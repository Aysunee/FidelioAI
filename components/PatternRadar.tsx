import React, { useState } from 'react';
import { useSignals } from '../context/SignalContext';
import { DetectedPattern } from '../services/patternScanner';
import { Flag, TrendingUp, TrendingDown, Clock, BarChart2, Link, Globe } from 'lucide-react';
import { formatPrice } from '../utils/formatters';
import { PatternPreviewModal } from './PatternPreviewModal';

export const PatternRadar: React.FC = () => {
    const { patterns } = useSignals();
    const [selectedPattern, setSelectedPattern] = useState<DetectedPattern | null>(null);

    const getPatternIcon = (pattern: DetectedPattern['pattern']) => {
        switch (pattern) {
            case 'BULL_FLAG': return <TrendingUp size={16} className="text-emerald-400" />;
            case 'BEAR_FLAG': return <TrendingDown size={16} className="text-rose-400" />;
            default: return <Flag size={16} className="text-gray-400" />;
        }
    };

    const getPatternColor = (pattern: DetectedPattern['pattern']) => {
        switch (pattern) {
            case 'BULL_FLAG': return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400';
            case 'BEAR_FLAG': return 'border-rose-500/30 bg-rose-500/10 text-rose-400';
            default: return 'border-gray-500/30 bg-gray-500/10 text-gray-400';
        }
    };

    return (
        <div className="h-full flex flex-col">
            {/* Header is handled by the parent tab system now */}

            <div className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                {patterns.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-500 p-4 text-center">
                        <Flag size={24} className="mb-2 opacity-30" />
                        <p className="text-xs">No patterns detected</p>
                        <p className="text-[10px] mt-1 text-gray-600">Scanning for flags & pennants...</p>
                    </div>
                ) : (
                    patterns.map((pattern) => (
                        <div
                            key={pattern.id}
                            onClick={() => setSelectedPattern(pattern)}
                            className={`p-3 rounded-lg border hover:scale-[1.02] transition-all group animate-in slide-in-from-left-2 duration-300 cursor-pointer ${getPatternColor(pattern.pattern)}`}
                        >
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex items-center gap-2">
                                    <div className="p-1.5 rounded-full bg-white/5">
                                        {getPatternIcon(pattern.pattern)}
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-sm text-gray-200">{pattern.symbol.replace('USDT', '')}</span>
                                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/20 border border-white/5">
                                                {pattern.timeframe}
                                            </span>
                                        </div>
                                        <div className="text-[11px] opacity-80 font-medium">
                                            {pattern.pattern.replace('_', ' ')}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-xs font-bold opacity-90">{pattern.confidence}% Conf.</div>
                                    <div className="text-[10px] opacity-60 flex items-center justify-end gap-1 mt-0.5">
                                        <Clock size={8} />
                                        {new Date(pattern.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                </div>
                            </div>

                            <div className="text-[10px] opacity-70 mb-2 pl-1 border-l-2 border-white/10">
                                {pattern.description}
                            </div>

                            {/* Action Buttons */}
                            <div className="flex justify-end gap-1 pt-2 border-t border-white/5" onClick={(e) => e.stopPropagation()}>
                                <button
                                    onClick={() => window.open(`https://www.binance.com/en/trade/${pattern.symbol.replace('USDT', '_USDT')}?type=spot`, '_blank')}
                                    className="p-1.5 hover:bg-white/10 rounded text-gray-400 hover:text-amber-400 transition-colors"
                                    title="Binance Spot"
                                >
                                    <Link size={12} />
                                </button>
                                <button
                                    onClick={() => window.open(`https://www.tradingview.com/chart/?symbol=BINANCE:${pattern.symbol}`, '_blank')}
                                    className="p-1.5 hover:bg-white/10 rounded text-gray-400 hover:text-blue-400 transition-colors"
                                    title="TradingView"
                                >
                                    <BarChart2 size={12} />
                                </button>
                                <button
                                    onClick={() => window.open(`https://coinmarketcap.com/currencies/search/?q=${pattern.symbol.replace('USDT', '')}`, '_blank')}
                                    className="p-1.5 hover:bg-white/10 rounded text-gray-400 hover:text-blue-500 transition-colors"
                                    title="CoinMarketCap"
                                >
                                    <Globe size={12} />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <PatternPreviewModal
                isOpen={!!selectedPattern}
                onClose={() => setSelectedPattern(null)}
                pattern={selectedPattern}
            />
        </div>
    );
};
