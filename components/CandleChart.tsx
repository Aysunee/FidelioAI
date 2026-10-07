import React, { useEffect, useRef, useState } from 'react';
import { useUser } from '../context/UserContext';
import { Loader2, TriangleAlert } from 'lucide-react';
import { isLightTheme } from '../utils/themeMode';

interface CandleChartProps {
    symbol: string;
    id?: string;
}

declare global {
    interface Window {
        TradingView: any;
    }
}

const SCRIPT_ID = 'tradingview-widget-script';
const SCRIPT_SRC = 'https://s3.tradingview.com/tv.js';
// If the widget iframe never reports "load", stop showing the spinner after this long
const LOADING_FALLBACK_MS = 10000;

// The TradingView widget needs concrete colours: read them from the theme tokens (index.css)
// so the chart always matches the panels around it.
const readToken = (name: string, fallback: string): string => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
    const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
};

export const CandleChart: React.FC<CandleChartProps> = ({ symbol, id }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const { theme } = useUser();
    const chartId = useRef(id || `tradingview_${symbol}_${Math.random().toString(36).substring(7)}`).current;
    const widgetRef = useRef<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Every theme except 'dark' is a light UI (see utils/themeMode).
    const isLightUi = isLightTheme(theme);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof document === 'undefined') return;

        let mounted = true;
        let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
        let observedScript: HTMLScriptElement | null = null;

        setIsLoading(true);
        setLoadError(null);

        const markReady = () => {
            if (mounted) setIsLoading(false);
        };

        const showScriptError = () => {
            if (!mounted) return;
            setIsLoading(false);
            setLoadError('Grafik yüklenemedi. Reklam engelleyiciyi veya internet bağlantınızı kontrol edip sayfayı yenileyin.');
        };

        // Real 'error' event: the request definitely failed, so later mounts should retry with a fresh tag
        const handleScriptError = () => {
            if (observedScript) observedScript.dataset.failed = 'true';
            showScriptError();
        };

        const initWidget = () => {
            if (!mounted || !containerRef.current || !window.TradingView) return;

            containerRef.current.innerHTML = '';

            // Concrete colours for the widget, taken from the active theme's tokens
            const surface = readToken('--bg-surface', isLightUi ? '#FFFFFF' : '#11151A');
            const gridLine = readToken('--color-border', isLightUi ? '#DFE3E8' : '#222832');
            const axisText = readToken('--color-text-secondary', isLightUi ? '#5A6472' : '#8A94A6');
            const upColor = readToken('--color-success', isLightUi ? '#0A9F68' : '#0ECB81');
            const downColor = readToken('--color-danger', isLightUi ? '#D9304A' : '#F6465D');

            try {
                widgetRef.current = new window.TradingView.widget({
                    autosize: true,
                    width: '100%',
                    height: '100%',
                    symbol: `BINANCE:${symbol}`,
                    interval: '15',
                    timezone: 'Etc/UTC',
                    theme: isLightUi ? 'light' : 'dark',
                    style: '1',
                    locale: 'en',
                    toolbar_bg: surface,
                    enable_publishing: false,
                    allow_symbol_change: true,
                    // The embedded widget's top toolbar renders as an empty strip above the chart; the
                    // date-range bar at the bottom (withdateranges) still switches the timeframe.
                    hide_top_toolbar: true,
                    hide_side_toolbar: false,
                    withdateranges: true,
                    save_image: true,
                    container_id: chartId,
                    disabled_features: [
                        'header_symbol_search',
                        'header_compare',
                        'display_market_status',
                    ],
                    enabled_features: [
                        'use_localstorage_for_settings',
                        'study_templates',
                        'header_resolutions',
                        'header_chart_type',
                        'header_indicators',
                        'side_toolbar_in_fullscreen_mode',
                        'left_toolbar',
                    ],
                    overrides: {
                        "paneProperties.background": surface,
                        "paneProperties.vertGridProperties.color": gridLine,
                        "paneProperties.horzGridProperties.color": gridLine,
                        "scalesProperties.textColor": axisText,
                        "mainSeriesProperties.candleStyle.upColor": upColor,
                        "mainSeriesProperties.candleStyle.downColor": downColor,
                        "mainSeriesProperties.candleStyle.drawWick": true,
                        "mainSeriesProperties.candleStyle.drawBorder": true,
                        "mainSeriesProperties.candleStyle.borderColor": upColor,
                        "mainSeriesProperties.candleStyle.borderUpColor": upColor,
                        "mainSeriesProperties.candleStyle.borderDownColor": downColor,
                        "mainSeriesProperties.candleStyle.wickUpColor": upColor,
                        "mainSeriesProperties.candleStyle.wickDownColor": downColor,
                    }
                });

                // The script may arrive after the timeout already showed an error (slow network): clear it
                if (mounted) setLoadError(null);

                // Hide the spinner when the widget iframe has actually loaded (with a fallback timeout)
                const iframe = containerRef.current?.querySelector('iframe');
                if (iframe) iframe.addEventListener('load', markReady, { once: true });
                if (fallbackTimer) clearTimeout(fallbackTimer);
                fallbackTimer = setTimeout(markReady, LOADING_FALLBACK_MS);
            } catch (error) {
                console.error('TradingView widget error:', error);
                if (mounted) {
                    setIsLoading(false);
                    setLoadError('Grafik başlatılamadı. Lütfen sayfayı yenileyin.');
                }
            }
        };

        if (window.TradingView) {
            // <html> receives its theme class in UserProvider's effect, which runs after this (child)
            // effect. Starting in a microtask makes sure the tokens read above belong to the new theme.
            queueMicrotask(initWidget);
        } else {
            let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;

            // A previous attempt failed (adblock / network): drop it and retry
            if (script && script.dataset.failed === 'true') {
                script.remove();
                script = null;
            }

            if (!script) {
                const newScript = document.createElement('script');
                newScript.id = SCRIPT_ID;
                newScript.src = SCRIPT_SRC;
                newScript.async = true;
                // Permanent flag so later mounts know this attempt failed
                newScript.addEventListener('error', () => { newScript.dataset.failed = 'true'; });
                document.head.appendChild(newScript);
                script = newScript;
            }

            observedScript = script;
            script.addEventListener('load', initWidget);
            script.addEventListener('error', handleScriptError);

            // Script never arrived (blocked request that fires no event, very slow network...).
            // Only show the message: the script may still load, so it is NOT marked as failed here
            // (the 'load' listener stays attached and initWidget clears the error if it does).
            fallbackTimer = setTimeout(() => {
                if (!window.TradingView) showScriptError();
            }, LOADING_FALLBACK_MS * 2);
        }

        return () => {
            mounted = false;
            if (fallbackTimer) clearTimeout(fallbackTimer);
            if (observedScript) {
                observedScript.removeEventListener('load', initWidget);
                observedScript.removeEventListener('error', handleScriptError);
            }
            // The container is cleared on the next init
        };
    }, [symbol, theme, isLightUi, chartId]);

    return (
        <div className="relative h-full w-full bg-surface">
            {isLoading && !loadError && (
                <div className="absolute inset-0 z-10 flex items-center justify-center">
                    <Loader2 className="animate-spin text-secondary" size={14} />
                </div>
            )}
            {loadError && (
                <div className="absolute inset-0 z-10 flex items-center justify-center gap-1.5 p-4 text-center">
                    <TriangleAlert size={14} className="shrink-0 text-danger" />
                    <p className="text-xs text-secondary">{loadError}</p>
                </div>
            )}
            <div
                id={chartId}
                ref={containerRef}
                className="h-full w-full"
            />
        </div>
    );
};
