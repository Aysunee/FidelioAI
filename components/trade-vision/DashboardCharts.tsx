import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { Trade } from './types';
import { cn } from '@/utils/cn';
import { formatSignedUsd, getClosedTrades, getSignedPnl, getTradeTimestamp, parseTradeDate } from './tradeMath';
import { badge, badgeAccent, chartColors, emptyLine, menuSurface, panelHeader, panelTitle } from './styles';

interface DashboardChartsProps {
    trades: Trade[];
}

const AXIS_TICK = { fontSize: 10, fill: chartColors.axis };

const DashboardCharts: React.FC<DashboardChartsProps> = ({ trades }) => {
    // Equity Curve Data
    // OPEN trades have no realised P&L and are excluded from the curve.
    const equityData = useMemo(() => {
        let runningTotal = 0;
        const sortedTrades = getClosedTrades(trades).sort((a, b) => getTradeTimestamp(a) - getTradeTimestamp(b));

        return sortedTrades.map((t, index) => {
            const pnl = getSignedPnl(t);
            runningTotal += pnl;
            return {
                name: index + 1,
                date: t.date,
                value: runningTotal,
                pnl
            };
        });
    }, [trades]);

    // Daily P&L Data
    const dailyData = useMemo(() => {
        const days: Record<string, number> = {};
        getClosedTrades(trades).forEach(t => {
            const date = t.date;
            days[date] = (days[date] || 0) + getSignedPnl(t);
        });

        // Chronological order; keep the latest 10 days.
        return Object.entries(days)
            .map(([date, value]) => ({ date, value }))
            .sort((a, b) => parseTradeDate(a.date).getTime() - parseTradeDate(b.date).getTime())
            .slice(-10);
    }, [trades]);

    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className={cn(menuSurface, 'px-2 py-1.5')}>
                    <div className="text-[10px] uppercase tracking-wider text-muted">{payload[0].payload.date}</div>
                    <div className={cn('font-mono text-xs font-semibold', payload[0].value >= 0 ? 'text-success' : 'text-danger')}>
                        {formatSignedUsd(payload[0].value)}
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="grid shrink-0 grid-cols-1 gap-px bg-border lg:grid-cols-3">
            {/* Equity Curve */}
            <section className="flex h-56 min-w-0 flex-col bg-surface lg:col-span-2">
                <header className={panelHeader}>
                    <h2 className={cn(panelTitle, 'truncate')}>Sample Performance Curve</h2>
                    <span className={cn(badge, badgeAccent)}>Cumulative Net</span>
                </header>
                <div className="min-h-0 w-full flex-1 p-2">
                    {equityData.length === 0 ? (
                        <div className={emptyLine}>Henüz kapalı işlem yok</div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={equityData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                                <CartesianGrid stroke={chartColors.grid} vertical={false} />
                                <XAxis
                                    dataKey="name"
                                    hide={true}
                                />
                                <YAxis
                                    orientation="right"
                                    width={48}
                                    tick={AXIS_TICK}
                                    axisLine={false}
                                    tickLine={false}
                                    tickFormatter={(val) => `$${val > 999 ? (val / 1000).toFixed(1) + 'k' : val}`}
                                />
                                <Tooltip content={<CustomTooltip />} cursor={{ stroke: chartColors.cursorLine }} />
                                <Area
                                    type="monotone"
                                    dataKey="value"
                                    stroke={chartColors.brand}
                                    strokeWidth={1.5}
                                    fill={chartColors.brand}
                                    fillOpacity={0.12}
                                    isAnimationActive={false}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </section>

            {/* Daily Net P&L */}
            <section className="flex h-56 min-w-0 flex-col bg-surface lg:col-span-1">
                <header className={panelHeader}>
                    <h2 className={cn(panelTitle, 'truncate')}>Daily Variance</h2>
                </header>
                <div className="min-h-0 w-full flex-1 p-2">
                    {dailyData.length === 0 ? (
                        <div className={emptyLine}>Henüz kapalı işlem yok</div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={dailyData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                                <CartesianGrid stroke={chartColors.grid} vertical={false} />
                                <XAxis
                                    dataKey="date"
                                    tick={AXIS_TICK}
                                    axisLine={false}
                                    tickLine={false}
                                    tickFormatter={(val) => val.split(',')[0]}
                                />
                                <Tooltip
                                    cursor={{ fill: chartColors.cursor }}
                                    content={<CustomTooltip />}
                                />
                                <Bar dataKey="value" isAnimationActive={false} maxBarSize={28}>
                                    {dailyData.map((entry, index) => (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={entry.value >= 0 ? chartColors.success : chartColors.danger}
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </section>
        </div>
    );
};

export default DashboardCharts;
