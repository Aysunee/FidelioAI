import React, { useMemo } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
    Cell, PieChart, Pie
} from 'recharts';
import { Trade } from './types';
import { Crosshair, Calendar, Clock, ArrowUpCircle, ArrowDownCircle, Activity, Target, Zap } from 'lucide-react';
import { cn } from '@/utils/cn';
import { PerformanceHeatmap } from './PerformanceHeatmap';

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
        return stats.filter(d => d.total > 0 || (d.name !== 'Sunday' && d.name !== 'Saturday'));
    }, [trades]);

    // --- 3. Stats by Side ---
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

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            return (
                <div className="bg-gray-950/90 border border-white/10 p-4 rounded-xl shadow-2xl backdrop-blur-xl z-50">
                    <p className="text-[9px] font-black text-gray-500 mb-2 uppercase tracking-widest">{label || data.name}</p>
                    <div className="space-y-1">
                        <p className={cn("text-sm font-black tabular-nums", data.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                            ${data.pnl.toLocaleString()}
                        </p>
                        {data.winRate !== undefined && (
                            <p className="text-[10px] text-white font-black uppercase tracking-tighter">WR: {data.winRate}%</p>
                        )}
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="flex-1 overflow-y-auto scrollbar-hide">
            <div className="flex items-center gap-4 mb-10">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20 shadow-lg shadow-purple-500/5">
                    <Activity size={20} className="text-purple-400" />
                </div>
                <div>
                    <h2 className="text-xl font-black text-white uppercase tracking-tighter">Correlation Engine</h2>
                    <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest mt-1">Multi-vector performance analytics</p>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 pb-10">
                {/* SETUP PERFORMANCE */}
                <div className="bg-white/[0.02] backdrop-blur-md rounded-2xl border border-white/5 p-8 group hover:border-white/10 transition-all">
                    <div className="flex justify-between items-center mb-10">
                        <h3 className="text-[11px] font-black text-white uppercase tracking-[0.2em] flex items-center gap-3">
                            <Target size={14} className="text-purple-400" /> Strategy Variance
                        </h3>
                    </div>
                    <div className="h-72 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={setupStats} layout="vertical" margin={{ left: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                                <XAxis type="number" hide />
                                <YAxis
                                    dataKey="name"
                                    type="category"
                                    tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 9, fontWeight: 800 }}
                                    width={100}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.02)' }} />
                                <Bar dataKey="pnl" radius={[0, 4, 4, 0]} barSize={24}>
                                    {setupStats.map((entry, index) => (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={entry.pnl >= 0 ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)'}
                                            className="transition-all duration-500 hover:opacity-100 opacity-70"
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* DAY OF WEEK PERFORMANCE */}
                <div className="bg-white/[0.02] backdrop-blur-md rounded-2xl border border-white/5 p-8 group hover:border-white/10 transition-all">
                    <div className="flex justify-between items-center mb-10">
                        <h3 className="text-[11px] font-black text-white uppercase tracking-[0.2em] flex items-center gap-3">
                            <Calendar size={14} className="text-purple-400" /> Temporal Drift
                        </h3>
                    </div>
                    <div className="h-72 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={dayStats}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                <XAxis
                                    dataKey="name"
                                    tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 8, fontWeight: 800 }}
                                    axisLine={false}
                                    tickLine={false}
                                    tickFormatter={(val) => val.slice(0, 3)}
                                />
                                <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.02)' }} />
                                <Bar dataKey="pnl" radius={[4, 4, 0, 0]} barSize={32}>
                                    {dayStats.map((entry, index) => (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={entry.pnl >= 0 ? 'rgba(168, 85, 247, 0.4)' : 'rgba(244, 63, 94, 0.4)'}
                                            className="transition-all duration-500 hover:opacity-100 opacity-70"
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* LONG VS SHORT */}
                <div className="bg-white/[0.02] backdrop-blur-md rounded-2xl border border-white/5 p-8 group hover:border-white/10 transition-all flex flex-col xl:col-span-2">
                    <div className="flex justify-between items-center mb-8">
                        <h3 className="text-[11px] font-black text-white uppercase tracking-[0.2em] flex items-center gap-3">
                            <Zap size={14} className="text-purple-400" /> Vector Allocation
                        </h3>
                    </div>
                    <div className="flex flex-col md:flex-row gap-12 items-center">
                        <div className="w-full md:w-1/2 h-64 relative group">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={sideStats}
                                        innerRadius={70}
                                        outerRadius={90}
                                        paddingAngle={8}
                                        dataKey="value"
                                        stroke="none"
                                    >
                                        {sideStats.map((entry, index) => (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill={entry.name === 'Long' ? 'rgba(168, 85, 247, 0.4)' : 'rgba(244, 63, 94, 0.4)'}
                                                className="transition-all duration-500 hover:opacity-100 opacity-70"
                                            />
                                        ))}
                                    </Pie>
                                    <RechartsTooltip content={<CustomTooltip />} />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                <span className="text-[10px] text-gray-600 font-black uppercase tracking-widest">Aggregate</span>
                                <span className="text-lg font-black text-white tracking-tighter">{trades.length} Samples</span>
                            </div>
                        </div>

                        <div className="w-full md:w-1/2 grid grid-cols-2 gap-8">
                            {sideStats.map(s => (
                                <div key={s.name} className="flex flex-col p-6 rounded-2xl bg-white/[0.01] border border-white/5 group/side hover:bg-white/[0.02] transition-all">
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className={cn(
                                            "w-2 h-2 rounded-full",
                                            s.name === 'Long' ? 'bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]' : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]'
                                        )}></div>
                                        <span className="text-[10px] text-gray-500 font-black uppercase tracking-widest group-hover/side:text-white transition-colors">{s.name} Exposure</span>
                                    </div>
                                    <div className="text-2xl font-black text-white tabular-nums tracking-tighter mb-1">${s.pnl.toLocaleString()}</div>
                                    <div className="text-[9px] text-gray-600 font-black uppercase tracking-widest">{s.winRate}% Efficiency</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Performance Heatmap */}
            <div className="pt-8 border-t border-white/5">
                <PerformanceHeatmap trades={trades} />
            </div>
        </div>
    );
};

export default AnalyticsView;
