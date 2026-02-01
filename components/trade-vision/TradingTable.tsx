import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Inbox, Activity, TrendingUp, TrendingDown } from 'lucide-react';
import { Trade } from './types';
import { cn } from '@/utils/cn';

interface TradingTableProps {
  trades: Trade[];
  onRowClick: (id: string) => void;
}

const TradingTable: React.FC<TradingTableProps> = ({ trades, onRowClick }) => {
  return (
    <div className="flex-1 overflow-auto scrollbar-hide min-h-0 bg-transparent">
      {trades.length === 0 ? (
        <div className="h-64 flex flex-col items-center justify-center text-gray-600 border border-dashed border-white/5 rounded-2xl mt-4">
          <Inbox size={48} strokeWidth={1} className="mb-2 opacity-20" />
          <p className="text-[10px] font-black uppercase tracking-widest opacity-50">No trade samples detected</p>
        </div>
      ) : (
        <table className="w-full text-left border-collapse relative">
          <thead>
            <tr className="text-[10px] text-gray-500 font-black uppercase tracking-[0.2em] border-b border-white/5 sticky top-0 bg-gray-950/80 backdrop-blur-md z-10">
              <th className="py-4 px-3 w-8">
                <div className="w-3 h-3 border border-white/10 rounded-sm bg-white/5"></div>
              </th>
              <th className="py-4 px-3">Type</th>
              <th className="py-4 px-3">Date / Time</th>
              <th className="py-4 px-3">Asset</th>
              <th className="py-4 px-3">Entry/Exit</th>
              <th className="py-4 px-3 text-right">Net Return</th>
              <th className="py-4 px-3">Setup</th>
              <th className="py-4 px-3 w-32">Efficiency</th>
            </tr>
          </thead>
          <tbody className="text-[11px] font-medium">
            {trades.map((trade) => (
              <tr
                key={trade.id}
                onClick={() => onRowClick(trade.id)}
                className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-all duration-300 group cursor-pointer"
              >
                <td className="py-4 px-3">
                  <div className="w-3 h-3 border border-white/5 rounded-sm bg-white/[0.02] group-hover:border-purple-500/50 transition-colors"></div>
                </td>
                <td className="py-4 px-3">
                  <span className={cn(
                    "px-3 py-1 rounded-lg text-[9px] font-black tracking-widest uppercase transition-all duration-500",
                    trade.status === 'WIN' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]' :
                      trade.status === 'LOSS' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20 shadow-[0_0_15px_rgba(244,63,94,0.1)]' :
                        'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.15)] animate-pulse'
                  )}>
                    {trade.status === 'OPEN' ? 'Active' : trade.status}
                  </span>
                </td>
                <td className="py-4 px-3">
                  <div className="text-gray-300 font-bold uppercase tracking-tighter">{trade.date}</div>
                  {trade.time && <div className="text-[9px] text-gray-600 font-mono mt-0.5">{trade.time}</div>}
                </td>
                <td className="py-4 px-3">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-white/5 border border-white/5 flex items-center justify-center text-[10px] font-black text-purple-400">
                      {trade.symbol.charAt(0)}
                    </div>
                    <span className="text-white font-black tracking-widest uppercase truncate max-w-[80px]">
                      {trade.symbol}
                    </span>
                  </div>
                </td>
                <td className="py-4 px-3 font-mono text-gray-500 tabular-nums">
                  <div className="text-gray-300 font-black">${trade.entry.toLocaleString()}</div>
                  <div className="text-[9px] font-medium tracking-widest">{trade.status === 'OPEN' ? 'LIVE' : `$${trade.exit?.toLocaleString()}`}</div>
                </td>
                <td className={cn(
                  "py-4 px-3 font-black font-mono text-[12px] text-right tabular-nums transition-colors duration-500",
                  trade.status === 'WIN' ? 'text-emerald-400 group-hover:text-emerald-300' :
                    trade.status === 'LOSS' ? 'text-rose-400 group-hover:text-rose-300' : 'text-cyan-400'
                )}>
                  {trade.status === 'OPEN' ? 'PENDING' : `${trade.status === 'WIN' ? '+' : '-'}$${(trade.returnVal || 0).toLocaleString()}`}
                  {trade.status !== 'OPEN' && (
                    <span className="block text-[9px] opacity-50 font-medium tracking-normal">
                      {trade.status === 'WIN' ? '+' : '-'}{trade.returnPct}%
                    </span>
                  )}
                </td>
                <td className="py-4 px-3">
                  <div className="flex items-center gap-2">
                    {trade.setups.map((s, i) => i === 0 && (
                      <span key={i} className="bg-white/5 border border-white/10 text-gray-400 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest shadow-lg">
                        {s}
                      </span>
                    ))}
                    {trade.setups.length > 1 && (
                      <span className="text-[9px] text-gray-600 font-black tracking-widest">+{trade.setups.length - 1}</span>
                    )}
                  </div>
                </td>
                <td className="py-4 px-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${trade.efficiency}%` }}
                        transition={{ duration: 1, ease: "easeOut" }}
                        className={cn(
                          "h-full rounded-full",
                          trade.efficiency >= 80 ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]' :
                            trade.efficiency >= 50 ? 'bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.3)]' :
                              'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.3)]'
                        )}
                      />
                    </div>
                    <span className="text-[9px] text-gray-500 w-6 text-right font-mono font-bold">{trade.efficiency || 0}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default TradingTable;
