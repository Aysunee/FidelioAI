import React, { useMemo } from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { Settings } from 'lucide-react';
import { Trade } from '../types';

interface RightSidebarProps {
  trades: Trade[];
}

const RightSidebar: React.FC<RightSidebarProps> = ({ trades }) => {
  // Generate some dynamic chart data based on trades (Equity Curve)
  const chartData = useMemo(() => {
    let runningTotal = 0;
    const data = trades
      .slice()
      .reverse() // Oldest first
      .map(t => {
        runningTotal += (t.status === 'WIN' ? t.returnVal : -t.returnVal);
        return {
          name: t.date,
          value: runningTotal
        };
      });
    return data; // already oldest to newest
  }, [trades]);

  const totalReturn = trades.reduce((acc, t) => acc + (t.status === 'WIN' ? t.returnVal : -t.returnVal), 0);
  const winRatio = trades.length > 0 ? Math.round((trades.filter(t => t.status === 'WIN').length / trades.length) * 100) : 0;

  // Hourly Analysis
  const hourlyStats = useMemo(() => {
    const buckets: Record<string, { total: number, wins: number }> = {};

    // Initialize standard trading hours
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
      value: stats.total > 0 ? Math.round((stats.wins / stats.total) * 100) : 0, // Win Rate %
      count: stats.total // Activity
    })).filter(h => parseInt(h.hour.split('-')[0]) >= 8 && parseInt(h.hour.split('-')[0]) <= 16);
  }, [trades]);

  const bestHour = useMemo(() => {
    const sorted = [...hourlyStats].sort((a, b) => b.value - a.value);
    return sorted.length > 0 ? sorted[0].hour : 'N/A';
  }, [hourlyStats]);

  const correctSetupsCount = trades.filter(t => t.efficiency > 70).length;
  const mistakeFreeCount = trades.filter(t => t.status === 'WIN').length;

  // Calculate Potential Profit
  const actualProfit = totalReturn;
  // Losses are stored as positive absolute values, so we just sum them
  const totalLossesAbs = trades.filter(t => t.status === 'LOSS').reduce((acc, t) => acc + t.returnVal, 0);

  // Potential: Actual Profit + 50% of Losses (assuming we saved half)
  const potentialProfitVal = actualProfit + (totalLossesAbs * 0.5);
  const potentialIncreasePct = actualProfit > 0 ? Math.round(((potentialProfitVal - actualProfit) / actualProfit) * 100) : 0;

  // Calculate Best Volume Bucket
  const bestVolume = useMemo(() => {
    const buckets = { 'Small (<500)': { wins: 0, total: 0 }, 'Medium (500-1000)': { wins: 0, total: 0 }, 'Large (>1000)': { wins: 0, total: 0 } };

    trades.forEach(t => {
      let key: keyof typeof buckets = 'Small (<500)';
      if (t.size > 1000) key = 'Large (>1000)';
      else if (t.size >= 500) key = 'Medium (500-1000)';

      buckets[key].total++;
      if (t.status === 'WIN') buckets[key].wins++;
    });

    const sorted = Object.entries(buckets).sort((a, b) => (b[1].wins / Math.max(1, b[1].total)) - (a[1].wins / Math.max(1, a[1].total)));
    return sorted.length > 0 ? sorted[0][0].split(' ')[0] : 'N/A'; // Returns "Small", "Medium" or "Large"
  }, [trades]);

  return (
    <div className="w-80 h-full bg-[#0a0c14] border-l border-gray-800 p-6 overflow-y-auto custom-scrollbar">
      <div className="mb-8">
        <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4">Management</h3>
        <div className="bg-[#11141f] p-4 rounded-xl border border-gray-800 flex items-center justify-between mb-4 group cursor-help">
          <div className="flex-1 pr-4">
            <h4 className="text-xs font-semibold text-gray-300 mb-1 leading-tight group-hover:text-cyan-400 transition-colors">Potential Profit Increase</h4>
            <p className="text-[9px] text-gray-500">Focusing on setups could lead to significant gains.</p>
          </div>
          <div className="w-16 h-16 rounded-full border-4 border-emerald-500/20 flex items-center justify-center relative">
            <div className="absolute inset-0 rounded-full border-4 border-emerald-500 border-t-transparent animate-[spin_4s_linear_infinite]"></div>
            <span className="text-emerald-500 font-bold text-sm">+{potentialIncreasePct}%</span>
          </div>
        </div>

        <div className="space-y-4">
          {[
            { label: 'Trades Made With Correct Setups', value: correctSetupsCount, total: trades.length, color: 'bg-emerald-500' },
            { label: 'Trades Without Mistakes', value: mistakeFreeCount, total: trades.length, color: 'bg-indigo-500' },
            { label: 'Time of Day To Focus On', value: 0, total: 1, text: bestHour, color: 'bg-purple-500', isText: true },
            { label: 'Volume/Shares To Focus On', value: 0, total: 1, text: bestVolume, color: 'bg-cyan-500', isText: true },
          ].map((item: any, idx) => (
            <div key={idx}>
              <div className="flex justify-between text-[9px] font-bold text-gray-500 mb-1 uppercase">
                <span>{item.label}</span>
                <span>{item.isText ? item.text : `${item.value}/${item.total}`}</span>
              </div>
              <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full ${item.color} transition-all duration-1000 ease-out`}
                  style={{ width: item.isText ? '100%' : `${item.total > 0 ? (item.value / item.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>



      <div>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Win Rate By Hour</h3>
          <Settings size={12} className="text-gray-600" />
        </div>
        <div className="space-y-3">
          {hourlyStats.map((item, idx) => (
            <div key={idx} className="flex items-center gap-3 group">
              <span className="text-[9px] text-gray-500 w-8 group-hover:text-gray-300 transition-colors">{item.hour}</span>
              <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full bg-cyan-500 opacity-70 group-hover:opacity-100 transition-all`}
                  style={{ width: `${item.value}%` }}
                />
              </div>
              <span className="text-[9px] text-gray-400 w-6 text-right">{item.value}%</span>
            </div>
          ))}
          {hourlyStats.length === 0 && (
            <div className="text-[10px] text-gray-500 text-center py-4">Add trades with times to see analysis</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RightSidebar;
