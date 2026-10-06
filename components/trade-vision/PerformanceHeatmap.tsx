import React, { useMemo } from 'react';
import { Trade } from './types';
import { cn } from '@/utils/cn';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { formatSignedUsd, getClosedTrades, getSignedPnl, normalizeTimeInput, parseTradeDate } from './tradeMath';
import { fieldLabel, menuSurface, panelHeader, panelTitle } from './styles';

interface PerformanceHeatmapProps {
    trades: Trade[];
    className?: string;
}

interface HeatmapCell {
    day: number;
    hour: number;
    avgPnl: number;
    tradeCount: number;
    winRate: number;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

// Data colours are mixed from the theme tokens so the matrix follows the active theme.
const heatColor = (token: string, pct: number) => `color-mix(in srgb, var(${token}) ${pct}%, var(--bg-surface-secondary))`;

export const PerformanceHeatmap: React.FC<PerformanceHeatmapProps> = ({ trades, className }) => {
    const heatmapData = useMemo(() => {
        // Initialize grid
        const grid: HeatmapCell[][] = Array(7).fill(null).map((_, day) =>
            Array(24).fill(null).map((_, hour) => ({
                day,
                hour,
                avgPnl: 0,
                tradeCount: 0,
                winRate: 0,
            }))
        );

        // Populate grid with closed trades only (OPEN trades have no realised P&L), using signed P&L.
        getClosedTrades(trades).forEach(trade => {
            const time = normalizeTimeInput(trade.time);
            if (!trade.date || !time) return;

            const date = parseTradeDate(trade.date, time);
            const day = date.getDay();
            const hour = parseInt(time.slice(0, 2), 10);

            if (hour >= 0 && hour < 24 && day >= 0 && day < 7) {
                grid[day][hour].tradeCount++;
                grid[day][hour].avgPnl += getSignedPnl(trade);
                if (trade.status === 'WIN') {
                    grid[day][hour].winRate++;
                }
            }
        });

        // Calculate averages
        grid.forEach(row => {
            row.forEach(cell => {
                if (cell.tradeCount > 0) {
                    cell.avgPnl = cell.avgPnl / cell.tradeCount;
                    cell.winRate = (cell.winRate / cell.tradeCount) * 100;
                }
            });
        });

        return grid;
    }, [trades]);

    // Find max absolute P&L for color scaling
    const maxAbsPnl = useMemo(() => {
        let max = 0;
        heatmapData.forEach(row => {
            row.forEach(cell => {
                if (Math.abs(cell.avgPnl) > max) {
                    max = Math.abs(cell.avgPnl);
                }
            });
        });
        return max || 100;
    }, [heatmapData]);

    // Inline colours: the intensity is computed at runtime, so it cannot be a Tailwind class.
    const getCellStyle = (avgPnl: number): React.CSSProperties | undefined => {
        if (avgPnl === 0 || !Number.isFinite(avgPnl)) return undefined;
        const intensity = Math.min(Math.abs(avgPnl) / maxAbsPnl, 1);
        const pct = Math.round(intensity * 60 + 15);
        return {
            backgroundColor: avgPnl > 0
                ? heatColor('--color-success', pct)  // profits
                : heatColor('--color-danger', pct)   // losses
        };
    };

    return (
        <section className={cn('flex min-w-0 flex-col bg-surface', className)}>
            <header className={panelHeader}>
                <h2 className={cn(panelTitle, 'truncate')}>Performance Matrix</h2>

                {/* Legend */}
                <div className="flex shrink-0 items-center gap-3 text-[10px] uppercase tracking-wider text-muted">
                    <div className="flex items-center gap-1.5">
                        <div className="h-2.5 w-2.5" style={{ backgroundColor: heatColor('--color-success', 60) }}></div>
                        <span>Profitable</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="h-2.5 w-2.5" style={{ backgroundColor: heatColor('--color-danger', 60) }}></div>
                        <span>Loss</span>
                    </div>
                </div>
            </header>

            <div className="flex min-h-0 flex-1 flex-col overflow-x-auto p-2">
                <div className="flex min-w-[720px] flex-1 flex-col">
                    {/* Hour labels */}
                    <div className="mb-px grid shrink-0 grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-px">
                        <div></div>
                        {HOURS.map(hour => (
                            <div key={hour} className="text-center font-mono text-[10px] leading-4 text-muted">
                                {hour}
                            </div>
                        ))}
                    </div>

                    {/* Heatmap grid */}
                    <div className="flex flex-1 flex-col gap-px">
                        {DAYS.map((dayName, dayIdx) => (
                            <div key={dayIdx} className="grid min-h-6 flex-1 grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-px">
                                {/* Day label */}
                                <div className="flex items-center text-[10px] font-medium uppercase tracking-wider text-muted">
                                    {dayName}
                                </div>

                                {/* Hour cells */}
                                {heatmapData[dayIdx].map((cell, hourIdx) => (
                                    <div
                                        key={`${dayIdx}-${hourIdx}`}
                                        className="group relative flex"
                                    >
                                        <div
                                            style={getCellStyle(cell.avgPnl)}
                                            className={cn(
                                                'min-h-6 flex-1',
                                                cell.avgPnl === 0 && 'bg-surface-secondary',
                                                cell.tradeCount > 0 && 'group-hover:outline group-hover:outline-1 group-hover:outline-border-strong'
                                            )}
                                        >
                                            {/* Tooltip (opens downwards for the first rows so it stays inside the panel) */}
                                            {cell.tradeCount > 0 && (
                                                <div className={cn(
                                                    'pointer-events-none absolute z-50 hidden min-w-[140px] px-2 py-1.5 group-hover:block',
                                                    menuSurface,
                                                    hourIdx < 3 ? 'left-0' : hourIdx > 20 ? 'right-0' : 'left-1/2 -translate-x-1/2',
                                                    dayIdx < 4 ? 'top-full mt-1' : 'bottom-full mb-1'
                                                )}>
                                                    <div className="mb-1 text-[10px] uppercase tracking-wider text-muted">
                                                        {dayName} {cell.hour}:00
                                                    </div>
                                                    <div className="space-y-0.5 text-[11px]">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <span className="text-secondary">Avg P&L:</span>
                                                            <span className={cn(
                                                                'font-mono font-semibold',
                                                                cell.avgPnl >= 0 ? 'text-success' : 'text-danger'
                                                            )}>
                                                                {formatSignedUsd(cell.avgPnl)}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center justify-between gap-3">
                                                            <span className="text-secondary">Trades:</span>
                                                            <span className="font-mono font-semibold text-text">{cell.tradeCount}</span>
                                                        </div>
                                                        <div className="flex items-center justify-between gap-3">
                                                            <span className="text-secondary">Win Rate:</span>
                                                            <span className="font-mono font-semibold text-text">{cell.winRate.toFixed(0)}%</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Best Time Indicators */}
            <div className="flex shrink-0 flex-col divide-y divide-border border-t border-border empty:hidden sm:flex-row sm:divide-x sm:divide-y-0">
                {(() => {
                    let bestCell: HeatmapCell | null = null;
                    let worstCell: HeatmapCell | null = null;

                    heatmapData.forEach(row => {
                        row.forEach(cell => {
                            if (cell.tradeCount > 0) {
                                if (!bestCell || cell.avgPnl > bestCell.avgPnl) {
                                    bestCell = cell;
                                }
                                if (!worstCell || cell.avgPnl < worstCell.avgPnl) {
                                    worstCell = cell;
                                }
                            }
                        });
                    });

                    return (
                        <>
                            {bestCell && bestCell.avgPnl > 0 && (
                                <div className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2">
                                    <TrendingUp size={14} className="shrink-0 text-success" />
                                    <div className="min-w-0">
                                        <div className={fieldLabel}>Best Time Slot</div>
                                        <div className="truncate font-mono text-xs font-semibold text-success">
                                            {DAYS[bestCell.day]} {bestCell.hour}:00 - Ort. {formatSignedUsd(bestCell.avgPnl)}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {worstCell && worstCell.avgPnl < 0 && (
                                <div className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2">
                                    <TrendingDown size={14} className="shrink-0 text-danger" />
                                    <div className="min-w-0">
                                        <div className={fieldLabel}>Worst Time Slot</div>
                                        <div className="truncate font-mono text-xs font-semibold text-danger">
                                            {DAYS[worstCell.day]} {worstCell.hour}:00 - Ort. {formatSignedUsd(worstCell.avgPnl)}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    );
                })()}
            </div>
        </section>
    );
};
