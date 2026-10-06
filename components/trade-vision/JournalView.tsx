import React, { useMemo, useState } from 'react';
import { BookOpen, ChevronRight, MessageSquare, Search } from 'lucide-react';
import { Trade } from './types';
import { cn } from '@/utils/cn';
import { formatSignedPct, formatSignedUsd, getClosedTrades, getSignedPct, getSignedPnl, parseTradeDate } from './tradeMath';
import { badge, badgeDanger, badgeNeutral, badgeSuccess, emptyLine, inputBase, panelHeader, panelTitle } from './styles';

interface JournalViewProps {
    trades: Trade[];
    onSelectTrade: (tradeId: string) => void;
}

const JournalView: React.FC<JournalViewProps> = ({ trades, onSelectTrade }) => {
    const [searchTerm, setSearchTerm] = useState('');

    // Group trades by Date
    const groupedTrades = useMemo(() => {
        const groups: Record<string, Trade[]> = {};
        trades.forEach(t => {
            if (!groups[t.date]) groups[t.date] = [];
            groups[t.date].push(t);
        });

        return Object.entries(groups)
            .sort((a, b) => parseTradeDate(b[0]).getTime() - parseTradeDate(a[0]).getTime())
            .map(([date, dayTrades]) => {
                const dayClosedTrades = getClosedTrades(dayTrades);
                const dailyPnL = dayClosedTrades.reduce((acc, t) => acc + getSignedPnl(t), 0);
                const winCount = dayClosedTrades.filter(t => t.status === 'WIN').length;

                return {
                    date,
                    trades: dayTrades.sort((a, b) => (b.time || '').localeCompare(a.time || '')),
                    dailyPnL,
                    winRate: dayClosedTrades.length > 0 ? Math.round((winCount / dayClosedTrades.length) * 100) : 0,
                    tradeCount: dayTrades.length
                };
            });
    }, [trades]);

    const filteredGroups = useMemo(() => {
        if (!searchTerm) return groupedTrades;
        return groupedTrades.filter(g =>
            g.date.toLowerCase().includes(searchTerm.toLowerCase()) ||
            g.trades.some(t => t.symbol.includes(searchTerm.toUpperCase()) || (t.notes && t.notes.toLowerCase().includes(searchTerm.toLowerCase())))
        ).map(g => ({
            ...g,
            trades: g.trades.filter(t => t.symbol.includes(searchTerm.toUpperCase()) || (t.notes && t.notes.toLowerCase().includes(searchTerm.toLowerCase())))
        })).filter(g => g.trades.length > 0);
    }, [groupedTrades, searchTerm]);

    return (
        <section className="flex h-full min-h-0 flex-1 flex-col bg-surface">
            {/* Header / Search */}
            <header className={panelHeader}>
                <h2 className={cn(panelTitle, 'truncate')}>Psychological Ledger</h2>

                <div className="relative w-44 shrink-0 sm:w-64">
                    <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                        type="text"
                        placeholder="SEARCH SAMPLES / NOTES..."
                        aria-label="Search samples / notes"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className={cn(inputBase, 'h-6 pl-6 text-[11px]')}
                    />
                </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
                {filteredGroups.map((group) => (
                    <div key={group.date}>
                        {/* Group Header */}
                        <div className="sticky top-0 z-10 flex h-7 items-center justify-between gap-3 border-b border-border bg-surface-secondary px-3">
                            <h3 className="flex min-w-0 items-baseline gap-2 font-mono text-[11px] font-semibold text-text">
                                {group.date}
                                <span className="truncate font-sans text-[10px] font-medium uppercase tracking-wider text-muted">{parseTradeDate(group.date).toLocaleDateString('tr-TR', { weekday: 'long' }).toLocaleUpperCase('tr-TR')}</span>
                            </h3>
                            <div className="flex shrink-0 items-center gap-4 text-[10px] uppercase tracking-wider text-muted">
                                <div className="flex items-baseline gap-1.5">
                                    <span className="hidden sm:inline">Session Flux</span>
                                    <span className={cn(
                                        'font-mono text-[11px] font-semibold',
                                        group.dailyPnL >= 0 ? 'text-success' : 'text-danger'
                                    )}>
                                        {formatSignedUsd(group.dailyPnL)}
                                    </span>
                                </div>
                                <div className="flex items-baseline gap-1.5">
                                    <span className="hidden sm:inline">Efficiency</span>
                                    <span className="font-mono text-[11px] font-semibold text-text">{group.winRate}%</span>
                                    <span>Avg</span>
                                </div>
                            </div>
                        </div>

                        {/* Sample List */}
                        {group.trades.map(trade => (
                            <div
                                key={trade.id}
                                onClick={() => onSelectTrade(trade.id)}
                                className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5 text-xs transition-colors hover:bg-surface-secondary md:h-7 md:flex-nowrap md:py-0"
                            >
                                {/* Asset Info */}
                                <span className="w-10 shrink-0 font-mono text-[11px] text-muted">{trade.time}</span>
                                <span className="w-24 shrink-0 truncate font-semibold uppercase text-text">{trade.symbol}</span>
                                <span className={cn(
                                    badge,
                                    'w-12 justify-center',
                                    trade.side === 'LONG' ? badgeSuccess : badgeDanger
                                )}>{trade.side}</span>

                                {/* Financials */}
                                <span className={cn(
                                    'ml-auto w-24 shrink-0 text-right font-mono font-medium md:ml-0',
                                    trade.status === 'OPEN' ? 'text-info' :
                                        getSignedPnl(trade) >= 0 ? 'text-success' : 'text-danger'
                                )}>
                                    {trade.status === 'OPEN' ? 'AÇIK' : formatSignedUsd(getSignedPnl(trade))}
                                </span>
                                <span className="hidden w-28 shrink-0 text-right font-mono text-[11px] text-muted sm:block">
                                    {trade.status === 'OPEN' ? 'KAPANIŞ BEKLİYOR' : `${formatSignedPct(getSignedPct(trade))} getiri`}
                                </span>

                                {/* Notes */}
                                <div className="flex min-w-0 basis-full items-center gap-1.5 md:flex-1 md:basis-0">
                                    {trade.notes ? (
                                        <>
                                            <MessageSquare size={12} className="shrink-0 text-muted" />
                                            <p className="truncate text-secondary">"{trade.notes}"</p>
                                        </>
                                    ) : (
                                        <span className="truncate text-muted">Null cognitive telemetry...</span>
                                    )}
                                </div>

                                {trade.setups.length > 0 && (
                                    <div className="flex shrink-0 flex-wrap items-center gap-1">
                                        {trade.setups.map((setup, i) => (
                                            <span key={i} className={cn(badge, badgeNeutral)}>
                                                {setup}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                <ChevronRight size={12} className="hidden shrink-0 text-muted md:block" />
                            </div>
                        ))}
                    </div>
                ))}

                {filteredGroups.length === 0 && (
                    <div className={emptyLine}>
                        <BookOpen size={14} className="shrink-0" />
                        <p>No matching segments in memory</p>
                    </div>
                )}
            </div>
        </section>
    );
};

export default JournalView;
