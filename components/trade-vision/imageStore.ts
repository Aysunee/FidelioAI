import { useEffect, useState } from 'react';

// Journal screenshots live in IndexedDB as (compressed) Blobs. Trades only keep
// references of the form "idb:<id>" so localStorage stays small.

const DB_NAME = 'fidelio_journal';
const DB_VERSION = 1;
const STORE_NAME = 'images';
const REF_PREFIX = 'idb:';

export const MAX_IMAGE_INPUT_BYTES = 15 * 1024 * 1024; // raw file limit before compression
export const MAX_IMAGES_PER_TRADE = 6;
const MAX_DIMENSION = 1600;
const TARGET_BYTES = 600 * 1024;
const MAX_STORED_BYTES = 2 * 1024 * 1024;

// Errors whose message is safe to show to the user as-is.
export class ImageStoreError extends Error {}

export const isImageRef = (value: string) => typeof value === 'string' && value.startsWith(REF_PREFIX);
const refToId = (ref: string) => ref.slice(REF_PREFIX.length);

let dbPromise: Promise<IDBDatabase> | null = null;

const openDb = (): Promise<IDBDatabase> => {
    if (typeof indexedDB === 'undefined') {
        return Promise.reject(new ImageStoreError('Bu tarayıcıda görsel depolama (IndexedDB) kullanılamıyor.'));
    }
    if (!dbPromise) {
        dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
            let request: IDBOpenDBRequest;
            try {
                request = indexedDB.open(DB_NAME, DB_VERSION);
            } catch (err) {
                reject(err);
                return;
            }
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('IndexedDB açılamadı.'));
            request.onblocked = () => reject(new Error('IndexedDB başka bir sekme tarafından engellendi.'));
        }).catch(err => {
            dbPromise = null;
            throw err;
        });
    }
    return dbPromise;
};

const runTransaction = async <T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> => {
    const db = await openDb();
    return new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const request = action(tx.objectStore(STORE_NAME));
        let result: T;
        request.onsuccess = () => { result = request.result; };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || request.error);
        tx.onabort = () => reject(tx.error || new Error('IndexedDB işlemi iptal edildi.'));
    });
};

const generateId = () => {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    } catch { /* ignore */ }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const canvasToBlob = (canvas: HTMLCanvasElement, quality: number) =>
    new Promise<Blob | null>(resolve => {
        try {
            canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality);
        } catch {
            resolve(null);
        }
    });

const loadImage = (blob: Blob) =>
    new Promise<{ img: HTMLImageElement; url: string }>((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => resolve({ img, url });
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new ImageStoreError('Görsel okunamadı. Lütfen geçerli bir resim dosyası seçin.'));
        };
        img.src = url;
    });

// Downscales to MAX_DIMENSION and re-encodes as JPEG until it fits TARGET_BYTES.
const compressImage = async (blob: Blob): Promise<Blob> => {
    if (typeof document === 'undefined') return blob;
    const { img, url } = await loadImage(blob);
    try {
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        if (!width || !height) return blob;
        const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return blob;
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        let quality = 0.85;
        let output = await canvasToBlob(canvas, quality);
        while (output && output.size > TARGET_BYTES && quality > 0.45) {
            quality -= 0.1;
            output = await canvasToBlob(canvas, quality);
        }
        if (!output) return blob;
        // Keep the original if it was already small and did not need resizing.
        if (scale === 1 && blob.size <= output.size) return blob;
        return output;
    } finally {
        URL.revokeObjectURL(url);
    }
};

const storeBlob = async (blob: Blob): Promise<string> => {
    const compressed = await compressImage(blob);
    if (compressed.size > MAX_STORED_BYTES) {
        throw new ImageStoreError('Görsel sıkıştırıldıktan sonra bile çok büyük. Daha küçük bir ekran görüntüsü deneyin.');
    }
    const id = generateId();
    await runTransaction('readwrite', store => store.put(compressed, id));
    return `${REF_PREFIX}${id}`;
};

// Validates, compresses and stores an uploaded file. Throws ImageStoreError with a Turkish message.
export const saveImageFile = async (file: File): Promise<string> => {
    if (!file.type || !file.type.startsWith('image/')) {
        throw new ImageStoreError('Yalnızca resim dosyaları yüklenebilir.');
    }
    if (file.size > MAX_IMAGE_INPUT_BYTES) {
        throw new ImageStoreError('Görsel çok büyük (en fazla 15 MB).');
    }
    try {
        return await storeBlob(file);
    } catch (err) {
        if (err instanceof ImageStoreError) throw err;
        console.warn('[imageStore] görsel kaydedilemedi:', err);
        throw new ImageStoreError('Görsel kaydedilemedi: tarayıcı depolama alanı kullanılamıyor veya dolu.');
    }
};

const dataUrlToBlob = (dataUrl: string): Blob => {
    const [header, data] = dataUrl.split(',');
    const mime = /data:([^;]+)/.exec(header || '')?.[1] || 'image/png';
    const isBase64 = /;base64/i.test(header || '');
    const decoded = isBase64 ? atob(data || '') : decodeURIComponent(data || '');
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
    return new Blob([bytes], { type: mime });
};

// Used to migrate legacy base64 screenshots out of localStorage.
export const saveDataUrl = async (dataUrl: string): Promise<string> => storeBlob(dataUrlToBlob(dataUrl));

const urlCache = new Map<string, string>();

const getImageUrl = async (ref: string): Promise<string | null> => {
    if (!isImageRef(ref)) return ref; // legacy data URL / plain URL
    const cached = urlCache.get(ref);
    if (cached) return cached;
    const blob = await runTransaction<Blob | undefined>('readonly', store => store.get(refToId(ref)));
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urlCache.set(ref, url);
    return url;
};

export const deleteImages = async (refs: string[]): Promise<void> => {
    const targets = refs.filter(isImageRef);
    if (targets.length === 0) return;
    for (const ref of targets) {
        const cached = urlCache.get(ref);
        if (cached) {
            try { URL.revokeObjectURL(cached); } catch { /* ignore */ }
            urlCache.delete(ref);
        }
    }
    try {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            targets.forEach(ref => store.delete(refToId(ref)));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } catch (err) {
        console.warn('[imageStore] görseller silinemedi:', err);
    }
};

// Resolves image references to displayable URLs. Missing entries map to null.
export const useImageUrls = (refs: string[]): Record<string, string | null> => {
    const [urls, setUrls] = useState<Record<string, string | null>>({});
    const key = refs.join('|');

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const next: Record<string, string | null> = {};
            for (const ref of refs) {
                try {
                    next[ref] = await getImageUrl(ref);
                } catch {
                    next[ref] = null;
                }
            }
            if (!cancelled) setUrls(next);
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    return urls;
};
