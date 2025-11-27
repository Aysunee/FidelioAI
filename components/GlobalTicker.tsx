
import React, { useState, useEffect, useRef } from 'react';
import { Ticker, MarketIndex } from '../types';
import { Pencil, X, Plus, GripVertical, TrendingUp, TrendingDown } from 'lucide-react';
import { Modal } from './ui/Modal';

interface GlobalTickerProps {
  spotData: Record<string, Ticker>;
  indicesData: MarketIndex[];
}

const DEFAULT_PINS = ['BTCUSDT', 'ETHUSDT', 'BTC.D', 'TOTAL', 'TOTAL3'];

export const GlobalTicker: React.FC<GlobalTickerProps> = ({ spotData, indicesData }) => {
  const [pinned, setPinned] = useState<string[]>(() => {
    const saved = localStorage.getItem('fidelio_pinned_ticker');
    return saved ? JSON.parse(saved) : DEFAULT_PINS;
  });
  
  const [isEditing, setIsEditing] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('fidelio_pinned_ticker', JSON.stringify(pinned));
  }, [pinned]);

  const handleRemove = (symbol: string) => {
    setPinned(prev => prev.filter(s => s !== symbol));
  };

  const handleAdd = () => {
    if (!newSymbol) return;
    const formatted = newSymbol.toUpperCase().trim();
    if (pinned.includes(formatted)) return;
    setPinned(prev => [...prev, formatted]);
    setNewSymbol('');
  };

  const resolveData = (symbol: string) => {
    const index = indicesData.find(i => i.symbol === symbol);
    if (index) {
        return { price: index.price, change: index.changePercent };
    }
    
    let searchKey = symbol;
    if (!symbol.endsWith('USDT') && !symbol.includes('.')) searchKey += 'USDT';
    
    const ticker = spotData[searchKey];
    if (ticker) {
        return { price: ticker.lastPrice, change: ticker.priceChangePercent };
    }
    return null;
  };

  const formatPrice = (symbol: string, price: number) => {
      if (symbol.includes('TOTAL')) {
          if (price >= 1_000_000_000_000) return `$${(price / 1_000_000_000_000).toFixed(3)}T`;
          if (price >= 1_000_000_000) return `$${(price / 1_000_000_000).toFixed(2)}B`;
      }
      if (price < 1) return price.toFixed(5);
      if (price > 1000) return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
      return price.toLocaleString(undefined, { maximumFractionDigits: 3 });
  };

  return (
    <>
      {/* Ticker Bar */}
      <div className="hidden lg:flex items-center bg-surface-secondary/20 border border-border/50 rounded-lg h-10 px-1 max-w-2xl w-full relative group">
         
         {/* Scrollable Content */}
         <div 
            ref={scrollRef}
            className="flex-1 flex items-center gap-4 overflow-x-auto scrollbar-hide px-3 mask-fade"
         >
            {pinned.map(sym => {
                const data = resolveData(sym);
                const priceDisplay = data ? formatPrice(sym, data.price) : '---';
                const change = data?.change || 0;
                const isPos = change >= 0;
                const isDom = sym.includes('.D');
                
                return (
                    <div key={sym} className="flex items-center gap-2 shrink-0 select-none">
                        <span className="text-[11px] font-bold text-secondary uppercase tracking-wider">{sym}</span>
                        <div className="flex items-center gap-1.5 bg-surface rounded px-1.5 py-0.5 border border-border/30">
                            <span className={`text-xs font-mono font-medium ${isPos ? 'text-text' : 'text-text'}`}>
                                {priceDisplay}{isDom ? '%' : ''}
                            </span>
                            <span className={`text-[10px] font-bold flex items-center ${isPos ? 'text-success' : 'text-danger'}`}>
                                {isPos ? <TrendingUp size={10} className="mr-0.5" /> : <TrendingDown size={10} className="mr-0.5" />}
                                {Math.abs(change).toFixed(2)}%
                            </span>
                        </div>
                    </div>
                );
            })}
         </div>

         {/* Edit Trigger */}
         <div className="pl-2 border-l border-border/50 shrink-0">
             <button 
                onClick={() => setIsEditing(true)}
                className="p-1.5 text-secondary hover:text-primary hover:bg-surface-secondary rounded-md transition-colors"
                title="Edit Ticker"
             >
                <Pencil size={12} />
             </button>
         </div>
      </div>

      {/* Modal */}
      <Modal isOpen={isEditing} onClose={() => setIsEditing(false)} title="Global Markets Config">
        <div className="space-y-6">
            <div className="bg-surface-secondary/30 p-4 rounded-xl border border-border/50">
                <p className="text-sm text-secondary mb-4">Drag to reorder or remove pinned assets.</p>
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                    {pinned.map((sym) => (
                        <div key={sym} className="flex items-center justify-between p-3 bg-surface rounded-lg border border-border shadow-sm group">
                            <div className="flex items-center gap-3">
                                <GripVertical size={16} className="text-secondary/50 cursor-move" />
                                <span className="font-bold text-text text-sm">{sym}</span>
                            </div>
                            <button 
                                onClick={() => handleRemove(sym)}
                                className="p-1.5 hover:bg-danger/10 text-secondary hover:text-danger rounded-md transition-colors opacity-0 group-hover:opacity-100"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex gap-3">
                <input 
                    type="text" 
                    value={newSymbol}
                    onChange={(e) => setNewSymbol(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                    placeholder="Add Symbol (e.g. SOL, BNB, TOTAL)"
                    className="flex-1 bg-surface-secondary border border-transparent focus:border-primary rounded-xl px-4 py-3 text-sm text-text outline-none uppercase font-mono"
                />
                <button 
                    onClick={handleAdd}
                    disabled={!newSymbol}
                    className="bg-primary hover:bg-primary/90 text-white px-5 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center shadow-lg shadow-primary/20"
                >
                    <Plus size={20} />
                </button>
            </div>
            
            <div className="pt-2 flex justify-end">
                <button 
                    onClick={() => setIsEditing(false)}
                    className="px-6 py-2.5 bg-text text-surface font-bold rounded-xl text-sm hover:opacity-90 transition-opacity"
                >
                    Save Changes
                </button>
            </div>
        </div>
      </Modal>
    </>
  );
};
