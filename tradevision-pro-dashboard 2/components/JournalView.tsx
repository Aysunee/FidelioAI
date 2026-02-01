
import React, { useMemo, useState } from 'react';
import { BookOpen, Calendar, ChevronRight, MessageSquare, Tag, Filter } from 'lucide-react';
import { Trade } from '../types';

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

        // Sort dates (newest first) and convert to array
        return Object.entries(groups)
            .sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime())
            .map(([date, dayTrades]) => {
                const dailyPnL = dayTrades.reduce((acc, t) => acc + (t.status === 'WIN' ? t.returnVal : -t.returnVal), 0);
                const winCount = dayTrades.filter(t => t.status === 'WIN').length;

                return {
                    date,
                    trades: dayTrades.sort((a, b) => (b.time || '').localeCompare(a.time || '')),
                    dailyPnL,
                    winRate: Math.round((winCount / dayTrades.length) * 100),
                    tradeCount: dayTrades.length
                };
            });
    }, [trades]);

    const filteredGroups = useMemo(() => {
        if (!searchTerm) return groupedTrades;
        return groupedTrades.filter(g =>
            g.date.toLowerCase().includes(searchTerm.toLowerCase()) ||
            g.trades.some(t => t.symbol.includes(searchTerm.toUpperCase()) || t.notes?.toLowerCase().includes(searchTerm.toLowerCase()))
        );
    }, [groupedTrades, searchTerm]);

    return (
        <div className="p-6 h-full overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                        <BookOpen className="text-cyan-400" /> Trading Journal
                    </h2>
                    <p className="text-slate-500 text-sm mt-1">Review your daily performance and psychological notes.</p>
                </div>

                <div className="relative">
                    <input
                        type="text"
                        placeholder="Search symbol, notes..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="bg-[#161b22] border border-white/10 rounded-xl py-2 px-4 pl-10 text-sm text-white focus:outline-none focus:border-cyan-500 transition-colors w-64"
                    />
                    <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                </div>
            </div>

            <div className="space-y-6 max-w-5xl mx-auto">
                {filteredGroups.map((group) => (
                    <div key={group.date} className="bg-[#161b22]/40 backdrop-blur-md border border-white/5 rounded-2xl overflow-hidden shadow-sm">
                        {/* Daily Header */}
                        <div className="bg-white/[0.02] p-4 flex items-center justify-between border-b border-white/5">
                            <div className="flex items-center gap-4">
                                <div className="flex flex-col">
                                    <span className="text-sm font-bold text-white flex items-center gap-2">
                                        <Calendar size={14} className="text-slate-400" /> {group.date}
                                    </span>
                                    <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mt-0.5">
                                        {new Date(group.date).toLocaleDateString('en-US', { weekday: 'long' })}
                                    </span>
                                </div>
                                <div className="h-8 w-px bg-white/10 mx-2"></div>
                                <div className="flex gap-4">
                                    <div>
                                        <span className="text-[9px] text-slate-500 uppercase block">Net P&L</span>
                                        <span className={`text-sm font-bold ${group.dailyPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {group.dailyPnL >= 0 ? '+' : ''}${group.dailyPnL.toLocaleString()}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-[9px] text-slate-500 uppercase block">Win Rate</span>
                                        <span className="text-sm font-bold text-white">{group.winRate}%</span>
                                    </div>
                                </div>
                            </div>
                            <div className="text-[10px] bg-white/5 px-2 py-1 rounded text-slate-400 border border-white/5">
                                {group.tradeCount} Trades
                            </div>
                        </div>

                        {/* Trades List */}
                        <div className="divide-y divide-white/5">
                            {group.trades.map(trade => (
                                <div
                                    key={trade.id}
                                    onClick={() => onSelectTrade(trade.id)}
                                    className="p-4 hover:bg-white/[0.02] transition-colors cursor-pointer group flex gap-6 items-start"
                                >
                                    {/* Time & Symbol */}
                                    <div className="w-24 shrink-0">
                                        <span className="text-[10px] font-mono text-slate-500 block mb-1">{trade.time}</span>
                                        <span className="text-lg font-bold text-white group-hover:text-cyan-400 transition-colors">{trade.symbol}</span>
                                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${trade.side === 'LONG' ? 'bg-cyan-500/10 text-cyan-400' : 'bg-rose-500/10 text-rose-400'
                                            }`}>{trade.side}</span>
                                    </div>

                                    {/* Result */}
                                    <div className="w-24 shrink-0">
                                        <div className={`text-sm font-bold ${trade.status === 'WIN' ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {trade.status === 'WIN' ? '+' : '-'}${trade.returnVal.toLocaleString()}
                                        </div>
                                        <div className="text-[10px] text-slate-500">{trade.returnPct}%</div>
                                    </div>

                                    {/* Notes Preview */}
                                    <div className="flex-1 min-w-0">
                                        {trade.notes ? (
                                            <div className="flex items-start gap-2">
                                                <MessageSquare size={14} className="text-slate-600 mt-1 shrink-0" />
                                                <p className="text-sm text-slate-400 line-clamp-2 italic">"{trade.notes}"</p>
                                            </div>
                                        ) : (
                                            <span className="text-xs text-slate-700 italic group-hover:text-slate-600 transition-colors">No notes added...</span>
                                        )}

                                        {/* Tags */}
                                        <div className="flex flex-wrap gap-2 mt-2">
                                            {trade.setups.map((setup, i) => (
                                                <div key={i} className="flex items-center gap-1 text-[9px] text-slate-500 bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
                                                    <Tag size={10} /> {setup}
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Action */}
                                    <div className="shrink-0 self-center opacity-0 group-hover:opacity-100 transition-opacity">
                                        <ChevronRight size={18} className="text-slate-600" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}

                {filteredGroups.length === 0 && (
                    <div className="text-center py-20 text-slate-600">
                        <BookOpen size={48} className="mx-auto mb-4 opacity-20" />
                        <p>No journal entries found matching your criteria.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default JournalView;
