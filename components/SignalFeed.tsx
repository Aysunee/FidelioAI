
import React, { useState, useMemo } from 'react';
import { Signal, Ticker } from '../types';
import { Card } from './ui/Card';
import { Search, Filter, ChevronDown, ChevronUp, Zap, Activity, ExternalLink, LineChart, CheckCircle2 } from 'lucide-react';

interface SignalFeedProps {
  signals: Signal[];
  marketData: Record<string, Ticker>;
}

type Tab = 'ALL' | 'SPOT' | 'FUTURES' | 'HIGH_CONF' | 'WORKING';

export const SignalFeed: React.FC<SignalFeedProps> = ({ signals, marketData }) => {
  const [activeTab, setActiveTab] = useState<Tab>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Helper to calculate PnL based on current market price
  const getPnL = (sig: Signal) => {
      const ticker = marketData[sig.symbol];
      if (!ticker) return 0;
      
      const currentPrice = ticker.lastPrice;
      const entryPrice = sig.price;
      const rawChange = ((currentPrice - entryPrice) / entryPrice) * 100;
      
      // If LONG/BUY, PnL is rawChange. If SHORT/SELL, PnL is inverted.
      return (sig.side === 'BUY' || sig.side === 'LONG') ? rawChange : -rawChange;
  };

  const workingSignalsCount = useMemo(() => {
      return signals.filter(s => getPnL(s) >= 2.0).length;
  }, [signals, marketData]);

  const filteredSignals = useMemo(() => {
    return signals.filter(sig => {
      // 1. Search Filter
      const searchMatch = sig.symbol.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          sig.strategy.toLowerCase().includes(searchTerm.toLowerCase());
      if (!searchMatch) return false;

      // 2. Tab Filter
      if (activeTab === 'ALL') return true;
      
      const isFutures = sig.strategy === 'SmartMoney_Divergence' || 
                        sig.strategy.includes('Funding') || 
                        sig.source === 'ALGO';

      if (activeTab === 'FUTURES') return isFutures;
      if (activeTab === 'SPOT') return !isFutures;
      if (activeTab === 'HIGH_CONF') return (sig.confidence || 0) >= 0.8;
      
      if (activeTab === 'WORKING') {
          return getPnL(sig) >= 2.0;
      }
      
      return true;
    });
  }, [signals, searchTerm, activeTab, marketData]);

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  const formatTime = (isoStr: string) => {
    return new Date(isoStr).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const getConfidenceColor = (conf: number) => {
    if (conf >= 0.9) return 'bg-purple-500';
    if (conf >= 0.7) return 'bg-success';
    if (conf >= 0.5) return 'bg-warning';
    return 'bg-secondary';
  };

  return (
    <Card className="h-full flex flex-col" noPadding>
        {/* Header Section */}
        <div className="flex flex-col border-b border-border bg-surface shrink-0 z-20">
            {/* Title & Search */}
            <div className="px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <Zap className="text-brand" size={18} fill="currentColor" />
                        <h3 className="font-bold text-text text-sm">Signal Intel</h3>
                        <span className="text-[10px] bg-surface-highlight text-secondary px-1.5 py-0.5 rounded-full font-mono">
                            {signals.length}
                        </span>
                    </div>

                    {/* Working Signals Counter Badge */}
                    <div className="flex items-center gap-1.5 bg-success/10 border border-success/20 px-2 py-1 rounded-md">
                        <CheckCircle2 size={12} className="text-success" />
                        <span className="text-[10px] font-bold text-success uppercase tracking-wide">
                            Success: {workingSignalsCount}
                        </span>
                    </div>
                </div>

                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-secondary" size={12} />
                    <input 
                        type="text" 
                        placeholder="Search..." 
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="bg-surface-secondary border border-transparent focus:border-brand/50 rounded-full pl-8 pr-3 py-1 text-xs text-text outline-none transition-all w-32 focus:w-48"
                    />
                </div>
            </div>

            {/* Tabs */}
            <div className="flex px-4 gap-4 overflow-x-auto scrollbar-hide">
                {(['ALL', 'SPOT', 'FUTURES', 'HIGH_CONF', 'WORKING'] as Tab[]).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`text-xs font-bold py-2 border-b-2 transition-colors whitespace-nowrap flex items-center gap-1 ${
                            activeTab === tab 
                            ? 'border-brand text-text' 
                            : 'border-transparent text-secondary hover:text-text'
                        }`}
                    >
                        {tab === 'HIGH_CONF' ? 'HIGH CONFIDENCE' : (tab === 'WORKING' ? 'WINNING (>2%)' : tab)}
                        {tab === 'WORKING' && activeTab !== 'WORKING' && workingSignalsCount > 0 && (
                             <div className="w-1.5 h-1.5 rounded-full bg-success"></div>
                        )}
                    </button>
                ))}
            </div>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-surface-secondary/50 border-b border-border text-[10px] font-bold text-secondary uppercase tracking-wider shrink-0 sticky top-0 z-10">
            <div className="col-span-2">Time</div>
            <div className="col-span-3">Pair</div>
            <div className="col-span-2">Side</div>
            <div className="col-span-3">Strategy</div>
            <div className="col-span-2 text-right">ROI / Str</div>
        </div>

        {/* Signal List */}
        <div className="flex-1 overflow-y-auto bg-surface relative">
            {filteredSignals.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-secondary gap-3 opacity-60">
                    <Filter size={32} />
                    <p className="text-xs">No signals found for this filter.</p>
                </div>
            ) : (
                <div className="divide-y divide-border">
                    {filteredSignals.map(sig => {
                        const isExpanded = expandedId === sig.id;
                        const isBuy = sig.side === 'BUY' || sig.side === 'LONG';
                        const symbolBase = sig.symbol.replace('USDT', '');
                        const iconUrl = `https://assets.coincap.io/assets/icons/${symbolBase.toLowerCase()}@2x.png`;
                        const confidence = sig.confidence || 0.5;
                        const pnl = getPnL(sig);
                        
                        // Links
                        const isFutures = sig.strategy.includes('Funding') || sig.strategy.includes('Divergence');
                        const tvLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${sig.symbol}${isFutures ? '.P' : ''}`;
                        const binanceLink = isFutures 
                            ? `https://www.binance.com/en/futures/${sig.symbol}`
                            : `https://www.binance.com/en/trade/${symbolBase}_USDT`;

                        return (
                            <React.Fragment key={sig.id}>
                                <div 
                                    onClick={() => toggleExpand(sig.id)}
                                    className={`grid grid-cols-12 gap-2 px-4 py-3 cursor-pointer transition-colors hover:bg-surface-secondary/40 items-center group ${
                                        isExpanded ? 'bg-surface-secondary/20' : ''
                                    }`}
                                >
                                    {/* Time */}
                                    <div className="col-span-2 text-[11px] font-mono text-secondary">
                                        {formatTime(sig.time)}
                                    </div>

                                    {/* Pair */}
                                    <div className="col-span-3 flex items-center gap-2">
                                        <div className="w-5 h-5 rounded-full bg-surface-secondary p-0.5 shrink-0 overflow-hidden">
                                            <img src={iconUrl} className="w-full h-full object-cover" onError={(e) => e.currentTarget.style.display = 'none'} />
                                        </div>
                                        <span className="text-xs font-bold text-text">{symbolBase}</span>
                                    </div>

                                    {/* Side */}
                                    <div className="col-span-2">
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                                            isBuy ? 'text-success bg-success/10' : 'text-danger bg-danger/10'
                                        }`}>
                                            {sig.side}
                                        </span>
                                    </div>

                                    {/* Strategy */}
                                    <div className="col-span-3">
                                        <div className="text-[10px] font-medium text-text truncate bg-surface-secondary px-1.5 py-0.5 rounded border border-border w-fit max-w-full">
                                            {sig.strategy}
                                        </div>
                                    </div>

                                    {/* Strength / PnL */}
                                    <div className="col-span-2 flex items-center justify-end gap-2">
                                        {pnl >= 2.0 ? (
                                            <span className="text-[10px] font-bold text-success bg-success/10 px-1.5 py-0.5 rounded">
                                                +{pnl.toFixed(2)}%
                                            </span>
                                        ) : (
                                            <>
                                                {isExpanded ? <ChevronUp size={12} className="text-secondary" /> : <ChevronDown size={12} className="text-secondary opacity-50 group-hover:opacity-100" />}
                                                <div className="w-8 h-1.5 bg-surface-secondary rounded-full overflow-hidden flex">
                                                    <div 
                                                        className={`h-full ${getConfidenceColor(confidence)}`} 
                                                        style={{ width: `${confidence * 100}%` }}
                                                    />
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Expanded Details */}
                                {isExpanded && (
                                    <div className="col-span-12 px-4 py-3 bg-surface-highlight/30 border-b border-border/50 flex flex-col gap-3 animate-enter">
                                        <div className="flex items-start gap-3">
                                            <div className="bg-surface-secondary p-1.5 rounded-lg text-primary shrink-0">
                                                <Activity size={16} />
                                            </div>
                                            <div className="flex-1">
                                                <h4 className="text-xs font-bold text-text mb-1">Analysis Note</h4>
                                                <p className="text-xs text-secondary leading-relaxed">
                                                    {sig.note || 'No specific algorithmic notes provided for this signal.'}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between pt-2 border-t border-border/50">
                                            <div className="flex items-center gap-4 text-[10px] text-secondary">
                                                <span className="flex items-center gap-1">
                                                    Entry: <span className="font-mono text-text">${sig.price}</span>
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    Current: <span className={`font-mono font-bold ${pnl > 0 ? 'text-success' : 'text-danger'}`}>
                                                        ${marketData[sig.symbol]?.lastPrice || '---'}
                                                    </span>
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    PnL: <span className={`font-mono font-bold ${pnl > 0 ? 'text-success' : 'text-danger'}`}>
                                                        {pnl > 0 ? '+' : ''}{pnl.toFixed(2)}%
                                                    </span>
                                                </span>
                                            </div>
                                            
                                            <div className="flex items-center gap-2">
                                                <a 
                                                    href={tvLink} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface hover:bg-surface-highlight border border-border text-[10px] font-bold text-secondary hover:text-text transition-colors"
                                                >
                                                    <LineChart size={12} /> TradingView
                                                </a>
                                                <a 
                                                    href={binanceLink} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface hover:bg-surface-highlight border border-border text-[10px] font-bold text-secondary hover:text-warning transition-colors"
                                                >
                                                    <ExternalLink size={12} /> Binance
                                                </a>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </React.Fragment>
                        );
                    })}
                </div>
            )}
        </div>
    </Card>
  );
};
