
import React, { useState, useRef } from 'react';
import { X, Save, Image as ImageIcon, Plus, Trash2, Crosshair, Target, Activity, Zap } from 'lucide-react';
import { Trade } from './types';
import { cn } from '@/utils/cn';
import { motion, AnimatePresence } from 'framer-motion';
import { TagSelector } from './TagSelector';
import { EmotionSelector } from './EmotionSelector';

interface AddTradeModalProps {
  onClose: () => void;
  onSubmit: (trade: Trade) => void;
}

const AddTradeModal: React.FC<AddTradeModalProps> = ({ onClose, onSubmit }) => {
  const [formData, setFormData] = useState({
    symbol: '',
    entry: '',
    exit: '',
    size: '',
    side: 'LONG' as 'LONG' | 'SHORT',
    status: 'WIN' as 'WIN' | 'LOSS' | 'OPEN',
    returnVal: '',
    setup: '',
    efficiency: '',
    date: new Date().toISOString().split('T')[0],
    time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }),
  });

  const [images, setImages] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [emotion, setEmotion] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trade: Trade = {
      id: Math.random().toString(36).substr(2, 9),
      symbol: formData.symbol.toUpperCase(),
      date: formData.date, // Store ISO for sorting, UI displays formatted
      time: formData.time,
      entry: parseFloat(formData.entry),
      exit: formData.status === 'OPEN' ? undefined : parseFloat(formData.exit),
      size: parseFloat(formData.size),
      side: formData.side,
      status: formData.status,
      returnVal: formData.status === 'OPEN' ? undefined : parseFloat(formData.returnVal),
      returnPct: formData.status === 'OPEN' ? undefined : Math.round((parseFloat(formData.returnVal) / (parseFloat(formData.entry) * parseFloat(formData.size))) * 100) || 0,
      setups: [formData.setup || 'STRATEGIC'],
      efficiency: parseInt(formData.efficiency) || 0,
      images: images,
      tags: tags,
      emotion: emotion as any,
    };
    onSubmit(trade);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-md animate-in fade-in duration-300">
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-gray-950/80 border border-white/10 rounded-[32px] w-full max-w-xl shadow-2xl overflow-hidden backdrop-blur-3xl flex flex-col max-h-[90vh]"
      >
        <div className="px-8 py-6 border-b border-white/5 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20 shadow-lg shadow-purple-500/5">
              <Crosshair size={20} className="text-purple-400" />
            </div>
            <div>
              <h2 className="text-xl font-black text-white uppercase tracking-tighter">Sample Initialization</h2>
              <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest mt-1">Register new vector telemetry</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full text-gray-500 hover:text-white transition-all">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto scrollbar-hide p-8">
          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[9px] font-black text-gray-600 uppercase tracking-[0.2em] ml-1">Vector Identifier</label>
                <input
                  required
                  className="w-full bg-white/[0.02] border border-white/5 rounded-2xl px-5 py-3 text-sm text-white focus:outline-none focus:border-purple-500/40 transition-all uppercase placeholder:text-gray-800"
                  placeholder="E.G. NVDA, BTC, SPY"
                  value={formData.symbol}
                  onChange={e => setFormData({ ...formData, symbol: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-gray-600 uppercase tracking-[0.2em] ml-1">Settlement Yield ($) {formData.status === 'OPEN' && '(Optional)'}</label>
                <input
                  required={formData.status !== 'OPEN'}
                  type="number"
                  step="0.01"
                  className="w-full bg-white/[0.02] border border-white/5 rounded-2xl px-5 py-3 text-sm text-white focus:outline-none focus:border-purple-500/40 transition-all placeholder:text-gray-800 tabular-nums"
                  placeholder="0.00"
                  value={formData.returnVal}
                  onChange={e => setFormData({ ...formData, returnVal: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[9px] font-black text-gray-600 uppercase tracking-[0.2em] ml-1">Directional Bias</label>
                <div className="grid grid-cols-2 gap-3 p-1 bg-white/[0.02] border border-white/5 rounded-2xl">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, side: 'LONG' })}
                    className={cn(
                      "py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                      formData.side === 'LONG' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-gray-600 hover:text-gray-400'
                    )}
                  >Long</button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, side: 'SHORT' })}
                    className={cn(
                      "py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                      formData.side === 'SHORT' ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20' : 'text-gray-600 hover:text-gray-400'
                    )}
                  >Short</button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-gray-600 uppercase tracking-[0.2em] ml-1">Outcome Status</label>
                <div className="grid grid-cols-3 gap-3 p-1 bg-white/[0.02] border border-white/5 rounded-2xl">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, status: 'WIN' })}
                    className={cn(
                      "py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                      formData.status === 'WIN' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'text-gray-600 hover:text-gray-400'
                    )}
                  >Win</button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, status: 'LOSS' })}
                    className={cn(
                      "py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                      formData.status === 'LOSS' ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20' : 'text-gray-600 hover:text-gray-400'
                    )}
                  >Loss</button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, status: 'OPEN' })}
                    className={cn(
                      "py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                      formData.status === 'OPEN' ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/20' : 'text-gray-600 hover:text-gray-400'
                    )}
                  >Active</button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="text-[9px] font-black text-gray-600 uppercase tracking-[0.2em] ml-1">Origin Unit</label>
                <input required type="number" step="0.01" className="w-full bg-white/[0.02] border border-white/5 rounded-2xl px-5 py-3 text-sm text-white focus:outline-none focus:border-purple-500/40 transition-all tabular-nums" value={formData.entry} onChange={e => setFormData({ ...formData, entry: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-gray-600 uppercase tracking-[0.2em] ml-1">Exit Point {formData.status === 'OPEN' && '(Optional)'}</label>
                <input required={formData.status !== 'OPEN'} type="number" step="0.01" className="w-full bg-white/[0.02] border border-white/5 rounded-2xl px-5 py-3 text-sm text-white focus:outline-none focus:border-purple-500/40 transition-all tabular-nums" value={formData.exit} onChange={e => setFormData({ ...formData, exit: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-gray-600 uppercase tracking-[0.2em] ml-1">Exposure Size</label>
                <input required type="number" className="w-full bg-white/[0.02] border border-white/5 rounded-2xl px-5 py-3 text-sm text-white focus:outline-none focus:border-purple-500/40 transition-all tabular-nums" value={formData.size} onChange={e => setFormData({ ...formData, size: e.target.value })} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[9px] font-black text-gray-600 uppercase tracking-[0.2em] ml-1">Temporal Date</label>
                <input
                  type="date"
                  required
                  className="w-full bg-white/[0.02] border border-white/5 rounded-2xl px-5 py-3 text-sm text-white focus:outline-none focus:border-purple-500/40 transition-all"
                  value={formData.date}
                  onChange={e => setFormData({ ...formData, date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-gray-600 uppercase tracking-[0.2em] ml-1">Temporal Time</label>
                <input
                  type="time"
                  className="w-full bg-white/[0.02] border border-white/5 rounded-2xl px-5 py-3 text-sm text-white focus:outline-none focus:border-purple-500/40 transition-all"
                  value={formData.time}
                  onChange={e => setFormData({ ...formData, time: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[9px] font-black text-gray-600 uppercase tracking-[0.2em] ml-1">Strategic Logic</label>
                <input
                  className="w-full bg-white/[0.02] border border-white/5 rounded-2xl px-5 py-3 text-sm text-white focus:outline-none focus:border-purple-500/40 transition-all uppercase placeholder:text-gray-800"
                  placeholder="E.G. LIQUIDITY GAP"
                  value={formData.setup}
                  onChange={e => setFormData({ ...formData, setup: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[9px] font-black text-gray-600 uppercase tracking-[0.2em] ml-1">Efficiency Ratio (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  className="w-full bg-white/[0.02] border border-white/5 rounded-2xl px-5 py-3 text-sm text-white focus:outline-none focus:border-purple-500/40 transition-all placeholder:text-gray-800 tabular-nums"
                  placeholder="0-100"
                  value={formData.efficiency}
                  onChange={e => setFormData({ ...formData, efficiency: e.target.value })}
                />
              </div>
            </div>

            {/* Emotion Tracking Section */}
            <div className="pt-6 border-t border-white/5">
              <EmotionSelector selectedEmotion={emotion} onChange={setEmotion} />
            </div>

            {/* Tags Section */}
            <div className="pt-6 border-t border-white/5">
              <TagSelector selectedTags={tags} onChange={setTags} />
            </div>

            {/* Image Upload Section */}
            <div className="space-y-4 pt-4 border-t border-white/5">
              <div className="flex justify-between items-center">
                <label className="text-[9px] font-black text-gray-600 uppercase tracking-[0.2em] flex items-center gap-2">
                  <ImageIcon size={14} /> Neural Telemetry / Screenshots
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
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 bg-white/5 border border-white/5 rounded-xl text-[9px] font-black text-purple-400 hover:text-white transition-all uppercase tracking-widest flex items-center gap-2"
                >
                  <Plus size={12} /> Append Vector
                </button>
              </div>

              <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
                {images.map((img, idx) => (
                  <div key={idx} className="w-20 h-20 shrink-0 rounded-2xl overflow-hidden relative group border transition-all" style={{ backgroundColor: 'var(--bg-matrix-slot)', borderColor: 'var(--border-matrix-slot)' }}>
                    <img src={img} alt="preview" className="w-full h-full object-cover group-hover:opacity-100 transition-opacity" style={{ opacity: 'var(--matrix-image-opacity)' }} />
                    <button
                      type="button"
                      onClick={() => removeImage(idx)}
                      className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-rose-500"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                {images.length === 0 && (
                  <div className="w-full py-8 border-2 border-dashed rounded-[24px] flex flex-col items-center justify-center gap-2" style={{ borderColor: 'var(--border-matrix-slot)' }}>
                    <ImageIcon size={24} className="text-gray-800 opacity-40" />
                    <span className="text-[8px] font-black text-gray-700 uppercase tracking-widest opacity-40">No visual telemetry</span>
                  </div>
                )}
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white text-[11px] font-black uppercase tracking-[0.2em] py-4 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-[0.98] shadow-2xl shadow-purple-500/20"
            >
              <Save size={18} /> Synchronize Data
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
};

export default AddTradeModal;
