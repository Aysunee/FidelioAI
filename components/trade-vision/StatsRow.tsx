import React from 'react';
import { TrendingUp, TrendingDown, Target, Zap, Activity, Scale, Trophy, AlertTriangle } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { Trade } from './types';
import { cn } from '@/utils/cn';

interface StatsRowProps {
  trades: Trade[];
}

const StatsCard = ({ title, value, subtext, icon: Icon, color, trend }: any) => (
  <div className="bg-white/[0.02] backdrop-blur-md p-5 rounded-2xl border border-white/5 hover:border-white/10 transition-all group relative overflow-hidden flex flex-col justify-between h-full">
    <div className="flex justify-between items-start mb-3">
      <div className={cn(
        "p-2 rounded-lg transition-colors",
        color === 'cyan' ? "bg-cyan-500/10 text-cyan-400 group-hover:text-cyan-300" :
          color === 'emerald' ? "bg-emerald-500/10 text-emerald-400 group-hover:text-emerald-300" :
            color === 'teal' ? "bg-teal-500/10 text-teal-400 group-hover:text-teal-300" :
              color === 'rose' ? "bg-rose-500/10 text-rose-400 group-hover:text-rose-300" :
                "bg-purple-500/10 text-purple-400 group-hover:text-purple-300"
      )}>
        <Icon size={16} />
      </div>
      {trend && (
        <div className={cn(
          "flex items-center gap-1 text-[10px] font-black tracking-widest uppercase px-2 py-0.5 rounded-md",
          trend > 0 ? 'text-emerald-400 bg-emerald-500/5 border border-emerald-500/10' : 'text-rose-400 bg-rose-500/5 border border-rose-500/10'
        )}>
          {trend > 0 ? '+' : ''}{trend}%
        </div>
      )}
    </div>
    <div>
      <span className="text-gray-500 text-[9px] font-black uppercase tracking-[0.2em] block mb-1">{title}</span>
      <div className="text-2xl font-bold text-white tracking-tighter">{value}</div>
      {subtext && <div className="text-[10px] text-gray-500 mt-1 font-medium italic opacity-70">{subtext}</div>}
    </div>
  </div>
);

const StatsRow: React.FC<StatsRowProps> = ({ trades }) => {
  const totalReturn = trades.reduce((acc, t) => acc + (t.status === 'WIN' ? t.returnVal : -t.returnVal), 0);
  const wins = trades.filter(t => t.status === 'WIN');
  const losses = trades.filter(t => t.status === 'LOSS');
  const winCount = wins.length;

  const winRatio = trades.length > 0 ? Math.round((winCount / trades.length) * 100) : 0;

  const avgWin = wins.length > 0 ? wins.reduce((acc, t) => acc + t.returnVal, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((acc, t) => acc + t.returnVal, 0) / losses.length : 0;

  const grossProfit = wins.reduce((acc, t) => acc + t.returnVal, 0);
  const grossLoss = losses.reduce((acc, t) => acc + t.returnVal, 0);

  const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : (grossProfit > 0 ? '∞' : '0.00');

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
      <StatsCard
        title="Net P&L"
        value={`$${totalReturn.toLocaleString()}`}
        subtext="Aggregated performance"
        icon={Zap}
        color="cyan"
        trend={12}
      />

      <div className="bg-white/[0.02] backdrop-blur-md p-5 rounded-2xl border border-white/5 flex items-center justify-between group relative overflow-hidden h-full">
        <div className="z-10">
          <span className="text-gray-500 text-[9px] font-black uppercase tracking-[0.2em] block mb-1">Win Rate</span>
          <div className="text-2xl font-bold text-white tracking-tighter">{winRatio}%</div>
          <div className="text-[10px] text-gray-500 mt-1 flex items-center gap-2">
            <Activity size={12} className="text-purple-500" /> {trades.length} Samples
          </div>
        </div>
        <div className="h-14 w-14 opacity-90 group-hover:scale-110 transition-transform">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={[{ v: winRatio }, { v: 100 - winRatio }]}
                innerRadius={18}
                outerRadius={24}
                paddingAngle={4}
                dataKey="v"
                stroke="none"
                startAngle={90}
                endAngle={-270}
              >
                <Cell fill="#a855f7" />
                <Cell fill="rgba(255,255,255,0.05)" />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <StatsCard
        title="Profit Factor"
        value={profitFactor}
        subtext={`$${Math.round(grossProfit / 1000)}k Win / $${Math.round(grossLoss / 1000)}k Loss`}
        icon={Scale}
        color="indigo"
      />

      <StatsCard
        title="Efficiency"
        value={`$${Math.round(avgWin).toLocaleString()}`}
        subtext="Average expected outcome"
        icon={Trophy}
        color="teal"
      />

      <StatsCard
        title="Risk Profile"
        value={`$${Math.round(avgLoss).toLocaleString()}`}
        subtext="Mean drawdown exposure"
        icon={AlertTriangle}
        color="rose"
      />
    </div>
  );
};

export default StatsRow;
