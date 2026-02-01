import React, { useState } from 'react';
import { ChevronDown, Plus, X, Calculator } from 'lucide-react';
import { Trade } from './types';
import { FilterState } from '../TradeVisionDashboard';
import { cn } from '@/utils/cn';
import { ExportButton } from './ExportButton';

interface HeaderProps {
  filters: FilterState;
  onFilterChange: (key: keyof FilterState, value: string | null) => void;
  onClear: () => void;
  onOpenModal: () => void;
  onOpenCalculator: () => void;
  trades: Trade[];
}



const Header: React.FC<HeaderProps> = ({ filters, onFilterChange, onClear, onOpenModal, onOpenCalculator, trades }) => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  const getUnique = (key: keyof Trade) => {
    if (key === 'setups') {
      const all = trades.flatMap(t => t.setups);
      return Array.from(new Set(all));
    }
    if (key === 'tags') {
      const all = trades.flatMap(t => t.tags || []);
      return Array.from(new Set(all));
    }
    return Array.from(new Set(trades.map(t => t[key] as string)));
  };

  const filterConfigs = [
    { label: 'SYMBOL', key: 'symbol' as keyof FilterState, options: getUnique('symbol') },
    { label: 'SETUPS', key: 'setup' as keyof FilterState, options: getUnique('setups') },
    { label: 'SIDE', key: 'side' as keyof FilterState, options: getUnique('side') },
    { label: 'STATUS', key: 'status' as keyof FilterState, options: getUnique('status') },
    { label: 'TAGS', key: 'tag' as keyof FilterState, options: getUnique('tags' as any) },
  ];

  return (
    <div className="bg-white/[0.01] px-2 py-4 border-b border-white/5 z-30">
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4 text-[10px] font-black text-gray-500 relative tracking-widest uppercase">
            {filterConfigs.map((cfg) => (
              <div key={cfg.label} className="relative">
                <button
                  onClick={() => setActiveMenu(activeMenu === cfg.label ? null : cfg.label)}
                  className={cn(
                    "flex items-center gap-1 hover:text-white transition-colors",
                    filters[cfg.key] ? 'text-purple-400' : ''
                  )}
                >
                  {cfg.label} <ChevronDown size={12} />
                </button>

                {activeMenu === cfg.label && (
                  <div className="absolute top-full left-0 mt-2 w-48 bg-gray-950/90 border border-white/10 rounded-xl shadow-2xl py-2 z-50 backdrop-blur-xl">
                    <button
                      onClick={() => { onFilterChange(cfg.key, null); setActiveMenu(null); }}
                      className="w-full text-left px-4 py-2 hover:bg-white/5 text-gray-500 hover:text-white transition-colors"
                    >
                      All {cfg.label}
                    </button>
                    {cfg.options.map(opt => (
                      <button
                        key={opt}
                        onClick={() => { onFilterChange(cfg.key, opt); setActiveMenu(null); }}
                        className={cn(
                          "w-full text-left px-4 py-2 hover:bg-white/5 transition-colors",
                          filters[cfg.key] === opt ? 'text-purple-400 bg-purple-400/5' : 'text-gray-400'
                        )}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div className="h-4 w-[1px] bg-white/5 mx-2" />
            <button className="text-purple-500 font-black hover:text-purple-400 transition-colors" onClick={onClear}>RESET</button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onOpenCalculator}
            className="bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 hover:text-white px-4 py-2 rounded-xl font-bold text-[10px] tracking-widest transition-all flex items-center gap-2 active:scale-95 uppercase"
          >
            <Calculator size={14} /> Calculator
          </button>
          <ExportButton trades={trades} />
          <button
            onClick={onOpenModal}
            className="bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-400 hover:to-indigo-400 text-white px-5 py-2 rounded-xl font-black text-[10px] tracking-widest transition-all flex items-center gap-2 shadow-lg shadow-purple-500/20 active:scale-95 uppercase"
          >
            <Plus size={14} /> Add Trade
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 h-6">
        {Object.entries(filters).map(([key, value]) => value && (
          <div key={key} className="bg-purple-500/10 border border-purple-500/20 text-[9px] font-black text-purple-400 px-2 py-0.5 rounded-lg flex items-center gap-2 uppercase tracking-tighter">
            {key}: {value}
            <X
              size={12}
              className="cursor-pointer opacity-70 hover:opacity-100"
              onClick={() => onFilterChange(key as keyof FilterState, null)}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default Header;
