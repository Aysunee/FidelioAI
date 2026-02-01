import React from 'react';
import { Inbox } from 'lucide-react';
import { Trade } from '../types';

interface TradingTableProps {
  trades: Trade[];
  onRowClick: (id: string) => void;
}

const TradingTable: React.FC<TradingTableProps> = ({ trades, onRowClick }) => {
  return (
    <div className="px-6 pb-6 flex-1 overflow-auto custom-scrollbar min-h-0 bg-[#0b0e14]">
      {trades.length === 0 ? (
        <div className="h-64 flex flex-col items-center justify-center text-gray-600 border border-dashed border-gray-800 rounded-xl mt-4">
          <Inbox size={48} strokeWidth={1} className="mb-2 opacity-20" />
          <p className="text-sm font-medium">No trades found for these filters</p>
        </div>
      ) : (
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-[10px] text-gray-500 font-bold uppercase border-b border-gray-800 sticky top-0 bg-[#0b0e14] z-10">
              <th className="py-3 px-2 w-8">
                <div className="w-3 h-3 border border-gray-600 rounded bg-[#131722] cursor-pointer hover:border-gray-400 transition-colors"></div>
              </th>
              <th className="py-3 px-2">Status</th>
              <th className="py-3 px-2">Date</th>
              <th className="py-3 px-2">Symbol</th>
              <th className="py-3 px-2">Entry</th>
              <th className="py-3 px-2">Exit</th>
              <th className="py-3 px-2">Size</th>
              <th className="py-3 px-2">Side</th>
              <th className="py-3 px-2">Return $</th>
              <th className="py-3 px-2">Return %</th>
              <th className="py-3 px-2">Setups</th>
              <th className="py-3 px-2 w-32">Efficiency</th>
            </tr>
          </thead>
          <tbody className="text-xs">
            {trades.map((trade) => (
              <tr
                key={trade.id}
                onClick={() => onRowClick(trade.id)}
                className="border-b border-gray-800/30 hover:bg-white/[0.02] transition-colors group cursor-pointer"
              >
                <td className="py-2.5 px-2">
                  <div className="w-3 h-3 border border-gray-700 rounded bg-[#131722] hover:border-gray-500 transition-colors"></div>
                </td>
                <td className="py-2.5 px-2">
                  <span className={`px-3 py-1.5 rounded-[4px] text-[10px] font-bold text-white shadow-[0_0_15px_rgba(0,0,0,0.3)] ${trade.status === 'WIN' ? 'bg-emerald-500 shadow-emerald-500/20' : 'bg-rose-500 shadow-rose-500/20'
                    }`}>
                    {trade.status}
                  </span>
                </td>
                <td className="py-2.5 px-2 text-gray-400 font-medium uppercase text-[11px] tracking-wide">
                  {trade.date}
                  {trade.time && <span className="block text-[9px] text-gray-600 font-mono mt-0.5">{trade.time}</span>}
                </td>
                <td className="py-2.5 px-2 text-cyan-400 font-bold uppercase text-[12px] tracking-wider group-hover:text-cyan-300 transition-colors">
                  {trade.symbol}
                </td>
                <td className="py-2.5 px-2 text-gray-300 font-mono text-[11px]">${trade.entry.toLocaleString()}</td>
                <td className="py-2.5 px-2 text-gray-300 font-mono text-[11px]">${trade.exit.toLocaleString()}</td>
                <td className="py-2.5 px-2 text-gray-500 font-mono text-[11px]">{trade.size.toLocaleString()}</td>
                <td className="py-2.5 px-2">
                  <span className={`border px-2 py-0.5 rounded-[4px] text-[9px] font-bold uppercase tracking-wider ${trade.side === 'LONG'
                      ? 'border-cyan-500/40 text-cyan-400 bg-cyan-500/5'
                      : 'border-emerald-500/40 text-emerald-400 bg-emerald-500/5'
                    }`}>
                    {trade.side}
                  </span>
                </td>
                <td className={`py-2.5 px-2 font-bold font-mono text-[12px] ${trade.status === 'WIN' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  ${trade.returnVal.toLocaleString()}
                </td>
                <td className="py-2.5 px-2 text-gray-400 font-mono text-[11px]">{trade.returnPct}%</td>
                <td className="py-2.5 px-2">
                  <div className="flex items-center gap-1">
                    {trade.setups.map((s, i) => i === 0 && (
                      <span key={i} className="bg-[#6366f1] text-white px-2 py-1 rounded-[4px] text-[9px] uppercase font-bold whitespace-nowrap overflow-hidden text-ellipsis shadow-lg shadow-indigo-500/30">
                        {s}
                      </span>
                    ))}
                    {trade.setups.length > 1 && (
                      <span className="text-[9px] text-gray-500 font-medium whitespace-nowrap">+{trade.setups.length - 1} MORE</span>
                    )}
                  </div>
                </td>
                <td className="py-2.5 px-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)] ${trade.efficiency >= 80 ? 'bg-gradient-to-r from-emerald-600 to-emerald-400' :
                            trade.efficiency >= 50 ? 'bg-gradient-to-r from-cyan-600 to-cyan-400' :
                              'bg-gradient-to-r from-rose-600 to-rose-400'
                          }`}
                        style={{ width: `${trade.efficiency}%` }}
                      />
                    </div>
                    <span className="text-[9px] text-gray-500 w-6 text-right font-mono">{trade.efficiency || 0}%</span>
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
