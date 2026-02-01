import React, { useState, useEffect, useMemo } from 'react';
import { useSignals } from '../context/SignalContext';
import { BigMoveSignal } from '../types';
import { formatPrice } from '../utils/formatters';
import { ArrowUpRight, ArrowDownRight, Activity, TrendingUp, TrendingDown, Clock, Zap, AlertTriangle, PlayCircle, PauseCircle, Filter, Link, BarChart2, Globe, Search } from 'lucide-react';

export const BigMoveRadar: React.FC = () => {
    const { bigMoves } = useSignals();
    const [isPaused, setIsPaused] = useState(false);
    const [filterType, setFilterType] = useState<'ALL' | 'RISE' | 'FALL' | 'HIGH' | 'LOW' | 'PULLBACK' | 'RALLY'>('ALL');
    const [filterLevel, setFilterLevel] = useState<'ALL' | 'HIGH' | 'MID' | 'SMALL'>('ALL');
    const [searchQuery, setSearchQuery] = useState('');
    const [isHovering, setIsHovering] = useState(false);

    const filteredMoves = useMemo(() => {
        let filtered = bigMoves;

        if (searchQuery) {
            filtered = filtered.filter(m => m.symbol.toLowerCase().includes(searchQuery.toLowerCase()));
        }

        if (filterType !== 'ALL') {
            filtered = filtered.filter(m => m.type === filterType);
        }

        if (filterLevel !== 'ALL') {
            filtered = filtered.filter(m => m.level === filterLevel);
        }

        return filtered;
    }, [bigMoves, filterType, filterLevel, searchQuery]);

    const [displayMoves, setDisplayMoves] = useState<BigMoveSignal[]>([]);

    useEffect(() => {
        if (!isPaused && !isHovering) {
            setDisplayMoves(filteredMoves);
        }
    }, [filteredMoves, isPaused, isHovering]);

    const getIcon = (type: BigMoveSignal['type']) => {
        switch (type) {
            case 'RISE': return <TrendingUp size={12} className="text-emerald-400" />;
            case 'FALL': return <TrendingDown size={12} className="text-rose-400" />;
            case 'HIGH': return <ArrowUpRight size={12} className="text-amber-400" />;
            case 'LOW': return <ArrowDownRight size={12} className="text-purple-400" />;
            case 'PULLBACK': return <Activity size={12} className="text-orange-400" />;
            case 'RALLY': return <Activity size={12} className="text-blue-400" />;
            case 'VOL_SPIKE': return <Zap size={12} className="text-yellow-400" />;
            default: return <AlertTriangle size={12} className="text-gray-400" />;
        }
    };

    const getLevelColor = (level: BigMoveSignal['level']) => {
        switch (level) {
            case 'HIGH': return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
            case 'MID': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
            case 'SMALL': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
            default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
        }
    };

    const getCardIntensity = (level: BigMoveSignal['level']) => {
        switch (level) {
            case 'HIGH': return 'border-white/10 bg-gradient-to-br from-amber-500/30 to-yellow-500/20 animate-pulse';
            case 'MID': return 'border-white/10 bg-gradient-to-br from-amber-500/20 to-yellow-500/12';
            case 'SMALL': return 'border-white/10 bg-gradient-to-br from-amber-500/12 to-yellow-500/6';
            default: return 'border-white/5 bg-white/5';
        }
    };

    return (
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-lg flex flex-col overflow-hidden shadow-[0_0_40px_rgba(251,191,36,0.1)] h-full">
            {/* Header */}
            <div className="p-2 border-b border-white/10 bg-gradient-to-r from-amber-600/20 to-orange-600/20 flex items-center gap-2 overflow-x-auto scrollbar-none">
                <div className="flex items-center gap-2 shrink-0">
                    <div className="relative">
                        <div className="absolute inset-0 bg-amber-500/30 rounded-full animate-ping"></div>
                        <Activity size={16} className="text-amber-400 relative z-10" />
                    </div>
                    <span className="font-bold text-sm text-gray-200 whitespace-nowrap">Spot Big Move</span>
                </div>

                {/* Search Bar */}
                <div className="relative w-24 shrink-0 mx-1">
                    <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                        type="text"
                        placeholder="Search..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-black/20 border border-white/10 rounded px-2 py-1 pl-6 text-[10px] text-gray-300 placeholder-gray-500 focus:outline-none focus:border-amber-500/50 transition-colors"
                    />
                </div>

                <div className="h-4 w-px bg-white/10 shrink-0" />

                {/* Filter Buttons - Single Row */}
                <div className="flex items-center gap-1 shrink-0">
                    {['ALL', 'RISE', 'FALL', 'HIGH', 'LOW'].map((type) => (
                        <button
                            key={type}
                            onClick={() => setFilterType(type as any)}
                            className={`px-1.5 py-0 text-[8px] font-bold rounded transition-all whitespace-nowrap ${filterType === type
                                ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50'
                                : 'bg-white/5 text-gray-500 hover:text-gray-300'}`}
                        >
                            {type}
                        </button>
                    ))}
                </div>

                <div className="h-4 w-px bg-white/10 shrink-0" />

                <div className="flex items-center gap-1 shrink-0">
                    {['ALL', 'HIGH', 'MID', 'SMALL'].map((level) => (
                        <button
                            key={level}
                            onClick={() => setFilterLevel(level as any)}
                            className={`px-1.5 py-0 text-[8px] font-bold rounded transition-all whitespace-nowrap ${filterLevel === level
                                ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50'
                                : 'bg-white/5 text-gray-500 hover:text-gray-300'}`}
                        >
                            {level}
                        </button>
                    ))}
                </div>

                <div className="flex-1" />

                <button
                    onClick={() => setIsPaused(!isPaused)}
                    className="text-gray-400 hover:text-white transition-colors shrink-0"
                    title={isPaused ? "Resume Updates" : "Pause Updates"}
                >
                    {isPaused ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
                </button>
            </div>

            {/* List */}
            <div
                className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
                onMouseEnter={() => setIsHovering(true)}
                onMouseLeave={() => setIsHovering(false)}
            >
                {displayMoves.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-600 p-4 text-center">
                        <Filter size={24} className="mb-2 opacity-30" />
                        <p className="text-xs">No moves found</p>
                        <p className="text-[10px] mt-1 text-gray-700">Adjust filters or wait for signals.</p>
                    </div>
                ) : (
                    displayMoves.map((move) => (
                        <div
                            key={move.id}
                            onClick={() => {
                                const symbol = move.symbol.replace('USDT', '_USDT');
                                window.open(`https://www.binance.com/en/trade/${symbol}?type=spot`, '_blank');
                            }}
                            className={`p-1.5 rounded-lg border hover:scale-[1.01] transition-all group animate-in slide-in-from-left-2 duration-300 cursor-pointer ${getCardIntensity(move.level)}`}
                        >
                            <div className="flex justify-between items-start mb-1">
                                <div className="flex items-center gap-1">
                                    <div className={`p-0.5 rounded-full bg-white/5 group-hover:scale-110 transition-transform`}>
                                        {getIcon(move.type)}
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-1">
                                            <span className="font-bold text-[10px] text-gray-200">{move.symbol.replace('USDT', '')}</span>
                                            <span className={`text-[9px] font-bold px-1.5 py-0 rounded border ${getLevelColor(move.level)}`}>
                                                {move.level}
                                            </span>
                                        </div>
                                        <div className="text-[9px] text-gray-400">{move.description}</div>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end">
                                    <span className="text-[10px] font-mono font-medium text-gray-300">
                                        ${formatPrice(move.price)}
                                    </span>
                                    <span className="text-[9px] text-gray-600 flex items-center gap-1">
                                        <Clock size={8} />
                                        {new Date(move.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                    </span>
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex justify-end gap-1 mt-1 pt-1 border-t border-white/5" onClick={(e) => e.stopPropagation()}>
                                <button
                                    onClick={() => window.open(`https://www.binance.com/en/trade/${move.symbol.replace('USDT', '_USDT')}?type=spot`, '_blank')}
                                    className="p-1 hover:bg-white/10 rounded text-gray-500 hover:text-amber-400 transition-colors"
                                    title="Binance Spot"
                                >
                                    <Link size={10} />
                                </button>
                                <button
                                    onClick={() => window.open(`https://www.tradingview.com/chart/?symbol=BINANCE:${move.symbol}`, '_blank')}
                                    className="p-1 hover:bg-white/10 rounded text-gray-500 hover:text-blue-400 transition-colors"
                                    title="TradingView"
                                >
                                    <BarChart2 size={10} />
                                </button>
                                <button
                                    onClick={() => window.open(`https://coinmarketcap.com/currencies/search/?q=${move.symbol.replace('USDT', '')}`, '_blank')}
                                    className="p-1 hover:bg-white/10 rounded text-gray-500 hover:text-blue-500 transition-colors"
                                    title="CoinMarketCap"
                                >
                                    <Globe size={10} />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div >
        </div >
    );
};
