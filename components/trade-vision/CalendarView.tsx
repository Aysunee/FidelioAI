import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Calendar as CalendarIcon, Target, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trade } from './types';
import { cn } from '@/utils/cn';

interface CalendarViewProps {
    trades: Trade[];
}

const CalendarView: React.FC<CalendarViewProps> = ({ trades }) => {
    const [currentDate, setCurrentDate] = useState(new Date());

    const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
    const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay();

    const dailyPnL = useMemo(() => {
        const pnl: Record<number, { value: number; count: number; wins: number }> = {};
        trades.forEach(trade => {
            const tDate = new Date(trade.date);
            if (
                tDate.getMonth() === currentDate.getMonth() &&
                tDate.getFullYear() === currentDate.getFullYear()
            ) {
                const day = tDate.getDate();
                if (!pnl[day]) pnl[day] = { value: 0, count: 0, wins: 0 };

                const val = trade.status === 'WIN' ? trade.returnVal : -trade.returnVal;
                pnl[day].value += val;
                pnl[day].count += 1;
                if (trade.status === 'WIN') pnl[day].wins += 1;
            }
        });
        return pnl;
    }, [trades, currentDate]);

    const monthStats = useMemo(() => {
        let totalPnl = 0;
        let totalTrades = 0;
        let greenDays = 0;
        let redDays = 0;
        (Object.values(dailyPnL) as { value: number; count: number; wins: number }[]).forEach(day => {
            totalPnl += day.value;
            totalTrades += day.count;
            if (day.value > 0) greenDays++;
            else if (day.value < 0) redDays++;
        });
        return { totalPnl, totalTrades, greenDays, redDays };
    }, [dailyPnL]);

    const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));

    const weekDayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return (
        <div className="flex-1 flex flex-col min-h-0 bg-transparent">
            {/* Header */}
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 mb-8">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20 shadow-lg shadow-purple-500/5">
                        <CalendarIcon size={20} className="text-purple-400" />
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-white uppercase tracking-tighter">Journal Ledger</h2>
                        <div className="flex items-center gap-2 mt-1">
                            <button onClick={prevMonth} className="p-1 hover:bg-white/5 rounded-lg text-gray-500 hover:text-white transition-all">
                                <ChevronLeft size={16} />
                            </button>
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest w-40 text-center select-none">
                                {currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
                            </span>
                            <button onClick={nextMonth} className="p-1 hover:bg-white/5 rounded-lg text-gray-500 hover:text-white transition-all">
                                <ChevronRight size={16} />
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap gap-4">
                    <div className="bg-white/[0.02] border border-white/5 px-6 py-3 rounded-2xl flex flex-col items-start min-w-[140px] group hover:border-emerald-500/20 transition-all">
                        <span className="text-[9px] font-black text-gray-500 uppercase tracking-[0.2em] mb-1 group-hover:text-emerald-500 transition-colors">Positive Drift</span>
                        <div className="text-2xl font-black text-emerald-400 tabular-nums">{monthStats.greenDays} <span className="text-[10px] text-gray-600">DAYS</span></div>
                    </div>
                    <div className="bg-white/[0.02] border border-white/5 px-6 py-3 rounded-2xl flex flex-col items-start min-w-[140px] group hover:border-rose-500/20 transition-all">
                        <span className="text-[9px] font-black text-gray-500 uppercase tracking-[0.2em] mb-1 group-hover:text-rose-500 transition-colors">Negative Drift</span>
                        <div className="text-2xl font-black text-rose-400 tabular-nums">{monthStats.redDays} <span className="text-[10px] text-gray-600">DAYS</span></div>
                    </div>
                    <div className={cn(
                        "bg-white/[0.02] border border-white/5 px-6 py-3 rounded-2xl flex flex-col items-start min-w-[160px] group transition-all",
                        monthStats.totalPnl >= 0 ? 'hover:border-purple-500/20' : 'hover:border-rose-500/20'
                    )}>
                        <span className="text-[9px] font-black text-gray-500 uppercase tracking-[0.2em] mb-1">Fiscal Outcome</span>
                        <div className={cn(
                            "text-2xl font-black tabular-nums",
                            monthStats.totalPnl >= 0 ? 'text-purple-400' : 'text-rose-400'
                        )}>
                            ${monthStats.totalPnl.toLocaleString()}
                        </div>
                    </div>
                </div>
            </div>

            {/* Calendar Grid Container */}
            <div className="flex-1 overflow-auto scrollbar-hide">
                <div className="min-w-[800px]">
                    {/* Weekday Headers */}
                    <div className="grid grid-cols-7 mb-4 border-b border-white/5">
                        {weekDayNames.map(day => (
                            <div key={day} className="text-center text-[10px] font-black text-gray-600 uppercase tracking-[0.3em] py-4">
                                {day}
                            </div>
                        ))}
                    </div>

                    {/* Calendar Grid */}
                    <div className="grid grid-cols-7 gap-3 pb-8">
                        {[...Array(firstDayOfMonth).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)].map((day, i) => {
                            if (day === null) {
                                return <div key={`pad-${i}`} className="h-40 bg-white/[0.01] border border-white/5 rounded-2xl opacity-30"></div>
                            }
                            const d = day as number;
                            const data = dailyPnL[d];
                            const isToday = new Date().getDate() === d && new Date().getMonth() === currentDate.getMonth() && new Date().getFullYear() === currentDate.getFullYear();

                            return (
                                <motion.div
                                    key={d}
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ duration: 0.3, delay: i * 0.01 }}
                                    className={cn(
                                        "h-40 p-4 border rounded-2xl relative group transition-all duration-500 cursor-pointer overflow-hidden",
                                        data
                                            ? (data.value >= 0
                                                ? 'bg-emerald-500/[0.03] border-emerald-500/10 hover:border-emerald-500/30 shadow-lg shadow-emerald-500/[0.02]'
                                                : 'bg-rose-500/[0.03] border-rose-500/10 hover:border-rose-500/30 shadow-lg shadow-rose-500/[0.02]')
                                            : 'bg-white/[0.02] border-white/5 hover:border-white/20',
                                        isToday && 'ring-1 ring-purple-500/50 border-purple-500/30'
                                    )}
                                >
                                    {/* Numbering */}
                                    <div className="flex justify-between items-start mb-2">
                                        <span className={cn(
                                            "text-xs font-black font-mono",
                                            isToday ? 'text-purple-400' : 'text-gray-600 group-hover:text-gray-400 transition-colors'
                                        )}>{d}</span>
                                        {data && (
                                            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/5 border border-white/5">
                                                <Activity size={10} className="text-gray-500" />
                                                <span className="text-[9px] font-black text-gray-500">{data.count}</span>
                                            </div>
                                        )}
                                    </div>

                                    {data ? (
                                        <div className="flex flex-col h-full justify-center -mt-6">
                                            <div className={cn(
                                                "text-xl font-black tracking-tighter tabular-nums",
                                                data.value >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                            )}>
                                                {data.value >= 0 ? '+' : '-'}${Math.abs(data.value).toLocaleString()}
                                            </div>

                                            <div className="flex flex-col gap-2 mt-4">
                                                <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                                                    <div className="h-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.3)]" style={{ width: `${(data.wins / data.count) * 100}%` }}></div>
                                                </div>
                                                <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all duration-300">
                                                    <Target size={10} className="text-gray-600" />
                                                    <span className="text-[9px] font-black text-gray-600 uppercase tracking-widest">
                                                        {Math.round((data.wins / data.count) * 100)}% Win Rate
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-500 bg-white/[0.02]">
                                            <span className="text-[24px] text-white/10 font-black">+</span>
                                        </div>
                                    )}

                                    {/* Decorative subtle texture */}
                                    <div className="absolute -bottom-4 -right-4 w-12 h-12 bg-white/5 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                </motion.div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CalendarView;
