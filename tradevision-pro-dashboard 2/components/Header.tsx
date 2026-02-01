
import React, { useState } from 'react';
import { ChevronDown, Plus, X, Calculator } from 'lucide-react';
import { Trade } from '../types';
import { FilterState } from '../App';

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
    return Array.from(new Set(trades.map(t => t[key] as string)));
  };

  const filterConfigs = [
    { label: 'SYMBOL', key: 'symbol' as keyof FilterState, options: getUnique('symbol') },
    { label: 'SETUPS', key: 'setup' as keyof FilterState, options: getUnique('setups') },
    { label: 'SIDE', key: 'side' as keyof FilterState, options: getUnique('side') },
    { label: 'STATUS', key: 'status' as keyof FilterState, options: getUnique('status') },
  ];

  return (
    <div className="bg-[#11141f] px-6 py-4 border-b border-gray-800 z-30">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-semibold text-white">Reports</h1>
          <div className="flex items-center gap-4 text-xs font-medium text-gray-400 relative">
            {filterConfigs.map((cfg) => (
              <div key={cfg.label} className="relative">
                <button
                  onClick={() => setActiveMenu(activeMenu === cfg.label ? null : cfg.label)}
                  className={`flex items-center gap-1 hover:text-white transition-colors uppercase ${filters[cfg.key] ? 'text-cyan-400' : ''}`}
                >
                  {cfg.label} <ChevronDown size={14} />
                </button>

                {activeMenu === cfg.label && (
                  <div className="absolute top-full left-0 mt-2 w-48 bg-[#1a1f2e] border border-gray-700 rounded-lg shadow-2xl py-2 z-50">
                    <button
                      onClick={() => { onFilterChange(cfg.key, null); setActiveMenu(null); }}
                      className="w-full text-left px-4 py-2 hover:bg-white/5 text-gray-400 hover:text-white"
                    >
                      All {cfg.label}
                    </button>
                    {cfg.options.map(opt => (
                      <button
                        key={opt}
                        onClick={() => { onFilterChange(cfg.key, opt); setActiveMenu(null); }}
                        className={`w-full text-left px-4 py-2 hover:bg-white/5 ${filters[cfg.key] === opt ? 'text-cyan-400 bg-cyan-400/5' : 'text-gray-300'}`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div className="h-4 w-px bg-gray-700 mx-2" />
            <button className="text-cyan-500 font-bold hover:text-cyan-400 transition-colors uppercase" onClick={onClear}>Clear Filters</button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onOpenCalculator}
            className="bg-[#161b22] hover:bg-white/5 border border-white/10 text-slate-300 hover:text-white px-3 py-2 rounded-lg font-bold text-xs transition-all flex items-center gap-2 active:scale-95"
          >
            <Calculator size={16} /> <span className="hidden sm:inline">CALCULATOR</span>
          </button>
          <button
            onClick={onOpenModal}
            className="bg-cyan-500 hover:bg-cyan-400 text-white px-4 py-2 rounded-lg font-bold text-xs transition-all flex items-center gap-2 shadow-lg shadow-cyan-500/20 active:scale-95"
          >
            <Plus size={16} /> ADD TRADE
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 h-6">
        {Object.entries(filters).map(([key, value]) => value && (
          <div key={key} className="bg-indigo-600/20 border border-indigo-500/30 text-[10px] font-bold text-indigo-300 px-2 py-1 rounded flex items-center gap-2 uppercase animate-in fade-in slide-in-from-left-2">
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
