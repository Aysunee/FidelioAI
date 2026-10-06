import React from 'react';
import { Liquidation } from '../types';
import { Droplets } from 'lucide-react';

interface LiquidationsFeedProps {
  liquidations: Liquidation[];
  /** Maximum number of entries shown in the strip. */
  limit?: number;
}

const formatValue = (val: number) => {
  if (val >= 1000000) return `$${(val / 1000000).toFixed(2)}M`;
  if (val >= 1000) return `$${(val / 1000).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
};

const formatTime = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Compact, horizontally scrolling ticker that fills the h-8 bottom strip of the app shell
// (the strip itself, App.tsx, owns the background and the top border).
// Newest liquidation first (MarketContext prepends new events).
export const LiquidationsFeed: React.FC<LiquidationsFeedProps> = ({ liquidations, limit = 30 }) => {
  const items = liquidations.slice(0, limit);

  return (
    <div className="flex h-full min-w-0 items-stretch" role="region" aria-label="Canlı likidasyonlar">
      <div className="flex shrink-0 items-center gap-1.5 border-r border-border px-3 text-[10px] font-semibold uppercase tracking-wider text-secondary">
        <Droplets size={12} />
        <span className="hidden sm:inline" lang="tr">Likidasyonlar</span>
      </div>

      <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden scrollbar-hide">
        {items.length === 0 ? (
          <span className="flex h-full items-center whitespace-nowrap px-3 text-[11px] text-muted">Likidasyon bekleniyor…</span>
        ) : (
          <ul className="flex h-full items-stretch divide-x divide-border whitespace-nowrap">
            {items.map((liq) => {
              const isLongLiq = liq.side === 'LONG';
              const colorClass = isLongLiq ? 'text-danger' : 'text-success';
              const symbolBase = liq.symbol.replace('USDT', '');
              const binanceLink = `https://www.binance.com/en/futures/${liq.symbol}`;

              return (
                <li key={liq.id} className="shrink-0">
                  <a
                    href={binanceLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`${liq.symbol} ${liq.side} likidasyonu: ${formatValue(liq.value)} @ ${liq.price}`}
                    className="flex h-full items-center gap-1.5 px-2.5 font-mono text-[11px] transition-colors hover:bg-surface-secondary focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-primary"
                  >
                    <span className="text-muted">{formatTime(liq.time)}</span>
                    <span className="font-semibold text-text">{symbolBase}</span>
                    <span className={`font-semibold ${colorClass}`}>{liq.side}</span>
                    <span className="text-text">{formatValue(liq.value)}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};
