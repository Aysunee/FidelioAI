import React, { useState, useMemo } from 'react';
import { Signal, Ticker } from '../types';
import { Search, ChevronDown, ChevronUp, Zap, Activity, ExternalLink, LineChart, CheckCircle2, TrendingUp, Sparkles, Target } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUser } from '../context/UserContext';

interface SignalFeedProps {
    signals: Signal[];
    marketData: Record<string, Ticker>;
}

type Tab = 'ALL' | 'SPOT' | 'FUTURES' | 'HIGH_CONF' | 'WORKING';

export const SignalFeed: React.FC<SignalFeedProps> = ({ signals, marketData }) => {
    const { theme } = useUser();
    const [activeTab, setActiveTab] = useState<Tab>('ALL');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    const isLight = theme === 'corporate' || theme === 'labs';

    // Helper to calculate PnL
    const getPnL = (sig: Signal) => {
        const ticker = marketData[sig.symbol];
        if (!ticker) return 0;

        const currentPrice = ticker.lastPrice;
        const entryPrice = sig.price;
        const rawChange = ((currentPrice - entryPrice) / entryPrice) * 100;

        return (sig.side === 'BUY' || sig.side === 'LONG') ? rawChange : -rawChange;
    };

    const workingSignalsCount = useMemo(() => {
        return signals.filter(s => getPnL(s) >= 2.0).length;
    }, [signals, marketData]);

    const filteredSignals = useMemo(() => {
        return signals.filter(sig => {
            const searchMatch = sig.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
                sig.strategy.toLowerCase().includes(searchTerm.toLowerCase());
            if (!searchMatch) return false;

            if (activeTab === 'ALL') return true;

            const isFutures = sig.strategy === 'SmartMoney_Divergence' ||
                sig.strategy.includes('Funding') ||
                sig.source === 'ALGO';

            if (activeTab === 'FUTURES') return isFutures;
            if (activeTab === 'SPOT') return !isFutures;
            if (activeTab === 'HIGH_CONF') return (sig.confidence || 0) >= 0.8;
            if (activeTab === 'WORKING') return getPnL(sig) >= 2.0;

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
        if (conf >= 0.9) return isLight ? 'bg-violet-500' : 'bg-purple-500';
        if (conf >= 0.7) return isLight ? 'bg-emerald-500' : 'bg-emerald-500';
        if (conf >= 0.5) return isLight ? 'bg-amber-500' : 'bg-amber-500';
        return isLight ? 'bg-gray-300' : 'bg-gray-600';
    };

    const tabs: { key: Tab; label: string; icon: any }[] = [
        { key: 'ALL', label: 'All Signals', icon: Zap },
        { key: 'SPOT', label: 'Spot', icon: Activity },
        { key: 'FUTURES', label: 'Futures', icon: TrendingUp },
        { key: 'HIGH_CONF', label: 'High Confidence', icon: Target },
        { key: 'WORKING', label: `Winning (${workingSignalsCount})`, icon: CheckCircle2 }
    ];

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
                            <Sparkles size={20} className={isLight ? 'text-violet-600' : 'text-purple-400'} />
                        </div>
                        <div>
                            <h3 className={`text-lg font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>Signal Intelligence</h3>
                            <p className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-500'}`}>{signals.length} total signals</p>
                        </div>
                    </div>

                    {/* Working Signals Badge */}
                    {workingSignalsCount > 0 && (
                        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${isLight ? 'bg-emerald-100 border border-emerald-200' : 'bg-emerald-500/10 border border-emerald-500/20'
                            }`}>
                            <CheckCircle2 size={16} className={isLight ? 'text-emerald-600' : 'text-emerald-400'} />
                            <span className={`text-sm font-bold ${isLight ? 'text-emerald-700' : 'text-emerald-400'}`}>
                                {workingSignalsCount} Winning
                            </span>
                        </div>
                    )}
                </div>

                {/* Search */}
                <div className="relative mb-4">
                    <Search className={`absolute left-3 top-1/2 -translate-y-1/2 ${isLight ? 'text-gray-400' : 'text-gray-600'}`} size={16} />
                    <input
                        type="text"
                        placeholder="Search signals..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        aria-label="Search signals"
                        className={`w-full ${isLight
                                ? 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-violet-500 focus:ring-violet-500/20'
                                : 'bg-black/40 border-white/10 text-white placeholder:text-gray-600 focus:border-purple-500/50 focus:ring-purple-500/20'
                            } border rounded-xl pl-10 pr-4 py-3 text-sm outline-none focus:ring-2 transition-all`}
                    />
                </div>

                {/* Tabs */}
                <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
                    {tabs.map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${activeTab === tab.key
                                    ? isLight
                                        ? 'bg-violet-100 text-violet-700'
                                        : 'bg-gradient-to-r from-purple-500/20 to-violet-500/20 text-purple-300 border border-purple-500/30'
                                    : isLight
                                        ? 'text-gray-600 hover:bg-gray-100'
                                        : 'text-gray-500 hover:bg-white/5'
                                }`}
                        >
                            <tab.icon size={14} />
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Signals List */}
            <div className="flex-1 overflow-y-auto">
                {filteredSignals.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full p-12">
                        <div className={`p-4 rounded-2xl mb-4 ${isLight ? 'bg-gray-100' : 'bg-white/5'}`}>
                            <Zap size={32} className={isLight ? 'text-gray-400' : 'text-gray-600'} />
                        </div>
                        <h4 className={`text-lg font-bold mb-2 ${isLight ? 'text-gray-700' : 'text-gray-400'}`}>No Signals Found</h4>
                        <p className={`text-sm ${isLight ? 'text-gray-500' : 'text-gray-600'} text-center max-w-sm`}>
                            Signals will appear here as market conditions trigger our algorithms. Try adjusting your filters.
                        </p>
                    </div>
                ) : (
                    <div>
                        {filteredSignals.map((sig, idx) => {
                            const isExpanded = expandedId === sig.id;
                            const isBuy = sig.side === 'BUY' || sig.side === 'LONG';
                            const symbolBase = sig.symbol.replace('USDT', '');
                            const iconUrl = `https://assets.coincap.io/assets/icons/${symbolBase.toLowerCase()}@2x.png`;
                            const confidence = sig.confidence || 0.5;
                            const pnl = getPnL(sig);
                            const isWinning = pnl >= 2.0;

                            const isFutures = sig.strategy.includes('Funding') || sig.strategy.includes('Divergence');
                            const tvLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${sig.symbol}${isFutures ? '.P' : ''}`;
                            const binanceLink = isFutures
                                ? `https://www.binance.com/en/futures/${sig.symbol}`
                                : `https://www.binance.com/en/trade/${symbolBase}_USDT`;

                            return (
                                <motion.div
                                    key={sig.id}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: idx * 0.02, duration: 0.3 }}
                                    className={`border-b ${isLight ? 'border-gray-100' : 'border-white/5'}`}
                                >
                                    <div
                                        onClick={() => toggleExpand(sig.id)}
                                        className={`px-6 py-4 cursor-pointer transition-all ${isExpanded
                                                ? isLight ? 'bg-gray-50' : 'bg-white/[0.02]'
                                                : isLight ? 'hover:bg-gray-50' : 'hover:bg-white/[0.02]'
                                            }`}
                                    >
                                        <div className="flex items-center justify-between">
                                            {/* Left: Icon + Symbol + Strategy */}
                                            <div className="flex items-center gap-4 flex-1">
                                                <div className={`w-10 h-10 rounded-full overflow-hidden ${isLight ? 'bg-gray-100' : 'bg-white/5'}`}>
                                                    <img src={iconUrl} className="w-full h-full object-cover" onError={(e) => e.currentTarget.style.display = 'none'} alt={symbolBase} />
                                                </div>
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-3">
                                                        <span className={`text-base font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>{symbolBase}</span>
                                                        <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${isBuy
                                                                ? isLight ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-500/10 text-emerald-400'
                                                                : isLight ? 'bg-red-100 text-red-700' : 'bg-red-500/10 text-red-400'
                                                            }`}>
                                                            {sig.side}
                                                        </span>
                                                        {isWinning && (
                                                            <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${isLight ? 'bg-violet-100 text-violet-700' : 'bg-purple-500/10 text-purple-400'
                                                                }`}>
                                                                +{pnl.toFixed(2)}%
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <span className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-600'}`}>{sig.strategy}</span>
                                                        <span className={`text-xs ${isLight ? 'text-gray-400' : 'text-gray-700'}`}>•</span>
                                                        <span className={`text-xs font-mono ${isLight ? 'text-gray-500' : 'text-gray-600'}`}>{formatTime(sig.time)}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Right: Confidence + Expand Icon */}
                                            <div className="flex items-center gap-3">
                                                {!isWinning && (
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-600'}`}>Confidence</span>
                                                        <div className={`w-16 h-2 rounded-full overflow-hidden ${isLight ? 'bg-gray-200' : 'bg-white/10'}`}>
                                                            <div
                                                                className={`h-full ${getConfidenceColor(confidence)} transition-all`}
                                                                style={{ width: `${confidence * 100}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                                <motion.div
                                                    animate={{ rotate: isExpanded ? 180 : 0 }}
                                                    transition={{ duration: 0.2 }}
                                                >
                                                    <ChevronDown size={20} className={isLight ? 'text-gray-400' : 'text-gray-600'} />
                                                </motion.div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Expanded Details */}
                                    <AnimatePresence>
                                        {isExpanded && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: 0.2 }}
                                                className={`overflow-hidden ${isLight ? 'bg-gray-50/50' : 'bg-white/[0.01]'}`}
                                            >
                                                <div className="px-6 py-4 space-y-4">
                                                    {/* Analysis Note */}
                                                    <div className={`p-4 rounded-xl ${isLight ? 'bg-white border border-gray-200' : 'bg-white/5 border border-white/10'}`}>
                                                        <div className="flex items-start gap-3">
                                                            <div className={`p-2 rounded-lg ${isLight ? 'bg-violet-100' : 'bg-purple-500/20'}`}>
                                                                <Activity size={16} className={isLight ? 'text-violet-600' : 'text-purple-400'} />
                                                            </div>
                                                            <div className="flex-1">
                                                                <h4 className={`text-sm font-bold mb-2 ${isLight ? 'text-gray-900' : 'text-white'}`}>Analysis Note</h4>
                                                                <p className={`text-sm leading-relaxed ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
                                                                    {sig.note || 'No specific algorithmic notes provided for this signal.'}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Stats Grid */}
                                                    <div className="grid grid-cols-3 gap-3">
                                                        <div className={`p-3 rounded-xl ${isLight ? 'bg-white border border-gray-200' : 'bg-white/5 border border-white/10'}`}>
                                                            <div className={`text-xs mb-1 ${isLight ? 'text-gray-500' : 'text-gray-600'}`}>Entry Price</div>
                                                            <div className={`text-sm font-mono font-bold ${isLight ? 'text-gray-900' : 'text-white'}`}>${sig.price}</div>
                                                        </div>
                                                        <div className={`p-3 rounded-xl ${isLight ? 'bg-white border border-gray-200' : 'bg-white/5 border border-white/10'}`}>
                                                            <div className={`text-xs mb-1 ${isLight ? 'text-gray-500' : 'text-gray-600'}`}>Current Price</div>
                                                            <div className={`text-sm font-mono font-bold ${pnl > 0
                                                                    ? isLight ? 'text-emerald-700' : 'text-emerald-400'
                                                                    : isLight ? 'text-red-700' : 'text-red-400'
                                                                }`}>
                                                                ${marketData[sig.symbol]?.lastPrice.toFixed(2) || '---'}
                                                            </div>
                                                        </div>
                                                        <div className={`p-3 rounded-xl ${isLight ? 'bg-white border border-gray-200' : 'bg-white/5 border border-white/10'}`}>
                                                            <div className={`text-xs mb-1 ${isLight ? 'text-gray-500' : 'text-gray-600'}`}>PnL</div>
                                                            <div className={`text-sm font-mono font-bold ${pnl > 0
                                                                    ? isLight ? 'text-emerald-700' : 'text-emerald-400'
                                                                    : isLight ? 'text-red-700' : 'text-red-400'
                                                                }`}>
                                                                {pnl > 0 ? '+' : ''}{pnl.toFixed(2)}%
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Action Buttons */}
                                                    <div className="flex gap-2">
                                                        <a
                                                            href={tvLink}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-sm transition-all ${isLight
                                                                    ? 'bg-white border border-gray-200 text-gray-700 hover:border-violet-300 hover:text-violet-600'
                                                                    : 'bg-white/5 border border-white/10 text-gray-300 hover:border-purple-500/30 hover:text-purple-400'
                                                                }`}
                                                        >
                                                            <LineChart size={16} />
                                                            TradingView
                                                        </a>
                                                        <a
                                                            href={binanceLink}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-sm transition-all ${isLight
                                                                    ? 'bg-white border border-gray-200 text-gray-700 hover:border-amber-300 hover:text-amber-600'
                                                                    : 'bg-white/5 border border-white/10 text-gray-300 hover:border-amber-500/30 hover:text-amber-400'
                                                                }`}
                                                        >
                                                            <ExternalLink size={16} />
                                                            Binance
                                                        </a>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </motion.div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};
