
import React, { useMemo, useState, useEffect } from 'react';
import { FuturesTicker } from '../types';
import { Search, ArrowUpDown, ArrowUp, ArrowDown, Filter, Zap, TrendingUp, TrendingDown, Clock, ChevronDown, ChevronUp, LineChart, ExternalLink, BarChart2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid, Cell } from 'recharts';

interface FundingRatesProps {
  data: Record<string, FuturesTicker>;
}

type SortKey = 'symbol' | 'markPrice' | 'fundingRate' | 'sessionChange';
type SortDirection = 'asc' | 'desc';
type QuickFilter = 'ALL' | 'HIGH_FUNDING' | 'NEGATIVE' | 'VOLATILE';
type Timeframe = '1m' | '5m' | '1h';

// --- Helper: Generate Mock History based on timeframe ---
const generateMockHistory = (currentRate: number, timeframe: Timeframe) => {
    const data = [];
    const now = Date.now();
    
    let count = 24;
    let intervalMs = 3600000; // 1h default

    if (timeframe === '1m') {
        count = 60; // Last 60 minutes
        intervalMs = 60000; 
    } else if (timeframe === '5m') {
        count = 48; // Last 4 hours approx
        intervalMs = 300000;
    } else {
        count = 24; // Last 24 hours
        intervalMs = 3600000;
    }

    // Generate points
    for (let i = count; i >= 0; i--) {
        const timeVal = new Date(now - i * intervalMs);
        
        // Format time label based on timeframe
        let timeLabel = '';
        if (timeframe === '1h') {
            timeLabel = timeVal.getHours().toString().padStart(2, '0') + ':00';
        } else {
            timeLabel = timeVal.getHours().toString().padStart(2, '0') + ':' + timeVal.getMinutes().toString().padStart(2, '0');
        }

        // Add pseudo-random noise
        // Volatility is higher on lower timeframes visually
        const noise = (Math.random() - 0.5) * (currentRate * 0.2); 
        const trend = Math.sin(i / (count / 4)) * (currentRate * 0.1);
        
        let rate = currentRate + noise + trend;
        if (i === 0) rate = currentRate; // Anchor to current

        // Ensure rate doesn't flip sign too aggressively unless near zero
        if (currentRate > 0.0002 && rate < 0) rate = 0.00005;

        data.push({
            time: timeLabel,
            rate: (rate * 100), // Convert to percentage for display
            displayRate: (rate * 100).toFixed(4),
            ts: timeVal.getTime()
        });
    }
    return data;
};

// --- Helper: Countdown Timer Component ---
const FundingCountdown: React.FC<{ targetTime: number }> = ({ targetTime }) => {
    const [timeLeft, setTimeLeft] = useState('');

    useEffect(() => {
        const update = () => {
            const now = Date.now();
            const diff = targetTime - now;
            if (diff <= 0) {
                setTimeLeft('00:00:00');
                return;
            }
            const h = Math.floor(diff / (1000 * 60 * 60));
            const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const s = Math.floor((diff % (1000 * 60)) / 1000);
            setTimeLeft(`${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`);
        };
        update();
        const interval = setInterval(update, 1000);
        return () => clearInterval(interval);
    }, [targetTime]);

    return <span className="font-mono font-bold tracking-widest">{timeLeft}</span>;
};

export const FundingRates: React.FC<FundingRatesProps> = ({ data }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection }>({
    key: 'fundingRate',
    direction: 'desc' 
  });
  const [activeFilter, setActiveFilter] = useState<QuickFilter>('ALL');
  
  // Expanded Row State
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [chartData, setChartData] = useState<any[]>([]);
  const [chartTimeframe, setChartTimeframe] = useState<Timeframe>('1h');
  const [selectedRateForChart, setSelectedRateForChart] = useState<number>(0);

  const handleSort = (key: SortKey) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  const toggleExpand = (symbol: string, currentRate: number) => {
      if (expandedSymbol === symbol) {
          setExpandedSymbol(null);
      } else {
          setExpandedSymbol(symbol);
          setSelectedRateForChart(currentRate);
          // Default to 1h when opening
          setChartTimeframe('1h');
          setChartData(generateMockHistory(currentRate, '1h'));
      }
  };

  const changeTimeframe = (tf: Timeframe) => {
      setChartTimeframe(tf);
      if (selectedRateForChart) {
          setChartData(generateMockHistory(selectedRateForChart, tf));
      }
  };

  const filteredAndSortedList = useMemo(() => {
    let list = Object.values(data) as FuturesTicker[];

    if (searchTerm) {
        list = list.filter(t => t.symbol.toLowerCase().includes(searchTerm.toLowerCase()));
    }

    if (activeFilter === 'HIGH_FUNDING') {
        list = list.filter(t => t.fundingRate >= 0.0001); 
    } else if (activeFilter === 'NEGATIVE') {
        list = list.filter(t => t.fundingRate < 0);
    } else if (activeFilter === 'VOLATILE') {
        list = list.filter(t => Math.abs(t.sessionChange || 0) > 0.02); 
    }

    return list.sort((a, b) => {
      const aValue = a[sortConfig.key] || 0;
      const bValue = b[sortConfig.key] || 0;
      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data, searchTerm, sortConfig, activeFilter]);

  const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
    if (sortConfig.key !== columnKey) return <ArrowUpDown size={12} className="opacity-30 ml-1" />;
    return sortConfig.direction === 'asc' 
      ? <ArrowUp size={12} className="text-primary ml-1" /> 
      : <ArrowDown size={12} className="text-primary ml-1" />;
  };

  const FilterChip = ({ id, label, icon: Icon }: { id: QuickFilter, label: string, icon?: any }) => (
    <button
        onClick={() => setActiveFilter(id)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
            activeFilter === id 
            ? 'bg-primary/10 text-primary border-primary/20 shadow-sm' 
            : 'bg-surface-secondary text-secondary border-transparent hover:text-text hover:bg-surface-highlight'
        }`}
    >
        {Icon && <Icon size={12} />}
        {label}
    </button>
  );

  return (
    <div className="flex flex-col h-full bg-surface">
       {/* Controls Area */}
       <div className="flex flex-col gap-3 px-5 py-4 border-b border-border">
            <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" size={14} />
                <input 
                    type="text" 
                    placeholder="Search Symbol (e.g. BTC, ETH)" 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-surface-secondary border border-transparent focus:border-primary rounded-lg pl-9 pr-4 py-2.5 text-sm text-text focus:outline-none transition-all shadow-inner"
                />
            </div>
            <div className="flex flex-wrap gap-2">
                <FilterChip id="ALL" label="All Contracts" icon={Filter} />
                <FilterChip id="HIGH_FUNDING" label="High Funding" icon={TrendingUp} />
                <FilterChip id="NEGATIVE" label="Negative (Squeeze)" icon={Zap} />
                <FilterChip id="VOLATILE" label="Volatile" icon={TrendingDown} />
            </div>
       </div>

       {/* Table Header */}
       <div className="grid grid-cols-12 gap-2 px-5 py-3 border-b border-border bg-surface-secondary/30 text-xs font-semibold text-secondary uppercase tracking-wider sticky top-0 z-10 backdrop-blur-md">
            <div className="col-span-4 flex items-center cursor-pointer hover:text-text select-none" onClick={() => handleSort('symbol')}>
                Symbol <SortIcon columnKey="symbol" />
            </div>
            <div className="col-span-3 text-right flex items-center justify-end cursor-pointer hover:text-text select-none" onClick={() => handleSort('markPrice')}>
                Price <SortIcon columnKey="markPrice" />
            </div>
            <div className="col-span-3 text-right flex items-center justify-end cursor-pointer hover:text-text select-none" onClick={() => handleSort('fundingRate')}>
                Funding / 8h <SortIcon columnKey="fundingRate" />
            </div>
            <div className="col-span-2 text-right flex items-center justify-end cursor-pointer hover:text-text select-none" onClick={() => handleSort('sessionChange')}>
                Change <SortIcon columnKey="sessionChange" />
            </div>
       </div>

       {/* Table Body */}
       <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <div className="divide-y divide-border">
                {filteredAndSortedList.map(ticker => {
                    const isExpanded = expandedSymbol === ticker.symbol;
                    const ratePct = ticker.fundingRate * 100;
                    const changePct = (ticker.sessionChange || 0) * 100;
                    const symbolBase = ticker.symbol.replace('USDT', '');
                    const iconUrl = `https://assets.coincap.io/assets/icons/${symbolBase.toLowerCase()}@2x.png`;
                    
                    const intensity = Math.min(Math.abs(ratePct) * 1000, 100);
                    const barColor = ratePct > 0 ? 'bg-warning' : 'bg-success';
                    
                    const tvLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${ticker.symbol}.P`;
                    const binanceLink = `https://www.binance.com/en/futures/${ticker.symbol}`;

                    return (
                        <React.Fragment key={ticker.symbol}>
                            {/* Main Row */}
                            <div 
                                onClick={() => toggleExpand(ticker.symbol, ticker.fundingRate)}
                                className={`grid grid-cols-12 gap-2 px-5 py-3 transition-colors group items-center relative cursor-pointer ${
                                    isExpanded ? 'bg-surface-highlight' : 'hover:bg-surface-secondary'
                                }`}
                            >
                                <div className="col-span-4 flex items-center gap-3">
                                    <div className="relative w-6 h-6 rounded-full bg-surface-secondary flex items-center justify-center shrink-0 overflow-hidden shadow-sm">
                                        <img src={iconUrl} className="absolute inset-0 w-full h-full object-cover" onError={(e) => e.currentTarget.style.display = 'none'} />
                                    </div>
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-1">
                                            <span className="text-sm font-bold text-text leading-none">{symbolBase}</span>
                                            {isExpanded ? <ChevronUp size={12} className="text-secondary"/> : <ChevronDown size={12} className="text-secondary opacity-0 group-hover:opacity-100"/>}
                                        </div>
                                        <span className="text-[10px] text-secondary mt-1">Perpetual</span>
                                    </div>
                                </div>

                                <div className="col-span-3 text-right font-mono text-sm text-text font-medium">
                                    {ticker.markPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>

                                <div className="col-span-3 text-right relative flex flex-col items-end justify-center">
                                    <span className={`text-sm font-bold tabular-nums ${ratePct > 0.01 ? 'text-warning' : (ratePct < 0 ? 'text-success' : 'text-text')}`}>
                                        {ratePct.toFixed(4)}%
                                    </span>
                                    <div className="h-0.5 w-16 bg-surface-highlight rounded-full mt-1 overflow-hidden flex justify-end">
                                        <div className={`h-full ${barColor} transition-all duration-500`} style={{ width: `${intensity}%`, opacity: intensity > 0 ? 1 : 0 }} />
                                    </div>
                                </div>

                                <div className="col-span-2 text-right">
                                    <div className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold tabular-nums ${
                                        changePct > 0 ? 'text-success bg-success/10' : (changePct < 0 ? 'text-danger bg-danger/10' : 'text-secondary bg-surface-highlight')
                                    }`}>
                                        {changePct > 0 ? '+' : ''}{changePct.toFixed(2)}%
                                    </div>
                                </div>

                                {/* Hover Actions */}
                                <div className="hidden group-hover:flex absolute right-4 top-1/2 -translate-y-1/2 items-center gap-1 bg-surface shadow-sm rounded border border-border px-1 py-0.5 z-20 animate-enter">
                                    <a 
                                        href={tvLink} target="_blank" rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="p-1.5 hover:text-primary text-secondary transition-colors" title="TradingView Perp"
                                    >
                                        <LineChart size={14} />
                                    </a>
                                    <a 
                                        href={binanceLink} target="_blank" rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="p-1.5 hover:text-warning text-secondary transition-colors" title="Binance Futures"
                                    >
                                        <ExternalLink size={14} />
                                    </a>
                                </div>
                            </div>

                            {/* Expanded Details Row */}
                            {isExpanded && (
                                <div className="col-span-12 bg-surface-secondary/30 border-b border-border border-l-4 border-l-primary/50 p-4 animate-enter">
                                    <div className="flex flex-col lg:flex-row gap-6">
                                        
                                        {/* Left: Info Card */}
                                        <div className="lg:w-1/3 flex flex-col gap-4">
                                            <div className="bg-surface rounded-xl p-4 border border-border shadow-sm">
                                                <div className="flex items-center gap-2 text-secondary text-xs uppercase tracking-wider font-semibold mb-2">
                                                    <Clock size={14} /> Next Funding In
                                                </div>
                                                <div className="text-2xl font-mono text-text">
                                                    <FundingCountdown targetTime={ticker.nextFundingTime} />
                                                </div>
                                                <div className="text-xs text-secondary mt-1">
                                                    Settlement: {new Date(ticker.nextFundingTime).toLocaleTimeString()}
                                                </div>
                                            </div>

                                            <div className="flex gap-2">
                                                <a 
                                                    href={tvLink} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer"
                                                    className="flex-1 bg-surface hover:bg-surface-highlight border border-border rounded-lg p-2 flex items-center justify-center gap-2 text-sm font-medium text-text transition-colors"
                                                >
                                                    <LineChart size={16} /> TradingView
                                                </a>
                                                <a 
                                                    href={binanceLink} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer"
                                                    className="flex-1 bg-surface hover:bg-surface-highlight border border-border rounded-lg p-2 flex items-center justify-center gap-2 text-sm font-medium text-text transition-colors"
                                                >
                                                    <ExternalLink size={16} /> Binance
                                                </a>
                                            </div>
                                        </div>

                                        {/* Right: History Chart */}
                                        <div className="lg:w-2/3 h-[250px] bg-surface rounded-xl border border-border p-4 relative flex flex-col">
                                            
                                            {/* Chart Header */}
                                            <div className="flex justify-between items-center mb-4 z-10">
                                                <div className="text-xs font-semibold text-secondary flex items-center gap-2">
                                                    <BarChart2 size={14} /> Funding History
                                                </div>
                                                <div className="flex bg-surface-secondary rounded p-0.5 border border-border">
                                                    {(['1m', '5m', '1h'] as Timeframe[]).map(tf => (
                                                        <button
                                                            key={tf}
                                                            onClick={() => changeTimeframe(tf)}
                                                            className={`px-3 py-1 text-[10px] font-bold rounded transition-colors ${
                                                                chartTimeframe === tf 
                                                                ? 'bg-surface text-primary shadow-sm' 
                                                                : 'text-secondary hover:text-text'
                                                            }`}
                                                        >
                                                            {tf.toUpperCase()}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Bar Chart */}
                                            <div className="flex-1 w-full min-h-0 overflow-hidden">
                                                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                                                    <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" opacity={0.3} />
                                                        <XAxis 
                                                            dataKey="time" 
                                                            tick={{fontSize: 9, fill: 'var(--color-text-secondary)'}} 
                                                            axisLine={false}
                                                            tickLine={false}
                                                            minTickGap={15}
                                                        />
                                                        <YAxis 
                                                            orientation="right"
                                                            tick={{fontSize: 9, fill: 'var(--color-text-secondary)'}} 
                                                            axisLine={false}
                                                            tickLine={false}
                                                            tickFormatter={(val) => `${val.toFixed(4)}%`}
                                                            width={50}
                                                        />
                                                        <Tooltip 
                                                            cursor={{fill: 'var(--bg-surface-secondary)', opacity: 0.4}}
                                                            contentStyle={{
                                                                backgroundColor: 'var(--bg-surface-highlight)',
                                                                borderColor: 'var(--color-border)',
                                                                borderRadius: '8px',
                                                                fontSize: '11px',
                                                                padding: '6px 10px'
                                                            }}
                                                            itemStyle={{ color: 'var(--color-text)' }}
                                                            formatter={(val: number) => [`${val.toFixed(4)}%`, 'Rate']}
                                                        />
                                                        <ReferenceLine y={0} stroke="var(--color-text-secondary)" opacity={0.5} />
                                                        <Bar dataKey="rate" radius={[2, 2, 0, 0]}>
                                                            {chartData.map((entry, index) => (
                                                                <Cell 
                                                                    key={`cell-${index}`} 
                                                                    fill={entry.rate >= 0 ? 'var(--color-warning)' : 'var(--color-success)'} 
                                                                    fillOpacity={0.8}
                                                                />
                                                            ))}
                                                        </Bar>
                                                    </BarChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </React.Fragment>
                    );
                })}
            </div>
       </div>
    </div>
  );
};
