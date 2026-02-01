import React, { useMemo } from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { Settings, Target, Zap, Shield, TrendingUp } from 'lucide-react';
import { Trade } from './types';
import { cn } from '@/utils/cn';

interface RightSidebarProps {
  trades: Trade[];
}

const RightSidebar: React.FC<RightSidebarProps> = ({ trades }) => {
  const chartData = useMemo(() => {
    let runningTotal = 0;
    const data = trades
      .slice()
      .reverse()
      .map(t => {
        runningTotal += (t.status === 'WIN' ? t.returnVal : -t.returnVal);
        return {
          name: t.date,
          value: runningTotal
        };
      });
    return data;
  }, [trades]);

  const totalReturn = trades.reduce((acc, t) => acc + (t.status === 'WIN' ? t.returnVal : -t.returnVal), 0);

  const hourlyStats = useMemo(() => {
    const buckets: Record<string, { total: number, wins: number }> = {};
    for (let h = 8; h <= 16; h++) {
      const label = `${h}-${h + 1}`;
      buckets[label] = { total: 0, wins: 0 };
    }
    trades.forEach(t => {
      if (!t.time) return;
      const hour = parseInt(t.time.split(':')[0]);
      const label = `${hour}-${hour + 1}`;
      if (!buckets[label]) buckets[label] = { total: 0, wins: 0 };
      buckets[label].total++;
      if (t.status === 'WIN') buckets[label].wins++;
    });
    return Object.entries(buckets).map(([hour, stats]) => ({
      hour,
      value: stats.total > 0 ? Math.round((stats.wins / stats.total) * 100) : 0,
      count: stats.total
    })).filter(h => parseInt(h.hour.split('-')[0]) >= 8 && parseInt(h.hour.split('-')[0]) <= 16);
  }, [trades]);

  const bestHour = useMemo(() => {
    const sorted = [...hourlyStats].sort((a, b) => b.value - a.value);
    return sorted.length > 0 ? sorted[0].hour : 'N/A';
  }, [hourlyStats]);

  const correctSetupsCount = trades.filter(t => t.efficiency > 70).length;
  const mistakeFreeCount = trades.filter(t => t.status === 'WIN').length;

  const totalLossesAbs = trades.filter(t => t.status === 'LOSS').reduce((acc, t) => acc + t.returnVal, 0);
  const actualProfit = totalReturn;
  const potentialProfitVal = actualProfit + (totalLossesAbs * 0.5);
  const potentialIncreasePct = actualProfit > 0 ? Math.round(((potentialProfitVal - actualProfit) / actualProfit) * 100) : 0;

  const bestVolume = useMemo(() => {
    const buckets = { 'S': { wins: 0, total: 0 }, 'M': { wins: 0, total: 0 }, 'L': { wins: 0, total: 0 } };
    trades.forEach(t => {
      let key: keyof typeof buckets = 'S';
      if (t.size > 1000) key = 'L';
      else if (t.size >= 500) key = 'M';
      buckets[key].total++;
      if (t.status === 'WIN') buckets[key].wins++;
    });
    const sorted = Object.entries(buckets).sort((a, b) => (b[1].wins / Math.max(1, b[1].total)) - (a[1].wins / Math.max(1, a[1].total)));
    return sorted.length > 0 ? sorted[0][0] : 'N/A';
  }, [trades]);

  return (
    <div className="w-80 h-full bg-white/[0.01] border-l border-white/5 p-6 overflow-y-auto scrollbar-hide backdrop-blur-3xl">
      <div className="mb-10">
        <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] mb-6">Management Scorecard</h3>

        <div className="bg-gradient-to-br from-purple-500/10 to-indigo-500/10 p-5 rounded-2xl border border-purple-500/10 relative overflow-hidden group mb-8">
          <div className="relative z-10 flex items-center justify-between">
            <div className="flex-1 pr-4">
              <h4 className="text-[11px] font-black text-white uppercase tracking-widest mb-1 group-hover:text-purple-400 transition-colors">Yield Optimization</h4>
              <p className="text-[9px] text-gray-500 font-medium leading-relaxed">Estimated potential upside via setup adherence.</p>
            </div>
            <div className="w-14 h-14 rounded-full border-4 border-purple-500/10 flex items-center justify-center relative">
              <div className="absolute inset-0 rounded-full border-4 border-purple-500 border-t-transparent border-r-transparent animate-[spin_6s_linear_infinite]"></div>
              <span className="text-purple-400 font-black text-[12px]">+{potentialIncreasePct}%</span>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {[
            { label: 'Setup Integrity', value: correctSetupsCount, total: trades.length, color: 'bg-emerald-500', icon: Target },
            { label: 'Loss Mitigation', value: mistakeFreeCount, total: trades.length, color: 'bg-indigo-500', icon: Shield },
            { label: 'Optimal Window', text: bestHour, color: 'bg-purple-500', isText: true, icon: Zap },
            { label: 'Volume Profile', text: bestVolume, color: 'bg-cyan-500', isText: true, icon: TrendingUp },
          ].map((item: any, idx) => (
            <div key={idx} className="group">
              <div className="flex justify-between items-center text-[9px] font-black text-gray-500 mb-2 uppercase tracking-widest group-hover:text-gray-400 transition-colors">
                <div className="flex items-center gap-2">
                  <item.icon size={12} className="opacity-50 group-hover:opacity-100 transition-opacity" />
                  <span>{item.label}</span>
                </div>
                <span className="text-white">{item.isText ? item.text : `${item.value}/${item.total}`}</span>
              </div>
              <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                <div
                  className={cn("h-full transition-all duration-1000 ease-out", item.color)}
                  style={{ width: item.isText ? '100%' : `${item.total > 0 ? (item.value / item.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">Hourly Success Variance</h3>
          <Settings size={12} className="text-gray-600 hover:text-white transition-colors cursor-pointer" />
        </div>
        <div className="space-y-4">
          {hourlyStats.map((item, idx) => (
            <div key={idx} className="flex items-center gap-4 group">
              <span className="text-[9px] font-black text-gray-500 w-8 group-hover:text-white transition-colors tabular-nums">{item.hour}</span>
              <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-500 opacity-40 group-hover:opacity-100 transition-all duration-500"
                  style={{ width: `${item.value}%` }}
                />
              </div>
              <span className="text-[9px] font-black text-gray-400 w-8 text-right tabular-nums">{item.value}%</span>
            </div>
          ))}
          {hourlyStats.length === 0 && (
            <div className="text-[10px] text-gray-600 font-black uppercase tracking-widest text-center py-8 opacity-50 italic">
              Awaiting session data...
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RightSidebar;
