import React, { useMemo, useState } from 'react';
import { Ticker, PriceAlert } from '../types';
import { Card } from './ui/Card';
import { Plus, Trash2, Bell, Search, LineChart, ExternalLink, LayoutGrid, List } from 'lucide-react';

interface WatchlistProps {
  symbols: string[];
  data: Record<string, Ticker>;
  activeAlerts?: PriceAlert[];
  onRemove?: (symbol: string) => void;
  onAdd?: (symbol: string) => void;
  onSetAlert?: (symbol: string) => void;
}

type Tab = 'favorites' | 'all' | 'movers';
type ViewMode = 'list' | 'heatmap';
type SortField = 'symbol' | 'lastPrice' | 'priceChangePercent' | 'volume';

export const Watchlist: React.FC<WatchlistProps> = ({ symbols, data, activeAlerts = [], onRemove, onAdd, onSetAlert }) => {
  const [activeTab, setActiveTab] = useState<Tab>('favorites');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ field: SortField; dir: 'asc' | 'desc' }>({ field: 'priceChangePercent', dir: 'desc' });
  
  // Handlers
  const handleSort = (field: SortField) => {
      setSort(prev => ({
          field,
          dir: prev.field === field && prev.dir === 'desc' ? 'asc' : 'desc'
      }));
  };

  // Data Processing
  const displayData = useMemo(() => {
      let list: Ticker[] = [];

      // 1. Source Selection
      if (activeTab === 'favorites') {
          list = symbols.map(s => data[s] || { symbol: s, lastPrice: 0, priceChangePercent: 0, volume: 0, updatedAt: 0 } as Ticker);
      } else {
          // All or Movers (Movers is just sorted All)
          list = Object.values(data).filter(t => t.symbol.endsWith('USDT'));
      }

      // 2. Filter
      if (search) {
          list = list.filter(t => t.symbol.includes(search.toUpperCase()));
      }

      // 3. Sort
      return list.sort((a, b) => {
          let valA = a[sort.field];
          let valB = b[sort.field];
          
          if (activeTab === 'movers' && sort.field === 'priceChangePercent') {
               // Force movers default to magnitude sort if not overridden
               valA = Math.abs(a.priceChangePercent);
               valB = Math.abs(b.priceChangePercent);
          }

          if (valA > valB) return sort.dir === 'asc' ? 1 : -1;
          if (valA < valB) return sort.dir === 'asc' ? -1 : 1;
          return 0;
      });

  }, [symbols, data, activeTab, search, sort]);


  const hasAlert = (symbol: string) => activeAlerts.some(a => a.symbol === symbol && a.isActive);

  return (
    <Card className="h-full flex flex-col" title="Market Overview" noPadding>
      {/* Header Controls */}
      <div className="px-4 py-3 border-b border-border bg-surface shrink-0 flex flex-col gap-3">
        
        {/* Top Row: Search & View Toggle */}
        <div className="flex gap-2">
            <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary group-focus-within:text-primary transition-colors" size={14} />
                <input 
                    type="text" 
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search Pair"
                    className="w-full bg-surface-secondary hover:bg-surface-highlight focus:bg-surface-highlight border border-transparent focus:border-primary rounded-lg pl-9 pr-2 py-2 text-sm text-text placeholder:text-secondary/50 transition-all outline-none"
                />
            </div>
            <div className="flex bg-surface-secondary p-1 rounded-lg border border-transparent">
                <button 
                    onClick={() => setViewMode('list')}
                    className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-surface text-primary shadow-sm' : 'text-secondary hover:text-text'}`}
                    title="List View"
                >
                    <List size={16} />
                </button>
                <button 
                    onClick={() => setViewMode('heatmap')}
                    className={`p-1.5 rounded-md transition-all ${viewMode === 'heatmap' ? 'bg-surface text-primary shadow-sm' : 'text-secondary hover:text-text'}`}
                    title="Heatmap View"
                >
                    <LayoutGrid size={16} />
                </button>
            </div>
        </div>

        {/* Bottom Row: Tabs */}
        <div className="flex gap-4 text-xs font-bold uppercase tracking-wider overflow-x-auto scrollbar-hide">
           <button
             onClick={() => { setActiveTab('favorites'); setSort({field: 'symbol', dir: 'asc'}); }}
             className={`pb-2 border-b-2 transition-colors whitespace-nowrap ${activeTab === 'favorites' ? 'border-primary text-text' : 'border-transparent text-secondary hover:text-text'}`}
           >
             Favorites
           </button>
           <button
             onClick={() => { setActiveTab('all'); setSort({field: 'volume', dir: 'desc'}); }}
             className={`pb-2 border-b-2 transition-colors whitespace-nowrap ${activeTab === 'all' ? 'border-primary text-text' : 'border-transparent text-secondary hover:text-text'}`}
           >
             All Pairs
           </button>
           <button
             onClick={() => { setActiveTab('movers'); setSort({field: 'priceChangePercent', dir: 'desc'}); }}
             className={`pb-2 border-b-2 transition-colors whitespace-nowrap ${activeTab === 'movers' ? 'border-primary text-text' : 'border-transparent text-secondary hover:text-text'}`}
           >
             Top Movers
           </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto bg-surface-secondary/5 min-h-0 relative">
        
        {/* LIST VIEW */}
        {viewMode === 'list' && (
            <div className="min-w-full inline-block align-middle">
                <div className="sticky top-0 z-10 grid grid-cols-12 gap-2 px-4 py-2 bg-surface border-b border-border text-[10px] font-bold text-secondary uppercase tracking-wider">
                    <div className="col-span-5 cursor-pointer hover:text-primary" onClick={() => handleSort('symbol')}>Pair</div>
                    <div className="col-span-4 text-right cursor-pointer hover:text-primary" onClick={() => handleSort('lastPrice')}>Price</div>
                    <div className="col-span-3 text-right cursor-pointer hover:text-primary" onClick={() => handleSort('priceChangePercent')}>24h %</div>
                </div>
                <div className="divide-y divide-border/50">
                    {displayData.map((ticker: any) => {
                        const isPositive = ticker.priceChangePercent >= 0;
                        const symbolBase = ticker.symbol.replace('USDT', '');
                        const iconUrl = `https://assets.coincap.io/assets/icons/${symbolBase.toLowerCase()}@2x.png`;
                        const tvLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${ticker.symbol}`;
                        const binanceLink = `https://www.binance.com/en/trade/${symbolBase}_USDT`;
                        const hasActiveAlert = hasAlert(ticker.symbol);

                        return (
                            <div key={ticker.symbol} className="grid grid-cols-12 gap-2 px-4 py-2.5 hover:bg-surface-secondary/50 items-center group cursor-default transition-colors relative">
                                <div className="col-span-5 flex items-center gap-3">
                                    <div className="w-5 h-5 rounded-full bg-surface-secondary shrink-0 overflow-hidden">
                                        <img src={iconUrl} className="w-full h-full object-cover" onError={(e) => e.currentTarget.style.display = 'none'} />
                                    </div>
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-sm font-bold text-text leading-none">{symbolBase}</span>
                                            {hasActiveAlert && <Bell size={10} className="text-warning fill-warning" />}
                                        </div>
                                    </div>
                                </div>
                                <div className="col-span-4 text-right font-mono text-sm text-text">
                                    {ticker.lastPrice < 1 ? ticker.lastPrice.toFixed(4) : ticker.lastPrice.toLocaleString(undefined, {maximumFractionDigits: 2})}
                                </div>
                                <div className="col-span-3 text-right">
                                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${isPositive ? 'text-success bg-success/10' : 'text-danger bg-danger/10'}`}>
                                        {isPositive ? '+' : ''}{ticker.priceChangePercent?.toFixed(2)}%
                                    </span>
                                </div>

                                {/* Hover Actions */}
                                <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1 bg-surface shadow-sm border border-border rounded p-1 z-20 animate-in fade-in zoom-in-95 duration-100">
                                    <a href={tvLink} target="_blank" rel="noopener noreferrer" className="p-1.5 hover:bg-surface-secondary rounded text-secondary hover:text-text"><LineChart size={14}/></a>
                                    <a href={binanceLink} target="_blank" rel="noopener noreferrer" className="p-1.5 hover:bg-surface-secondary rounded text-secondary hover:text-warning"><ExternalLink size={14}/></a>
                                    <div className="w-[1px] h-3 bg-border mx-0.5" />
                                    <button onClick={() => onSetAlert?.(ticker.symbol)} className="p-1.5 hover:bg-surface-secondary rounded text-secondary hover:text-primary"><Bell size={14}/></button>
                                    {activeTab === 'favorites' && <button onClick={() => onRemove?.(ticker.symbol)} className="p-1.5 hover:bg-surface-secondary rounded text-secondary hover:text-danger"><Trash2 size={14}/></button>}
                                    {activeTab !== 'favorites' && <button onClick={() => onAdd?.(ticker.symbol)} className="p-1.5 hover:bg-surface-secondary rounded text-secondary hover:text-success"><Plus size={14}/></button>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        )}

        {/* HEATMAP VIEW */}
        {viewMode === 'heatmap' && (
            <div className="p-2 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                {displayData.map((ticker: any) => {
                    const pct = ticker.priceChangePercent;
                    const isPositive = pct >= 0;
                    const intensity = Math.min(Math.abs(pct) * 10, 100) / 100; // 0 to 1 opacity based on magnitude
                    
                    // Dynamic background based on % change intensity
                    const bgColor = isPositive 
                        ? `rgba(45, 189, 133, ${0.1 + (intensity * 0.9)})` // Green
                        : `rgba(246, 70, 93, ${0.1 + (intensity * 0.9)})`; // Red
                    
                    const textColor = intensity > 0.6 ? '#FFFFFF' : 'var(--color-text)'; // White text for dark blocks
                    const subTextColor = intensity > 0.6 ? 'rgba(255,255,255,0.8)' : 'var(--color-text-secondary)';

                    return (
                        <div 
                            key={ticker.symbol}
                            className="aspect-square rounded-lg flex flex-col items-center justify-center p-2 text-center transition-transform hover:scale-105 cursor-pointer relative group overflow-hidden border border-transparent hover:border-text/20"
                            style={{ backgroundColor: bgColor }}
                            onClick={() => window.open(`https://www.tradingview.com/chart/?symbol=BINANCE:${ticker.symbol}`, '_blank')}
                        >
                            <div className="font-bold text-xs truncate w-full" style={{ color: textColor }}>
                                {ticker.symbol.replace('USDT', '')}
                            </div>
                            <div className="font-mono text-[10px] mt-0.5" style={{ color: subTextColor }}>
                                {isPositive ? '+' : ''}{pct.toFixed(2)}%
                            </div>
                            {/* Hover Add/Remove */}
                            <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {activeTab === 'favorites' 
                                    ? <button onClick={(e) => {e.stopPropagation(); onRemove?.(ticker.symbol)}} className="bg-black/20 hover:bg-black/40 text-white rounded p-0.5"><Trash2 size={10}/></button> 
                                    : <button onClick={(e) => {e.stopPropagation(); onAdd?.(ticker.symbol)}} className="bg-black/20 hover:bg-black/40 text-white rounded p-0.5"><Plus size={10}/></button>
                                }
                            </div>
                        </div>
                    );
                })}
            </div>
        )}
      </div>
    </Card>
  );
};
