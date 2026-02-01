
import React, { useState, useRef } from 'react';
import { X, Trash2, Calendar, Target, Briefcase, Activity, Save, Check, Image as ImageIcon, Plus, Maximize2 } from 'lucide-react';
import { Trade } from '../types';
import { motion, AnimatePresence } from 'framer-motion';

interface TradeJournalModalProps {
  trade: Trade;
  onClose: () => void;
  onDelete: () => void;
  onUpdateTrade: (updates: Partial<Trade>) => void;
}

const TradeJournalModal: React.FC<TradeJournalModalProps> = ({ trade, onClose, onDelete, onUpdateTrade }) => {
  const [notes, setNotes] = useState(trade.notes || '');
  const [images, setImages] = useState<string[]>(trade.images || []);
  const [isSaved, setIsSaved] = useState(false);
  const [activeImage, setActiveImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    onUpdateTrade({ notes, images });
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
      className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md"
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        className="bg-[#0b0e14] border border-white/10 rounded-3xl w-full max-w-5xl shadow-2xl overflow-hidden flex h-[700px]"
      >
        {/* Left Side: Summary & Meta */}
        <div className="w-72 border-r border-white/5 bg-[#11141f]/50 p-6 flex flex-col overflow-y-auto custom-scrollbar">
          <div className="mb-8">
            <div className={`inline-block px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest mb-4 ${trade.status === 'WIN' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
              }`}>
              {trade.status} TRADE
            </div>
            <h2 className="text-3xl font-extrabold text-white mb-2">{trade.symbol}</h2>
            <div className="flex items-center gap-2 text-slate-500 text-xs font-medium">
              <Calendar size={14} /> {trade.date}
            </div>
          </div>

          <div className="space-y-6 flex-1">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest block">Return</span>
              <div className={`text-xl font-bold ${trade.status === 'WIN' ? 'text-emerald-400' : 'text-rose-400'}`}>
                ${trade.returnVal.toLocaleString()} ({trade.returnPct}%)
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest block">Entry</span>
                <div className="text-sm font-semibold text-slate-200">${trade.entry}</div>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest block">Exit</span>
                <div className="text-sm font-semibold text-slate-200">${trade.exit}</div>
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest block">Size / Shares</span>
              <div className="text-sm font-semibold text-slate-200">{trade.size.toLocaleString()} units</div>
            </div>

            <div className="pt-4 border-t border-white/5">
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest block mb-3">Efficiency Score</span>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${trade.efficiency}%` }}
                    className={`h-full ${trade.efficiency > 70 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  />
                </div>
                <span className="text-xs font-bold text-slate-300">{trade.efficiency}%</span>
              </div>
            </div>
          </div>

          <button
            onClick={onDelete}
            className="mt-8 flex items-center justify-center gap-2 text-rose-500/50 hover:text-rose-500 text-[10px] font-bold uppercase transition-colors"
          >
            <Trash2 size={14} /> Delete Transaction
          </button>
        </div>

        {/* Right Side: Analysis & Notes */}
        <div className="flex-1 p-8 flex flex-col overflow-y-auto custom-scrollbar">
          <div className="flex justify-between items-center mb-6 shrink-0">
            <div className="flex items-center gap-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Target size={20} className="text-cyan-400" />
                Trade Journal
              </h3>
              <div className="h-4 w-px bg-white/10" />
              <button
                onClick={handleSave}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all ${isSaved ? 'bg-emerald-500/20 text-emerald-400' : 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30'}`}
              >
                {isSaved ? <Check size={14} /> : <Save size={14} />}
                {isSaved ? 'Saved' : 'Save Changes'}
              </button>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors text-slate-500 hover:text-white">
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 flex flex-col gap-6">
            {/* Top Analysis Grid */}
            <div className="grid grid-cols-2 gap-6 shrink-0">
              <div className="bg-white/5 border border-white/5 rounded-2xl p-4">
                <div className="flex items-center gap-2 text-cyan-400 mb-2">
                  <Briefcase size={16} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Active Setups</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {trade.setups.map((s, i) => (
                    <span key={i} className="bg-cyan-500/10 text-cyan-400 text-[10px] font-bold px-2 py-1 rounded-lg border border-cyan-500/20">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
              <div className="bg-white/5 border border-white/5 rounded-2xl p-4">
                <div className="flex items-center gap-2 text-purple-400 mb-2">
                  <Activity size={16} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Market Context</span>
                </div>
                <span className="text-[10px] text-slate-500 italic">No market data linked.</span>
              </div>
            </div>

            {/* Charts & Media Section */}
            <div className="shrink-0">
              <div className="flex justify-between items-center mb-3">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                  <ImageIcon size={14} /> Charts & Screenshots
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
                  className="text-[10px] font-bold text-cyan-400 hover:text-cyan-300 flex items-center gap-1 uppercase transition-colors"
                >
                  <Plus size={12} /> Add Image
                </button>
              </div>

              <div className="grid grid-cols-4 gap-3">
                {images.map((img, idx) => (
                  <div key={idx} className="aspect-video bg-black/40 rounded-xl overflow-hidden relative group border border-white/5">
                    <img src={img} alt={`Trade ${idx}`} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button
                        onClick={() => setActiveImage(img)}
                        className="p-1.5 bg-white/10 rounded-lg hover:bg-cyan-500 hover:text-white transition-colors text-white"
                      >
                        <Maximize2 size={14} />
                      </button>
                      <button
                        onClick={() => removeImage(idx)}
                        className="p-1.5 bg-white/10 rounded-lg hover:bg-rose-500 hover:text-white transition-colors text-white"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
                {images.length === 0 && (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="aspect-video col-span-1 bg-white/5 border border-dashed border-white/10 rounded-xl flex flex-col items-center justify-center gap-2 text-slate-600 hover:text-slate-400 hover:border-white/20 transition-all cursor-pointer group"
                  >
                    <ImageIcon size={24} className="opacity-50 group-hover:scale-110 transition-transform" />
                    <span className="text-[10px] font-bold uppercase">Upload Chart</span>
                  </div>
                )}
              </div>
            </div>

            {/* Notes Section */}
            <div className="flex-1 flex flex-col min-h-[200px]">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Analysis Notes</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Describe your execution, emotions, and outcome..."
                className="flex-1 bg-[#11141f] border border-white/5 rounded-2xl p-4 text-sm text-slate-300 focus:outline-none focus:border-cyan-500/50 transition-all resize-none placeholder:text-slate-700 leading-relaxed custom-scrollbar"
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
            className="fixed inset-0 z-[110] bg-black/90 backdrop-blur-xl flex items-center justify-center p-8"
            onClick={() => setActiveImage(null)}
          >
            <button className="absolute top-6 right-6 text-white/50 hover:text-white transition-colors">
              <X size={32} />
            </button>
            <img src={activeImage} className="max-w-full max-h-full rounded-lg shadow-2xl border border-white/10" onClick={(e) => e.stopPropagation()} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default TradeJournalModal;
