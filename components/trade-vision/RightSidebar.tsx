import React, { useMemo } from 'react';
import { Target, Zap, Shield, TrendingUp } from 'lucide-react';
import { Trade } from './types';
import { cn } from '@/utils/cn';
import { getClosedTrades, getSignedPnl, getTradeTimestamp, normalizeTimeInput } from './tradeMath';
import { emptyLine, panelHeader, panelTitle } from './styles';

interface RightSidebarProps {
  trades: Trade[];
}

const RightSidebar: React.FC<RightSidebarProps> = ({ trades }) => {
  // Only closed trades carry realised P&L / outcome; OPEN trades are excluded.
  const closed = useMemo(() => getClosedTrades(trades), [trades]);

  const chartData = useMemo(() => {
    let runningTotal = 0;
    return [...closed]
      .sort((a, b) => getTradeTimestamp(a) - getTradeTimestamp(b))
      .map(t => {
        runningTotal += getSignedPnl(t);
        return {
          name: t.date,
          value: runningTotal
        };
      });
  }, [closed]);

  const hourlyStats = useMemo(() => {
    const buckets: Record<number, { total: number, wins: number }> = {};
    closed.forEach(t => {
      const time = normalizeTimeInput(t.time);
      if (!time) return;
      const hour = parseInt(time.slice(0, 2), 10);
      if (!buckets[hour]) buckets[hour] = { total: 0, wins: 0 };
      buckets[hour].total++;
      if (t.status === 'WIN') buckets[hour].wins++;
    });
    // Crypto trades 24/7: report every hour (00-23) that actually has trades.
    return Object.entries(buckets)
      .map(([hour, stats]) => ({
        hourNum: Number(hour),
        hour: `${String(hour).padStart(2, '0')}-${String((Number(hour) + 1) % 24).padStart(2, '0')}`,
        value: stats.total > 0 ? Math.round((stats.wins / stats.total) * 100) : 0,
        count: stats.total
      }))
      .sort((a, b) => a.hourNum - b.hourNum);
  }, [closed]);

  const bestHour = useMemo(() => {
    const sorted = [...hourlyStats].sort((a, b) => b.value - a.value || b.count - a.count);
    return sorted.length > 0 ? sorted[0].hour : 'Yok';
  }, [hourlyStats]);

  const correctSetupsCount = trades.filter(t => t.efficiency > 70).length;
  const winCount = closed.filter(t => t.status === 'WIN').length;

  // Buckets by notional value (entry * size) in USD, so fractional crypto sizes are classified correctly.
  const bestVolume = useMemo(() => {
    const buckets = {
      '<$1K': { wins: 0, total: 0 },
      '$1K-10K': { wins: 0, total: 0 },
      '>$10K': { wins: 0, total: 0 }
    };
    closed.forEach(t => {
      const notional = t.entry * t.size;
      let key: keyof typeof buckets = '<$1K';
      if (notional >= 10000) key = '>$10K';
      else if (notional >= 1000) key = '$1K-10K';
      buckets[key].total++;
      if (t.status === 'WIN') buckets[key].wins++;
    });
    const sorted = Object.entries(buckets)
      .filter(([, b]) => b.total > 0)
      .sort((a, b) => (b[1].wins / b[1].total) - (a[1].wins / a[1].total));
    return sorted.length > 0 ? sorted[0][0] : 'Yok';
  }, [closed]);

  return (
    <aside className="flex min-h-0 w-full flex-col overflow-y-auto bg-surface">
      <header className={panelHeader}>
        <h2 className={cn(panelTitle, 'truncate')}>Management Scorecard</h2>
      </header>

      <div className="shrink-0 border-b border-border">
        {[
          { label: 'Setup Integrity', value: correctSetupsCount, total: trades.length, color: 'bg-success', icon: Target },
          { label: 'Kazanan İşlem', value: winCount, total: closed.length, color: 'bg-primary', icon: Shield },
          { label: 'En İyi Saat', text: bestHour, isText: true, icon: Zap },
          { label: 'En İyi Hacim (Nominal)', text: bestVolume, isText: true, icon: TrendingUp },
        ].map((item: any, idx) => (
          <div key={idx} className="border-b border-border px-3 py-1.5 last:border-b-0">
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="flex min-w-0 items-center gap-1.5 text-secondary">
                <item.icon size={12} className="shrink-0" />
                <span className="truncate">{item.label}</span>
              </div>
              <span className="shrink-0 font-mono text-text">{item.isText ? item.text : `${item.value}/${item.total}`}</span>
            </div>
            {!item.isText && (
              <div className="mt-1.5 h-1 bg-surface-highlight">
                <div
                  className={cn('h-full', item.color)}
                  style={{ width: `${item.total > 0 ? (item.value / item.total) * 100 : 0}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <header className={panelHeader}>
        <h2 className={cn(panelTitle, 'truncate')}>Hourly Success Variance</h2>
      </header>
      <div className="min-h-0 flex-1">
        {hourlyStats.map((item, idx) => (
          <div key={idx} className="flex h-7 items-center gap-3 border-b border-border px-3 text-[11px] hover:bg-surface-secondary">
            <span className="w-10 shrink-0 font-mono text-secondary">{item.hour}</span>
            <div className="h-1 flex-1 bg-surface-highlight">
              <div
                className="h-full bg-primary"
                style={{ width: `${item.value}%` }}
              />
            </div>
            <span className="w-9 shrink-0 text-right font-mono text-text">{item.value}%</span>
          </div>
        ))}
        {hourlyStats.length === 0 && (
          <div className={emptyLine}>
            Henüz kapalı işlem yok
          </div>
        )}
      </div>
    </aside>
  );
};

export default RightSidebar;
