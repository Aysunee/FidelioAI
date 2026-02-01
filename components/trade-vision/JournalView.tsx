import React, { useMemo, useState } from 'react';
import { BookOpen, Calendar, ChevronRight, MessageSquare, Tag, Filter, Search, Activity, Target } from 'lucide-react';
import { Trade } from './types';
import { cn } from '@/utils/cn';

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
            .sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime())
            .map(([date, dayTrades]) => {
                const dayClosedTrades = dayTrades.filter(t => t.status !== 'OPEN');
                const dailyPnL = dayClosedTrades.reduce((acc, t) => acc + (t.status === 'WIN' ? (t.returnVal || 0) : -(t.returnVal || 0)), 0);
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
        <div className="flex-1 flex flex-col min-h-0 bg-transparent">
            {/* Header / Search */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20 shadow-lg shadow-purple-500/5">
                        <BookOpen size={20} className="text-purple-400" />
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-white uppercase tracking-tighter">Psychological Ledger</h2>
                        <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest mt-1">Timeline of strategic execution & cognitive notes</p>
                    </div>
                </div>

                <div className="relative group w-full md:w-80">
                    <input
                        type="text"
                        placeholder="SEARCH SAMPLES / NOTES..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-white/[0.02] border border-white/5 rounded-2xl py-3 px-12 text-[10px] font-black uppercase tracking-[0.2em] text-white focus:outline-none focus:border-purple-500/50 transition-all placeholder:text-gray-700"
                    />
                    <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-700 group-focus-within:text-purple-500 transition-colors" />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-hide space-y-10 pb-10">
                {filteredGroups.map((group) => (
                    <div key={group.date} className="relative pl-8">
                        {/* Timeline Connector */}
                        <div className="absolute left-[3px] top-4 bottom-[-40px] w-[2px] bg-gradient-to-b from-purple-500/30 to-transparent"></div>
                        <div className="absolute left-0 top-6 w-2 h-2 rounded-full bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.8)]"></div>

                        {/* Group Header */}
                        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
                            <div>
                                <h3 className="text-xs font-black text-white uppercase tracking-[0.3em] flex items-center gap-3">
                                    {group.date}
                                    <span className="text-[9px] text-gray-600 font-medium">/ {new Date(group.date).toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()}</span>
                                </h3>
                            </div>
                            <div className="flex items-center gap-6">
                                <div className="flex flex-col items-end">
                                    <span className="text-[8px] font-black text-gray-600 uppercase tracking-widest mb-1">Session Flux</span>
                                    <span className={cn(
                                        "text-sm font-black tabular-nums",
                                        group.dailyPnL >= 0 ? 'text-purple-400' : 'text-rose-400'
                                    )}>
                                        {group.dailyPnL >= 0 ? '+' : ''}${group.dailyPnL.toLocaleString()}
                                    </span>
                                </div>
                                <div className="flex flex-col items-end">
                                    <span className="text-[8px] font-black text-gray-600 uppercase tracking-widest mb-1">Efficiency</span>
                                    <span className="text-sm font-bold text-white tabular-nums">{group.winRate}% <span className="text-[10px] text-gray-700 uppercase">Avg</span></span>
                                </div>
                            </div>
                        </div>

                        {/* Sample List */}
                        <div className="grid gap-4">
                            {group.trades.map(trade => (
                                <div
                                    key={trade.id}
                                    onClick={() => onSelectTrade(trade.id)}
                                    className="bg-white/[0.02] backdrop-blur-md border border-white/5 p-6 rounded-2xl hover:bg-white/[0.03] transition-all duration-300 group cursor-pointer flex flex-col md:flex-row gap-8 items-start md:items-center"
                                >
                                    {/* Asset Info */}
                                    <div className="w-full md:w-32 shrink-0">
                                        <div className="text-[10px] font-black text-gray-600 uppercase tracking-widest mb-2 flex items-center gap-2">
                                            <Activity size={10} /> {trade.time}
                                        </div>
                                        <div className="text-xl font-black text-white group-hover:text-purple-400 transition-colors uppercase tracking-widest">{trade.symbol}</div>
                                        <div className={cn(
                                            "inline-block text-[8px] font-black px-2 py-0.5 rounded-md mt-2 uppercase tracking-widest border",
                                            trade.side === 'LONG' ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                                        )}>{trade.side}</div>
                                    </div>

                                    {/* Financials */}
                                    <div className="w-full md:w-32 shrink-0">
                                        <div className={cn(
                                            "text-lg font-black tabular-nums",
                                            trade.status === 'WIN' ? 'text-emerald-400' :
                                                trade.status === 'LOSS' ? 'text-rose-400' : 'text-cyan-400'
                                        )}>
                                            {trade.status === 'OPEN' ? 'ACTIVE' :
                                                `${trade.status === 'WIN' ? '+' : '-'}$${(trade.returnVal || 0).toLocaleString()}`}
                                        </div>
                                        <div className="text-[10px] text-gray-600 font-black tabular-nums uppercase tracking-widest mt-1">
                                            {trade.status === 'OPEN' ? 'PENDING SETTLE' : `${trade.returnPct}% Variance`}
                                        </div>
                                    </div>

                                    {/* Notes */}
                                    <div className="flex-1 min-w-0">
                                        {trade.notes ? (
                                            <div className="flex items-start gap-3">
                                                <MessageSquare size={14} className="text-purple-500/40 mt-1 shrink-0" />
                                                <p className="text-sm text-gray-400 line-clamp-2 italic font-medium">"{trade.notes}"</p>
                                            </div>
                                        ) : (
                                            <span className="text-[10px] text-gray-700 font-black uppercase tracking-widest italic opacity-50">Null cognitive telemetry...</span>
                                        )}

                                        <div className="flex flex-wrap gap-2 mt-4">
                                            {trade.setups.map((setup, i) => (
                                                <div key={i} className="flex items-center gap-2 text-[8px] font-black text-gray-500 bg-white/5 px-3 py-1 rounded-lg border border-white/5 uppercase tracking-widest">
                                                    <Target size={10} className="opacity-50" /> {setup}
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="shrink-0 self-center hidden md:block opacity-0 group-hover:opacity-100 transition-all translate-x-[-10px] group-hover:translate-x-0">
                                        <ChevronRight size={20} className="text-purple-500/40" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}

                {filteredGroups.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-32 opacity-20">
                        <BookOpen size={64} strokeWidth={1} className="mb-4" />
                        <p className="text-[10px] font-black uppercase tracking-[0.3em]">No matching segments in memory</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default JournalView;
