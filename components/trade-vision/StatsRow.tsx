import React from 'react';
import { Trade } from './types';
import { cn } from '@/utils/cn';
import { formatSignedUsd, formatUsd, getClosedTrades, getSignedPnl } from './tradeMath';
import { fieldLabel } from './styles';

interface StatsRowProps {
  trades: Trade[];
}

interface KpiCellProps {
  title: string;
  value: React.ReactNode;
  subtext?: string;
  valueClassName?: string;
  className?: string;
  children?: React.ReactNode;
}

// One cell of the KPI strip: label, mono value, optional detail line.
const KpiCell: React.FC<KpiCellProps> = ({ title, value, subtext, valueClassName, className, children }) => (
  <div className={cn('flex min-w-0 flex-col justify-center gap-0.5 bg-surface px-3 py-2', className)}>
    <span className={cn(fieldLabel, 'truncate')}>{title}</span>
    <div className="flex min-w-0 items-center gap-2">
      <span className={cn('truncate font-mono text-base font-semibold leading-5 text-text', valueClassName)}>{value}</span>
      {children}
    </div>
    {subtext && <span className="truncate text-[10px] text-muted" title={subtext}>{subtext}</span>}
  </div>
);

const StatsRow: React.FC<StatsRowProps> = ({ trades }) => {
  // OPEN trades have no realised P&L: they are excluded from every statistic below.
  const closed = getClosedTrades(trades);
  const openCount = trades.length - closed.length;
  const totalReturn = closed.reduce((acc, t) => acc + getSignedPnl(t), 0);
  const wins = closed.filter(t => t.status === 'WIN');
  const losses = closed.filter(t => t.status === 'LOSS');
  const winCount = wins.length;

  const winRatio = closed.length > 0 ? Math.round((winCount / closed.length) * 100) : 0;

  const grossProfit = wins.reduce((acc, t) => acc + Math.max(0, getSignedPnl(t)), 0);
  const grossLoss = losses.reduce((acc, t) => acc + Math.abs(Math.min(0, getSignedPnl(t))), 0);

  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;

  const profitFactor = grossLoss > 0
    ? (grossProfit / grossLoss).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : (grossProfit > 0 ? '∞' : '0,00');

  return (
    <div className="grid shrink-0 grid-cols-2 gap-px bg-border lg:grid-cols-5">
      <KpiCell
        className="col-span-2 lg:col-span-1"
        title="Net K/Z"
        value={formatSignedUsd(totalReturn)}
        valueClassName={totalReturn > 0 ? 'text-success' : totalReturn < 0 ? 'text-danger' : undefined}
        subtext={`${closed.length} kapalı işlem${openCount > 0 ? ` · ${openCount} açık işlem hariç` : ''}`}
      />

      <KpiCell
        title="Kazanma Oranı"
        value={`%${winRatio}`}
        subtext={`${closed.length} kapalı işlem`}
      >
        <div
          className="h-1 min-w-0 flex-1 bg-surface-highlight"
          role="img"
          aria-label={`Kazanma oranı %${winRatio}`}
        >
          <div className="h-full bg-primary" style={{ width: `${winRatio}%` }} />
        </div>
      </KpiCell>

      <KpiCell
        title="Kâr Faktörü"
        value={profitFactor}
        subtext={`${formatUsd(grossProfit)} kazanç / ${formatUsd(grossLoss)} kayıp`}
      />

      <KpiCell
        title="Ort. Kazanç"
        value={formatUsd(avgWin)}
        subtext={`${wins.length} kazançlı işlem ortalaması`}
      />

      <KpiCell
        title="Ort. Kayıp"
        value={formatUsd(avgLoss)}
        subtext={`${losses.length} kayıplı işlem ortalaması`}
      />
    </div>
  );
};

export default StatsRow;
