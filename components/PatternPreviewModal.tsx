import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, Time, CandlestickSeries } from 'lightweight-charts';
import { DetectedPattern } from '../services/patternScanner';
import { X, TrendingUp, TrendingDown } from 'lucide-react';

interface PatternPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    pattern: DetectedPattern | null;
}

export const PatternPreviewModal: React.FC<PatternPreviewModalProps> = ({ isOpen, onClose, pattern }) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!isOpen || !pattern || !chartContainerRef.current) return;

        // Initialize Chart
        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: '#000000' },
                textColor: '#d1d5db',
            },
            grid: {
                vertLines: { color: '#1f2937' },
                horzLines: { color: '#1f2937' },
            },
            width: chartContainerRef.current.clientWidth,
            height: 400,
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
            },
        });

        const candlestickSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#10b981',
            downColor: '#f43f5e',
            borderVisible: false,
            wickUpColor: '#10b981',
            wickDownColor: '#f43f5e',
        });

        chartRef.current = chart;
        seriesRef.current = candlestickSeries;

        // Fetch Data
        const fetchData = async () => {
            setLoading(true);
            try {
                // Fetch 100 candles to show context
                const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${pattern.symbol}&interval=${pattern.timeframe}&limit=100`);
                const data = await response.json();

                const candles = data.map((d: any) => ({
                    time: d[0] / 1000 as Time,
                    open: parseFloat(d[1]),
                    high: parseFloat(d[2]),
                    low: parseFloat(d[3]),
                    close: parseFloat(d[4]),
                }));

                candlestickSeries.setData(candles);

                // Add Marker
                // We place the marker at the detected time (which is usually the last candle or close to it)
                const markerTime = pattern.timestamp / 1000 as Time;

                (candlestickSeries as any).setMarkers([
                    {
                        time: markerTime,
                        position: pattern.pattern === 'BULL_FLAG' ? 'belowBar' : 'aboveBar',
                        color: pattern.pattern === 'BULL_FLAG' ? '#10b981' : '#f43f5e',
                        shape: pattern.pattern === 'BULL_FLAG' ? 'arrowUp' : 'arrowDown',
                        text: pattern.pattern.replace('_', ' '),
                    }
                ]);

                chart.timeScale().fitContent();
            } catch (error) {
                console.error('Failed to fetch chart data', error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();

        const handleResize = () => {
            if (chartContainerRef.current) {
                chart.applyOptions({ width: chartContainerRef.current.clientWidth });
            }
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, [isOpen, pattern]);

    if (!isOpen || !pattern) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-zinc-900 border border-white/10 rounded-xl w-full max-w-3xl overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10 bg-zinc-900">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${pattern.pattern === 'BULL_FLAG' ? 'bg-emerald-500/20' : 'bg-rose-500/20'}`}>
                            {pattern.pattern === 'BULL_FLAG' ? <TrendingUp size={20} className="text-emerald-400" /> : <TrendingDown size={20} className="text-rose-400" />}
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                {pattern.symbol.replace('USDT', '')}
                                <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-white/10 text-gray-400">{pattern.timeframe}</span>
                            </h3>
                            <p className="text-xs text-gray-400">{pattern.pattern.replace('_', ' ')} Detected</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-gray-400 hover:text-white">
                        <X size={20} />
                    </button>
                </div>

                {/* Chart Container */}
                <div className="relative h-[400px] bg-black">
                    {loading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                        </div>
                    )}
                    <div ref={chartContainerRef} className="w-full h-full" />
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-white/10 bg-zinc-900 flex justify-between items-center">
                    <div className="text-xs text-gray-500">
                        Confidence: <span className="text-white font-bold">{pattern.confidence}%</span>
                    </div>
                    <div className="text-xs text-gray-500">
                        {pattern.description}
                    </div>
                </div>
            </div>
        </div>
    );
};
