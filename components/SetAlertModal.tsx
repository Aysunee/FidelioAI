import React, { useState, useEffect } from 'react';
import { Bell, TrendingUp, TrendingDown } from 'lucide-react';

interface SetAlertModalProps {
  symbol: string;
  currentPrice: number;
  onSave: (price: number, condition: 'ABOVE' | 'BELOW') => void;
  onCancel: () => void;
}

export const SetAlertModal: React.FC<SetAlertModalProps> = ({ symbol, currentPrice, onSave, onCancel }) => {
  const [targetPrice, setTargetPrice] = useState<string>(currentPrice.toString());
  const [condition, setCondition] = useState<'ABOVE' | 'BELOW'>('ABOVE');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const price = parseFloat(targetPrice);
    if (isNaN(price) || price <= 0) return;
    onSave(price, condition);
  };

  return (
    <div className="space-y-6 pt-2">
      <div className="text-center">
         <h3 className="text-3xl font-display font-bold text-text tracking-tight">${currentPrice.toLocaleString()}</h3>
         <p className="text-secondary text-sm font-medium">Current Price</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-secondary uppercase tracking-wide ml-1">Trigger Price</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-text font-semibold">$</span>
            <input
              type="number"
              step="any"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              className="w-full bg-surface-secondary border-none rounded-xl px-4 pl-8 py-4 text-xl font-semibold text-text focus:ring-2 focus:ring-primary/20 transition-all outline-none"
              autoFocus
            />
          </div>
        </div>

        {/* iOS Segmented Control */}
        <div className="bg-surface-secondary p-1 rounded-xl flex">
          <button
            type="button"
            onClick={() => setCondition('ABOVE')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm ${
              condition === 'ABOVE'
                ? 'bg-surface text-text'
                : 'bg-transparent text-secondary shadow-none hover:text-text'
            }`}
          >
            Above
          </button>
          <button
            type="button"
            onClick={() => setCondition('BELOW')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm ${
              condition === 'BELOW'
                ? 'bg-surface text-text'
                : 'bg-transparent text-secondary shadow-none hover:text-text'
            }`}
          >
            Below
          </button>
        </div>

        <button 
            type="submit"
            className="w-full bg-primary hover:bg-primary/90 text-white py-4 rounded-xl text-[17px] font-semibold transition-all shadow-lg shadow-primary/20 active:scale-[0.98]"
        >
            Create Alert
        </button>
      </form>
    </div>
  );
};