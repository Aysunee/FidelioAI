
import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { Trade } from '../types';

interface DashboardChartsProps {
    trades: Trade[];
}

const DashboardCharts: React.FC<DashboardChartsProps> = ({ trades }) => {
    // Equity Curve Data
    const equityData = useMemo(() => {
        let runningTotal = 0;
        // Sort oldest to newest
        const sortedTrades = [...trades].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        return sortedTrades.map((t, index) => {
            runningTotal += (t.status === 'WIN' ? t.returnVal : -t.returnVal);
            return {
                name: index + 1, // Trade Number
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
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .slice(-10); // Last 10 days
    }, [trades]);

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-[#1f2937] border border-gray-700 p-3 rounded-lg shadow-xl">
                    <p className="text-gray-400 text-xs mb-1">{payload[0].payload.date}</p>
                    <p className="text-white font-bold text-sm">
                        ${payload[0].value.toLocaleString()}
                    </p>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="grid grid-cols-3 gap-6 px-6 mb-6 h-64">
            {/* Equity Curve - Takes up 2/3 */}
            <div className="col-span-2 bg-[#161b22]/40 backdrop-blur-md rounded-2xl border border-white/5 p-5 flex flex-col">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-gray-400 text-xs font-bold uppercase tracking-wider">Equity Curve</h3>
                    <div className="flex gap-2">
                        <span className="text-[10px] bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded border border-cyan-500/20">ALL TIME</span>
                    </div>
                </div>
                <div className="flex-1 w-full min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={equityData}>
                            <defs>
                                <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} vertical={false} />
                            <XAxis
                                dataKey="name"
                                hide={true}
                            />
                            <YAxis
                                orientation="right"
                                tick={{ fontSize: 10, fill: '#6b7280' }}
                                axisLine={false}
                                tickLine={false}
                                tickFormatter={(val) => `$${val}`}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <Area
                                type="monotone"
                                dataKey="value"
                                stroke="#06b6d4"
                                strokeWidth={2}
                                fillOpacity={1}
                                fill="url(#colorEquity)"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Daily Net P&L - Takes up 1/3 */}
            <div className="col-span-1 bg-[#161b22]/40 backdrop-blur-md rounded-2xl border border-white/5 p-5 flex flex-col">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-gray-400 text-xs font-bold uppercase tracking-wider">Daily Net P&L</h3>
                </div>
                <div className="flex-1 w-full min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={dailyData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} vertical={false} />
                            <XAxis
                                dataKey="date"
                                tick={{ fontSize: 9, fill: '#6b7280' }}
                                axisLine={false}
                                tickLine={false}
                                tickFormatter={(val) => val.split('-').slice(1).join('/')}
                            />
                            <Tooltip
                                cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', borderRadius: '8px' }}
                                itemStyle={{ color: '#fff' }}
                                formatter={(value: number) => [`$${value}`, 'P&L']}
                                labelStyle={{ display: 'none' }}
                            />
                            <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                                {dailyData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.value >= 0 ? '#10b981' : '#f43f5e'} />
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
