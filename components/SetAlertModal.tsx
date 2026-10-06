import React, { useState } from 'react';

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

  const segment = 'h-6 flex-1 rounded-sm text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary';

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 border-b border-border pb-3">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted">Current Price</p>
        <h3 className="font-mono text-2xl font-semibold text-text">${currentPrice.toLocaleString()}</h3>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="alert-trigger-price" className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted">Trigger Price</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 font-mono text-xs text-secondary">$</span>
            <input
              id="alert-trigger-price"
              type="number"
              step="any"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              className="h-7 w-full rounded-sm border border-border bg-surface-secondary pl-5 pr-2 font-mono text-xs text-text outline-none placeholder:text-muted focus:border-primary"
              autoFocus
            />
          </div>
        </div>

        {/* Segmented control */}
        <div className="flex rounded-sm border border-border p-0.5">
          <button
            type="button"
            onClick={() => setCondition('ABOVE')}
            aria-pressed={condition === 'ABOVE'}
            className={`${segment} ${
              condition === 'ABOVE'
                ? 'bg-surface-highlight text-text'
                : 'text-secondary hover:text-text'
            }`}
          >
            Above
          </button>
          <button
            type="button"
            onClick={() => setCondition('BELOW')}
            aria-pressed={condition === 'BELOW'}
            className={`${segment} ${
              condition === 'BELOW'
                ? 'bg-surface-highlight text-text'
                : 'text-secondary hover:text-text'
            }`}
          >
            Below
          </button>
        </div>

        <button
            type="submit"
            className="h-7 w-full rounded-sm bg-primary px-2.5 text-xs font-medium text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
        >
            Create Alert
        </button>
      </form>
    </div>
  );
};
