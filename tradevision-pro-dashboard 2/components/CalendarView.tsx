
import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown } from 'lucide-react';
import { Trade } from '../types';

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
            const tradeDate = new Date(trade.date); // Assuming date string parses correctly or is standard format
            // Note: Date parsing can be tricky depending on the string format in MOCK_TRADES. 
            // MOCK_TRADES has "Sep 12, 2019".

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

        const days = Object.values(dailyPnL) as { value: number; count: number; wins: number }[];

        days.forEach(day => {
            totalPnl += day.value;
            totalTrades += day.count;
            if (day.value > 0) greenDays++;
            if (day.value < 0) redDays++;
        });

        return { totalPnl, totalTrades, greenDays, redDays };
    }, [dailyPnL]);

    const prevMonth = () => {
        setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    };

    const nextMonth = () => {
        setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    };

    const weeks = [];
    let days = [];

    // Padding for first week
    for (let i = 0; i < firstDayOfMonth; i++) {
        days.push(<div key={`pad-${i}`} className="h-32 bg-[#11141f]/30 border border-white/5 rounded-xl m-1"></div>);
    }

    // Days
    for (let d = 1; d <= daysInMonth; d++) {
        const data = dailyPnL[d];
        const isToday = new Date().getDate() === d && new Date().getMonth() === currentDate.getMonth() && new Date().getFullYear() === currentDate.getFullYear();

        days.push(
            <div
                key={d}
                className={`h-32 p-3 border rounded-xl m-1 relative group transition-all hover:scale-[1.02] ${data
                    ? (data.value >= 0
                        ? 'bg-emerald-500/5 border-emerald-500/20 hover:bg-emerald-500/10'
                        : 'bg-rose-500/5 border-rose-500/20 hover:bg-rose-500/10')
                    : 'bg-[#161b22]/40 border-white/5 hover:border-white/10'
                    } ${isToday ? 'ring-1 ring-cyan-500' : ''}`}
            >
                <div className="flex justify-between items-start mb-2">
                    <span className={`text-sm font-bold ${isToday ? 'text-cyan-400' : 'text-slate-500'}`}>{d}</span>
                    {data && (
                        <div className="flex gap-1">
                            <span className="text-[9px] font-bold text-slate-500 bg-black/20 px-1.5 py-0.5 rounded">
                                {data.count}T
                            </span>
                        </div>
                    )}
                </div>

                {data ? (
                    <div className="flex flex-col h-full justify-center -mt-4">
                        <div className={`text-lg font-bold tracking-tight ${data.value >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {data.value >= 0 ? '+' : '-'}${Math.abs(data.value).toLocaleString()}
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                            {data.value >= 0 ? <TrendingUp size={12} className="text-emerald-500" /> : <TrendingDown size={12} className="text-rose-500" />}
                            <span className="text-[10px] text-slate-400">
                                {data.wins}/{data.count} Wins
                            </span>
                        </div>
                    </div>
                ) : (
                    <div className="h-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">+ Add Trade</span>
                    </div>
                )}
            </div>
        );

        if ((firstDayOfMonth + d) % 7 === 0 || d === daysInMonth) {
            weeks.push(days);
            days = [];
        }
    }

    const weekDayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return (
        <div className="p-6 h-full flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-4">
                    <h2 className="text-2xl font-bold text-white">Calendar</h2>
                    <div className="flex bg-[#161b22] rounded-lg border border-white/5 p-1">
                        <button onClick={prevMonth} className="p-1 hover:bg-white/5 rounded text-slate-400 hover:text-white transition-colors">
                            <ChevronLeft size={18} />
                        </button>
                        <span className="px-4 font-bold text-slate-200 w-32 text-center select-none">
                            {currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
                        </span>
                        <button onClick={nextMonth} className="p-1 hover:bg-white/5 rounded text-slate-400 hover:text-white transition-colors">
                            <ChevronRight size={18} />
                        </button>
                    </div>
                </div>

                <div className="flex gap-4">
                    <div className="bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 rounded-xl flex flex-col items-center min-w-[100px]">
                        <span className="text-[10px] font-bold text-emerald-500 uppercase">Green Days</span>
                        <span className="text-xl font-bold text-emerald-400">{monthStats.greenDays}</span>
                    </div>
                    <div className="bg-rose-500/10 border border-rose-500/20 px-4 py-2 rounded-xl flex flex-col items-center min-w-[100px]">
                        <span className="text-[10px] font-bold text-rose-500 uppercase">Red Days</span>
                        <span className="text-xl font-bold text-rose-400">{monthStats.redDays}</span>
                    </div>
                    <div className={`bg-[#161b22] border border-white/5 px-4 py-2 rounded-xl flex flex-col items-center min-w-[120px] ${monthStats.totalPnl >= 0 ? 'shadow-[0_0_15px_rgba(16,185,129,0.1)]' : ''}`}>
                        <span className="text-[10px] font-bold text-slate-500 uppercase">Net P&L</span>
                        <span className={`text-xl font-bold ${monthStats.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            ${monthStats.totalPnl.toLocaleString()}
                        </span>
                    </div>
                </div>
            </div>

            {/* Calendar Grid */}
            <div className="flex-1 overflow-auto custom-scrollbar">
                {/* Weekday Headers */}
                <div className="grid grid-cols-7 mb-2">
                    {weekDayNames.map(day => (
                        <div key={day} className="text-center text-[10px] font-bold text-slate-600 uppercase tracking-widest py-2">
                            {day}
                        </div>
                    ))}
                </div>

                {/* Calendar Body */}
                <div className="grid grid-cols-7 auto-rows-fr gap-0">
                    {/* Flatten the days array for simple grid */}
                    {[...Array(firstDayOfMonth).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)].map((day, i) => {
                        if (day === null) {
                            return <div key={`pad-${i}`} className="h-32 bg-[#11141f]/20 border border-white/5 m-1 rounded-xl"></div>
                        }
                        const d = day as number;
                        const data = dailyPnL[d];
                        const isToday = new Date().getDate() === d && new Date().getMonth() === currentDate.getMonth() && new Date().getFullYear() === currentDate.getFullYear();

                        return (
                            <div
                                key={d}
                                className={`h-32 p-3 border rounded-xl m-1 relative group transition-all hover:scale-[1.02] hover:z-10 bg-[#161b22]/40 backdrop-blur-sm ${data
                                    ? (data.value >= 0
                                        ? 'bg-gradient-to-br from-emerald-500/10 to-[#161b22]/40 border-emerald-500/20 hover:border-emerald-500/40'
                                        : 'bg-gradient-to-br from-rose-500/10 to-[#161b22]/40 border-rose-500/20 hover:border-rose-500/40')
                                    : 'border-white/5 hover:border-white/10'
                                    } ${isToday ? 'ring-2 ring-cyan-500 shadow-lg shadow-cyan-500/20' : ''}`}
                            >
                                {/* Day Number */}
                                <div className="flex justify-between items-start mb-2">
                                    <span className={`text-sm font-bold ${isToday ? 'text-cyan-400' : 'text-slate-500'} font-mono`}>{d}</span>
                                    {data && (
                                        <div className="flex gap-1">
                                            <span className="text-[9px] font-bold text-slate-400 bg-black/40 px-1.5 py-0.5 rounded border border-white/5">
                                                {data.count}
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {data ? (
                                    <div className="flex flex-col h-full justify-center -mt-6">
                                        <div className={`text-lg font-bold tracking-tight ${data.value >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            ${Math.abs(data.value).toLocaleString()}
                                        </div>
                                        {/* Bar for win rate */}
                                        <div className="w-full h-1 bg-white/5 rounded-full mt-2 overflow-hidden">
                                            <div className="h-full bg-slate-500" style={{ width: `${(data.wins / data.count) * 100}%` }}></div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                        <span className="text-[20px] text-white/5 font-black">+</span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default CalendarView;
