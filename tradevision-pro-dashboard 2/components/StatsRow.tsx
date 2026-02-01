
import React from 'react';
import { TrendingUp, TrendingDown, Target, Zap, Activity, Scale, Trophy, AlertTriangle } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { Trade } from '../types';

interface StatsRowProps {
  trades: Trade[];
}

const StatsCard = ({ title, value, subtext, icon: Icon, color, trend }: any) => (
  <div className="bg-[#161b22]/40 backdrop-blur-md p-5 rounded-xl border border-white/5 hover:border-white/10 transition-all group relative overflow-hidden">
    <div className={`absolute top-0 right-0 w-20 h-20 bg-${color}-500/5 blur-3xl rounded-full -mr-6 -mt-6`}></div>
    <div className="flex justify-between items-start mb-3">
      <div className={`p-2 bg-${color}-500/10 rounded-lg text-${color}-400 group-hover:text-${color}-300 transition-colors`}>
        <Icon size={16} />
      </div>
      {trend && (
        <div className={`flex items-center gap-1 text-[10px] font-bold ${trend > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {trend > 0 ? '+' : ''}{trend}%
        </div>
      )}
    </div>
    <div>
      <span className="text-slate-500 text-[9px] font-bold uppercase tracking-widest block mb-1">{title}</span>
      <div className="text-xl font-bold text-white tracking-tight">{value}</div>
      {subtext && <div className="text-[10px] text-slate-600 mt-1 font-medium">{subtext}</div>}
    </div>
  </div>
);

const StatsRow: React.FC<StatsRowProps> = ({ trades }) => {
  const totalReturn = trades.reduce((acc, t) => acc + (t.status === 'WIN' ? t.returnVal : -t.returnVal), 0);
  const wins = trades.filter(t => t.status === 'WIN');
  const losses = trades.filter(t => t.status === 'LOSS');
  const winCount = wins.length;
  const lossCount = losses.length;

  const winRatio = trades.length > 0 ? Math.round((winCount / trades.length) * 100) : 0;

  const avgWin = wins.length > 0 ? wins.reduce((acc, t) => acc + t.returnVal, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((acc, t) => acc + t.returnVal, 0) / losses.length : 0;

  // Profit Factor: Gross Profit / Gross Loss
  const grossProfit = wins.reduce((acc, t) => acc + t.returnVal, 0);
  const grossLoss = losses.reduce((acc, t) => acc + t.returnVal, 0); // stored as positive values in DB usually, but logic here assumes returnVal is positive.
  // Wait, looking at App.tsx: totalReturn calculation uses t.returnVal. So returnVal is likely just the magnitude? 
  // "t.status === 'WIN' ? t.returnVal : -t.returnVal" -> Suggests returnVal is always positive absolute amount.

  const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : (grossProfit > 0 ? '∞' : '0.00');

  return (
    <div className="grid grid-cols-5 gap-4 px-6 py-6">
      <StatsCard
        title="Net P&L"
        value={`$${totalReturn.toLocaleString()}`}
        subtext="All time profit"
        icon={Zap}
        color="cyan"
        trend={12}
      />

      <div className="bg-[#161b22]/40 backdrop-blur-md p-5 rounded-xl border border-white/5 flex items-center justify-between group relative overflow-hidden">
        <div className="absolute top-0 right-0 w-20 h-20 bg-indigo-500/5 blur-3xl rounded-full -mr-6 -mt-6"></div>
        <div className="z-10">
          <span className="text-slate-500 text-[9px] font-bold uppercase tracking-widest block mb-1">Win Rate</span>
          <div className="text-xl font-bold text-white tracking-tight">{winRatio}%</div>
          <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
            <Activity size={10} /> {trades.length} Trades
          </div>
        </div>
        <div className="h-12 w-12 opacity-90 group-hover:scale-110 transition-transform">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={[{ v: winRatio }, { v: 100 - winRatio }]}
                innerRadius={16}
                outerRadius={22}
                paddingAngle={4}
                dataKey="v"
                stroke="none"
                startAngle={90}
                endAngle={-270}
              >
                <Cell fill="#06b6d4" />
                <Cell fill="#1e293b" />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <StatsCard
        title="Profit Factor"
        value={profitFactor}
        subtext={`$${Math.round(grossProfit / 1000)}k Won / $${Math.round(grossLoss / 1000)}k Lost`}
        icon={Scale}
        color="emerald"
      />

      <StatsCard
        title="Avg Win"
        value={`$${Math.round(avgWin).toLocaleString()}`}
        subtext="Expected gain on win"
        icon={Trophy}
        color="teal"
      />

      <StatsCard
        title="Avg Loss"
        value={`$${Math.round(avgLoss).toLocaleString()}`}
        subtext="Average risk per trade"
        icon={AlertTriangle}
        color="rose"
      />
    </div>
  );
};

export default StatsRow;
