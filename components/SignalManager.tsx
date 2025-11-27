
import React, { useState, useMemo } from 'react';
import { Signal, Side } from '../types';
import { Card } from './ui/Card';
import { Search, Trash2, Filter, AlertCircle, ArrowUpRight, ArrowDownRight, Zap, Download } from 'lucide-react';

interface SignalManagerProps {
  signals: Signal[];
  onDelete: (id: string) => void;
  onClearAll: () => void;
}

export const SignalManager: React.FC<SignalManagerProps> = ({ signals, onDelete, onClearAll }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sideFilter, setSideFilter] = useState<'ALL' | 'LONG' | 'SHORT'>('ALL');
  const [strategyFilter, setStrategyFilter] = useState<string>('ALL');

  // Extract unique strategies for the filter dropdown
  const uniqueStrategies = useMemo(() => {
    const strats = new Set(signals.map(s => s.strategy));
    return ['ALL', ...Array.from(strats)];
  }, [signals]);

  const filteredSignals = useMemo(() => {
    return signals.filter(sig => {
      const matchesSearch = sig.symbol.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            sig.note?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesSide = sideFilter === 'ALL' 
        ? true 
        : (sideFilter === 'LONG' ? (sig.side === 'BUY' || sig.side === 'LONG') : (sig.side === 'SELL' || sig.side === 'SHORT'));

      const matchesStrategy = strategyFilter === 'ALL' ? true : sig.strategy === strategyFilter;

      return matchesSearch && matchesSide && matchesStrategy;
    });
  }, [signals, searchTerm, sideFilter, strategyFilter]);

  const formatTime = (isoStr: string) => {
    return new Date(isoStr).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  };

  const exportCSV = () => {
    const headers = ['Time', 'Symbol', 'Side', 'Price', 'Strategy', 'Note'];
    const rows = filteredSignals.map(s => [
        s.time, s.symbol, s.side, s.price, s.strategy, s.note || ''
    ]);
    const csvContent = "data:text/csv;charset=utf-8," 
        + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `signals_export_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Card className="h-full flex flex-col" noPadding>
      {/* Header & Filters */}
      <div className="p-5 border-b border-border bg-surface flex flex-col xl:flex-row gap-4 justify-between items-start xl:items-center">
        <div>
            <h2 className="text-xl font-bold text-text flex items-center gap-2">
                <Zap className="text-brand" size={24} />
                Signal Manager
            </h2>
            <p className="text-secondary text-sm mt-1">
                Manage, analyze, and audit all generated trading signals.
            </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
             {/* Search */}
             <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" size={14} />
                <input 
                    type="text" 
                    placeholder="Search Symbol..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-surface-secondary border border-transparent focus:border-primary rounded-lg pl-9 pr-4 py-2 text-sm text-text focus:outline-none transition-all"
                />
             </div>

             {/* Filters */}
             <select 
                value={sideFilter}
                onChange={(e) => setSideFilter(e.target.value as any)}
                className="bg-surface-secondary border border-transparent focus:border-primary rounded-lg px-3 py-2 text-sm font-medium text-text focus:outline-none cursor-pointer"
             >
                <option value="ALL">All Sides</option>
                <option value="LONG">Long / Buy</option>
                <option value="SHORT">Short / Sell</option>
             </select>

             <select 
                value={strategyFilter}
                onChange={(e) => setStrategyFilter(e.target.value)}
                className="bg-surface-secondary border border-transparent focus:border-primary rounded-lg px-3 py-2 text-sm font-medium text-text focus:outline-none cursor-pointer max-w-[150px]"
             >
                {uniqueStrategies.map(s => (
                    <option key={s} value={s}>{s === 'ALL' ? 'All Strategies' : s}</option>
                ))}
             </select>

             {/* Actions */}
             <div className="h-8 w-[1px] bg-border mx-1 hidden sm:block"></div>
             
             <button 
                onClick={exportCSV}
                className="p-2 text-secondary hover:text-text hover:bg-surface-secondary rounded-lg transition-colors"
                title="Export CSV"
             >
                <Download size={18} />
             </button>

             <button 
                onClick={onClearAll}
                className="flex items-center gap-2 px-3 py-2 bg-danger/10 hover:bg-danger/20 text-danger rounded-lg text-sm font-medium transition-colors"
             >
                <Trash2 size={16} />
                <span className="hidden sm:inline">Clear All</span>
             </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto bg-surface-secondary/10">
        <table className="min-w-full divide-y divide-border">
            <thead className="bg-surface sticky top-0 z-10 shadow-sm">
                <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-secondary uppercase tracking-wider">Time</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-secondary uppercase tracking-wider">Symbol</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-secondary uppercase tracking-wider">Side</th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-secondary uppercase tracking-wider">Price</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-secondary uppercase tracking-wider">Strategy</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-secondary uppercase tracking-wider hidden md:table-cell">Context</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-secondary uppercase tracking-wider">Action</th>
                </tr>
            </thead>
            <tbody className="bg-surface divide-y divide-border">
                {filteredSignals.length === 0 ? (
                    <tr>
                        <td colSpan={7} className="px-6 py-12 text-center text-secondary">
                            <div className="flex flex-col items-center justify-center gap-3">
                                <Filter size={32} className="opacity-20" />
                                <p>No signals found matching criteria.</p>
                            </div>
                        </td>
                    </tr>
                ) : (
                    filteredSignals.map((sig) => {
                        const isLong = sig.side === 'BUY' || sig.side === 'LONG';
                        const symbolBase = sig.symbol.replace('USDT', '');
                        const iconUrl = `https://assets.coincap.io/assets/icons/${symbolBase.toLowerCase()}@2x.png`;

                        return (
                            <tr key={sig.id} className="hover:bg-surface-secondary/50 transition-colors group">
                                <td className="px-6 py-4 whitespace-nowrap text-xs font-mono text-secondary">
                                    {formatTime(sig.time)}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center gap-3">
                                        <div className="relative w-6 h-6 rounded-full bg-surface-secondary flex items-center justify-center shrink-0 overflow-hidden">
                                            <img 
                                                src={iconUrl} 
                                                className="absolute inset-0 w-full h-full object-cover"
                                                onError={(e) => e.currentTarget.style.display = 'none'}
                                            />
                                        </div>
                                        <span className="font-bold text-sm text-text">{symbolBase}</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold ${
                                        isLong ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
                                    }`}>
                                        {isLong ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                                        {sig.side}
                                    </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-mono font-medium text-text">
                                    {sig.price.toLocaleString()}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="text-xs font-medium text-text bg-surface-secondary px-2 py-1 rounded w-fit border border-border">
                                        {sig.strategy}
                                    </div>
                                </td>
                                <td className="px-6 py-4 hidden md:table-cell">
                                    <div className="text-xs text-secondary max-w-[200px] truncate" title={sig.note}>
                                        {sig.note || '-'}
                                    </div>
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-right">
                                    <button 
                                        onClick={() => onDelete(sig.id)}
                                        className="text-secondary hover:text-danger p-2 hover:bg-danger/10 rounded-full transition-all opacity-0 group-hover:opacity-100"
                                        title="Delete Signal"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </td>
                            </tr>
                        );
                    })
                )}
            </tbody>
        </table>
      </div>
    </Card>
  );
};
