import React, { useState } from 'react';
import { useSignals } from '../context/SignalContext';
import { DetectedPattern } from '../services/patternScanner';
import { Flag, TrendingUp, TrendingDown, BarChart2, Link, Globe } from 'lucide-react';
import { PatternPreviewModal } from './PatternPreviewModal';

const ROW_ACTION =
    'grid h-6 w-6 place-items-center rounded-sm text-secondary transition-colors hover:bg-surface-highlight hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary';

export const PatternRadar: React.FC = () => {
    const { patterns } = useSignals();
    const [selectedPattern, setSelectedPattern] = useState<DetectedPattern | null>(null);

    const getPatternIcon = (pattern: DetectedPattern['pattern']) => {
        switch (pattern) {
            case 'BULL_FLAG': return <TrendingUp size={12} className="shrink-0 text-success" />;
            case 'BEAR_FLAG': return <TrendingDown size={12} className="shrink-0 text-danger" />;
            default: return <Flag size={12} className="shrink-0 text-secondary" />;
        }
    };

    const getPatternColor = (pattern: DetectedPattern['pattern']) => {
        switch (pattern) {
            case 'BULL_FLAG': return 'bg-success-soft text-success';
            case 'BEAR_FLAG': return 'bg-danger-soft text-danger';
            default: return 'bg-surface-secondary text-secondary';
        }
    };

    return (
        <div lang="tr" className="flex h-full min-h-0 flex-1 flex-col">
            {/* Header is handled by the parent tab system now */}

            <div className="min-h-0 flex-1 overflow-y-auto">
                {patterns.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-1 px-3 py-8 text-center text-xs text-muted">
                        <Flag size={14} />
                        <p>Kayıt yok</p>
                        <p className="text-[11px]">15 dk mumlarda bayrak formasyonu aranıyor; aynı formasyon bir kez listelenir.</p>
                    </div>
                ) : (
                    patterns.map((pattern) => (
                        <div
                            key={pattern.id}
                            onClick={() => setSelectedPattern(pattern)}
                            className="cursor-pointer border-b border-border px-3 py-1 text-xs hover:bg-surface-secondary"
                        >
                            <div className="flex items-center gap-1.5">
                                {getPatternIcon(pattern.pattern)}
                                <span className="truncate font-medium text-text">{pattern.symbol.replace('USDT', '')}</span>
                                <span className="shrink-0 rounded-sm bg-surface-secondary px-1.5 py-0.5 font-mono text-[10px] font-semibold text-secondary">
                                    {pattern.timeframe}
                                </span>
                                <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase ${getPatternColor(pattern.pattern)}`}>
                                    {pattern.pattern.replace('_', ' ')}
                                </span>
                            </div>

                            <div className="flex items-center gap-2">
                                <p className="min-w-0 flex-1 text-[11px] leading-snug text-secondary">{pattern.description}</p>
                                <span className="shrink-0 font-mono text-[10px] text-muted">
                                    {new Date(pattern.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>

                                {/* Action Buttons */}
                                <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
                                    <button
                                        onClick={() => window.open(`https://www.binance.com/en/trade/${pattern.symbol.replace('USDT', '_USDT')}?type=spot`, '_blank')}
                                        className={ROW_ACTION}
                                        title="Binance Spot"
                                    >
                                        <Link size={12} />
                                    </button>
                                    <button
                                        onClick={() => window.open(`https://www.tradingview.com/chart/?symbol=BINANCE:${pattern.symbol}`, '_blank')}
                                        className={ROW_ACTION}
                                        title="TradingView"
                                    >
                                        <BarChart2 size={12} />
                                    </button>
                                    <button
                                        onClick={() => window.open(`https://coinmarketcap.com/currencies/search/?q=${pattern.symbol.replace('USDT', '')}`, '_blank')}
                                        className={ROW_ACTION}
                                        title="CoinMarketCap"
                                    >
                                        <Globe size={12} />
                                    </button>
                                </div>
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
