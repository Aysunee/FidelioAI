
import React, { useMemo } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
    Cell, PieChart, Pie, Legend
} from 'recharts';
import { Trade } from '../types';
import { Crosshair, Calendar, Clock, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';

interface AnalyticsViewProps {
    trades: Trade[];
}

const AnalyticsView: React.FC<AnalyticsViewProps> = ({ trades }) => {
    // --- 1. Stats by Setup ---
    const setupStats = useMemo(() => {
        const stats: Record<string, { pnl: number; wins: number; total: number }> = {};

        trades.forEach(t => {
            t.setups.forEach(setup => {
                if (!stats[setup]) stats[setup] = { pnl: 0, wins: 0, total: 0 };
                const val = t.status === 'WIN' ? t.returnVal : -t.returnVal;
                stats[setup].pnl += val;
                stats[setup].total += 1;
                if (t.status === 'WIN') stats[setup].wins += 1;
            });
        });

        return Object.entries(stats)
            .map(([name, data]) => ({
                name,
                pnl: data.pnl,
                winRate: Math.round((data.wins / data.total) * 100),
                count: data.total
            }))
            .sort((a, b) => b.pnl - a.pnl);
    }, [trades]);

    // --- 2. Stats by Day of Week ---
    const dayStats = useMemo(() => {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const stats = days.map(d => ({ name: d, pnl: 0, wins: 0, total: 0 }));

        trades.forEach(t => {
            const date = new Date(t.date);
            const dayIdx = date.getDay();
            const val = t.status === 'WIN' ? t.returnVal : -t.returnVal;

            stats[dayIdx].pnl += val;
            stats[dayIdx].total += 1;
            if (t.status === 'WIN') stats[dayIdx].wins += 1;
        });

        // Filter out weekends if no trades
        return stats.filter(d => d.total > 0 || (d.name !== 'Sunday' && d.name !== 'Saturday'));
    }, [trades]);

    // --- 3. Stats by Side (Long/Short) ---
    const sideStats = useMemo(() => {
        const stats = {
            LONG: { pnl: 0, wins: 0, total: 0 },
            SHORT: { pnl: 0, wins: 0, total: 0 }
        };

        trades.forEach(t => {
            const side = t.side as 'LONG' | 'SHORT';
            if (stats[side]) {
                const val = t.status === 'WIN' ? t.returnVal : -t.returnVal;
                stats[side].pnl += val;
                stats[side].total += 1;
                if (t.status === 'WIN') stats[side].wins += 1;
            }
        });

        return [
            { name: 'Long', value: stats.LONG.total, pnl: stats.LONG.pnl, winRate: stats.LONG.total ? Math.round((stats.LONG.wins / stats.LONG.total) * 100) : 0 },
            { name: 'Short', value: stats.SHORT.total, pnl: stats.SHORT.pnl, winRate: stats.SHORT.total ? Math.round((stats.SHORT.wins / stats.SHORT.total) * 100) : 0 }
        ].filter(s => s.value > 0);
    }, [trades]);

    // --- Custom Tooltip ---
    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            return (
                <div className="bg-[#1f2937] border border-gray-700 p-3 rounded-lg shadow-xl z-50">
                    <p className="text-gray-400 text-xs mb-1 font-bold uppercase">{label || data.name}</p>
                    <div className="space-y-1">
                        <p className={`text-sm font-bold ${data.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            Net P&L: ${data.pnl.toLocaleString()}
                        </p>
                        {data.winRate !== undefined && (
                            <p className="text-xs text-white">Win Rate: {data.winRate}%</p>
                        )}
                        {data.count !== undefined && (
                            <p className="text-xs text-gray-400">Trades: {data.count}</p>
                        )}
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="p-6 h-full overflow-y-auto custom-scrollbar">
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                <Crosshair className="text-cyan-400" /> Performance Analytics
            </h2>

            <div className="grid grid-cols-2 gap-6 mb-6">
                {/* SETUP PERFORMANCE */}
                <div className="col-span-2 bg-[#161b22]/40 backdrop-blur-md rounded-2xl border border-white/5 p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-sm font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                            <Crosshair size={14} className="text-indigo-400" /> Breakdown by Setup
                        </h3>
                    </div>
                    <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={setupStats} layout="vertical" margin={{ left: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.1} horizontal={false} />
                                <XAxis type="number" hide />
                                <YAxis
                                    dataKey="name"
                                    type="category"
                                    tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }}
                                    width={100}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.02)' }} />
                                <Bar dataKey="pnl" radius={[0, 4, 4, 0]} barSize={20}>
                                    {setupStats.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#10b981' : '#f43f5e'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* DAY OF WEEK PERFORMANCE */}
                <div className="bg-[#161b22]/40 backdrop-blur-md rounded-2xl border border-white/5 p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-sm font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                            <Calendar size={14} className="text-purple-400" /> P&L by Day
                        </h3>
                    </div>
                    <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={dayStats}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.1} vertical={false} />
                                <XAxis
                                    dataKey="name"
                                    tick={{ fill: '#64748b', fontSize: 10 }}
                                    axisLine={false}
                                    tickLine={false}
                                    tickFormatter={(val) => val.slice(0, 3)}
                                />
                                <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.02)' }} />
                                <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                                    {dayStats.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#8b5cf6' : '#f43f5e'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* LONG VS SHORT */}
                <div className="bg-[#161b22]/40 backdrop-blur-md rounded-2xl border border-white/5 p-6 flex flex-col">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-sm font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                            <ArrowUpCircle size={14} className="text-cyan-400" /> Long vs Short
                        </h3>
                    </div>
                    <div className="flex-1 flex gap-4">
                        <div className="w-1/2 relative">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={sideStats}
                                        innerRadius={40}
                                        outerRadius={60}
                                        paddingAngle={5}
                                        dataKey="value"
                                    >
                                        {sideStats.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.name === 'Long' ? '#06b6d4' : '#f43f5e'} />
                                        ))}
                                    </Pie>
                                    <RechartsTooltip />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <span className="text-xs text-slate-500 font-bold">VOL</span>
                            </div>
                        </div>

                        <div className="w-1/2 flex flex-col justify-center gap-4">
                            {sideStats.map(s => (
                                <div key={s.name} className="flex flex-col">
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className={`w-2 h-2 rounded-full ${s.name === 'Long' ? 'bg-cyan-500' : 'bg-rose-500'}`}></div>
                                        <span className="text-xs text-slate-400 font-bold uppercase">{s.name}</span>
                                    </div>
                                    <div className="text-lg font-bold text-white">${s.pnl.toLocaleString()}</div>
                                    <div className="text-[10px] text-slate-500">{s.winRate}% Win Rate</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AnalyticsView;
