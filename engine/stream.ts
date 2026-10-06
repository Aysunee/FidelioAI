// Reconnecting market-data stream for the engine host (Node, `ws` package).
//
//  - 'connecting' until the first message of a connection arrives, 'connected' while data flows,
//    'down' between a drop and the next attempt.
//  - Exponential backoff (1 s … 30 s, ±20% jitter); the backoff resets once a connection delivers data.
//  - Stale detection: an open socket without a message for `staleMs` (60 s) is dropped and reconnected.
//    Binance also closes every connection after 24 h; that is a normal drop.
//  - Fallback URLs: a connection that never delivered data moves on to the next URL of the list
//    (fstream's legacy `/stream` route accepts connections but stays silent, so silence counts as failure).

import WebSocket from 'ws';
import type { EngineLogger, SocketFactory, SocketLike, StreamState } from './types';

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const HANDSHAKE_TIMEOUT_MS = 15_000;

export const defaultSocketFactory: SocketFactory = (url) =>
    new WebSocket(url, { handshakeTimeout: HANDSHAKE_TIMEOUT_MS, perMessageDeflate: false }) as unknown as SocketLike;

export interface StreamOptions {
    name: string;
    urls: readonly string[];
    onData: (payload: unknown, receivedAt: number) => void;
    createSocket: SocketFactory;
    now: () => number;
    log: EngineLogger;
    staleMs: number;
    watchdogMs: number;
}

export interface StreamHandle {
    state(): StreamState;
    lastDataAt(): number;
    url(): string;
    close(): void;
}

const toText = (raw: unknown): string | null => {
    if (typeof raw === 'string') return raw;
    if (Buffer.isBuffer(raw)) return raw.toString('utf8');
    if (Array.isArray(raw) && raw.every((part) => Buffer.isBuffer(part))) return Buffer.concat(raw as Buffer[]).toString('utf8');
    if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
    return null;
};

export function openStream(options: StreamOptions): StreamHandle {
    const { name, urls, log } = options;
    if (urls.length === 0) throw new Error(`${name}: URL listesi boş`);

    let socket: SocketLike | null = null;
    let state: StreamState = 'connecting';
    let closed = false;
    let attempt = 0;
    let urlIndex = 0;
    let openedAt = 0;      // when the current socket was created
    let lastDataAt = 0;
    let gotData = false;   // the current socket delivered at least one message
    let failures = 0;      // consecutive connections that delivered nothing (log throttling)
    let lastError = '';
    let handlerErrors = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const detach = (s: SocketLike | null) => {
        if (!s) return;
        try {
            s.removeAllListeners();
            // A late 'error' from a terminated socket must not become an uncaught exception.
            s.on('error', () => { /* ignored */ });
            s.terminate();
        } catch { /* already gone */ }
    };

    const scheduleReconnect = () => {
        if (closed || reconnectTimer) return;
        state = 'down';
        const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt) * (0.8 + Math.random() * 0.4);
        attempt = Math.min(attempt + 1, 10);
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, delay);
    };

    // The current connection ended (closed, failed or went silent).
    const dropped = (reason: string) => {
        if (closed) return;
        if (gotData) {
            log.warn(`[engine] ${name}: ${reason}, yeniden bağlanılıyor`);
        } else {
            failures++;
            const from = urls[urlIndex];
            urlIndex = (urlIndex + 1) % urls.length;
            if (failures === 1 || failures % 10 === 0) {
                const detail = lastError ? `${reason}: ${lastError}` : reason;
                const next = urls.length > 1 ? `, sıradaki adres: ${urls[urlIndex]}` : '';
                log.warn(`[engine] ${name}: ${from} veri vermedi (${detail}; ${failures}. deneme${next})`);
            }
        }
        scheduleReconnect();
    };

    const connect = () => {
        if (closed) return;
        state = 'connecting';
        gotData = false;
        lastError = '';
        openedAt = options.now();
        let s: SocketLike;
        try {
            s = options.createSocket(urls[urlIndex]);
        } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
            dropped('soket açılamadı');
            return;
        }
        socket = s;

        s.on('message', (raw) => {
            if (socket !== s || closed) return;
            const at = options.now();
            lastDataAt = at;
            if (!gotData) {
                gotData = true;
                attempt = 0;
                if (failures > 0) log.info(`[engine] ${name}: veri akışı yeniden başladı (${urls[urlIndex]})`);
                failures = 0;
            }
            state = 'connected';
            const text = toText(raw);
            if (text === null) return;
            let payload: unknown;
            try {
                payload = JSON.parse(text);
            } catch {
                return;
            }
            try {
                options.onData(payload, at);
            } catch (err) {
                handlerErrors++;
                if (handlerErrors === 1 || handlerErrors % 100 === 0) {
                    log.error(`[engine] ${name}: mesaj işlenemedi (${handlerErrors}. kez): ${err instanceof Error ? err.message : String(err)}`);
                }
            }
        });
        s.on('error', (err) => {
            if (socket !== s) return;
            lastError = err && err.message ? err.message : 'bilinmeyen hata';
            // 'close' follows and schedules the reconnect.
        });
        s.on('close', () => {
            if (socket !== s) return;
            socket = null;
            dropped('bağlantı kapandı');
        });
    };

    const watchdog = setInterval(() => {
        if (closed || !socket) return;
        const reference = gotData ? lastDataAt : openedAt;
        if (options.now() - reference <= options.staleMs) return;
        const stale = socket;
        socket = null;
        detach(stale);
        dropped(`${Math.round(options.staleMs / 1000)} sn boyunca veri gelmedi`);
    }, options.watchdogMs);

    connect();

    return {
        state: () => state,
        lastDataAt: () => lastDataAt,
        url: () => urls[urlIndex],
        close: () => {
            if (closed) return;
            closed = true;
            state = 'down';
            clearInterval(watchdog);
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = null;
            const s = socket;
            socket = null;
            detach(s);
        },
    };
}
