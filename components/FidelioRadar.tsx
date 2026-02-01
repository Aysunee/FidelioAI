import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Ticker, FuturesTicker, MarketIndex } from '../types';
import { Radar, AlertCircle, TrendingUp, TrendingDown, Zap, Droplets, Activity, Gauge, BarChart2, ChevronDown, Radio, Clock, Filter, Search, Sparkles, Target } from 'lucide-react';
import { CandleChart } from './CandleChart';
import { DEFAULT_WATCHLIST } from '../constants';
import { useSignals } from '../context/SignalContext';
import { useUser } from '../context/UserContext';
import { formatPrice } from '../utils/formatters';
import { BigMoveRadar } from './BigMoveRadar';
import { PerpBigMoveRadar } from './PerpBigMoveRadar';
import { PatternRadar } from './PatternRadar';
import { GlobalTicker } from './GlobalTicker';

interface FidelioRadarProps {
    spotData: Record<string, Ticker>;
    futuresData: Record<string, FuturesTicker>;
    indicesData: MarketIndex[];
}

type AnomalyType = 'PUMP' | 'DUMP' | 'DIV_BULL' | 'DIV_BEAR' | 'NEG_FUNDING' | 'VOLUME_SPIKE';

interface Anomaly {
    id: string;
    symbol: string;
    type: AnomalyType;
    value: number;
    message: string;
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

export const FidelioRadar: React.FC<FidelioRadarProps> = ({ spotData, futuresData, indicesData }) => {
    const { signals, bigMoves } = useSignals();
    const { theme } = useUser();

    // Theme helpers - Professional Light, Google Labs, or Dark
    const isCorporate = theme === 'corporate';
    const isLabs = theme === 'labs';
    const isLight = isCorporate || isLabs;
    const gradientClasses = isCorporate ? 'from-violet-600 to-purple-600' : isLabs ? 'from-[#4285F4] to-[#34A853]' : 'from-purple-400 via-violet-300 to-amber-400';
    const bgClass = isLight ? (isLabs ? 'bg-[#F0F2F5]' : 'bg-[#FAFBFC]') : 'bg-black';
    const cardBg = isLight ? (isLabs ? 'bg-white border-white shadow-[0_2px_8px_rgba(0,0,0,0.04)]' : 'bg-white border-gray-200 shadow-sm') : 'bg-white/5 border-white/10';
    const textPrimary = isLight ? 'text-gray-900' : 'text-gray-200';
    const textSecondary = isLight ? 'text-gray-600' : 'text-gray-500';
    const glowClass = isCorporate ? 'shadow-lg' : isLabs ? 'shadow-sm' : 'shadow-[0_0_30px_rgba(168,85,247,0.4)]';

    // Filter State
    const [searchQuery, setSearchQuery] = useState('');
    const [filterSource, setFilterSource] = useState<'ALL' | 'WEBHOOK' | 'RMI' | 'DIV' | 'VOLUME'>('ALL');
    const [filterSide, setFilterSide] = useState<'ALL' | 'BULL' | 'BEAR'>('ALL');
    const [activeTab, setActiveTab] = useState<'SIGNALS' | 'PATTERNS'>('SIGNALS');

    // Filter Logic
    const filteredSignals = useMemo(() => {
        return signals.filter(s => {
            const matchesSearch = s.symbol.toLowerCase().includes(searchQuery.toLowerCase());

            let matchesSource = true;
            if (filterSource === 'WEBHOOK') matchesSource = s.source === 'WEBHOOK';
            else if (filterSource === 'RMI') matchesSource = s.source === 'ALGO_MOMENTUM';
            else if (filterSource === 'DIV') matchesSource = s.source === 'ALGO_DIVERGENCE';
            else if (filterSource === 'VOLUME') matchesSource = s.source === 'ALGO_VOLUME';

            const isBull = s.side === 'BUY' || s.side === 'LONG';
            const matchesSide = filterSide === 'ALL'
                ? true
                : filterSide === 'BULL'
                    ? isBull
                    : !isBull;

            return matchesSearch && matchesSource && matchesSide;
        });
    }, [signals, searchQuery, filterSource, filterSide]);

    // Chart State
    const [selectedSymbol, setSelectedSymbol] = useState<string>('BTCUSDT');
    const [showSymbolDropdown, setShowSymbolDropdown] = useState(false);
    const [showWebhookInfo, setShowWebhookInfo] = useState(false);

    // Available symbols from watchlist
    const availableSymbols = DEFAULT_WATCHLIST.filter(s => spotData[s]);

    // Market Sentiment Calculation
    const sentiment = useMemo(() => {
        let score = 50;
        const tickers = (Object.values(spotData) as Ticker[]).filter(t => t.symbol.endsWith('USDT'));
        if (tickers.length === 0) return { score: 50, label: 'NEUTRAL', color: 'text-gray-400', glow: 'shadow-gray-500/50' };

        const gainers = tickers.filter(t => t.priceChangePercent > 0).length;
        const ratio = gainers / tickers.length;

        score = ratio * 100;

        let label = 'NEUTRAL';
        let color = 'text-gray-400';
        let glow = 'shadow-gray-500/50';

        if (score >= 75) { label = 'GREED'; color = 'text-emerald-400'; glow = 'shadow-emerald-500/50'; }
        else if (score >= 60) { label = 'BULLISH'; color = 'text-emerald-400'; glow = 'shadow-emerald-500/50'; }
        else if (score <= 25) { label = 'FEAR'; color = 'text-rose-400'; glow = 'shadow-rose-500/50'; }
        else if (score <= 40) { label = 'BEARISH'; color = 'text-rose-400'; glow = 'shadow-rose-500/50'; }

        return { score, label, color, glow };
    }, [spotData]);

    // Anomaly Detection
    const anomalies = useMemo(() => {
        const list: Anomaly[] = [];
        const now = Date.now();

        // 1. Real-time Big Moves (Pumps/Dumps)
        // Only consider moves from the last 15 minutes
        bigMoves.forEach(move => {
            if (now - move.timestamp > 15 * 60 * 1000) return;

            if (move.type === 'RISE' || move.type === 'RALLY' || move.type === 'WHALE') {
                list.push({
                    id: `pump-${move.id}`,
                    symbol: move.symbol,
                    type: 'PUMP',
                    value: move.changePercent || 0,
                    message: `${move.type} DETECTED`,
                    severity: move.level === 'HIGH' ? 'HIGH' : 'MEDIUM'
                });
            } else if (move.type === 'FALL' || move.type === 'PULLBACK') {
                list.push({
                    id: `dump-${move.id}`,
                    symbol: move.symbol,
                    type: 'DUMP',
                    value: move.changePercent || 0,
                    message: `${move.type} DETECTED`,
                    severity: move.level === 'HIGH' ? 'HIGH' : 'MEDIUM'
                });
            }
        });

        // 2. 24h Gainers/Losers (Renamed from Pump/Dump)
        Object.values(spotData).forEach((t: Ticker) => {
            if (!t.symbol.endsWith('USDT')) return;

            // Only add if not already added by BigMoves to avoid duplicates
            if (list.some(a => a.symbol === t.symbol)) return;

            if (t.priceChangePercent > 10) {
                list.push({
                    id: `gainer-${t.symbol}`,
                    symbol: t.symbol,
                    type: 'PUMP', // Keep type PUMP for styling, but message changes
                    value: t.priceChangePercent,
                    message: '24H GAINER',
                    severity: t.priceChangePercent > 20 ? 'HIGH' : 'MEDIUM'
                });
            }
            if (t.priceChangePercent < -10) {
                list.push({
                    id: `loser-${t.symbol}`,
                    symbol: t.symbol,
                    type: 'DUMP', // Keep type DUMP for styling
                    value: t.priceChangePercent,
                    message: '24H LOSER',
                    severity: t.priceChangePercent < -20 ? 'HIGH' : 'MEDIUM'
                });
            }
        });

        // 3. Futures Anomalies
        Object.values(futuresData).forEach((f: FuturesTicker) => {
            if (!f.symbol.endsWith('USDT')) return;
            const fundingPct = f.fundingRate * 100;

            // User requested focus on funding dropping below -0.1%
            if (fundingPct < -0.1) {
                list.push({
                    id: `super-neg-${f.symbol}`,
                    symbol: f.symbol,
                    type: 'NEG_FUNDING',
                    value: fundingPct,
                    message: 'EXTREME NEGATIVE FUNDING',
                    severity: 'HIGH'
                });
            } else if (fundingPct < -0.05) {
                list.push({
                    id: `neg-${f.symbol}`,
                    symbol: f.symbol,
                    type: 'NEG_FUNDING',
                    value: fundingPct,
                    message: 'Heavy Negative Funding',
                    severity: 'MEDIUM'
                });
            }

            const spot = spotData[f.symbol];
            if (spot) {
                // Short Squeeze Setup: Funding < -0.1% AND Price rising (divergence)
                if (fundingPct <= -0.1 && spot.priceChangePercent > 0.5) {
                    list.push({
                        id: `div-bull-${f.symbol}`,
                        symbol: f.symbol,
                        type: 'DIV_BULL',
                        value: fundingPct,
                        message: 'SHORT SQUEEZE ALERT',
                        severity: 'HIGH'
                    });
                }

                // Long Trap: Funding > 0.1% AND Price falling
                if (fundingPct >= 0.1 && spot.priceChangePercent < -0.5) {
                    list.push({
                        id: `div-bear-${f.symbol}`,
                        symbol: f.symbol,
                        type: 'DIV_BEAR',
                        value: fundingPct,
                        message: 'LONG TRAP ALERT',
                        severity: 'HIGH'
                    });
                }
            }
        });

        // 4. Volume Spikes (From Signals Context)
        signals.forEach(s => {
            if (s.source === 'ALGO_VOLUME') {
                // Only show recent spikes (last 5 minutes) in the anomalies cards
                const signalTime = new Date(s.time).getTime();
                if (now - signalTime < 300000) {
                    // Extract multiplier from note or calculate roughly
                    // Note format: "3.5x Normal Volume Flow"
                    const match = s.note.match(/([\d.]+)x/);
                    const multiplier = match ? parseFloat(match[1]) : 0;

                    list.push({
                        id: s.id,
                        symbol: s.symbol,
                        type: 'VOLUME_SPIKE',
                        value: multiplier * 100, // Display as percentage or just raw? The UI expects a number.
                        message: s.note,
                        severity: multiplier > 5 ? 'HIGH' : 'MEDIUM'
                    });
                }
            }
        });

        return list.sort((a, b) => {
            if (a.severity === 'HIGH' && b.severity !== 'HIGH') return -1;
            if (b.severity === 'HIGH' && a.severity !== 'HIGH') return 1;
            return 0;
        }).slice(0, 4);
    }, [spotData, futuresData, signals, bigMoves]);

    const getStyle = (type: AnomalyType) => {
        switch (type) {
            case 'DIV_BULL': return { text: 'text-emerald-400', border: 'border-emerald-500/30', icon: Zap, glow: 'shadow-[0_0_20px_rgba(16,185,129,0.3)]' };
            case 'DIV_BEAR': return { text: 'text-rose-400', border: 'border-rose-500/30', icon: AlertCircle, glow: 'shadow-[0_0_20px_rgba(244,63,94,0.3)]' };
            case 'PUMP': return { text: 'text-emerald-400', border: 'border-emerald-500/30', icon: TrendingUp, glow: 'shadow-[0_0_20px_rgba(16,185,129,0.3)]' };
            case 'DUMP': return { text: 'text-rose-400', border: 'border-rose-500/30', icon: TrendingDown, glow: 'shadow-[0_0_20px_rgba(244,63,94,0.3)]' };
            case 'NEG_FUNDING': return { text: 'text-amber-400', border: 'border-amber-500/30', icon: Droplets, glow: 'shadow-[0_0_20px_rgba(251,191,36,0.3)]' };
            case 'VOLUME_SPIKE': return { text: 'text-purple-400', border: 'border-purple-500/30', icon: Activity, glow: 'shadow-[0_0_20px_rgba(168,85,247,0.3)]' };
            default: return { text: 'text-cyan-400', border: 'border-cyan-500/30', icon: Radar, glow: 'shadow-[0_0_20px_rgba(34,211,238,0.3)]' };
        }
    };

    return (
        <div className={`min-h-screen ${bgClass} p-6`}>
            {/* Ambient Background */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className={`absolute top-0 right-0 w-[800px] h-[800px] ${isCorporate ? 'bg-blue-500/5' : isLabs ? 'bg-blue-400/10' : 'bg-purple-600/10'} rounded-full blur-[120px]`}></div>
                <div className={`absolute bottom-0 left-0 w-[600px] h-[600px] ${isCorporate ? 'bg-cyan-500/5' : isLabs ? 'bg-green-400/10' : 'bg-amber-600/10'} rounded-full blur-[120px]`}></div>
            </div>


            <div className="max-w-[1800px] mx-auto flex flex-col gap-6 relative z-10">
                {/* Top Row: Chart + Fidelio Signals */}
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-2 h-[600px]">

                    {/* Chart Section (55% = ~2.2 cols, use 3 cols) */}
                    <div className={`lg:col-span-3 backdrop-blur-xl ${cardBg} rounded-lg p-5 flex flex-col relative overflow-hidden ${isCorporate ? 'shadow-lg' : 'shadow-[0_0_40px_rgba(168,85,247,0.15)]'}`}>
                        <div className="flex items-center justify-between mb-4 h-10">
                            <div className="flex items-center gap-3 h-full">
                                <div className="h-full aspect-square bg-gradient-to-br from-cyan-500 to-blue-600 rounded-md shadow-[0_0_15px_rgba(34,211,238,0.3)] flex items-center justify-center">
                                    <BarChart2 size={16} className="text-white" />
                                </div>

                                {/* Symbol Selector */}
                                <div className="relative h-full">
                                    <button
                                        onClick={() => setShowSymbolDropdown(!showSymbolDropdown)}
                                        className={`h-full flex items-center gap-2 px-3 backdrop-blur-xl ${cardBg} rounded-md transition-all ${isCorporate ? 'hover:border-blue-500/50' : 'hover:border-purple-500/50'} font-medium text-sm ${textPrimary}`}
                                    >
                                        <span>{selectedSymbol.replace('USDT', '')}/USDT</span>
                                        <ChevronDown size={12} className={textSecondary} />
                                    </button>

                                    {showSymbolDropdown && (
                                        <div className={`absolute top-full left-0 mt-2 w-52 backdrop-blur-xl ${isCorporate ? 'bg-white border-slate-200' : 'bg-black/80 border-white/10'} border rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto`}>
                                            {availableSymbols.map(sym => (
                                                <button
                                                    key={sym}
                                                    onClick={() => {
                                                        setSelectedSymbol(sym);
                                                        setShowSymbolDropdown(false);
                                                    }}
                                                    className={`w-full px-3 py-2 text-left ${isCorporate ? 'hover:bg-slate-100' : 'hover:bg-white/5'} transition-colors flex items-center justify-between text-sm ${sym === selectedSymbol ? (isCorporate ? 'bg-blue-50 border-l-2 border-blue-500' : 'bg-gradient-to-r from-purple-600/20 to-amber-600/20 border-l border-purple-500') : ''}`}
                                                >
                                                    <span className={`font-medium ${textPrimary}`}>{sym.replace('USDT', '')}</span>
                                                    <span className={`text-xs font-bold ${spotData[sym]?.priceChangePercent > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                        {spotData[sym]?.priceChangePercent > 0 ? '+' : ''}{spotData[sym]?.priceChangePercent.toFixed(2)}%
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center gap-3 flex-1 min-w-0 h-full">
                                <div className="hidden xl:block flex-1 min-w-0 px-4 h-full">
                                    <GlobalTicker spotData={spotData} indicesData={indicesData} />
                                </div>
                                <div className={`h-full px-3 backdrop-blur-xl ${cardBg} rounded-md flex flex-col justify-center`}>
                                    <div className={`text-[10px] ${textSecondary} uppercase tracking-wider`}>Price</div>
                                    <div className={`text-base font-bold ${textPrimary} font-mono leading-none`}>
                                        ${spotData[selectedSymbol] ? formatPrice(spotData[selectedSymbol].lastPrice) : '...'}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 w-full">
                            <CandleChart symbol={selectedSymbol} id={`fidelio-radar-${selectedSymbol}`} />
                        </div>
                    </div>

                    {/* Fidelio Signals (20% = ~0.8 cols, use 1 col) */}
                    <div className={`lg:col-span-1 h-full backdrop-blur-xl ${cardBg} rounded-lg flex flex-col overflow-hidden ${isCorporate ? 'shadow-lg' : 'shadow-[0_0_40px_rgba(168,85,247,0.15)]'}`}>
                        <div className={`p-3 border-b ${isCorporate ? 'border-slate-200 bg-gradient-to-r from-blue-500/10 to-cyan-500/10' : 'border-white/10 bg-gradient-to-r from-purple-600/20 to-amber-600/20'}`}>
                            <div className="flex items-center justify-between">
                                <div className="flex bg-black/20 rounded-lg p-0.5 border border-white/5">
                                    <button
                                        onClick={() => setActiveTab('SIGNALS')}
                                        className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${activeTab === 'SIGNALS'
                                            ? 'bg-purple-500/20 text-purple-300 shadow-[0_0_10px_rgba(168,85,247,0.2)]'
                                            : 'text-gray-500 hover:text-gray-300'}`}
                                    >
                                        Signals
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('PATTERNS')}
                                        className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${activeTab === 'PATTERNS'
                                            ? 'bg-emerald-500/20 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                                            : 'text-gray-500 hover:text-gray-300'}`}
                                    >
                                        Patterns
                                    </button>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setShowWebhookInfo(!showWebhookInfo)}
                                        className={`text-[9px] font-bold px-2 py-0.5 rounded-full border transition-all uppercase tracking-wider ${showWebhookInfo
                                            ? 'bg-amber-500/20 text-amber-400 border-amber-500/50'
                                            : 'bg-white/5 border-white/10 text-gray-500 hover:text-gray-300'}`}
                                    >
                                        Webhook Info
                                    </button>
                                    <div className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-gradient-to-r from-purple-600 to-amber-600 text-white uppercase tracking-wider shadow-[0_0_15px_rgba(168,85,247,0.4)]">
                                        Live
                                    </div>
                                </div>
                            </div>

                            {/* Webhook Info Panel */}
                            {showWebhookInfo && (
                                <div className="mt-3 p-3 rounded-md bg-black/40 border border-white/10 text-xs animate-in slide-in-from-top-2">
                                    <p className="text-gray-400 mb-2">
                                        To receive signals from outside your network (TradingView, etc.):
                                    </p>
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between bg-white/5 p-2 rounded border border-white/5">
                                            <span className="text-gray-500">URL:</span>
                                            <code className="text-amber-400 font-mono select-all">http://YOUR_STATIC_IP:80/api/webhook</code>
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] text-gray-500">
                                            <Zap size={10} className="text-amber-400" />
                                            <span>Requires Port Forwarding (80) on your router.</span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Content based on Tab */}
                        {activeTab === 'SIGNALS' ? (
                            <>
                                {/* Filters Toolbar */}
                                <div className="p-2 border-b border-white/10 bg-black/20 flex flex-col gap-2">
                                    <div className="relative">
                                        <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-600" />
                                        <input
                                            type="text"
                                            placeholder="Filter..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1 pl-6 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/50 transition-colors"
                                        />
                                    </div>
                                    <div className="flex gap-1">
                                        <button
                                            onClick={() => setFilterSource(filterSource === 'WEBHOOK' ? 'ALL' : 'WEBHOOK')}
                                            className={`flex-1 py-1 text-[9px] font-bold rounded-md transition-all ${filterSource === 'WEBHOOK'
                                                ? 'bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-[0_0_15px_rgba(251,191,36,0.4)]'
                                                : 'bg-white/5 border border-white/10 text-gray-500 hover:text-gray-300 hover:border-amber-500/30'
                                                }`}
                                        >
                                            WEBHOOK
                                        </button>
                                        <button
                                            onClick={() => setFilterSource(filterSource === 'RMI' ? 'ALL' : 'RMI')}
                                            className={`flex-1 py-1 text-[9px] font-bold rounded-md transition-all ${filterSource === 'RMI'
                                                ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-[0_0_15px_rgba(34,211,238,0.4)]'
                                                : 'bg-white/5 border border-white/10 text-gray-500 hover:text-gray-300 hover:border-cyan-500/30'
                                                }`}
                                        >
                                            RMI
                                        </button>
                                        <button
                                            onClick={() => setFilterSource(filterSource === 'DIV' ? 'ALL' : 'DIV')}
                                            className={`flex-1 py-1 text-[9px] font-bold rounded-md transition-all ${filterSource === 'DIV'
                                                ? 'bg-gradient-to-r from-purple-600 to-violet-600 text-white shadow-[0_0_15px_rgba(168,85,247,0.4)]'
                                                : 'bg-white/5 border border-white/10 text-gray-500 hover:text-gray-300 hover:border-purple-500/30'
                                                }`}
                                        >
                                            DIV
                                        </button>
                                        <button
                                            onClick={() => setFilterSource(filterSource === 'VOLUME' ? 'ALL' : 'VOLUME')}
                                            className={`flex-1 py-1 text-[9px] font-bold rounded-md transition-all ${filterSource === 'VOLUME'
                                                ? 'bg-gradient-to-r from-emerald-600 to-green-600 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                                                : 'bg-white/5 border border-white/10 text-gray-500 hover:text-gray-300 hover:border-emerald-500/30'
                                                }`}
                                        >
                                            VOL
                                        </button>
                                    </div>
                                    <div className="flex gap-1">
                                        <button
                                            onClick={() => setFilterSide(filterSide === 'BULL' ? 'ALL' : 'BULL')}
                                            className={`flex-1 py-1 text-[9px] font-bold rounded-md transition-all ${filterSide === 'BULL'
                                                ? 'bg-gradient-to-r from-emerald-600 to-green-600 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                                                : 'bg-white/5 border border-white/10 text-gray-500 hover:text-gray-300 hover:border-emerald-500/30'
                                                }`}
                                        >
                                            BULL
                                        </button>
                                        <button
                                            onClick={() => setFilterSide(filterSide === 'BEAR' ? 'ALL' : 'BEAR')}
                                            className={`flex-1 py-1 text-[9px] font-bold rounded-md transition-all ${filterSide === 'BEAR'
                                                ? 'bg-gradient-to-r from-rose-600 to-red-600 text-white shadow-[0_0_15px_rgba(244,63,94,0.4)]'
                                                : 'bg-white/5 border border-white/10 text-gray-500 hover:text-gray-300 hover:border-rose-500/30'
                                                }`}
                                        >
                                            BEAR
                                        </button>
                                    </div>
                                </div>

                                <div className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                                    {filteredSignals.length === 0 ? (
                                        <div className="h-full flex flex-col items-center justify-center text-gray-600 p-4 text-center">
                                            <Filter size={20} className="mb-2 opacity-30" />
                                            <p className="text-xs">No signals found</p>
                                        </div>
                                    ) : (
                                        filteredSignals.slice(0, 20).map((signal) => (
                                            <div
                                                key={signal.id}
                                                onClick={() => setSelectedSymbol(signal.symbol)}
                                                className={`p-1.5 rounded-lg border transition-all cursor-pointer group relative overflow-hidden ${signal.source === 'WEBHOOK'
                                                    ? 'backdrop-blur-xl bg-gradient-to-br from-amber-600/20 to-orange-600/20 border-amber-500/30 shadow-[0_0_20px_rgba(251,191,36,0.2)] hover:shadow-[0_0_30px_rgba(251,191,36,0.3)]'
                                                    : 'backdrop-blur-xl bg-white/5 border-white/10 hover:border-purple-500/30'
                                                    }`}
                                            >
                                                {signal.source === 'WEBHOOK' && (
                                                    <div className="absolute top-1 right-1">
                                                        <span className="relative flex h-1.5 w-1.5">
                                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
                                                        </span>
                                                    </div>
                                                )}
                                                <div className="flex justify-between items-start mb-0.5">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className={`font-bold text-[10px] ${signal.source === 'WEBHOOK' ? 'text-amber-400' : 'text-gray-200'}`}>
                                                            {signal.symbol.replace('USDT', '')}
                                                        </span>
                                                        <span className={`text-[8px] font-bold px-1 py-0.5 rounded ${signal.side === 'BUY' || signal.side === 'LONG'
                                                            ? 'bg-emerald-500/20 text-emerald-400'
                                                            : 'bg-rose-500/20 text-rose-400'
                                                            }`}>
                                                            {signal.side}
                                                        </span>
                                                    </div>
                                                    <span className="text-[8px] text-gray-600 flex items-center gap-1">
                                                        <Clock size={8} />
                                                        {new Date(signal.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </div>

                                                <div className="flex justify-between items-end">
                                                    <div className="flex flex-col">
                                                        <span className="text-[10px] font-mono text-gray-300">${formatPrice(signal.price)}</span>
                                                        <span className="text-[8px] text-gray-600 truncate max-w-[100px]">{signal.strategy}</span>
                                                    </div>

                                                    {signal.source === 'WEBHOOK' && (
                                                        <span className="text-[7px] font-bold px-1 py-0.5 rounded bg-gradient-to-r from-amber-600 to-orange-600 text-white flex items-center gap-0.5 shadow-[0_0_10px_rgba(251,191,36,0.3)]">
                                                            <Zap size={6} fill="currentColor" /> WH
                                                        </span>
                                                    )}
                                                    {signal.source === 'ALGO_MOMENTUM' && (
                                                        <span className="text-[7px] font-bold px-1 py-0.5 rounded bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-[0_0_10px_rgba(34,211,238,0.3)]">
                                                            RMI
                                                        </span>
                                                    )}
                                                    {signal.source === 'ALGO_DIVERGENCE' && (
                                                        <span className="text-[7px] font-bold px-1 py-0.5 rounded bg-gradient-to-r from-purple-600 to-violet-600 text-white shadow-[0_0_10px_rgba(168,85,247,0.3)]">
                                                            DIV
                                                        </span>
                                                    )}
                                                    {signal.source === 'ALGO_VOLUME' && (
                                                        <span className="text-[7px] font-bold px-1 py-0.5 rounded bg-gradient-to-r from-emerald-600 to-green-600 text-white shadow-[0_0_10px_rgba(16,185,129,0.3)]">
                                                            VOL
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </>
                        ) : (
                            <PatternRadar />
                        )}
                    </div>
                </div>

                {/* Bottom Row: Big Move Radars */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 h-[500px]">
                    {/* Binance Spot Big Move (15%) */}
                    <div className="h-full overflow-hidden">
                        <BigMoveRadar />
                    </div>

                    {/* Perp Big Move Radar (15%) */}
                    <div className="h-full overflow-hidden">
                        <PerpBigMoveRadar />
                    </div>
                </div>

                {/* Bottom Row: Anomalies */}
                < div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" >
                    {
                        anomalies.length > 0 ? (
                            anomalies.map(anomaly => {
                                const style = getStyle(anomaly.type);
                                const Icon = style.icon;
                                return (
                                    <div
                                        key={anomaly.id}
                                        onClick={() => setSelectedSymbol(anomaly.symbol)}
                                        className={`p-1.5 border transition-all cursor-pointer hover:shadow-lg hover:-translate-y-0.5 ${isLabs
                                            ? 'bg-white rounded-[16px] border-[#DADCE0] shadow-sm'
                                            : `backdrop-blur-xl rounded-md ${isCorporate ? 'bg-white border-gray-100' : 'bg-white/5 ' + style.border} ${style.glow} hover:${style.glow.replace('0.3', '0.5')}`
                                            }`}
                                    >
                                        <div className="flex items-start justify-between mb-0.5">
                                            <div className="flex items-center gap-1">
                                                <div className={`p-0.5 rounded ${style.text === 'text-emerald-400' ? 'bg-emerald-500/20' : style.text === 'text-rose-400' ? 'bg-rose-500/20' : style.text === 'text-amber-400' ? 'bg-amber-500/20' : 'bg-purple-500/20'}`}>
                                                    <Icon size={10} className={style.text} />
                                                </div>
                                                <span className={`font-bold text-[9px] ${textPrimary}`}>{anomaly.symbol.replace('USDT', '')}</span>
                                            </div>
                                            <span className={`text-[7px] font-bold px-1 py-0.5 rounded-full ${anomaly.severity === 'HIGH' ? 'bg-rose-500/20 text-rose-400' :
                                                anomaly.severity === 'MEDIUM' ? 'bg-amber-500/20 text-amber-400' :
                                                    'bg-gray-500/20 text-gray-400'
                                                }`}>
                                                {anomaly.severity}
                                            </span>
                                        </div>
                                        <div className="text-[8px] text-gray-500 leading-tight mb-0.5 truncate">{anomaly.message}</div>
                                        <div className={`text-[10px] font-bold ${style.text}`}>
                                            {anomaly.type === 'VOLUME_SPIKE' ? `+${anomaly.value.toFixed(0)}%` : `${anomaly.value > 0 ? '+' : ''}${anomaly.value.toFixed(2)}%`}
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="col-span-full p-8 backdrop-blur-xl bg-white/5 border border-dashed border-white/10 rounded-lg text-center">
                                <Sparkles size={40} className="mx-auto mb-3 text-gray-700 opacity-30" />
                                <p className="text-gray-600 text-sm">No anomalies detected</p>
                            </div>
                        )
                    }
                </div >
            </div >
        </div >
    );
};
