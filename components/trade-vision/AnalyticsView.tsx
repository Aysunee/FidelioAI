import React, { useMemo } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
    Cell, PieChart, Pie
} from 'recharts';
import { Trade } from './types';
import { cn } from '@/utils/cn';
import { PerformanceHeatmap } from './PerformanceHeatmap';
import { formatSignedUsd, getClosedTrades, getSignedPnl, parseTradeDate } from './tradeMath';
import { chartColors, emptyLine, fieldLabel, menuSurface, panelHeader, panelTitle } from './styles';

interface AnalyticsViewProps {
    trades: Trade[];
}

const AXIS_TICK = { fill: chartColors.axis, fontSize: 10 };

const AnalyticsView: React.FC<AnalyticsViewProps> = ({ trades: allTrades }) => {
    // Only closed trades have an outcome / realised P&L.
    const trades = useMemo(() => getClosedTrades(allTrades), [allTrades]);

    // --- 1. Stats by Setup ---
    const setupStats = useMemo(() => {
        const stats: Record<string, { pnl: number; wins: number; total: number }> = {};
        trades.forEach(t => {
            t.setups.forEach(setup => {
                if (!stats[setup]) stats[setup] = { pnl: 0, wins: 0, total: 0 };
                const val = getSignedPnl(t);
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
            const date = parseTradeDate(t.date);
            const dayIdx = date.getDay();
            if (Number.isNaN(dayIdx)) return;
            const val = getSignedPnl(t);
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
                const val = getSignedPnl(t);
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
                <div className={cn(menuSurface, 'z-50 px-2 py-1.5')}>
                    <p className="text-[10px] uppercase tracking-wider text-muted">{label || data.name}</p>
                    <p className={cn('font-mono text-xs font-semibold', data.pnl >= 0 ? 'text-success' : 'text-danger')}>
                        {formatSignedUsd(data.pnl)}
                    </p>
                    {data.winRate !== undefined && (
                        <p className="font-mono text-[10px] uppercase text-secondary">WR: {data.winRate}%</p>
                    )}
                </div>
            );
        }
        return null;
    };

    return (
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto bg-surface">
            <div className="grid flex-1 grid-cols-1 grid-rows-[auto_auto_auto_1fr] gap-px bg-border xl:grid-cols-2 xl:grid-rows-[auto_auto_1fr]">
                {/* SETUP PERFORMANCE */}
                <section className="flex min-w-0 flex-col bg-surface">
                    <header className={panelHeader}>
                        <h2 className={cn(panelTitle, 'truncate')}>Strategy Variance</h2>
                    </header>
                    <div className="h-56 w-full p-2">
                        {setupStats.length === 0 ? (
                            <div className={emptyLine}>Henüz kapalı işlem yok</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={setupStats} layout="vertical" margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                                    <CartesianGrid stroke={chartColors.grid} horizontal={false} />
                                    <XAxis type="number" hide />
                                    <YAxis
                                        dataKey="name"
                                        type="category"
                                        tick={AXIS_TICK}
                                        width={100}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: chartColors.cursor }} />
                                    <Bar dataKey="pnl" maxBarSize={16} isAnimationActive={false}>
                                        {setupStats.map((entry, index) => (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill={entry.pnl >= 0 ? chartColors.success : chartColors.danger}
                                            />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </section>

                {/* DAY OF WEEK PERFORMANCE */}
                <section className="flex min-w-0 flex-col bg-surface">
                    <header className={panelHeader}>
                        <h2 className={cn(panelTitle, 'truncate')}>Temporal Drift</h2>
                    </header>
                    <div className="h-56 w-full p-2">
                        {trades.length === 0 ? (
                            <div className={emptyLine}>Henüz kapalı işlem yok</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={dayStats} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                                    <CartesianGrid stroke={chartColors.grid} vertical={false} />
                                    <XAxis
                                        dataKey="name"
                                        tick={AXIS_TICK}
                                        axisLine={false}
                                        tickLine={false}
                                        tickFormatter={(val) => val.slice(0, 3)}
                                    />
                                    <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: chartColors.cursor }} />
                                    <Bar dataKey="pnl" maxBarSize={28} isAnimationActive={false}>
                                        {dayStats.map((entry, index) => (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill={entry.pnl >= 0 ? chartColors.success : chartColors.danger}
                                            />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </section>

                {/* LONG VS SHORT */}
                <section className="flex min-w-0 flex-col bg-surface xl:col-span-2">
                    <header className={panelHeader}>
                        <h2 className={cn(panelTitle, 'truncate')}>Vector Allocation</h2>
                    </header>
                    <div className="flex flex-col divide-y divide-border md:flex-row md:divide-x md:divide-y-0">
                        <div className="relative h-40 w-full shrink-0 md:w-64">
                            {sideStats.length === 0 && (
                                <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 h-[136px] w-[136px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[12px] border-surface-highlight" />
                            )}
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={sideStats}
                                        innerRadius={56}
                                        outerRadius={68}
                                        paddingAngle={2}
                                        dataKey="value"
                                        stroke="none"
                                        isAnimationActive={false}
                                    >
                                        {sideStats.map((entry, index) => (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill={entry.name === 'Long' ? chartColors.success : chartColors.danger}
                                            />
                                        ))}
                                    </Pie>
                                    <RechartsTooltip content={<CustomTooltip />} />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                                <span className={fieldLabel}>Aggregate</span>
                                <span className="text-xs font-semibold text-text">{trades.length} kapalı işlem</span>
                            </div>
                        </div>

                        <div className="grid min-w-0 flex-1 grid-cols-2 divide-x divide-border">
                            {sideStats.length === 0 && (
                                <div className={cn(emptyLine, 'col-span-2')}>Henüz kapalı işlem yok</div>
                            )}
                            {sideStats.map(s => (
                                <div key={s.name} className="flex min-w-0 flex-col justify-center gap-0.5 px-3 py-2">
                                    <div className="flex items-center gap-1.5">
                                        <div className={cn(
                                            'h-1.5 w-1.5 shrink-0 rounded-full',
                                            s.name === 'Long' ? 'bg-success' : 'bg-danger'
                                        )}></div>
                                        <span className={cn(fieldLabel, 'truncate')}>{s.name} Exposure</span>
                                    </div>
                                    <div className={cn(
                                        'truncate font-mono text-base font-semibold leading-5',
                                        s.pnl > 0 ? 'text-success' : s.pnl < 0 ? 'text-danger' : 'text-text'
                                    )}>{formatSignedUsd(s.pnl)}</div>
                                    <div className="truncate text-[10px] text-muted">{s.winRate}% Efficiency</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* Performance Heatmap */}
                <PerformanceHeatmap trades={trades} className="xl:col-span-2" />
            </div>
        </div>
    );
};

export default AnalyticsView;
