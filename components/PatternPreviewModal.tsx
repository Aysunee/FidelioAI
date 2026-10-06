import React, { useEffect, useRef, useState } from 'react';
import { createChart, createSeriesMarkers, ColorType, IChartApi, ISeriesApi, Time, CandlestickSeries, CandlestickData } from 'lightweight-charts';
import { DetectedPattern } from '../services/patternScanner';
import { X, TrendingUp, TrendingDown, Loader2, TriangleAlert } from 'lucide-react';
import { formatTime } from '../utils/formatters';

interface PatternPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    pattern: DetectedPattern | null;
}

// lightweight-charts needs concrete colours: read them from the theme tokens (index.css).
const readToken = (name: string, fallback: string): string => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
    const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
};

export const PatternPreviewModal: React.FC<PatternPreviewModalProps> = ({ isOpen, onClose, pattern }) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen || !pattern || !chartContainerRef.current) return;

        let disposed = false;

        // Chart colours follow the active theme; the canvas is transparent so the panel shows through
        const textColor = readToken('--color-text-secondary', '#8A94A6');
        const gridColor = readToken('--color-border', '#222832');
        const upColor = readToken('--color-success', '#0ECB81');
        const downColor = readToken('--color-danger', '#F6465D');

        // Initialize Chart
        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor,
            },
            grid: {
                vertLines: { color: gridColor },
                horzLines: { color: gridColor },
            },
            width: chartContainerRef.current.clientWidth,
            height: 400,
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
            },
        });

        const candlestickSeries = chart.addSeries(CandlestickSeries, {
            upColor,
            downColor,
            borderVisible: false,
            wickUpColor: upColor,
            wickDownColor: downColor,
        });

        chartRef.current = chart;
        seriesRef.current = candlestickSeries;

        // Fetch Data
        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                // Fetch 100 candles to show context
                const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${pattern.symbol}&interval=${pattern.timeframe}&limit=100`);
                if (!response.ok) throw new Error(`Klines request failed (HTTP ${response.status})`);
                const data = await response.json();
                if (!Array.isArray(data)) throw new Error('Unexpected klines response');
                if (disposed) return;

                const candles: CandlestickData<Time>[] = data.map((d: any) => ({
                    time: d[0] / 1000 as Time,
                    open: parseFloat(d[1]),
                    high: parseFloat(d[2]),
                    low: parseFloat(d[3]),
                    close: parseFloat(d[4]),
                }));

                candlestickSeries.setData(candles);

                if (candles.length > 0) {
                    // lightweight-charts v5: markers are a plugin (series.setMarkers was removed).
                    // The detection timestamp is aligned to the open time of the candle that contains it.
                    const detectedAt = pattern.timestamp / 1000;
                    let markerCandle = candles[0];
                    for (const candle of candles) {
                        if ((candle.time as number) <= detectedAt) markerCandle = candle;
                        else break;
                    }

                    createSeriesMarkers(candlestickSeries, [
                        {
                            time: markerCandle.time,
                            position: pattern.pattern === 'BULL_FLAG' ? 'belowBar' : 'aboveBar',
                            color: pattern.pattern === 'BULL_FLAG' ? upColor : downColor,
                            shape: pattern.pattern === 'BULL_FLAG' ? 'arrowUp' : 'arrowDown',
                            text: pattern.pattern.replace('_', ' '),
                        }
                    ]);
                }

                chart.timeScale().fitContent();
            } catch (err) {
                console.error('[PatternPreviewModal] Chart could not be loaded', err);
                if (!disposed) setError('Grafik verisi yüklenemedi. Lütfen daha sonra tekrar deneyin.');
            } finally {
                if (!disposed) setLoading(false);
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
            disposed = true;
            window.removeEventListener('resize', handleResize);
            chart.remove();
            chartRef.current = null;
            seriesRef.current = null;
        };
    }, [isOpen, pattern]);

    if (!isOpen || !pattern) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-3xl overflow-hidden rounded-sm border border-border-strong bg-surface shadow-overlay animate-overlay-in">
                {/* Header */}
                <div className="flex h-9 items-center justify-between gap-2 border-b border-border pl-3 pr-1">
                    <div className="flex min-w-0 items-center gap-2">
                        {pattern.pattern === 'BULL_FLAG'
                            ? <TrendingUp size={14} className="shrink-0 text-success" />
                            : <TrendingDown size={14} className="shrink-0 text-danger" />}
                        <h3 className="flex shrink-0 items-center gap-2 text-xs font-semibold text-text">
                            {pattern.symbol.replace('USDT', '')}
                            <span className="rounded-sm bg-surface-secondary px-1.5 py-0.5 font-mono text-[10px] font-semibold text-secondary">{pattern.timeframe}</span>
                        </h3>
                        <p className="min-w-0 truncate text-[11px] text-secondary">{pattern.pattern.replace('_', ' ')} kuralı eşleşti</p>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Kapat"
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-secondary transition-colors hover:bg-surface-secondary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                    >
                        <X size={14} />
                    </button>
                </div>

                {/* Chart Container */}
                <div className="relative h-[400px] bg-surface">
                    {loading && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center">
                            <Loader2 size={14} className="animate-spin text-secondary" />
                        </div>
                    )}
                    {error && !loading && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center gap-1.5 bg-surface p-4 text-center">
                            <TriangleAlert size={14} className="shrink-0 text-danger" />
                            <p className="text-xs text-secondary">{error}</p>
                        </div>
                    )}
                    <div ref={chartContainerRef} className="h-full w-full" />
                </div>

                {/* Footer */}
                <div className="flex items-start justify-between gap-4 border-t border-border px-3 py-2 text-xs text-secondary">
                    <div className="shrink-0">
                        Tespit: <span className="font-mono font-semibold text-text">{formatTime(pattern.timestamp, false)}</span>
                    </div>
                    <div className="min-w-0 text-right">
                        {pattern.description}
                    </div>
                </div>
            </div>
        </div>
    );
};
