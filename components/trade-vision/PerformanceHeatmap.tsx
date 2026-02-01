import React, { useMemo } from 'react';
import { Trade } from './types';
import { cn } from '@/utils/cn';
import { Clock, TrendingUp, TrendingDown, Target } from 'lucide-react';
import { motion } from 'framer-motion';

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

        // Populate grid with trade data
        trades.forEach(trade => {
            if (!trade.date || !trade.time) return;

            const date = new Date(trade.date);
            const day = date.getDay();
            const hour = parseInt(trade.time.split(':')[0]);

            if (hour >= 0 && hour < 24 && day >= 0 && day < 7) {
                grid[day][hour].tradeCount++;
                grid[day][hour].avgPnl += trade.returnVal;
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

    const getCellColor = (avgPnl: number) => {
        if (avgPnl === 0) return 'bg-white/[0.02]';

        const intensity = Math.min(Math.abs(avgPnl) / maxAbsPnl, 1);

        if (avgPnl > 0) {
            // Green for profits
            return `bg-emerald-500/${Math.round(intensity * 30 + 5)}`;
        } else {
            // Red for losses
            return `bg-rose-500/${Math.round(intensity * 30 + 5)}`;
        }
    };

    const getBorderColor = (avgPnl: number) => {
        if (avgPnl === 0) return 'border-white/5';
        return avgPnl > 0 ? 'border-emerald-500/20' : 'border-rose-500/20';
    };

    return (
        <div className={cn("space-y-6", className)}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center border border-cyan-500/20 shadow-lg shadow-cyan-500/5">
                        <Clock size={20} className="text-cyan-400" />
                    </div>
                    <div>
                        <h3 className="text-xl font-black text-white uppercase tracking-tighter">Performance Matrix</h3>
                        <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest mt-1">Time-slot optimization heatmap</p>
                    </div>
                </div>

                {/* Legend */}
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded bg-emerald-500/20 border border-emerald-500/20"></div>
                        <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">Profitable</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded bg-rose-500/20 border border-rose-500/20"></div>
                        <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">Loss</span>
                    </div>
                </div>
            </div>

            <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 overflow-x-auto">
                <div className="min-w-[800px]">
                    {/* Hour labels */}
                    <div className="grid grid-cols-25 gap-1 mb-2">
                        <div className="w-12"></div>
                        {HOURS.map(hour => (
                            <div key={hour} className="text-center">
                                <span className="text-[8px] font-black text-gray-600 uppercase">{hour}</span>
                            </div>
                        ))}
                    </div>

                    {/* Heatmap grid */}
                    <div className="space-y-1">
                        {DAYS.map((dayName, dayIdx) => (
                            <div key={dayIdx} className="grid grid-cols-25 gap-1">
                                {/* Day label */}
                                <div className="w-12 flex items-center">
                                    <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">{dayName}</span>
                                </div>

                                {/* Hour cells */}
                                {heatmapData[dayIdx].map((cell, hourIdx) => (
                                    <motion.div
                                        key={`${dayIdx}-${hourIdx}`}
                                        initial={{ opacity: 0, scale: 0.8 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        transition={{ duration: 0.2, delay: (dayIdx * 24 + hourIdx) * 0.002 }}
                                        className="group relative"
                                    >
                                        <div
                                            className={cn(
                                                "aspect-square rounded border transition-all duration-300 cursor-pointer",
                                                getCellColor(cell.avgPnl),
                                                getBorderColor(cell.avgPnl),
                                                cell.tradeCount > 0 && "hover:scale-110 hover:z-10 hover:shadow-lg",
                                                cell.tradeCount === 0 && "opacity-30"
                                            )}
                                        >
                                            {/* Tooltip */}
                                            {cell.tradeCount > 0 && (
                                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 z-50">
                                                    <div className="bg-gray-950/95 border border-white/10 rounded-xl p-3 shadow-2xl backdrop-blur-xl min-w-[140px]">
                                                        <div className="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-2">
                                                            {dayName} {cell.hour}:00
                                                        </div>
                                                        <div className="space-y-1">
                                                            <div className="flex justify-between items-center">
                                                                <span className="text-[8px] text-gray-600 uppercase">Avg P&L:</span>
                                                                <span className={cn(
                                                                    "text-[10px] font-black tabular-nums",
                                                                    cell.avgPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                                                )}>
                                                                    {cell.avgPnl >= 0 ? '+' : ''}{cell.avgPnl.toFixed(2)}
                                                                </span>
                                                            </div>
                                                            <div className="flex justify-between items-center">
                                                                <span className="text-[8px] text-gray-600 uppercase">Trades:</span>
                                                                <span className="text-[10px] font-black text-white">{cell.tradeCount}</span>
                                                            </div>
                                                            <div className="flex justify-between items-center">
                                                                <span className="text-[8px] text-gray-600 uppercase">Win Rate:</span>
                                                                <span className="text-[10px] font-black text-cyan-400">{cell.winRate.toFixed(0)}%</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Best Time Indicators */}
            <div className="grid grid-cols-2 gap-6">
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
                            {bestCell && (
                                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-4">
                                    <div className="flex items-center gap-3">
                                        <TrendingUp size={20} className="text-emerald-400" />
                                        <div>
                                            <div className="text-[9px] font-black text-gray-600 uppercase tracking-widest">Best Time Slot</div>
                                            <div className="text-sm font-black text-emerald-400 mt-1">
                                                {DAYS[bestCell.day]} {bestCell.hour}:00 - Avg +${bestCell.avgPnl.toFixed(2)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {worstCell && worstCell.avgPnl < 0 && (
                                <div className="bg-rose-500/5 border border-rose-500/20 rounded-2xl p-4">
                                    <div className="flex items-center gap-3">
                                        <TrendingDown size={20} className="text-rose-400" />
                                        <div>
                                            <div className="text-[9px] font-black text-gray-600 uppercase tracking-widest">Worst Time Slot</div>
                                            <div className="text-sm font-black text-rose-400 mt-1">
                                                {DAYS[worstCell.day]} {worstCell.hour}:00 - Avg ${worstCell.avgPnl.toFixed(2)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    );
                })()}
            </div>
        </div>
    );
};
