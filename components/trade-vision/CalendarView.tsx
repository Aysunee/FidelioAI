import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Activity } from 'lucide-react';
import { Trade } from './types';
import { cn } from '@/utils/cn';
import { formatSignedUsd, getClosedTrades, getSignedPnl, parseTradeDate } from './tradeMath';
import { fieldLabel, iconBtn, panelHeader, panelTitle } from './styles';

interface CalendarViewProps {
    trades: Trade[];
}

const CalendarView: React.FC<CalendarViewProps> = ({ trades }) => {
    const [currentDate, setCurrentDate] = useState(new Date());

    const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
    const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay();

    const dailyPnL = useMemo(() => {
        const pnl: Record<number, { value: number; count: number; wins: number }> = {};
        // OPEN trades have no realised P&L and are not shown in the ledger.
        getClosedTrades(trades).forEach(trade => {
            const tDate = parseTradeDate(trade.date);
            if (
                tDate.getMonth() === currentDate.getMonth() &&
                tDate.getFullYear() === currentDate.getFullYear()
            ) {
                const day = tDate.getDate();
                if (!pnl[day]) pnl[day] = { value: 0, count: 0, wins: 0 };

                const val = getSignedPnl(trade);
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

    const dayCells: (number | null)[] = [...Array(firstDayOfMonth).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
    // Complete the last week so the 1px grid lines stay closed.
    const trailingPads = (7 - (dayCells.length % 7)) % 7;

    return (
        <section className="flex h-full min-h-0 flex-1 flex-col bg-surface">
            {/* Header: title + month navigation */}
            <header className={panelHeader}>
                <h2 className={cn(panelTitle, 'truncate')}>Journal Ledger</h2>
                <div className="flex items-center gap-1">
                    <button type="button" onClick={prevMonth} aria-label="Önceki ay" className={cn(iconBtn, 'h-6 w-6')}>
                        <ChevronLeft size={14} />
                    </button>
                    <span className="w-32 select-none text-center text-[11px] font-medium uppercase tracking-wider text-text">
                        {currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
                    </span>
                    <button type="button" onClick={nextMonth} aria-label="Sonraki ay" className={cn(iconBtn, 'h-6 w-6')}>
                        <ChevronRight size={14} />
                    </button>
                </div>
            </header>

            {/* Month KPI strip */}
            <div className="grid shrink-0 grid-cols-3 divide-x divide-border border-b border-border">
                <div className="min-w-0 px-3 py-1.5">
                    <div className={cn(fieldLabel, 'truncate')}>Positive Drift</div>
                    <div className="font-mono text-base font-semibold leading-5 text-success">
                        {monthStats.greenDays} <span className="text-[10px] font-medium text-muted">DAYS</span>
                    </div>
                </div>
                <div className="min-w-0 px-3 py-1.5">
                    <div className={cn(fieldLabel, 'truncate')}>Negative Drift</div>
                    <div className="font-mono text-base font-semibold leading-5 text-danger">
                        {monthStats.redDays} <span className="text-[10px] font-medium text-muted">DAYS</span>
                    </div>
                </div>
                <div className="min-w-0 px-3 py-1.5">
                    <div className={cn(fieldLabel, 'truncate')}>Fiscal Outcome</div>
                    <div className={cn(
                        'truncate font-mono text-base font-semibold leading-5',
                        monthStats.totalPnl >= 0 ? 'text-success' : 'text-danger'
                    )}>
                        {formatSignedUsd(monthStats.totalPnl)}
                    </div>
                </div>
            </div>

            {/* Calendar grid (scrolls inside the panel on narrow screens) */}
            <div className="flex min-h-0 flex-1 flex-col overflow-auto">
                <div className="flex min-w-[640px] flex-1 flex-col">
                    {/* Weekday headers */}
                    <div className="sticky top-0 z-10 grid h-7 shrink-0 grid-cols-7 items-center border-b border-border bg-surface text-center text-[10px] font-medium uppercase tracking-wider text-muted">
                        {weekDayNames.map(day => (
                            <div key={day}>
                                {day}
                            </div>
                        ))}
                    </div>

                    {/* Day cells: flat grid, 1px lines come from the grid background */}
                    <div className="grid flex-1 auto-rows-[minmax(76px,1fr)] grid-cols-7 gap-px bg-border">
                        {dayCells.map((day, i) => {
                            if (day === null) {
                                return <div key={`pad-${i}`} className="bg-background"></div>
                            }
                            const d = day as number;
                            const data = dailyPnL[d];
                            const isToday = new Date().getDate() === d && new Date().getMonth() === currentDate.getMonth() && new Date().getFullYear() === currentDate.getFullYear();

                            return (
                                <div
                                    key={d}
                                    className={cn(
                                        'flex min-w-0 flex-col bg-surface px-2 py-1.5',
                                        isToday && 'shadow-[inset_0_2px_0_var(--color-brand)]'
                                    )}
                                >
                                    {/* Numbering */}
                                    <div className="flex items-center justify-between">
                                        <span className={cn(
                                            'font-mono text-[11px]',
                                            isToday ? 'font-semibold text-primary' : 'text-muted'
                                        )}>{d}</span>
                                        {data && (
                                            <span className="flex items-center gap-1 font-mono text-[10px] text-muted">
                                                <Activity size={10} />
                                                {data.count}
                                            </span>
                                        )}
                                    </div>

                                    {data && (
                                        <div className="mt-auto min-w-0">
                                            <div className={cn(
                                                'truncate font-mono text-sm font-semibold',
                                                data.value >= 0 ? 'text-success' : 'text-danger'
                                            )}>
                                                {formatSignedUsd(data.value)}
                                            </div>

                                            <div className="mt-1 h-0.5 w-full bg-surface-highlight">
                                                <div className="h-full bg-primary" style={{ width: `${(data.wins / data.count) * 100}%` }}></div>
                                            </div>
                                            <div className="mt-0.5 truncate text-[10px] text-muted">
                                                {Math.round((data.wins / data.count) * 100)}% Win Rate
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {Array.from({ length: trailingPads }, (_, i) => (
                            <div key={`pad-end-${i}`} className="bg-background"></div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
};

export default CalendarView;
