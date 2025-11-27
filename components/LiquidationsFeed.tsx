
import React, { useEffect, useRef } from 'react';
import { Liquidation } from '../types';
import { Card } from './ui/Card';
import { Skull, Droplets, LineChart, ExternalLink } from 'lucide-react';

interface LiquidationsFeedProps {
  liquidations: Liquidation[];
}

export const LiquidationsFeed: React.FC<LiquidationsFeedProps> = ({ liquidations }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom like a terminal
  useEffect(() => {
    if (scrollRef.current) {
        // Only auto-scroll if user is already near bottom
        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
        if (scrollHeight - scrollTop - clientHeight < 100) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }
  }, [liquidations]);

  const formatValue = (val: number) => {
    if (val >= 1000000) return `$${(val / 1000000).toFixed(2)}M`;
    if (val >= 1000) return `$${(val / 1000).toFixed(1)}K`;
    return `$${val.toFixed(0)}`;
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <Card 
        title="Live Liquidations" 
        className="h-full"
        action={<Droplets size={14} className="text-secondary animate-pulse" />}
    >
      <div className="flex flex-col h-full bg-surface">
         {/* Header */}
         <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-surface-secondary/50 border-b border-border text-[10px] font-bold text-secondary uppercase tracking-wider">
            <div className="col-span-3">Time</div>
            <div className="col-span-4">Symbol</div>
            <div className="col-span-2">Side</div>
            <div className="col-span-3 text-right">Value</div>
         </div>

         {/* Content */}
         <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden p-0 scroll-smooth">
            {liquidations.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-secondary opacity-50 gap-2 p-4">
                    <Skull size={24} />
                    <span className="text-xs">Watching for REKTs...</span>
                </div>
            ) : (
                <div className="flex flex-col-reverse"> {/* Reverse to show newest at top logically, but we use scroll to bottom for terminal feel usually. Actually let's just map normally and scroll to top? Standard feed usually puts newest at top. Let's do newest at TOP. */}
                     {liquidations.map((liq) => {
                         const isLongLiq = liq.side === 'LONG';
                         const colorClass = isLongLiq ? 'text-danger' : 'text-success';
                         const bgClass = isLongLiq ? 'bg-danger/5 hover:bg-danger/10' : 'bg-success/5 hover:bg-success/10';
                         const symbolBase = liq.symbol.replace('USDT', '');
                         
                         const tvLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${liq.symbol}.P`;
                         const binanceLink = `https://www.binance.com/en/futures/${liq.symbol}`;

                         return (
                             <div key={liq.id} className={`grid grid-cols-12 gap-2 px-4 py-2 border-b border-border/50 text-xs items-center transition-colors animate-enter group relative ${bgClass}`}>
                                 <div className="col-span-3 font-mono text-secondary opacity-75">
                                     {formatTime(liq.time)}
                                 </div>
                                 <div className="col-span-4 font-bold text-text flex items-center justify-between">
                                     <span>{symbolBase}</span>
                                     <div className="hidden group-hover:flex items-center gap-1 bg-surface shadow-sm rounded border border-border px-1 absolute left-20 z-10">
                                         <a href={tvLink} target="_blank" rel="noopener noreferrer" className="p-0.5 hover:text-primary text-secondary"><LineChart size={12}/></a>
                                         <a href={binanceLink} target="_blank" rel="noopener noreferrer" className="p-0.5 hover:text-warning text-secondary"><ExternalLink size={12}/></a>
                                     </div>
                                 </div>
                                 <div className="col-span-2">
                                     <span className={`font-bold ${colorClass}`}>
                                         {liq.side}
                                     </span>
                                 </div>
                                 <div className="col-span-3 text-right font-mono font-medium text-text">
                                     {formatValue(liq.value)}
                                 </div>
                             </div>
                         );
                     })}
                </div>
            )}
         </div>
      </div>
    </Card>
  );
};
