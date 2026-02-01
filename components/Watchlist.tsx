import React, { useMemo, useState } from 'react';
import { Ticker, PriceAlert } from '../types';
import { Plus, Trash2, Bell, Search, LineChart, ExternalLink, LayoutGrid, List, TrendingUp, TrendingDown, Star } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUser } from '../context/UserContext';

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
    const { theme } = useUser();
    const [activeTab, setActiveTab] = useState<Tab>('favorites');
    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<{ field: SortField; dir: 'asc' | 'desc' }>({ field: 'priceChangePercent', dir: 'desc' });

    const isLight = theme === 'corporate' || theme === 'labs';

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

        if (activeTab === 'favorites') {
            list = symbols.map(s => data[s] || { symbol: s, lastPrice: 0, priceChangePercent: 0, volume: 0, updatedAt: 0 } as Ticker);
        } else {
            list = Object.values(data).filter(t => t.symbol.endsWith('USDT'));
        }

        if (search) {
            list = list.filter(t => t.symbol.includes(search.toUpperCase()));
        }

        return list.sort((a, b) => {
            let valA = a[sort.field];
            let valB = b[sort.field];

            if (activeTab === 'movers' && sort.field === 'priceChangePercent') {
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
        <div className={`h-full flex flex-col rounded-3xl overflow-hidden ${isLight
                ? 'bg-white border border-gray-200 shadow-sm'
                : 'bg-white/[0.02] border border-white/10 backdrop-blur-xl'
            }`}>
            {/* Header */}
            <div className={`px-6 py-4 border-b ${isLight ? 'border-gray-200 bg-gray-50/50' : 'border-white/10 bg-white/[0.02]'}`}>
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-xl ${isLight ? 'bg-violet-100' : 'bg-gradient-to-br from-purple-500/20 to-violet-500/20'}`}>
                            <TrendingUp size={20} className={isLight ? 'text-violet-600' : 'text-purple-400'} />
                        </div>
                        <div>
                            <h3 className={`text-lg font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>Market Overview</h3>
                            <p className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-500'}`}>{displayData.length} pairs</p>
                        </div>
                    </div>

                    {/* View Toggle */}
                    <div className={`flex gap-1 p-1 rounded-xl ${isLight ? 'bg-gray-100' : 'bg-white/5'}`}>
                        <button
                            onClick={() => setViewMode('list')}
                            aria-label="List view"
                            className={`p-2 rounded-lg transition-all ${viewMode === 'list'
                                    ? isLight ? 'bg-white text-violet-600 shadow-sm' : 'bg-white/10 text-purple-400'
                                    : isLight ? 'text-gray-500 hover:text-gray-700' : 'text-gray-500 hover:text-gray-300'
                                }`}
                        >
                            <List size={16} />
                        </button>
                        <button
                            onClick={() => setViewMode('heatmap')}
                            aria-label="Heatmap view"
                            className={`p-2 rounded-lg transition-all ${viewMode === 'heatmap'
                                    ? isLight ? 'bg-white text-violet-600 shadow-sm' : 'bg-white/10 text-purple-400'
                                    : isLight ? 'text-gray-500 hover:text-gray-700' : 'text-gray-500 hover:text-gray-300'
                                }`}
                        >
                            <LayoutGrid size={16} />
                        </button>
                    </div>
                </div>

                {/* Search */}
                <div className="relative mb-4">
                    <Search className={`absolute left-3 top-1/2 -translate-y-1/2 ${isLight ? 'text-gray-400' : 'text-gray-600'}`} size={16} />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search pairs..."
                        aria-label="Search market pairs"
                        className={`w-full ${isLight
                                ? 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-violet-500 focus:ring-violet-500/20'
                                : 'bg-black/40 border-white/10 text-white placeholder:text-gray-600 focus:border-purple-500/50 focus:ring-purple-500/20'
                            } border rounded-xl pl-10 pr-4 py-3 text-sm outline-none focus:ring-2 transition-all`}
                    />
                </div>

                {/* Tabs */}
                <div className="flex gap-2">
                    {[
                        { key: 'favorites' as Tab, label: 'Favorites', icon: Star },
                        { key: 'all' as Tab, label: 'All Pairs', icon: LayoutGrid },
                        { key: 'movers' as Tab, label: 'Top Movers', icon: TrendingUp }
                    ].map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => {
                                setActiveTab(tab.key);
                                setSort({ field: tab.key === 'movers' ? 'priceChangePercent' : 'symbol', dir: 'desc' });
                            }}
                            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === tab.key
                                    ? isLight
                                        ? 'bg-violet-100 text-violet-700'
                                        : 'bg-gradient-to-r from-purple-500/20 to-violet-500/20 text-purple-300 border border-purple-500/30'
                                    : isLight
                                        ? 'text-gray-600 hover:bg-gray-100'
                                        : 'text-gray-500 hover:bg-white/5'
                                }`}
                        >
                            <tab.icon size={14} />
                            <span className="hidden sm:inline">{tab.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto">
                <AnimatePresence mode="wait">
                    {viewMode === 'list' ? (
                        <motion.div
                            key="list"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                        >
                            {/* Table Header */}
                            <div className={`sticky top-0 z-10 grid grid-cols-12 gap-3 px-6 py-3 ${isLight ? 'bg-gray-50 border-b border-gray-200' : 'bg-white/[0.02] border-b border-white/10'
                                } text-xs font-bold ${isLight ? 'text-gray-600' : 'text-gray-500'} uppercase tracking-wider`}>
                                <div className="col-span-5 cursor-pointer hover:text-purple-400 transition-colors" onClick={() => handleSort('symbol')}>
                                    Pair
                                </div>
                                <div className="col-span-4 text-right cursor-pointer hover:text-purple-400 transition-colors" onClick={() => handleSort('lastPrice')}>
                                    Price
                                </div>
                                <div className="col-span-3 text-right cursor-pointer hover:text-purple-400 transition-colors" onClick={() => handleSort('priceChangePercent')}>
                                    24h %
                                </div>
                            </div>

                            {/* Table Body */}
                            <div>
                                {displayData.map((ticker, idx) => {
                                    const isPositive = ticker.priceChangePercent >= 0;
                                    const symbolBase = ticker.symbol.replace('USDT', '');
                                    const iconUrl = `https://assets.coincap.io/assets/icons/${symbolBase.toLowerCase()}@2x.png`;
                                    const tvLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${ticker.symbol}`;
                                    const binanceLink = `https://www.binance.com/en/trade/${symbolBase}_USDT`;
                                    const hasActiveAlert = hasAlert(ticker.symbol);

                                    return (
                                        <motion.div
                                            key={ticker.symbol}
                                            initial={{ opacity: 0, y: 20 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: idx * 0.02, duration: 0.3 }}
                                            className={`grid grid-cols-12 gap-3 px-6 py-4 items-center group cursor-pointer transition-all ${isLight
                                                    ? 'hover:bg-gray-50 border-b border-gray-100'
                                                    : 'hover:bg-white/[0.02] border-b border-white/5'
                                                }`}
                                        >
                                            {/* Pair */}
                                            <div className="col-span-5 flex items-center gap-3">
                                                <div className={`w-8 h-8 rounded-full overflow-hidden ${isLight ? 'bg-gray-100' : 'bg-white/5'}`}>
                                                    <img src={iconUrl} className="w-full h-full object-cover" onError={(e) => e.currentTarget.style.display = 'none'} alt={symbolBase} />
                                                </div>
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-sm font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>{symbolBase}</span>
                                                        {hasActiveAlert && <Bell size={12} className="text-amber-500 fill-amber-500" />}
                                                    </div>
                                                    <span className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-600'}`}>USDT</span>
                                                </div>
                                            </div>

                                            {/* Price */}
                                            <div className={`col-span-4 text-right font-mono text-sm ${isLight ? 'text-gray-900' : 'text-white'}`}>
                                                ${ticker.lastPrice < 1 ? ticker.lastPrice.toFixed(4) : ticker.lastPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                            </div>

                                            {/* 24h % */}
                                            <div className="col-span-3 text-right">
                                                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold ${isPositive
                                                        ? isLight ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-500/10 text-emerald-400'
                                                        : isLight ? 'bg-red-100 text-red-700' : 'bg-red-500/10 text-red-400'
                                                    }`}>
                                                    {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                                    {isPositive ? '+' : ''}{ticker.priceChangePercent?.toFixed(2)}%
                                                </span>
                                            </div>

                                            {/* Hover Actions */}
                                            <div className={`absolute right-4 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1 ${isLight ? 'bg-white shadow-lg border border-gray-200' : 'bg-black/80 backdrop-blur-xl border border-white/10'
                                                } rounded-xl p-1.5`}>
                                                <a
                                                    href={tvLink}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    aria-label={`View ${symbolBase} on TradingView`}
                                                    className={`p-2 rounded-lg transition-colors ${isLight ? 'hover:bg-gray-100 text-gray-600 hover:text-gray-900' : 'hover:bg-white/10 text-gray-400 hover:text-white'
                                                        }`}
                                                >
                                                    <LineChart size={14} />
                                                </a>
                                                <a
                                                    href={binanceLink}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    aria-label={`Trade ${symbolBase} on Binance`}
                                                    className={`p-2 rounded-lg transition-colors ${isLight ? 'hover:bg-gray-100 text-gray-600 hover:text-amber-600' : 'hover:bg-white/10 text-gray-400 hover:text-amber-400'
                                                        }`}
                                                >
                                                    <ExternalLink size={14} />
                                                </a>
                                                <div className={`w-px h-4 ${isLight ? 'bg-gray-200' : 'bg-white/10'}`} />
                                                <button
                                                    onClick={() => onSetAlert?.(ticker.symbol)}
                                                    aria-label={`Set price alert for ${symbolBase}`}
                                                    className={`p-2 rounded-lg transition-colors ${isLight ? 'hover:bg-gray-100 text-gray-600 hover:text-violet-600' : 'hover:bg-white/10 text-gray-400 hover:text-purple-400'
                                                        }`}
                                                >
                                                    <Bell size={14} />
                                                </button>
                                                {activeTab === 'favorites' ? (
                                                    <button
                                                        onClick={() => onRemove?.(ticker.symbol)}
                                                        aria-label={`Remove ${symbolBase} from favorites`}
                                                        className={`p-2 rounded-lg transition-colors ${isLight ? 'hover:bg-red-50 text-gray-600 hover:text-red-600' : 'hover:bg-red-500/10 text-gray-400 hover:text-red-400'
                                                            }`}
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => onAdd?.(ticker.symbol)}
                                                        aria-label={`Add ${symbolBase} to favorites`}
                                                        className={`p-2 rounded-lg transition-colors ${isLight ? 'hover:bg-emerald-50 text-gray-600 hover:text-emerald-600' : 'hover:bg-emerald-500/10 text-gray-400 hover:text-emerald-400'
                                                            }`}
                                                    >
                                                        <Plus size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        </motion.div>
                                    );
                                })}
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="heatmap"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="p-4 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3"
                        >
                            {displayData.map((ticker, idx) => {
                                const pct = ticker.priceChangePercent;
                                const isPositive = pct >= 0;
                                const intensity = Math.min(Math.abs(pct) * 10, 100) / 100;

                                const bgColor = isPositive
                                    ? `rgba(16, 185, 129, ${0.1 + (intensity * 0.4)})`
                                    : `rgba(239, 68, 68, ${0.1 + (intensity * 0.4)})`;

                                return (
                                    <motion.div
                                        key={ticker.symbol}
                                        initial={{ opacity: 0, scale: 0.9 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        transition={{ delay: idx * 0.01, duration: 0.2 }}
                                        className={`aspect-square rounded-2xl flex flex-col items-center justify-center p-3 text-center transition-all hover:scale-105 cursor-pointer border ${isLight ? 'border-gray-200 hover:border-violet-300' : 'border-white/10 hover:border-purple-500/30'
                                            }`}
                                        style={{ backgroundColor: bgColor }}
                                        onClick={() => window.open(`https://www.tradingview.com/chart/?symbol=BINANCE:${ticker.symbol}`, '_blank')}
                                    >
                                        <div className={`font-bold text-sm mb-1 ${isLight ? 'text-gray-900' : 'text-white'}`}>
                                            {ticker.symbol.replace('USDT', '')}
                                        </div>
                                        <div className={`text-xs font-bold ${isPositive
                                                ? isLight ? 'text-emerald-700' : 'text-emerald-400'
                                                : isLight ? 'text-red-700' : 'text-red-400'
                                            }`}>
                                            {isPositive ? '+' : ''}{pct.toFixed(2)}%
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};
