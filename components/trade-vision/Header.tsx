import React, { useState } from 'react';
import { ChevronDown, Plus, X, Calculator } from 'lucide-react';
import { Trade } from './types';
import { FilterState } from '../TradeVisionDashboard';
import { cn } from '@/utils/cn';
import { ExportButton } from './ExportButton';
import { badge, badgeAccent, btnCompact, btnDefault, btnPrimary, menuSurface } from './styles';

interface HeaderProps {
  filters: FilterState;
  onFilterChange: (key: keyof FilterState, value: string | null) => void;
  onClear: () => void;
  onOpenModal: () => void;
  onOpenCalculator: () => void;
  /** Filtered trades (used for export). */
  trades: Trade[];
  /** Full, unfiltered list: dropdown options must not shrink when a filter is active. */
  allTrades?: Trade[];
}

const focusRing = 'focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary';

const Header: React.FC<HeaderProps> = ({ filters, onFilterChange, onClear, onOpenModal, onOpenCalculator, trades, allTrades }) => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const optionSource = allTrades ?? trades;

  const getUnique = (key: keyof Trade) => {
    if (key === 'setups') {
      const all = optionSource.flatMap(t => t.setups);
      return Array.from(new Set(all));
    }
    if (key === 'tags') {
      const all = optionSource.flatMap(t => t.tags || []);
      return Array.from(new Set(all));
    }
    return Array.from(new Set(optionSource.map(t => t[key] as string)));
  };

  const filterConfigs = [
    { label: 'SYMBOL', key: 'symbol' as keyof FilterState, options: getUnique('symbol') },
    { label: 'SETUPS', key: 'setup' as keyof FilterState, options: getUnique('setups') },
    { label: 'SIDE', key: 'side' as keyof FilterState, options: getUnique('side') },
    { label: 'STATUS', key: 'status' as keyof FilterState, options: getUnique('status') },
    { label: 'TAGS', key: 'tag' as keyof FilterState, options: getUnique('tags' as any) },
  ];

  const activeFilters = Object.entries(filters).filter(([, value]) => value);

  return (
    <div className="relative z-30 shrink-0 bg-surface">
      {/* Toolbar: filters on the left, actions on the right (wraps on narrow screens) */}
      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1 lg:py-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium uppercase tracking-wider text-secondary sm:gap-x-3">
          {filterConfigs.map((cfg, idx) => (
            <div key={cfg.label} className="relative">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={activeMenu === cfg.label}
                onClick={() => setActiveMenu(activeMenu === cfg.label ? null : cfg.label)}
                className={cn(
                  'flex h-6 items-center gap-1 rounded-sm uppercase tracking-wider transition-colors hover:text-text',
                  focusRing,
                  filters[cfg.key] ? 'text-primary' : ''
                )}
              >
                {cfg.label} <ChevronDown size={12} />
              </button>

              {activeMenu === cfg.label && (
                <div
                  role="menu"
                  className={cn(
                    'absolute top-full z-50 mt-1 max-h-64 w-44 overflow-y-auto py-1',
                    menuSurface,
                    // The last menus open towards the left on narrow screens so they never leave the viewport.
                    idx >= 3 ? 'right-0 lg:left-0 lg:right-auto' : 'left-0'
                  )}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { onFilterChange(cfg.key, null); setActiveMenu(null); }}
                    className="flex h-7 w-full items-center px-3 text-left text-xs uppercase text-muted transition-colors hover:bg-surface-secondary hover:text-text"
                  >
                    All {cfg.label}
                  </button>
                  {cfg.options.map(opt => (
                    <button
                      type="button"
                      role="menuitem"
                      key={opt}
                      onClick={() => { onFilterChange(cfg.key, opt); setActiveMenu(null); }}
                      className={cn(
                        'flex h-7 w-full items-center px-3 text-left text-xs uppercase transition-colors hover:bg-surface-secondary',
                        filters[cfg.key] === opt ? 'bg-surface-highlight text-primary' : 'text-text'
                      )}
                    >
                      <span className="truncate">{opt}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="hidden h-3 w-px bg-border sm:block" />
          <button
            type="button"
            className={cn('h-6 rounded-sm uppercase tracking-wider text-primary transition-opacity hover:opacity-80', focusRing)}
            onClick={onClear}
          >
            RESET
          </button>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={onOpenCalculator} className={cn(btnDefault, btnCompact)}>
            <Calculator size={12} /> Calculator
          </button>
          <ExportButton trades={trades} />
          <button type="button" onClick={onOpenModal} className={cn(btnPrimary, btnCompact)}>
            <Plus size={12} /> Add Trade
          </button>
        </div>
      </div>

      {/* Active filters: thin sub-row, only while a filter is set */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-t border-border px-3 py-1">
          {activeFilters.map(([key, value]) => (
            <div key={key} className={cn(badge, badgeAccent)}>
              {key}: {value}
              <X
                size={12}
                className="cursor-pointer opacity-70 hover:opacity-100"
                onClick={() => onFilterChange(key as keyof FilterState, null)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Header;
