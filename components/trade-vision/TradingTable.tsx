import React from 'react';
import { Inbox } from 'lucide-react';
import { Trade } from './types';
import { cn } from '@/utils/cn';
import { formatPrice, formatSignedPct, formatSignedUsd, getSignedPct, getSignedPnl } from './tradeMath';
import { badge, badgeDanger, badgeInfo, badgeNeutral, badgeSuccess, emptyLine } from './styles';

interface TradingTableProps {
  trades: Trade[];
  onRowClick: (id: string) => void;
}

const TH = 'sticky top-0 z-10 h-7 whitespace-nowrap border-b border-border bg-surface px-3 text-left text-[10px] font-medium uppercase tracking-wider text-muted';
const TD = 'h-7 whitespace-nowrap border-b border-border px-3';

const TradingTable: React.FC<TradingTableProps> = ({ trades, onRowClick }) => {
  return (
    <div className="flex min-h-[240px] flex-1 flex-col overflow-auto bg-surface">
      <table className={cn('w-full shrink-0 border-separate border-spacing-0 text-left text-xs', trades.length > 0 && 'min-w-[760px]')}>
        <thead>
          <tr>
            <th className={TH}>Type</th>
            <th className={TH}>Date / Time</th>
            <th className={TH}>Asset</th>
            <th className={TH}>Entry/Exit</th>
            <th className={cn(TH, 'text-right')}>Net Return</th>
            <th className={TH}>Setup</th>
            <th className={cn(TH, 'w-36')}>Efficiency</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => (
            <tr
              key={trade.id}
              onClick={() => onRowClick(trade.id)}
              className="cursor-pointer transition-colors hover:bg-surface-secondary"
            >
              <td className={TD}>
                <span className={cn(
                  badge,
                  trade.status === 'WIN' ? badgeSuccess :
                    trade.status === 'LOSS' ? badgeDanger :
                      badgeInfo
                )}>
                  {trade.status === 'OPEN' ? 'Active' : trade.status}
                </span>
              </td>
              <td className={cn(TD, 'font-mono')}>
                <span className="text-text">{trade.date}</span>
                {trade.time && <span className="ml-2 text-muted">{trade.time}</span>}
              </td>
              <td className={cn(TD, 'font-semibold uppercase text-text')}>
                {trade.symbol}
              </td>
              <td className={cn(TD, 'font-mono')}>
                <span className="text-text">${trade.entry.toLocaleString()}</span>
                <span className="mx-1.5 text-muted">/</span>
                <span className="text-secondary">{trade.status === 'OPEN' ? 'AÇIK' : formatPrice(trade.exit)}</span>
              </td>
              <td className={cn(
                TD,
                'text-right font-mono font-medium',
                trade.status === 'OPEN' ? 'text-info' :
                  getSignedPnl(trade) >= 0 ? 'text-success' : 'text-danger'
              )}>
                {trade.status === 'OPEN' ? 'BEKLİYOR' : formatSignedUsd(getSignedPnl(trade))}
                {trade.status !== 'OPEN' && (
                  <span className="ml-2 inline-block w-16 text-[11px] font-normal opacity-70">
                    {formatSignedPct(getSignedPct(trade))}
                  </span>
                )}
              </td>
              <td className={TD}>
                <div className="flex items-center gap-1.5">
                  {trade.setups.map((s, i) => i === 0 && (
                    <span key={i} className={cn(badge, badgeNeutral)}>
                      {s}
                    </span>
                  ))}
                  {trade.setups.length > 1 && (
                    <span className="font-mono text-[10px] text-muted">+{trade.setups.length - 1}</span>
                  )}
                </div>
              </td>
              <td className={TD}>
                <div className="flex items-center gap-2">
                  <div className="h-1 flex-1 bg-surface-highlight">
                    <div
                      className={cn(
                        'h-full',
                        trade.efficiency >= 80 ? 'bg-success' :
                          trade.efficiency >= 50 ? 'bg-primary' :
                            'bg-danger'
                      )}
                      style={{ width: `${trade.efficiency}%` }}
                    />
                  </div>
                  <span className="w-8 text-right font-mono text-[11px] text-secondary">{trade.efficiency || 0}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {trades.length === 0 && (
        <div className={cn(emptyLine, 'h-auto flex-1')}>
          <Inbox size={14} className="shrink-0" />
          <p>No trade samples detected</p>
        </div>
      )}
    </div>
  );
};

export default TradingTable;
