
import React, { useState, useRef } from 'react';
import { X, Save, Image as ImageIcon, Plus, Trash2 } from 'lucide-react';
import { Trade } from '../types';

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
    status: 'WIN' as 'WIN' | 'LOSS',
    returnVal: '',
    setup: '',
    efficiency: '',
    date: new Date().toISOString().split('T')[0],
    time: '09:30',
  });

  const [images, setImages] = useState<string[]>([]);
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
      date: new Date(formData.date).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).toUpperCase(),
      time: formData.time,
      entry: parseFloat(formData.entry),
      exit: parseFloat(formData.exit),
      size: parseInt(formData.size),
      side: formData.side,
      status: formData.status,
      returnVal: parseFloat(formData.returnVal),
      returnPct: Math.round((parseFloat(formData.returnVal) / (parseFloat(formData.entry) * parseInt(formData.size))) * 100) || 0,
      setups: [formData.setup || 'MANUAL'],
      efficiency: parseInt(formData.efficiency) || 0,
      images: images,
    };
    onSubmit(trade);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-[#11141f] border border-gray-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-800 flex justify-between items-center bg-white/5 shrink-0">
          <h2 className="text-lg font-bold text-white">Add New Trade</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto custom-scrollbar p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase">Symbol</label>
                <input
                  required
                  className="w-full bg-[#0a0c14] border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 transition-colors"
                  placeholder="AAPL, BTC, etc."
                  value={formData.symbol}
                  onChange={e => setFormData({ ...formData, symbol: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase">Return $</label>
                <input
                  required
                  type="number"
                  className="w-full bg-[#0a0c14] border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 transition-colors"
                  placeholder="2500"
                  value={formData.returnVal}
                  onChange={e => setFormData({ ...formData, returnVal: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase">Side</label>
                <select
                  className="w-full bg-[#0a0c14] border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
                  value={formData.side}
                  onChange={e => setFormData({ ...formData, side: e.target.value as any })}
                >
                  <option value="LONG">LONG</option>
                  <option value="SHORT">SHORT</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase">Status</label>
                <select
                  className="w-full bg-[#0a0c14] border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
                  value={formData.status}
                  onChange={e => setFormData({ ...formData, status: e.target.value as any })}
                >
                  <option value="WIN">WIN</option>
                  <option value="LOSS">LOSS</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase">Entry</label>
                <input required type="number" step="0.01" className="w-full bg-[#0a0c14] border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500" value={formData.entry} onChange={e => setFormData({ ...formData, entry: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase">Exit</label>
                <input required type="number" step="0.01" className="w-full bg-[#0a0c14] border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500" value={formData.exit} onChange={e => setFormData({ ...formData, exit: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase">Size</label>
                <input required type="number" className="w-full bg-[#0a0c14] border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500" value={formData.size} onChange={e => setFormData({ ...formData, size: e.target.value })} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase">Date</label>
                <input
                  type="date"
                  required
                  className="w-full bg-[#0a0c14] border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
                  value={formData.date}
                  onChange={e => setFormData({ ...formData, date: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase">Time</label>
                <input
                  type="time"
                  className="w-full bg-[#0a0c14] border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
                  value={formData.time}
                  onChange={e => setFormData({ ...formData, time: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase">Setup Tag</label>
                <input
                  className="w-full bg-[#0a0c14] border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
                  placeholder="e.g. GAP UP"
                  value={formData.setup}
                  onChange={e => setFormData({ ...formData, setup: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase">Efficiency %</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  className="w-full bg-[#0a0c14] border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
                  placeholder="0-100"
                  value={formData.efficiency}
                  onChange={e => setFormData({ ...formData, efficiency: e.target.value })}
                />
              </div>
            </div>

            {/* Image Upload Section */}
            <div className="space-y-2 pt-2 border-t border-white/5">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold text-gray-500 uppercase flex items-center gap-2">
                  <ImageIcon size={14} /> Attachments
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
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[10px] font-bold text-cyan-400 hover:text-cyan-300 flex items-center gap-1 uppercase transition-colors"
                >
                  <Plus size={12} /> Add
                </button>
              </div>

              <div className="flex gap-3 overflow-x-auto pb-2 custom-scrollbar">
                {images.map((img, idx) => (
                  <div key={idx} className="w-16 h-16 shrink-0 bg-black/40 rounded-lg overflow-hidden relative group border border-white/10">
                    <img src={img} alt="preview" className="w-full h-full object-cover opacity-80" />
                    <button
                      type="button"
                      onClick={() => removeImage(idx)}
                      className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-rose-500"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                {images.length === 0 && (
                  <div className="w-full py-4 border border-dashed border-gray-800 rounded-lg text-center">
                    <span className="text-[10px] text-gray-600">No images attached</span>
                  </div>
                )}
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-cyan-500 hover:bg-cyan-400 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg shadow-cyan-500/20"
            >
              <Save size={18} /> SAVE TRADE
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AddTradeModal;
