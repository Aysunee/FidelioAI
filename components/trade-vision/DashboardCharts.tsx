import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { Trade } from './types';
import { cn } from '@/utils/cn';

interface DashboardChartsProps {
    trades: Trade[];
}

const DashboardCharts: React.FC<DashboardChartsProps> = ({ trades }) => {
    // Equity Curve Data
    const equityData = useMemo(() => {
        let runningTotal = 0;
        const sortedTrades = [...trades].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        return sortedTrades.map((t, index) => {
            runningTotal += (t.status === 'WIN' ? t.returnVal : -t.returnVal);
            return {
                name: index + 1,
                date: t.date,
                value: runningTotal,
                pnl: (t.status === 'WIN' ? t.returnVal : -t.returnVal)
            };
        });
    }, [trades]);

    // Daily P&L Data
    const dailyData = useMemo(() => {
        const days: Record<string, number> = {};
        trades.forEach(t => {
            const date = t.date;
            const val = (t.status === 'WIN' ? t.returnVal : -t.returnVal);
            days[date] = (days[date] || 0) + val;
        });

        return Object.entries(days)
            .map(([date, value]) => ({ date, value }))
            .sort((a, b) => new Date(a.date).getTime() - new Date(a.date).getTime())
            .slice(-10);
    }, [trades]);

    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-gray-950/90 border border-white/10 p-4 rounded-xl shadow-2xl backdrop-blur-xl">
                    <div className="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-1">{payload[0].payload.date}</div>
                    <div className="text-sm font-black text-white tabular-nums">
                        ${payload[0].value.toLocaleString()}
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[500px] lg:h-72">
            {/* Equity Curve */}
            <div className="lg:col-span-2 bg-white/[0.02] backdrop-blur-md rounded-2xl border border-white/5 p-6 flex flex-col h-full overflow-hidden group">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-gray-500 text-[9px] font-black uppercase tracking-[0.2em]">Sample Performance Curve</h3>
                    <div className="flex gap-2">
                        <span className="text-[8px] font-black bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded-lg border border-purple-500/20 uppercase tracking-tighter">Cumulative Net</span>
                    </div>
                </div>
                <div className="flex-1 w-full min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={equityData}>
                            <defs>
                                <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#a855f7" stopOpacity={0.2} />
                                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                            <XAxis
                                dataKey="name"
                                hide={true}
                            />
                            <YAxis
                                orientation="right"
                                tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.3)', fontWeight: 600 }}
                                axisLine={false}
                                tickLine={false}
                                tickFormatter={(val) => `$${val > 999 ? (val / 1000).toFixed(1) + 'k' : val}`}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <Area
                                type="monotone"
                                dataKey="value"
                                stroke="#a855f7"
                                strokeWidth={2}
                                fillOpacity={1}
                                fill="url(#colorEquity)"
                                animationDuration={2000}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Daily Net P&L */}
            <div className="lg:col-span-1 bg-white/[0.02] backdrop-blur-md rounded-2xl border border-white/5 p-6 flex flex-col h-full overflow-hidden group">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-gray-500 text-[9px] font-black uppercase tracking-[0.2em]">Daily Variance</h3>
                </div>
                <div className="flex-1 w-full min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={dailyData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                            <XAxis
                                dataKey="date"
                                tick={{ fontSize: 8, fill: 'rgba(255,255,255,0.3)', fontWeight: 600 }}
                                axisLine={false}
                                tickLine={false}
                                tickFormatter={(val) => val.split(',')[0]}
                            />
                            <Tooltip
                                cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                                content={<CustomTooltip />}
                            />
                            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                                {dailyData.map((entry, index) => (
                                    <Cell
                                        key={`cell-${index}`}
                                        fill={entry.value >= 0 ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)'}
                                        className="transition-all duration-500 hover:opacity-100 opacity-70"
                                    />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
};

export default DashboardCharts;
