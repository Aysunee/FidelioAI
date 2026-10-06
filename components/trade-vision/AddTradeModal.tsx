
import React, { useState, useRef, useEffect } from 'react';
import { X, Save, Image as ImageIcon, Plus, Trash2, Loader2 } from 'lucide-react';
import { Trade } from './types';
import { cn } from '@/utils/cn';
import { TagSelector } from './TagSelector';
import { EmotionSelector } from './EmotionSelector';
import {
  computePnl,
  computeReturnPct,
  createTradeId,
  formatSignedUsd,
  normalizeTimeInput,
  toFiniteNumber,
  toLocalDateInput,
  toLocalTimeInput,
  validateOutcome
} from './tradeMath';
import { deleteImages, MAX_IMAGES_PER_TRADE, saveImageFile, useImageUrls } from './imageStore';
import { btnCompact, btnDefault, btnPrimary, fieldLabel, iconBtn, inputBase, segIdle, segItem, segWrap } from './styles';

const FIELD = 'flex min-w-0 flex-col gap-1';
const LABEL = `${fieldLabel} truncate`;

interface AddTradeModalProps {
  onClose: () => void;
  onSubmit: (trade: Trade) => void;
}

const AddTradeModal: React.FC<AddTradeModalProps> = ({ onClose, onSubmit }) => {
  const [formData, setFormData] = useState(() => {
    const now = new Date();
    return {
      symbol: '',
      entry: '',
      exit: '',
      size: '',
      side: 'LONG' as 'LONG' | 'SHORT',
      status: 'WIN' as 'WIN' | 'LOSS' | 'OPEN',
      setup: '',
      efficiency: '',
      // Local calendar date/time (toISOString() would shift to the previous day in UTC+3 between 00:00-03:00)
      date: toLocalDateInput(now),
      time: toLocalTimeInput(now),
    };
  });

  const [images, setImages] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [emotion, setEmotion] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);
  const imagesRef = useRef<string[]>([]);
  imagesRef.current = images;
  const imageUrls = useImageUrls(images);

  const entryNum = toFiniteNumber(formData.entry);
  const exitNum = toFiniteNumber(formData.exit);
  const sizeNum = toFiniteNumber(formData.size);
  const isClosed = formData.status !== 'OPEN';
  const computedPnl = isClosed && entryNum && exitNum && sizeNum && entryNum > 0 && exitNum > 0 && sizeNum > 0
    ? computePnl(entryNum, exitNum, sizeNum, formData.side)
    : undefined;

  // Images uploaded in this modal but never saved must not stay orphaned in IndexedDB.
  useEffect(() => () => {
    if (!submittedRef.current && imagesRef.current.length > 0) deleteImages(imagesRef.current);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

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
    if (ref) deleteImages([ref]);
  };

  const validate = (): string | null => {
    if (!formData.symbol.trim()) return 'Sembol zorunludur.';
    if (entryNum === undefined || entryNum <= 0) return 'Giriş fiyatı sıfırdan büyük olmalıdır.';
    if (sizeNum === undefined || sizeNum <= 0) return 'Miktar sıfırdan büyük olmalıdır.';
    if (isClosed && (exitNum === undefined || exitNum <= 0)) return 'Kapalı işlemler için çıkış fiyatı sıfırdan büyük olmalıdır.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(formData.date)) return 'Geçerli bir tarih seçin.';
    if (formData.time && !normalizeTimeInput(formData.time)) return 'Geçerli bir saat girin (SS:DD).';
    const efficiency = formData.efficiency === '' ? 0 : toFiniteNumber(formData.efficiency);
    if (efficiency === undefined || efficiency < 0 || efficiency > 100) return 'Uygulama skoru 0 ile 100 arasında olmalıdır.';
    if (isClosed && computedPnl !== undefined) return validateOutcome(formData.status, computedPnl);
    return null;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isUploading) {
      setError('Görsel yüklemesi bitene kadar bekleyin.');
      return;
    }
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    const entry = entryNum as number;
    const size = sizeNum as number;
    const pnl = isClosed ? computePnl(entry, exitNum as number, size, formData.side) : undefined;
    const setup = formData.setup.trim().toUpperCase();
    const trade: Trade = {
      id: createTradeId(),
      symbol: formData.symbol.trim().toUpperCase(),
      date: formData.date, // local YYYY-MM-DD
      time: normalizeTimeInput(formData.time),
      entry,
      exit: isClosed ? exitNum : undefined,
      size,
      side: formData.side,
      status: formData.status,
      returnVal: pnl,
      returnPct: pnl === undefined ? undefined : computeReturnPct(pnl, entry, size),
      setups: setup ? [setup] : [],
      efficiency: Math.round(toFiniteNumber(formData.efficiency) ?? 0),
      images: images,
      tags: tags,
      emotion: (emotion || undefined) as Trade['emotion'],
    };
    submittedRef.current = true;
    onSubmit(trade);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-2 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-trade-title"
        className="flex max-h-[92dvh] w-full max-w-xl animate-overlay-in flex-col overflow-hidden rounded-sm border border-border-strong bg-surface shadow-overlay"
      >
        <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border pl-3 pr-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 id="add-trade-title" className="truncate text-xs font-semibold text-text">Sample Initialization</h2>
            <p className="hidden truncate text-[10px] uppercase tracking-wider text-muted sm:block">Register new vector telemetry</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Kapat" className={iconBtn}>
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
              <div className={FIELD}>
                <label htmlFor="add-trade-symbol" className={LABEL}>Vector Identifier</label>
                <input
                  id="add-trade-symbol"
                  required
                  className={cn(inputBase, 'uppercase')}
                  placeholder="E.G. NVDA, BTC, SPY"
                  value={formData.symbol}
                  onChange={e => setFormData({ ...formData, symbol: e.target.value })}
                />
              </div>
              <div className={FIELD}>
                <label htmlFor="add-trade-pnl" className={LABEL}>Kâr / Zarar ($) · otomatik</label>
                <input
                  id="add-trade-pnl"
                  readOnly
                  tabIndex={-1}
                  className={cn(
                    inputBase,
                    'cursor-default font-mono focus:border-border',
                    computedPnl === undefined ? 'text-secondary' : computedPnl >= 0 ? 'text-success' : 'text-danger'
                  )}
                  placeholder={isClosed ? 'Giriş, çıkış ve miktardan hesaplanır' : 'Açık işlem'}
                  value={computedPnl === undefined ? '' : formatSignedUsd(computedPnl, 8)}
                />
              </div>

              <div className={FIELD}>
                <label className={LABEL}>Directional Bias</label>
                <div className={segWrap}>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, side: 'LONG' })}
                    className={cn(segItem, formData.side === 'LONG' ? 'bg-success-soft text-success' : segIdle)}
                  >Long</button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, side: 'SHORT' })}
                    className={cn(segItem, formData.side === 'SHORT' ? 'bg-danger-soft text-danger' : segIdle)}
                  >Short</button>
                </div>
              </div>
              <div className={FIELD}>
                <label className={LABEL}>Outcome Status</label>
                <div className={segWrap}>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, status: 'WIN' })}
                    className={cn(segItem, formData.status === 'WIN' ? 'bg-success-soft text-success' : segIdle)}
                  >Kazanç</button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, status: 'LOSS' })}
                    className={cn(segItem, formData.status === 'LOSS' ? 'bg-danger-soft text-danger' : segIdle)}
                  >Kayıp</button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, status: 'OPEN' })}
                    className={cn(segItem, formData.status === 'OPEN' ? 'bg-info-soft text-info' : segIdle)}
                  >Açık</button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-x-3 gap-y-2.5">
              <div className={FIELD}>
                <label htmlFor="add-trade-entry" className={LABEL}>Giriş Fiyatı</label>
                <input id="add-trade-entry" required type="number" step="any" min="0" inputMode="decimal" className={cn(inputBase, 'font-mono')} value={formData.entry} onChange={e => setFormData({ ...formData, entry: e.target.value })} />
              </div>
              <div className={FIELD}>
                <label htmlFor="add-trade-exit" className={LABEL}>Çıkış Fiyatı {formData.status === 'OPEN' && '(İsteğe bağlı)'}</label>
                <input id="add-trade-exit" required={formData.status !== 'OPEN'} disabled={formData.status === 'OPEN'} type="number" step="any" min="0" inputMode="decimal" className={cn(inputBase, 'font-mono')} value={formData.status === 'OPEN' ? '' : formData.exit} onChange={e => setFormData({ ...formData, exit: e.target.value })} />
              </div>
              <div className={FIELD}>
                <label htmlFor="add-trade-size" className={LABEL}>Miktar</label>
                <input id="add-trade-size" required type="number" step="any" min="0" inputMode="decimal" className={cn(inputBase, 'font-mono')} value={formData.size} onChange={e => setFormData({ ...formData, size: e.target.value })} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
              <div className={FIELD}>
                <label htmlFor="add-trade-date" className={LABEL}>Temporal Date</label>
                <input
                  id="add-trade-date"
                  type="date"
                  required
                  className={cn(inputBase, 'font-mono')}
                  value={formData.date}
                  onChange={e => setFormData({ ...formData, date: e.target.value })}
                />
              </div>
              <div className={FIELD}>
                <label htmlFor="add-trade-time" className={LABEL}>Temporal Time</label>
                <input
                  id="add-trade-time"
                  type="time"
                  className={cn(inputBase, 'font-mono')}
                  value={formData.time}
                  onChange={e => setFormData({ ...formData, time: e.target.value })}
                />
              </div>

              <div className={FIELD}>
                <label htmlFor="add-trade-setup" className={LABEL}>Strategic Logic</label>
                <input
                  id="add-trade-setup"
                  className={cn(inputBase, 'uppercase')}
                  placeholder="E.G. LIQUIDITY GAP"
                  value={formData.setup}
                  onChange={e => setFormData({ ...formData, setup: e.target.value })}
                />
              </div>
              <div className={FIELD}>
                <label htmlFor="add-trade-efficiency" className={LABEL}>Efficiency Ratio (%)</label>
                <input
                  id="add-trade-efficiency"
                  type="number"
                  min="0"
                  max="100"
                  className={cn(inputBase, 'font-mono')}
                  placeholder="0-100"
                  value={formData.efficiency}
                  onChange={e => setFormData({ ...formData, efficiency: e.target.value })}
                />
              </div>
            </div>

            {/* Emotion Tracking Section */}
            <div className="border-t border-border pt-3">
              <EmotionSelector selectedEmotion={emotion} onChange={setEmotion} />
            </div>

            {/* Tags Section */}
            <div className="border-t border-border pt-3">
              <TagSelector selectedTags={tags} onChange={setTags} />
            </div>

            {/* Image Upload Section */}
            <div className="space-y-1.5 border-t border-border pt-3">
              <div className="flex items-center justify-between gap-2">
                <label className={cn(LABEL, 'flex items-center gap-1.5')}>
                  <ImageIcon size={12} /> Neural Telemetry / Screenshots
                </label>
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

              <div className="flex gap-2 overflow-x-auto scrollbar-hide">
                {images.map((img, idx) => (
                  <div key={img} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-sm border border-border bg-surface-secondary">
                    {imageUrls[img] && (
                      <img src={imageUrls[img] as string} alt={`Görsel ${idx + 1}`} className="h-full w-full object-cover" />
                    )}
                    <button
                      type="button"
                      aria-label="Görseli kaldır"
                      onClick={() => removeImage(idx)}
                      className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-sm border border-border bg-surface text-danger transition-colors hover:bg-surface-highlight focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                {images.length === 0 && (
                  <div className="flex w-full items-center gap-1.5 py-1 text-[11px] text-muted">
                    <ImageIcon size={12} className="shrink-0" />
                    <span>No visual telemetry</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="shrink-0 border-t border-border">
            {error && (
              <div role="alert" className="border-b border-border bg-danger-soft px-3 py-1.5 text-[11px] font-medium text-danger">
                {error}
              </div>
            )}
            <div className="flex justify-end px-3 py-2">
              <button
                type="submit"
                className={cn(btnPrimary, 'w-full sm:w-auto')}
              >
                <Save size={14} /> Synchronize Data
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddTradeModal;
