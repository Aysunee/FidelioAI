
import React, { useState, useRef } from 'react';
import { X, Trash2, Calendar, Target, Briefcase, Activity, Save, Check, Image as ImageIcon, Plus, Maximize2, Shield, Zap, TrendingUp, Clock } from 'lucide-react';
import { Trade } from './types';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/utils/cn';
import { TagSelector } from './TagSelector';
import { EmotionSelector } from './EmotionSelector';

interface TradeJournalModalProps {
  trade: Trade;
  onClose: () => void;
  onDelete: () => void;
  onUpdateTrade: (updates: Partial<Trade>) => void;
}

const TradeJournalModal: React.FC<TradeJournalModalProps> = ({ trade, onClose, onDelete, onUpdateTrade }) => {
  const [notes, setNotes] = useState(trade.notes || '');
  const [images, setImages] = useState<string[]>(trade.images || []);
  const [tags, setTags] = useState<string[]>(trade.tags || []);
  const [emotion, setEmotion] = useState<string>(trade.emotion || '');
  const [status, setStatus] = useState<'WIN' | 'LOSS' | 'OPEN'>(trade.status);
  const [exit, setExit] = useState<string>(trade.exit?.toString() || '');
  const [returnVal, setReturnVal] = useState<string>(trade.returnVal?.toString() || '');
  const [isSaved, setIsSaved] = useState(false);
  const [activeImage, setActiveImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    const finalExit = exit ? parseFloat(exit) : undefined;
    const finalReturn = returnVal ? parseFloat(returnVal) : undefined;
    const finalReturnPct = (finalReturn && trade.entry && trade.size)
      ? Math.round((finalReturn / (trade.entry * trade.size)) * 100)
      : trade.returnPct;

    onUpdateTrade({
      notes,
      images,
      tags,
      emotion: emotion as any,
      status,
      exit: finalExit,
      returnVal: finalReturn,
      returnPct: finalReturnPct
    });
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImages(prev => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-md"
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        className="bg-gray-950/80 border border-white/10 rounded-[32px] w-full max-w-5xl shadow-2xl overflow-hidden backdrop-blur-3xl flex h-[700px]"
      >
        {/* Left Side: Summary & Meta */}
        <div className="w-80 border-r border-white/5 bg-white/[0.01] p-8 flex flex-col overflow-y-auto scrollbar-hide">
          <div className="mb-10">
            <div className={cn(
              "inline-flex items-center gap-2 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.2em] mb-4 border",
              status === 'WIN' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                status === 'LOSS' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                  'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
            )}>
              <div className={cn(
                "w-1.5 h-1.5 rounded-full",
                status === 'WIN' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' :
                  status === 'LOSS' ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]' :
                    'bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.5)] animate-pulse'
              )} />
              <span>{status} PROTOCOL</span>
            </div>
            <h2 className="text-4xl font-black text-white tracking-tighter mb-2">{trade.symbol}</h2>
            <div className="flex items-center gap-2 text-gray-500 text-[10px] font-black uppercase tracking-widest">
              <Clock size={12} className="opacity-50" /> {trade.date} • {trade.time}
            </div>
          </div>

          <div className="space-y-8 flex-1">
            <div className="space-y-2">
              <span className="text-[9px] font-black text-gray-600 uppercase tracking-[0.2em] block">Settle Yield</span>
              <div className={cn(
                "text-2xl font-black tabular-nums",
                status === 'WIN' ? 'text-emerald-400' :
                  status === 'LOSS' ? 'text-rose-400' : 'text-cyan-400'
              )}>
                {status === 'OPEN' ? 'PENDING' : `$${(trade.returnVal || 0).toLocaleString()}`}
                {status !== 'OPEN' && <span className="text-xs opacity-50 ml-1">({trade.returnPct}%)</span>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <span className="text-[9px] font-black text-gray-600 uppercase tracking-[0.2em] block">Initialization</span>
                <div className="text-sm font-black text-white tabular-nums">${trade.entry}</div>
              </div>
              <div className="space-y-2">
                <span className="text-[9px] font-black text-gray-600 uppercase tracking-[0.2em] block">Termination</span>
                <div className="text-sm font-black text-white tabular-nums">
                  {status === 'OPEN' ? 'ACTIVE' : `$${trade.exit || 0}`}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-[9px] font-black text-gray-600 uppercase tracking-[0.2em] block">Volume Metric</span>
              <div className="text-sm font-black text-white uppercase tracking-widest">{trade.size.toLocaleString()} UNITS</div>
            </div>

            {status === 'OPEN' && (
              <div className="space-y-4 pt-6 border-t border-white/5 animate-in slide-in-from-left duration-500">
                <span className="text-[9px] font-black text-cyan-400 uppercase tracking-[0.2em] block underline decoration-cyan-500/30 underline-offset-8">Settlement Required</span>
                <div className="space-y-4 pt-2">
                  <div className="grid grid-cols-2 gap-2 p-1 bg-white/[0.02] border border-white/5 rounded-xl">
                    <button onClick={() => setStatus('WIN')} className="py-2 rounded-lg text-[8px] font-black uppercase tracking-widest text-gray-600 hover:text-emerald-400 transition-all">Win</button>
                    <button onClick={() => setStatus('LOSS')} className="py-2 rounded-lg text-[8px] font-black uppercase tracking-widest text-gray-600 hover:text-rose-400 transition-all">Loss</button>
                  </div>
                  <div className="space-y-2">
                    <input
                      type="number"
                      placeholder="EXIT PRICE"
                      className="w-full bg-white/[0.02] border border-white/5 rounded-xl px-4 py-2 text-[10px] font-black text-white placeholder:text-gray-800 focus:outline-none focus:border-cyan-500/40"
                      value={exit}
                      onChange={e => setExit(e.target.value)}
                    />
                    <input
                      type="number"
                      placeholder="NET YIELD ($)"
                      className="w-full bg-white/[0.02] border border-white/5 rounded-xl px-4 py-2 text-[10px] font-black text-white placeholder:text-gray-800 focus:outline-none focus:border-cyan-500/40"
                      value={returnVal}
                      onChange={e => setReturnVal(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="pt-6 border-t border-white/5">
              <div className="flex justify-between items-center mb-3">
                <span className="text-[9px] font-black text-gray-600 uppercase tracking-[0.2em]">Execution Fidelity</span>
                <span className="text-[10px] font-black text-white tabular-nums">{trade.efficiency}%</span>
              </div>
              <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${trade.efficiency}%` }}
                  className={cn("h-full", trade.efficiency > 70 ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.3)]')}
                />
              </div>
            </div>
          </div>

          <button
            onClick={onDelete}
            className="mt-10 flex items-center justify-center gap-2 text-rose-500/40 hover:text-rose-500 text-[9px] font-black uppercase tracking-[0.2em] transition-all group"
          >
            <Trash2 size={12} className="group-hover:rotate-12 transition-transform" />
            <span>Dissolve Record</span>
          </button>
        </div>

        {/* Right Side: Analysis & Notes */}
        <div className="flex-1 p-10 flex flex-col overflow-y-auto scrollbar-hide bg-white/[0.005]">
          <div className="flex justify-between items-center mb-10 shrink-0">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20 shadow-lg shadow-purple-500/5 text-purple-400">
                  <Target size={20} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-white uppercase tracking-tighter">Event Journal</h3>
                  <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest mt-1">Multi-core telemetry analysis</p>
                </div>
              </div>
              <div className="h-4 w-px bg-white/10" />
              <button
                onClick={handleSave}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                  isSaved
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20'
                    : 'bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/20'
                )}
              >
                {isSaved ? <Check size={14} /> : <Save size={14} />}
                {isSaved ? 'Synchronized' : 'Commit Changes'}
              </button>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors text-gray-500 hover:text-white">
              <X size={24} />
            </button>
          </div>

          <div className="flex-1 flex flex-col gap-10">
            {/* Top Analysis Grid */}
            <div className="grid grid-cols-2 gap-8 shrink-0">
              <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 hover:border-white/10 transition-all">
                <div className="flex items-center gap-2 text-purple-400 mb-4">
                  <Shield size={16} />
                  <span className="text-[9px] font-black uppercase tracking-[0.2em]">Strategic Setup</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {trade.setups.map((s, i) => (
                    <span key={i} className="bg-purple-500/10 text-purple-400 text-[9px] font-black px-3 py-1.5 rounded-lg border border-purple-500/20 uppercase tracking-widest">
                      {s}
                    </span>
                  ))}
                </div>
                {/* Emotion Selector inside the Strategic Card or below */}
                <div className="mt-8 pt-8 border-t border-white/5">
                  <EmotionSelector selectedEmotion={emotion} onChange={setEmotion} />
                </div>
              </div>
              <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 hover:border-white/10 transition-all">
                <TagSelector selectedTags={tags} onChange={setTags} />
              </div>
            </div>

            {/* Charts & Media Section */}
            <div className="shrink-0">
              <div className="flex justify-between items-center mb-6">
                <span className="text-[9px] font-black text-gray-600 uppercase tracking-[0.2em] flex items-center gap-2">
                  <ImageIcon size={14} /> Visual Telemetry
                </span>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept="image/*"
                  onChange={handleImageUpload}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[9px] font-black text-purple-400 hover:text-white transition-all uppercase tracking-[0.2em] flex items-center gap-2 bg-purple-500/10 px-3 py-1.5 rounded-xl border border-purple-500/20"
                >
                  <Plus size={12} /> Append Sample
                </button>
              </div>

              <div className="grid grid-cols-4 gap-4">
                {images.map((img, idx) => (
                  <motion.div
                    key={idx}
                    layoutId={`img-${idx}`}
                    className="aspect-video rounded-2xl overflow-hidden relative group border transition-all cursor-pointer shadow-lg"
                    style={{ backgroundColor: 'var(--bg-matrix-slot)', borderColor: 'var(--border-matrix-slot)' }}
                  >
                    <img src={img} alt={`Trade ${idx}`} className="w-full h-full object-cover group-hover:opacity-100 transition-opacity" style={{ opacity: 'var(--matrix-image-opacity)' }} />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                      <button
                        onClick={() => setActiveImage(img)}
                        className="p-2 bg-white/10 rounded-xl hover:bg-white/20 transition-colors text-white"
                      >
                        <Maximize2 size={16} />
                      </button>
                      <button
                        onClick={() => removeImage(idx)}
                        className="p-2 bg-white/10 rounded-xl hover:bg-rose-500 transition-colors text-white"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </motion.div>
                ))}
                {images.length === 0 && (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="aspect-video col-span-1 border border-dashed rounded-[24px] flex flex-col items-center justify-center gap-3 transition-all cursor-pointer group"
                    style={{ backgroundColor: 'var(--bg-matrix-slot)', borderColor: 'var(--border-matrix-slot)' }}
                  >
                    <ImageIcon size={24} className="opacity-30 group-hover:scale-110 transition-transform text-gray-500" />
                    <span className="text-[8px] font-black uppercase tracking-[0.2em] text-gray-500">Upload Matrix</span>
                  </div>
                )}
              </div>
            </div>

            {/* Notes Section */}
            <div className="flex-1 flex flex-col min-h-[250px]">
              <span className="text-[9px] font-black text-gray-600 uppercase tracking-[0.2em] mb-4">Post-Session Analysis</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="DECODE EXECUTION LOGS, EMOTIONAL FREQUENCIES, AND OUTCOME VECTORS..."
                className="flex-1 bg-white/[0.02] border border-white/5 rounded-[24px] p-6 text-sm text-gray-400 focus:outline-none focus:border-purple-500/40 transition-all resize-none placeholder:text-gray-800 leading-relaxed font-black uppercase tracking-wider scrollbar-hide"
              />
            </div>
          </div>
        </div>
      </motion.div>

      {/* Lightbox for Full Image */}
      <AnimatePresence>
        {activeImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-black/95 backdrop-blur-2xl flex items-center justify-center p-12"
            onClick={() => setActiveImage(null)}
          >
            <button className="absolute top-10 right-10 text-white/50 hover:text-white transition-colors">
              <X size={40} />
            </button>
            <motion.img
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              src={activeImage}
              className="max-w-full max-h-full rounded-[32px] shadow-[0_0_100px_rgba(0,0,0,0.5)] border border-white/10"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default TradeJournalModal;
