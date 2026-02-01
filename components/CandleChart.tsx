import React, { useEffect, useRef, useState } from 'react';
import { useUser } from '../context/UserContext';
import { Loader2 } from 'lucide-react';

interface CandleChartProps {
    symbol: string;
    id?: string;
}

declare global {
    interface Window {
        TradingView: any;
    }
}

export const CandleChart: React.FC<CandleChartProps> = ({ symbol, id }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const { theme } = useUser();
    const chartId = useRef(id || `tradingview_${symbol}_${Math.random().toString(36).substring(7)}`).current;
    const widgetRef = useRef<any>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let mounted = true;

        const initWidget = () => {
            if (!containerRef.current || !window.TradingView) return;

            // Cleanup previous widget
            if (widgetRef.current) {
                try {
                    // Some versions of the widget might have a remove method, or we just clear the container
                    // widgetRef.current.remove(); 
                } catch (e) {
                    console.error('Widget cleanup error:', e);
                }
            }

            containerRef.current.innerHTML = '';

            try {
                widgetRef.current = new window.TradingView.widget({
                    autosize: true,
                    width: '100%',
                    height: '100%',
                    symbol: `BINANCE:${symbol}`,
                    interval: '15',
                    timezone: 'Etc/UTC',
                    theme: theme === 'dark' ? 'dark' : 'light',
                    style: '1',
                    locale: 'en',
                    toolbar_bg: theme === 'dark' ? '#000000' : theme === 'corporate' ? '#FAFBFC' : '#f1f3f6',
                    enable_publishing: false,
                    allow_symbol_change: true,
                    hide_top_toolbar: false,
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
                        "paneProperties.background": theme === 'dark' ? "#000000" : theme === 'corporate' ? "#FAFBFC" : "#ffffff",
                        "paneProperties.vertGridProperties.color": theme === 'dark' ? "#1f2937" : theme === 'corporate' ? "#E5E7EB" : "#e5e7eb",
                        "paneProperties.horzGridProperties.color": theme === 'dark' ? "#1f2937" : theme === 'corporate' ? "#E5E7EB" : "#e5e7eb",
                        "scalesProperties.textColor": theme === 'dark' ? "#9ca3af" : theme === 'corporate' ? "#111827" : "#374151",
                        "mainSeriesProperties.candleStyle.upColor": theme === 'corporate' ? "#059669" : "#10B981",
                        "mainSeriesProperties.candleStyle.downColor": theme === 'corporate' ? "#DC2626" : "#EF4444",
                        "mainSeriesProperties.candleStyle.drawWick": true,
                        "mainSeriesProperties.candleStyle.drawBorder": true,
                        "mainSeriesProperties.candleStyle.borderColor": theme === 'corporate' ? "#059669" : "#10B981",
                        "mainSeriesProperties.candleStyle.borderUpColor": theme === 'corporate' ? "#059669" : "#10B981",
                        "mainSeriesProperties.candleStyle.borderDownColor": theme === 'corporate' ? "#DC2626" : "#EF4444",
                        "mainSeriesProperties.candleStyle.wickUpColor": theme === 'corporate' ? "#059669" : "#10B981",
                        "mainSeriesProperties.candleStyle.wickDownColor": theme === 'corporate' ? "#DC2626" : "#EF4444",
                    }
                });

                if (mounted) setIsLoading(false);
            } catch (error) {
                console.error('TradingView widget error:', error);
            }
        };

        if (window.TradingView) {
            initWidget();
        } else {
            const scriptId = 'tradingview-widget-script';
            const existingScript = document.getElementById(scriptId);

            if (existingScript) {
                existingScript.addEventListener('load', initWidget);
            } else {
                const script = document.createElement('script');
                script.id = scriptId;
                script.src = 'https://s3.tradingview.com/tv.js';
                script.async = true;
                script.onload = initWidget;
                document.head.appendChild(script);
            }
        }

        return () => {
            mounted = false;
            // No explicit cleanup needed as we clear innerHTML on next init
        };
    }, [symbol, theme, chartId]);

    return (
        <div className="relative w-full h-full bg-black/20">
            {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center z-10">
                    <Loader2 className="animate-spin text-purple-500" size={24} />
                </div>
            )}
            <div
                id={chartId}
                ref={containerRef}
                className="w-full h-full"
            />
        </div>
    );
};
