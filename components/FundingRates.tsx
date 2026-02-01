import React, { useMemo, useState, useEffect } from 'react';
import { useUser } from '../context/UserContext';
import { useMarketData } from '../context/MarketContext';
import { FuturesTicker, Ticker } from '../types';
import { FundingAnalyzer } from '../utils/AnomalyLogic';
import { Search, TrendingDown, ArrowUpDown, ArrowUp, ArrowDown, BarChart3, ChevronsDown, ChevronsUp, Activity, Zap, Clock, TrendingUp } from 'lucide-react';
import { CandleChart } from './CandleChart';
import { motion, AnimatePresence } from 'framer-motion';

interface FundingRatesProps {
    data: Record<string, FuturesTicker>;
    spotData: Record<string, Ticker>;
}

type SortKey = 'symbol' | 'markPrice' | 'fundingRate' | 'priceChangePercent' | 'volume';
type SortDirection = 'asc' | 'desc';

// Funding Countdown Component
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
            setTimeLeft(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
        };
        update();
        const interval = setInterval(update, 1000);
        return () => clearInterval(interval);
    }, [targetTime]);

    return <span className="font-mono">{timeLeft}</span>;
};

export const FundingRates: React.FC<FundingRatesProps> = ({ data, spotData }) => {
    const { theme } = useUser();
    const { fundingHistory } = useMarketData();
    const [searchTerm, setSearchTerm] = useState('');
    const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection }>({
        key: 'fundingRate',
        direction: 'asc'
    });
    const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
    const [showCharts, setShowCharts] = useState(false);

    const isLight = theme === 'corporate' || theme === 'labs';

    const handleSort = (key: SortKey) => {
        setSortConfig(current => ({
            key,
            direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
        }));
    };

    const sortedList = useMemo(() => {
        let list = Object.values(data) as FuturesTicker[];

        if (searchTerm) {
            list = list.filter(t => t.symbol.toLowerCase().includes(searchTerm.toLowerCase()));
        }

        return list.sort((a, b) => {
            let aValue: number, bValue: number;

            if (sortConfig.key === 'priceChangePercent') {
                aValue = spotData[a.symbol]?.priceChangePercent || 0;
                bValue = spotData[b.symbol]?.priceChangePercent || 0;
            } else if (sortConfig.key === 'volume') {
                aValue = spotData[a.symbol]?.volume || 0;
                bValue = spotData[b.symbol]?.volume || 0;
            } else {
                aValue = a[sortConfig.key] || 0;
                bValue = b[sortConfig.key] || 0;
            }

            if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [data, spotData, searchTerm, sortConfig]);

    useEffect(() => {
        if (!selectedSymbol && sortedList.length > 0) {
            setSelectedSymbol(sortedList[0].symbol);
        }
    }, [sortedList, selectedSymbol]);

    const selectedTicker = selectedSymbol ? data[selectedSymbol] : null;
    const selectedSpot = selectedSymbol ? spotData[selectedSymbol] : null;

    const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
        if (sortConfig.key !== columnKey) return <ArrowUpDown size={12} className="opacity-30" />;
        return sortConfig.direction === 'asc'
            ? <ArrowUp size={12} className={isLight ? 'text-violet-600' : 'text-purple-400'} />
            : <ArrowDown size={12} className={isLight ? 'text-violet-600' : 'text-purple-400'} />;
    };

    const formatVolume = (vol: number) => {
        if (vol >= 1000000) return `${(vol / 1000000).toFixed(2)}M`;
        if (vol >= 1000) return `${(vol / 1000).toFixed(2)}K`;
        return vol.toFixed(0);
    };

    return (
        <div className={`flex flex-col h-full rounded-3xl overflow-hidden ${isLight
            ? 'bg-white border border-gray-200 shadow-sm'
            : 'bg-white/[0.02] border border-white/10 backdrop-blur-xl'
            }`}>
            {/* Header */}
            <div className={`px-6 py-4 border-b ${isLight ? 'border-gray-200 bg-gray-50/50' : 'border-white/10 bg-white/[0.02]'}`}>
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-xl ${isLight ? 'bg-amber-100' : 'bg-gradient-to-br from-amber-500/20 to-orange-500/20'}`}>
                            <TrendingDown size={20} className={isLight ? 'text-amber-600' : 'text-amber-400'} />
                        </div>
                        <div>
                            <h3 className={`text-lg font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>Derivatives Market</h3>
                            <p className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-500'}`}>{sortedList.length} perpetual contracts</p>
                        </div>
                    </div>

                    {/* Search */}
                    <div className="relative">
                        <Search className={`absolute left-3 top-1/2 -translate-y-1/2 ${isLight ? 'text-gray-400' : 'text-gray-600'}`} size={16} />
                        <input
                            type="text"
                            placeholder="Search contracts..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            aria-label="Search perpetual contracts"
                            className={`${isLight
                                ? 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-violet-500 focus:ring-violet-500/20'
                                : 'bg-black/40 border-white/10 text-white placeholder:text-gray-600 focus:border-purple-500/50 focus:ring-purple-500/20'
                                } border rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 transition-all w-64`}
                        />
                    </div>
                </div>
            </div>

            {/* Selected Detail Panel */}
            <AnimatePresence>
                {selectedTicker && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className={`overflow-hidden border-b ${isLight ? 'border-gray-200 bg-gray-50/50' : 'border-white/10 bg-white/[0.02]'}`}
                    >
                        <div className="px-6 py-4">
                            <div className="flex items-center justify-between mb-4">
                                {/* Left: Coin Info */}
                                <div className="flex items-center gap-4">
                                    <div className={`w-12 h-12 rounded-2xl overflow-hidden ${isLight ? 'bg-gray-100' : 'bg-white/5'} p-2`}>
                                        <img
                                            src={`https://assets.coincap.io/assets/icons/${selectedTicker.symbol.replace('USDT', '').toLowerCase()}@2x.png`}
                                            className="w-full h-full object-cover"
                                            onError={(e) => e.currentTarget.style.display = 'none'}
                                            alt={selectedTicker.symbol.replace('USDT', '')}
                                        />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className={`text-xl font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>
                                                {selectedTicker.symbol.replace('USDT', '')}
                                            </span>
                                            <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${isLight ? 'bg-amber-100 text-amber-700' : 'bg-amber-500/10 text-amber-400'
                                                }`}>
                                                PERPETUAL
                                            </span>
                                        </div>
                                        <div className="flex items-baseline gap-3">
                                            <span className={`text-2xl font-mono font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>
                                                ${selectedTicker.markPrice.toFixed(selectedTicker.markPrice < 1 ? 5 : 2)}
                                            </span>
                                            <span className={`text-sm ${isLight ? 'text-gray-500' : 'text-gray-600'}`}>
                                                Spot: ${selectedSpot?.lastPrice.toFixed(selectedSpot?.lastPrice < 1 ? 5 : 2)}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Middle: Stats Grid */}
                                <div className="grid grid-cols-3 gap-6">
                                    <div className={`p-3 rounded-xl ${isLight ? 'bg-white border border-gray-200' : 'bg-white/5 border border-white/10'}`}>
                                        <div className={`text-xs mb-1 ${isLight ? 'text-gray-500' : 'text-gray-600'} flex items-center gap-1`}>
                                            <Zap size={12} />
                                            Funding Rate
                                        </div>
                                        <div className={`text-lg font-mono font-bold ${selectedTicker.fundingRate > 0
                                            ? isLight ? 'text-amber-700' : 'text-amber-400'
                                            : isLight ? 'text-emerald-700' : 'text-emerald-400'
                                            }`}>
                                            {(selectedTicker.fundingRate * 100).toFixed(4)}%
                                        </div>
                                    </div>
                                    <div className={`p-3 rounded-xl ${isLight ? 'bg-white border border-gray-200' : 'bg-white/5 border border-white/10'}`}>
                                        <div className={`text-xs mb-1 ${isLight ? 'text-gray-500' : 'text-gray-600'} flex items-center gap-1`}>
                                            <Clock size={12} />
                                            Next Funding
                                        </div>
                                        <div className={`text-sm font-mono font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>
                                            <FundingCountdown targetTime={selectedTicker.nextFundingTime} />
                                        </div>
                                    </div>
                                    <div className={`p-3 rounded-xl ${isLight ? 'bg-white border border-gray-200' : 'bg-white/5 border border-white/10'}`}>
                                        <div className={`text-xs mb-1 ${isLight ? 'text-gray-500' : 'text-gray-600'} flex items-center gap-1`}>
                                            <TrendingUp size={12} />
                                            24h Volume
                                        </div>
                                        <div className={`text-sm font-mono font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>
                                            ${formatVolume(selectedSpot?.volume || 0)}
                                        </div>
                                    </div>
                                </div>

                                {/* Right: Action Buttons */}
                                <div className="flex gap-2">
                                    {/* Coinglass Button */}
                                    <a
                                        href={`https://www.coinglass.com/funding/${selectedTicker.symbol.replace('USDT', '')}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={`px-4 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${isLight
                                            ? 'bg-white border border-gray-200 text-gray-700 hover:border-amber-300 hover:text-amber-600'
                                            : 'bg-white/5 border border-white/10 text-gray-300 hover:border-amber-500/30 hover:text-amber-400'
                                            }`}
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                                            <line x1="12" y1="22.08" x2="12" y2="12" />
                                        </svg>
                                        Coinglass
                                    </a>

                                    {/* Chart Toggle */}
                                    <button
                                        onClick={() => setShowCharts(!showCharts)}
                                        className={`px-4 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${showCharts
                                            ? isLight
                                                ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/30'
                                                : 'bg-gradient-to-r from-purple-600 to-violet-600 text-white shadow-lg shadow-purple-500/30'
                                            : isLight
                                                ? 'bg-white border border-gray-200 text-gray-700 hover:border-violet-300'
                                                : 'bg-white/5 border border-white/10 text-gray-300 hover:border-purple-500/30'
                                            }`}
                                    >
                                        <BarChart3 size={16} />
                                        {showCharts ? 'Hide Chart' : 'Show Chart'}
                                    </button>
                                </div>
                            </div>

                            {/* Expandable Chart */}
                            <AnimatePresence>
                                {showCharts && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 300, opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.3 }}
                                        className={`overflow-hidden rounded-2xl ${isLight ? 'bg-gray-100 border border-gray-200' : 'bg-black/40 border border-white/10'}`}
                                    >
                                        <CandleChart symbol={`${selectedTicker.symbol}.P`} id={`detail-chart-${selectedTicker.symbol}`} />
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Table Header */}
            <div className={`grid grid-cols-12 gap-3 px-6 py-2 border-b ${isLight ? 'border-gray-200 bg-gray-50' : 'border-white/10 bg-white/[0.02]'
                } text-xs font-bold ${isLight ? 'text-gray-600' : 'text-gray-500'} uppercase tracking-wider sticky top-0 z-10`}>
                <div className="col-span-3 flex items-center gap-1 cursor-pointer hover:text-purple-400 transition-colors" onClick={() => handleSort('symbol')}>
                    Symbol <SortIcon columnKey="symbol" />
                </div>
                <div className="col-span-2 text-right flex items-center justify-end gap-1 cursor-pointer hover:text-purple-400 transition-colors" onClick={() => handleSort('markPrice')}>
                    Mark Price <SortIcon columnKey="markPrice" />
                </div>
                <div className="col-span-2 text-right flex items-center justify-end gap-1 cursor-pointer hover:text-purple-400 transition-colors" onClick={() => handleSort('priceChangePercent')}>
                    24h Change <SortIcon columnKey="priceChangePercent" />
                </div>
                <div className="col-span-2 text-right flex items-center justify-end gap-1 cursor-pointer hover:text-purple-400 transition-colors" onClick={() => handleSort('fundingRate')}>
                    Funding <SortIcon columnKey="fundingRate" />
                </div>
                <div className="col-span-3 text-center">
                    Trend Analysis
                </div>
            </div>

            {/* Table Body */}
            <div className="flex-1 overflow-y-auto">
                {sortedList.map((ticker, idx) => {
                    const spot = spotData[ticker.symbol];
                    const changePct = spot?.priceChangePercent || 0;
                    const fundingPct = ticker.fundingRate * 100;
                    const isSelected = selectedSymbol === ticker.symbol;

                    const history = fundingHistory[ticker.symbol] || [];
                    const trend = FundingAnalyzer.analyze(ticker.symbol, history);

                    return (
                        <motion.div
                            key={ticker.symbol}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.01, duration: 0.2 }}
                            onClick={() => setSelectedSymbol(ticker.symbol)}
                            className={`grid grid-cols-12 gap-3 px-6 py-2.5 cursor-pointer transition-all items-center border-b ${isLight ? 'border-gray-100' : 'border-white/5'
                                } ${isSelected
                                    ? isLight ? 'bg-violet-50' : 'bg-purple-500/5'
                                    : isLight ? 'hover:bg-gray-50' : 'hover:bg-white/[0.02]'
                                }`}
                        >
                            {/* Symbol */}
                            <div className="col-span-3 flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-full overflow-hidden ${isLight ? 'bg-gray-100' : 'bg-white/5'}`}>
                                    <img
                                        src={`https://assets.coincap.io/assets/icons/${ticker.symbol.replace('USDT', '').toLowerCase()}@2x.png`}
                                        className="w-full h-full object-cover"
                                        onError={(e) => e.currentTarget.style.display = 'none'}
                                        alt={ticker.symbol.replace('USDT', '')}
                                    />
                                </div>
                                <div>
                                    <div className={`text-sm font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>
                                        {ticker.symbol.replace('USDT', '')}
                                    </div>
                                    <div className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-600'}`}>USDT</div>
                                </div>
                            </div>

                            {/* Mark Price */}
                            <div className={`col-span-2 text-right font-mono text-sm ${isLight ? 'text-gray-900' : 'text-white'}`}>
                                ${ticker.markPrice.toFixed(ticker.markPrice < 1 ? 5 : 2)}
                            </div>

                            {/* 24h Change */}
                            <div className="col-span-2 text-right">
                                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold ${changePct >= 0
                                    ? isLight ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-500/10 text-emerald-400'
                                    : isLight ? 'bg-red-100 text-red-700' : 'bg-red-500/10 text-red-400'
                                    }`}>
                                    {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
                                </span>
                            </div>

                            {/* Funding Rate */}
                            <div className="col-span-2 text-right">
                                <div className={`text-sm font-mono font-bold mb-0.5 ${fundingPct > 0
                                    ? isLight ? 'text-amber-700' : 'text-amber-400'
                                    : fundingPct < 0
                                        ? isLight ? 'text-emerald-700' : 'text-emerald-400'
                                        : isLight ? 'text-gray-500' : 'text-gray-600'
                                    }`}>
                                    {fundingPct.toFixed(4)}%
                                </div>
                                <div className={`text-xs font-mono ${isLight ? 'text-gray-500' : 'text-gray-600'}`}>
                                    <FundingCountdown targetTime={ticker.nextFundingTime} />
                                </div>
                            </div>

                            {/* Trend Analysis */}
                            <div className="col-span-3 flex items-center justify-center gap-2">
                                {trend.direction === 'DIVING' && (
                                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${isLight ? 'bg-red-100 text-red-700' : 'bg-red-500/10 text-red-400'
                                        } font-bold text-xs animate-pulse`}>
                                        <ChevronsDown size={14} />
                                        DIVE
                                    </div>
                                )}
                                {trend.direction === 'SPIKING' && (
                                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${isLight ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-500/10 text-emerald-400'
                                        } font-bold text-xs animate-pulse`}>
                                        <ChevronsUp size={14} />
                                        SPIKE
                                    </div>
                                )}
                                {trend.direction === 'STABLE' && (
                                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${isLight ? 'bg-gray-100 text-gray-500' : 'bg-white/5 text-gray-600'
                                        } text-xs`}>
                                        <Activity size={12} />
                                        Stable
                                    </div>
                                )}

                                {/* Sparkline */}
                                {history.length > 5 && (
                                    <div className="flex-1 h-8 max-w-[80px] flex items-end gap-[1px]">
                                        {history.slice(-15).map((p, i, arr) => {
                                            const min = Math.min(...arr.map(x => x.rate));
                                            const max = Math.max(...arr.map(x => x.rate));
                                            const range = max - min || 0.0001;
                                            const h = ((p.rate - min) / range) * 100;
                                            return (
                                                <div
                                                    key={i}
                                                    className={`flex-1 min-w-[2px] rounded-t transition-all ${trend.velocity < 0
                                                        ? isLight ? 'bg-red-400' : 'bg-red-500/40'
                                                        : isLight ? 'bg-emerald-400' : 'bg-emerald-500/40'
                                                        }`}
                                                    style={{ height: `${Math.max(h, 10)}%` }}
                                                />
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    );
                })}
            </div>
        </div>
    );
};
