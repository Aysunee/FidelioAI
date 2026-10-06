
import React, { useState, useRef, useEffect } from 'react';
import { X, Trash2, Save, Check, Image as ImageIcon, Plus, Maximize2, Shield, Clock, Loader2 } from 'lucide-react';
import { Trade } from './types';
import { cn } from '@/utils/cn';
import { TagSelector } from './TagSelector';
import { EmotionSelector } from './EmotionSelector';
import {
  computePnl,
  computeReturnPct,
  formatPrice,
  formatSignedPct,
  formatSignedUsd,
  getSignedPnl,
  toFiniteNumber,
  validateOutcome
} from './tradeMath';
import { deleteImages, MAX_IMAGES_PER_TRADE, saveImageFile, useImageUrls } from './imageStore';
import {
  badge, badgeAccent, badgeDanger, badgeInfo, badgeSuccess, btnCompact, btnDanger, btnDefault, btnPrimary,
  fieldLabel, iconBtn, inputBase, segIdle, segItem, segWrap
} from './styles';

const ROW = 'flex items-center justify-between gap-3 border-b border-border px-3 py-1.5';
const SECTION = 'shrink-0 border-b border-border px-3 py-2.5';
const THUMB_BTN = 'grid h-5 w-5 place-items-center rounded-sm border border-border bg-surface text-secondary transition-colors hover:bg-surface-highlight hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary';

interface TradeJournalModalProps {
  trade: Trade;
  onClose: () => void;
  onDelete: () => void;
  onUpdateTrade: (updates: Partial<Trade>) => void;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

const TradeJournalModal: React.FC<TradeJournalModalProps> = ({ trade, onClose, onDelete, onUpdateTrade }) => {
  const [notes, setNotes] = useState(trade.notes || '');
  const [images, setImages] = useState<string[]>(trade.images || []);
  const [tags, setTags] = useState<string[]>(trade.tags || []);
  const [emotion, setEmotion] = useState<string>(trade.emotion || '');
  const [status, setStatus] = useState<'WIN' | 'LOSS' | 'OPEN'>(trade.status);
  const [exit, setExit] = useState<string>(trade.exit?.toString() || '');
  const [isSaved, setIsSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [activeImage, setActiveImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageUrls = useImageUrls(images);

  const exitNum = toFiniteNumber(exit);
  const isClosing = status !== 'OPEN';
  // Outcome and exit untouched: the stored P&L stays authoritative (older records may hold a hand-entered value).
  const settlementUnchanged = isClosing && status === trade.status &&
    typeof trade.returnVal === 'number' && Number.isFinite(trade.returnVal) &&
    (exit.trim() === '' ? trade.exit === undefined : exitNum === trade.exit);
  const priceBasedPnl = isClosing && exitNum !== undefined && exitNum > 0 && trade.entry > 0 && trade.size > 0
    ? computePnl(trade.entry, exitNum, trade.size, trade.side)
    : undefined;
  const computedPnl = settlementUnchanged ? getSignedPnl(trade) : priceBasedPnl;
  const isManualPnl = settlementUnchanged && priceBasedPnl !== undefined && Math.abs(priceBasedPnl - getSignedPnl(trade)) > 1e-8;
  const displayPnl = isClosing ? (computedPnl ?? getSignedPnl(trade)) : 0;
  const displayPct = isClosing ? computeReturnPct(displayPnl, trade.entry, trade.size) : 0;

  const isDirty =
    notes !== (trade.notes || '') ||
    !sameList(images, trade.images || []) ||
    !sameList(tags, trade.tags || []) ||
    emotion !== (trade.emotion || '') ||
    status !== trade.status ||
    (status !== 'OPEN' && exitNum !== trade.exit);

  // Images uploaded in this modal but never committed must not stay orphaned in IndexedDB.
  const imagesRef = useRef<string[]>(images);
  imagesRef.current = images;
  const committedImagesRef = useRef<string[]>(trade.images || []);
  committedImagesRef.current = trade.images || [];
  useEffect(() => () => {
    const committed = new Set(committedImagesRef.current);
    const orphans = imagesRef.current.filter(ref => !committed.has(ref));
    if (orphans.length > 0) deleteImages(orphans);
  }, []);

  const requestClose = () => {
    if (isDirty && typeof window !== 'undefined' &&
      !window.confirm('Kaydedilmemiş değişiklikler var. Kaydetmeden kapatmak istiyor musunuz?')) {
      return;
    }
    onClose();
  };

  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  const activeImageRef = useRef(activeImage);
  activeImageRef.current = activeImage;
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (activeImageRef.current) setActiveImage(null);
      else requestCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleDelete = () => {
    if (typeof window !== 'undefined' &&
      !window.confirm(`${trade.symbol} işlem kaydı kalıcı olarak silinecek. Bu işlem geri alınamaz. Emin misiniz?`)) {
      return;
    }
    onDelete();
  };

  const handleSave = () => {
    if (isUploading) {
      setError('Görsel yüklemesi bitene kadar bekleyin.');
      return;
    }
    const updates: Partial<Trade> = {
      notes,
      images,
      tags,
      emotion: (emotion || undefined) as Trade['emotion'],
      status,
    };

    if (status === 'OPEN') {
      updates.exit = undefined;
      updates.returnVal = undefined;
      updates.returnPct = undefined;
    } else if (settlementUnchanged) {
      // Settlement not edited: keep the stored (signed) P&L untouched instead of recomputing it from prices.
    } else {
      if (exitNum === undefined || exitNum <= 0) {
        setError('İşlemi kapatmak için sıfırdan büyük bir çıkış fiyatı girin.');
        return;
      }
      if (!(trade.entry > 0) || !(trade.size > 0)) {
        setError('Bu kayıtta geçerli bir giriş fiyatı veya miktar yok; K/Z hesaplanamıyor.');
        return;
      }
      const pnl = computePnl(trade.entry, exitNum, trade.size, trade.side);
      const outcomeError = validateOutcome(status, pnl);
      if (outcomeError) {
        setError(outcomeError);
        return;
      }
      updates.exit = exitNum;
      updates.returnVal = pnl;
      updates.returnPct = computeReturnPct(pnl, trade.entry, trade.size);
    }

    setError(null);
    onUpdateTrade(updates);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (images.length >= MAX_IMAGES_PER_TRADE) {
      setError(`Bir işleme en fazla ${MAX_IMAGES_PER_TRADE} görsel eklenebilir.`);
      return;
    }
    setIsUploading(true);
    try {
      const ref = await saveImageFile(file);
      setImages(prev => [...prev, ref]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Görsel kaydedilemedi.');
    } finally {
      setIsUploading(false);
    }
  };

  const removeImage = (index: number) => {
    const ref = images[index];
    setImages(prev => prev.filter((_, i) => i !== index));
    // Not yet committed -> safe to drop now. Committed images are removed by the dashboard on save.
    if (ref && !(trade.images || []).includes(ref)) deleteImages([ref]);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-2 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trade-journal-title"
        className="flex h-[640px] max-h-[92dvh] w-full max-w-4xl animate-overlay-in flex-col overflow-hidden rounded-sm border border-border-strong bg-surface shadow-overlay"
      >
        {/* Header: identity + save / close */}
        <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border pl-3 pr-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="hidden shrink-0 text-[11px] font-semibold uppercase tracking-wider text-secondary sm:block" title="Multi-core telemetry analysis">Event Journal</h3>
            <h2 id="trade-journal-title" className="truncate text-xs font-semibold text-text">{trade.symbol}</h2>
            <div className={cn(
              badge,
              status === 'WIN' ? badgeSuccess :
                status === 'LOSS' ? badgeDanger :
                  badgeInfo
            )}>
              <div className="h-1.5 w-1.5 rounded-full bg-current" />
              <span>{status} PROTOCOL</span>
            </div>
            <div className="hidden items-center gap-1 whitespace-nowrap font-mono text-[11px] text-muted md:flex">
              <Clock size={12} /> {trade.date} • {trade.time}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={handleSave}
              className={cn(
                isSaved ? cn(btnDefault, 'border-transparent bg-success-soft text-success hover:bg-success-soft') : btnPrimary,
                btnCompact
              )}
            >
              {isSaved ? <Check size={14} /> : <Save size={14} />}
              {isSaved ? 'Kaydedildi' : isDirty ? 'Değişiklikleri Kaydet' : 'Kaydet'}
            </button>
            <button type="button" onClick={requestClose} aria-label="Kapat" className={iconBtn}>
              <X size={14} />
            </button>
          </div>
        </div>

        {error && (
          <div role="alert" className="shrink-0 border-b border-border bg-danger-soft px-3 py-1.5 text-[11px] font-medium text-danger">
            {error}
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
          {/* Left Side: Summary & Meta */}
          <div className="flex shrink-0 flex-col border-b border-border md:w-64 md:overflow-y-auto md:border-b-0 md:border-r">
            <div className="flex items-center gap-1 border-b border-border px-3 py-1.5 font-mono text-[11px] text-muted md:hidden">
              <Clock size={12} /> {trade.date} • {trade.time}
            </div>

            <div className="border-b border-border px-3 py-2">
              <span className={cn(fieldLabel, 'block')}>Settle Yield</span>
              <div className={cn(
                'font-mono text-xl font-semibold',
                status === 'OPEN' ? 'text-info' : displayPnl >= 0 ? 'text-success' : 'text-danger'
              )}>
                {status === 'OPEN' ? 'BEKLİYOR' : formatSignedUsd(displayPnl)}
                {status !== 'OPEN' && <span className="ml-1.5 text-[11px] font-normal opacity-70">({formatSignedPct(displayPct)})</span>}
              </div>
            </div>

            <div className={ROW}>
              <span className={fieldLabel}>Initialization</span>
              <div className="font-mono text-xs text-text">${trade.entry}</div>
            </div>
            <div className={ROW}>
              <span className={fieldLabel}>Termination</span>
              <div className="font-mono text-xs text-text">
                {status === 'OPEN' ? 'AÇIK' : formatPrice(exitNum)}
              </div>
            </div>
            <div className={ROW}>
              <span className={fieldLabel}>Volume Metric</span>
              <div className="font-mono text-xs uppercase text-text">{trade.size.toLocaleString()} UNITS</div>
            </div>

            {/* Settlement: always visible so closing a trade keeps the exit/P&L fields on screen */}
            <div className="space-y-2 border-b border-border px-3 py-2">
              <span className={cn(
                fieldLabel,
                'block',
                trade.status === 'OPEN' ? 'text-info' : ''
              )}>{trade.status === 'OPEN' ? 'Kapanış Gerekli' : 'Kapanış Bilgisi'}</span>
              <div className={segWrap}>
                <button
                  type="button"
                  aria-pressed={status === 'WIN'}
                  onClick={() => setStatus('WIN')}
                  className={cn(segItem, status === 'WIN' ? 'bg-success-soft text-success' : segIdle)}
                >Kazanç</button>
                <button
                  type="button"
                  aria-pressed={status === 'LOSS'}
                  onClick={() => setStatus('LOSS')}
                  className={cn(segItem, status === 'LOSS' ? 'bg-danger-soft text-danger' : segIdle)}
                >Kayıp</button>
                <button
                  type="button"
                  aria-pressed={status === 'OPEN'}
                  onClick={() => setStatus('OPEN')}
                  className={cn(segItem, status === 'OPEN' ? 'bg-info-soft text-info' : segIdle)}
                >Açık</button>
              </div>
              <label htmlFor="trade-journal-exit" className="sr-only">Çıkış fiyatı</label>
              <input
                id="trade-journal-exit"
                type="number"
                step="any"
                min="0"
                inputMode="decimal"
                disabled={status === 'OPEN'}
                placeholder="ÇIKIŞ FİYATI"
                className={cn(inputBase, 'font-mono')}
                value={exit}
                onChange={e => setExit(e.target.value)}
              />
              <div
                aria-live="polite"
                className={cn(
                  'font-mono text-[11px]',
                  status === 'OPEN' || computedPnl === undefined ? 'text-muted' : computedPnl >= 0 ? 'text-success' : 'text-danger'
                )}
              >
                {status === 'OPEN'
                  ? 'K/Z: açık işlem'
                  : computedPnl === undefined
                    ? 'K/Z: çıkış fiyatından otomatik hesaplanır'
                    : `K/Z: ${formatSignedUsd(computedPnl, 8)}${isManualPnl ? ' (kayıtlı değer)' : ''}`}
              </div>
            </div>

            <div className="border-b border-border px-3 py-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className={fieldLabel}>Execution Fidelity</span>
                <span className="font-mono text-xs text-text">{trade.efficiency}%</span>
              </div>
              <div className="h-1 bg-surface-highlight">
                <div
                  className={cn('h-full', trade.efficiency > 70 ? 'bg-success' : 'bg-warning')}
                  style={{ width: `${trade.efficiency}%` }}
                />
              </div>
            </div>

            <div className="mt-auto px-3 py-2">
              <button
                type="button"
                onClick={handleDelete}
                className={cn(btnDanger, 'w-full')}
              >
                <Trash2 size={12} />
                <span>Kaydı Sil</span>
              </button>
            </div>
          </div>

          {/* Right Side: Analysis & Notes */}
          <div className="flex min-w-0 flex-1 flex-col md:overflow-y-auto">
            <div className={SECTION}>
              <div className={cn(fieldLabel, 'mb-1.5 flex items-center gap-1.5')}>
                <Shield size={12} />
                <span>Strategic Setup</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {trade.setups.map((s, i) => (
                  <span key={i} className={cn(badge, badgeAccent)}>
                    {s}
                  </span>
                ))}
              </div>
            </div>

            <div className={SECTION}>
              <EmotionSelector selectedEmotion={emotion} onChange={setEmotion} />
            </div>

            <div className={SECTION}>
              <TagSelector selectedTags={tags} onChange={setTags} />
            </div>

            {/* Charts & Media Section */}
            <div className={SECTION}>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className={cn(fieldLabel, 'flex items-center gap-1.5')}>
                  <ImageIcon size={12} /> Visual Telemetry
                </span>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept="image/*"
                  onChange={handleImageUpload}
                />
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(btnDefault, btnCompact)}
                >
                  {isUploading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} {isUploading ? 'Yükleniyor...' : 'Görsel Ekle'}
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {images.map((img, idx) => (
                  <div
                    key={img}
                    className="relative aspect-video overflow-hidden rounded-sm border border-border bg-surface-secondary"
                  >
                    {imageUrls[img] && (
                      <img src={imageUrls[img] as string} alt={`İşlem görseli ${idx + 1}`} className="h-full w-full object-cover" />
                    )}
                    <div className="absolute right-0.5 top-0.5 flex items-center gap-0.5">
                      <button
                        type="button"
                        aria-label="Görseli büyüt"
                        onClick={() => setActiveImage(img)}
                        className={THUMB_BTN}
                      >
                        <Maximize2 size={12} />
                      </button>
                      <button
                        type="button"
                        aria-label="Görseli kaldır"
                        onClick={() => removeImage(idx)}
                        className={cn(THUMB_BTN, 'text-danger hover:text-danger')}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
                {images.length === 0 && (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="col-span-1 flex aspect-video cursor-pointer items-center justify-center gap-1.5 rounded-sm border border-dashed border-border-strong text-muted transition-colors hover:bg-surface-secondary hover:text-text"
                  >
                    <ImageIcon size={12} className="shrink-0" />
                    <span className="text-[10px] font-medium uppercase tracking-wider">Upload Matrix</span>
                  </div>
                )}
              </div>
            </div>

            {/* Notes Section */}
            <div className="flex min-h-[180px] flex-1 flex-col px-3 py-2.5">
              <span className={cn(fieldLabel, 'mb-1.5')}>Post-Session Analysis</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="DECODE EXECUTION LOGS, EMOTIONAL FREQUENCIES, AND OUTCOME VECTORS..."
                aria-label="Post-Session Analysis"
                className="min-h-0 flex-1 resize-none rounded-sm border border-border bg-surface-secondary p-2 text-xs leading-relaxed text-text outline-none placeholder:text-muted focus:border-primary"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox for Full Image */}
      {activeImage && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-background p-4 sm:p-8"
          onClick={() => setActiveImage(null)}
        >
          <button type="button" aria-label="Kapat" className={cn(iconBtn, 'absolute right-3 top-3 border border-border bg-surface')}>
            <X size={14} />
          </button>
          <img
            src={imageUrls[activeImage] || undefined}
            className="max-h-full max-w-full rounded-sm border border-border"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};

export default TradeJournalModal;
