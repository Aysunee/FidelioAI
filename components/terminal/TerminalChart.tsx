import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
    ColorType,
    CrosshairMode,
    LineStyle,
    TickMarkType,
    createChart,
    type ChartOptions,
    type DeepPartial,
    type IChartApi,
    type Time,
} from 'lightweight-charts';
import { AlertTriangle, ChevronDown, Loader2, RefreshCw } from 'lucide-react';
import { useUser } from '../../context/UserContext';
import type { Candle, ChartInterval } from './types';
import { fetchKlines, getCachedKlines, subscribeKline } from './terminalData';
import { getChartPalette, themedIndicatorColor, type ChartPalette } from './chartTheme';
import { indicatorShortLabel, isPaneIndicator, useChartSettings, type ChartSettings } from './chartSettings';
import { ChartSeriesManager, indicatorColor } from './chartIndicators';
import { ChartSettingsButton } from './ChartSettingsPanel';
import { formatCompact } from './format';
import { CoinIcon } from './CoinIcon';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

// Binance weighs /fapi/v1/klines by limit: [100, 500) costs 2, [500, 1000] costs 5. 499 bars keep every
// symbol switch (3 charts) at weight 6 instead of 15.
const KLINE_LIMIT = 499;
const MAX_CANDLES = 1500; // live session cap for the in-memory candle buffer

const INTERVALS: ReadonlyArray<{ value: ChartInterval; label: string }> = [
    { value: '1m', label: '1m' },
    { value: '5m', label: '5m' },
    { value: '15m', label: '15m' },
    { value: '1h', label: '1H' },
    { value: '4h', label: '4H' },
    { value: '1d', label: '1D' },
];

const INTERVAL_SECONDS: Record<ChartInterval, number> = {
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '1h': 3600,
    '4h': 14400,
    '1d': 86400,
};

const MONTHS_TR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const DAYS_TR = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

const heuristicPrecision = (price: number): number => {
    const p = Math.abs(price);
    if (!Number.isFinite(p) || p === 0) return 4;
    if (p >= 1000) return 2;
    if (p >= 10) return 3;
    if (p >= 0.1) return 4;
    if (p >= 0.01) return 5;
    if (p >= 0.001) return 6;
    if (p >= 0.0001) return 7;
    return 8;
};

const decimalsOf = (n: number): number => {
    if (!Number.isFinite(n)) return 0;
    const s = String(n);
    if (s.includes('e')) return 99; // exponent form: let the heuristic decide
    const dot = s.indexOf('.');
    return dot < 0 ? 0 : s.length - dot - 1;
};

/** Price precision derived from the exchange-formatted prices (mirrors the contract tick size). */
const detectPrecision = (candles: Candle[]): number => {
    if (!candles.length) return 4;
    let d = 0;
    for (let i = Math.max(0, candles.length - 120); i < candles.length; i++) {
        const c = candles[i];
        d = Math.max(d, decimalsOf(c.open), decimalsOf(c.high), decimalsOf(c.low), decimalsOf(c.close));
    }
    if (d > 8) return heuristicPrecision(candles[candles.length - 1].close);
    return Math.max(0, d);
};

const splitSymbol = (symbol: string): { base: string; quote: string } => {
    const s = (symbol || '').toUpperCase();
    for (const q of ['USDT', 'USDC', 'BUSD', 'FDUSD']) {
        if (s.length > q.length && s.endsWith(q)) return { base: s.slice(0, -q.length), quote: q };
    }
    return { base: s, quote: '' };
};

/** Seconds of a lightweight-charts Time value (we only feed UTCTimestamp numbers). */
const timeToSeconds = (time: Time): number | null => {
    if (typeof time === 'number') return time;
    if (typeof time === 'string') {
        const ms = Date.parse(time);
        return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
    }
    if (time && typeof time === 'object') return Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000);
    return null;
};

/**
 * The chart works in UTC. Candle times are shifted by the viewer's (current) UTC offset so axis ticks
 * and day boundaries line up with local time, and the formatters below read the shifted value with getUTC*.
 * A single constant offset keeps timestamps strictly ascending (a per-candle DST offset could reorder them).
 */
const localOffsetSeconds = (): number => -new Date().getTimezoneOffset() * 60;

const tickMarkFormatter = (time: Time, type: TickMarkType): string | null => {
    const sec = timeToSeconds(time);
    if (sec === null) return null;
    const d = new Date(sec * 1000);
    switch (type) {
        case TickMarkType.Year:
            return String(d.getUTCFullYear());
        case TickMarkType.Month:
            return MONTHS_TR[d.getUTCMonth()];
        case TickMarkType.DayOfMonth:
            return String(d.getUTCDate());
        case TickMarkType.Time:
            return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
        case TickMarkType.TimeWithSeconds:
            return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
        default:
            return null;
    }
};

const makeCrosshairTimeFormatter = (interval: ChartInterval) => (time: Time): string => {
    const sec = timeToSeconds(time);
    if (sec === null) return '';
    const d = new Date(sec * 1000);
    const date = `${DAYS_TR[d.getUTCDay()]} ${pad2(d.getUTCDate())} ${MONTHS_TR[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(-2)}`;
    if (interval === '1d') return date;
    return `${date} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
};

// ---------------------------------------------------------------------------
// Chart construction
// ---------------------------------------------------------------------------

const themeOptions = (p: ChartPalette): DeepPartial<ChartOptions> => ({
    layout: {
        background: { type: ColorType.Solid, color: p.background },
        textColor: p.text,
        panes: { separatorColor: p.separator, separatorHoverColor: p.separatorHover },
    },
    grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
    crosshair: {
        vertLine: { color: p.crosshair, labelBackgroundColor: p.crosshairLabel },
        horzLine: { color: p.crosshair, labelBackgroundColor: p.crosshairLabel },
    },
    rightPriceScale: { borderColor: p.border },
    timeScale: { borderColor: p.border },
});

/** Grid / crosshair options from the shared chart settings. */
const settingsOptions = (st: ChartSettings): DeepPartial<ChartOptions> => ({
    grid: { vertLines: { visible: st.gridVertical }, horzLines: { visible: st.gridHorizontal } },
    crosshair: { mode: st.crosshair === 'magnet' ? CrosshairMode.Magnet : CrosshairMode.Normal },
});

const buildChartOptions = (
    p: ChartPalette,
    st: ChartSettings,
    interval: ChartInterval,
    width: number,
    height: number,
): DeepPartial<ChartOptions> => {
    const themed = themeOptions(p);
    const configured = settingsOptions(st);
    return {
        ...themed,
        width,
        height,
        layout: {
            ...themed.layout,
            fontSize: 10,
            fontFamily: "'IBM Plex Mono', Menlo, Monaco, monospace",
            panes: { ...themed.layout?.panes, enableResize: true },
        },
        grid: {
            vertLines: { ...themed.grid?.vertLines, ...configured.grid?.vertLines },
            horzLines: { ...themed.grid?.horzLines, ...configured.grid?.horzLines },
        },
        crosshair: {
            mode: configured.crosshair?.mode,
            vertLine: { ...themed.crosshair?.vertLine, style: LineStyle.Dashed, width: 1 },
            horzLine: { ...themed.crosshair?.horzLine, style: LineStyle.Dashed, width: 1 },
        },
        rightPriceScale: {
            ...themed.rightPriceScale,
            borderVisible: true,
            minimumWidth: 58,
            scaleMargins: { top: 0.12, bottom: 0.08 },
        },
        timeScale: {
            ...themed.timeScale,
            timeVisible: interval !== '1d',
            secondsVisible: false,
            rightOffset: 4,
            barSpacing: 5,
            minBarSpacing: 0.5,
            tickMarkFormatter,
        },
        // Vertical swipes keep scrolling the page on touch devices (charts are stacked on mobile).
        handleScroll: { vertTouchDrag: false },
        localization: {
            locale: 'en-US',
            timeFormatter: makeCrosshairTimeFormatter(interval),
        },
    };
};

/** Options that depend on the interval of the drawn series (applied when a new series is swapped in). */
const intervalOptions = (interval: ChartInterval): DeepPartial<ChartOptions> => ({
    timeScale: { timeVisible: interval !== '1d' },
    localization: { timeFormatter: makeCrosshairTimeFormatter(interval) },
});

/** Cached history of (symbol, interval), or null. Never throws. */
const readCachedCandles = (symbol: string, interval: ChartInterval): Candle[] | null => {
    if (!symbol) return null;
    try {
        const hit = getCachedKlines(symbol, interval);
        return hit && Array.isArray(hit.candles) && hit.candles.length ? hit.candles : null;
    } catch {
        return null;
    }
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type LoadStatus = 'loading' | 'ready' | 'error';

interface TerminalChartProps {
    symbol: string;
    defaultInterval: ChartInterval;
}

/** The chart instance of one mounted component; symbol/interval changes only swap its data. */
interface ChartView {
    chart: IChartApi;
    mgr: ChartSeriesManager; // series built from the shared chart settings
    candles: Candle[]; // what is drawn right now
    drawnKey: string | null; // `${symbol}|${interval}` of the drawn candles, null when nothing is drawn
    tzShift: number; // UTC offset the drawn candles were shifted by
    scheduleMeasure: () => void;
}

const TerminalChartInner: React.FC<TerminalChartProps> = ({ symbol, defaultInterval }) => {
    const { theme } = useUser();
    const palette = useMemo(() => getChartPalette(theme), [theme]);
    const settings = useChartSettings();

    const [chartInterval, setChartInterval] = useState<ChartInterval>(defaultInterval);
    // A cached series is painted in the first effect pass, so skip the loading overlay for it (no
    // one-frame spinner flash on revisits).
    const [status, setStatus] = useState<LoadStatus>(() =>
        readCachedCandles(symbol, defaultInterval) ? 'ready' : 'loading',
    );
    // Cached candles on screen, fresh history on the way.
    const [refreshing, setRefreshing] = useState(() => status === 'ready');
    const [hasData, setHasData] = useState(false); // the chart shows candles (possibly of the previous series)
    const [errorMsg, setErrorMsg] = useState('');
    const [volText, setVolText] = useState('—');
    const [paneTops, setPaneTops] = useState<number[]>([]);
    const [reloadKey, setReloadKey] = useState(0);

    const containerRef = useRef<HTMLDivElement>(null);
    const paletteRef = useRef<ChartPalette>(palette);
    const settingsRef = useRef<ChartSettings>(settings);
    const applyStyleRef = useRef<(() => void) | null>(null);
    const prevDefaultRef = useRef<ChartInterval>(defaultInterval);
    const mountIntervalRef = useRef<ChartInterval>(chartInterval);
    const viewRef = useRef<ChartView | null>(null);
    const volTextRef = useRef('—');

    // Follow the parent's default interval if it changes after mount.
    useEffect(() => {
        if (prevDefaultRef.current === defaultInterval) return;
        prevDefaultRef.current = defaultInterval;
        setChartInterval(defaultInterval);
    }, [defaultInterval]);

    // Theme / chart settings: restyle (or rebuild the series of) the live chart in place. Declared before
    // the chart effect so a re-created chart always starts with the latest palette and settings.
    useEffect(() => {
        paletteRef.current = palette;
        applyStyleRef.current?.();
    }, [palette]);
    useEffect(() => {
        settingsRef.current = settings;
        applyStyleRef.current?.();
    }, [settings]);

    // Chart lifecycle: one chart per mount. Symbol / interval changes only swap data (below); settings
    // changes restyle or rebuild its series.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const container = containerRef.current;
        if (!container) return;

        let disposed = false;
        let rafId = 0;
        let measureRetries = 0;

        const chart = createChart(
            container,
            buildChartOptions(
                paletteRef.current,
                settingsRef.current,
                mountIntervalRef.current,
                Math.floor(container.clientWidth),
                Math.floor(container.clientHeight),
            ),
        );
        const mgr = new ChartSeriesManager(chart);

        let ro: ResizeObserver | null = null;
        // Pane heights can change without the container resizing (time-axis/font layout, stretch factors
        // applied on the chart's next frame, panes added / removed by the settings), so the pane captions
        // follow the panes themselves.
        let paneRo: ResizeObserver | null = null;
        const observedPanes = new Set<Element>();

        // --- pane caption positions ---
        const measurePanes = () => {
            if (disposed) return;
            const top = container.getBoundingClientRect().top;
            let acc = 0;
            let missing = false;
            const present = new Set<Element>();
            const tops = chart.panes().map((pane) => {
                const el = pane.getHTMLElement();
                if (el) {
                    present.add(el);
                    if (paneRo && !observedPanes.has(el)) {
                        paneRo.observe(el);
                        observedPanes.add(el);
                    }
                } else {
                    missing = true;
                }
                const value = el ? Math.round(el.getBoundingClientRect().top - top) : acc;
                acc += pane.getHeight() + 1;
                return value;
            });
            for (const el of Array.from(observedPanes)) {
                if (!present.has(el)) {
                    paneRo?.unobserve(el);
                    observedPanes.delete(el);
                }
            }
            setPaneTops((prev) => (prev.length === tops.length && prev.every((v, i) => v === tops[i]) ? prev : tops));
            // New panes get their DOM on the chart's next frame: measure again until they exist.
            if (missing && measureRetries < 10) {
                measureRetries++;
                scheduleMeasure();
            } else if (!missing) {
                measureRetries = 0;
            }
        };
        const scheduleMeasure = () => {
            if (disposed || rafId) return;
            rafId = window.requestAnimationFrame(() => {
                rafId = 0;
                measurePanes();
            });
        };

        // --- sizing ---
        const resize = () => {
            if (disposed) return;
            const w = Math.floor(container.clientWidth);
            const h = Math.floor(container.clientHeight);
            if (w > 0 && h > 0) {
                chart.resize(w, h);
                scheduleMeasure();
            }
        };
        if (typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(resize);
            ro.observe(container);
            paneRo = new ResizeObserver(scheduleMeasure);
        } else {
            window.addEventListener('resize', resize);
        }

        const view: ChartView = { chart, mgr, candles: [], drawnKey: null, tzShift: localOffsetSeconds(), scheduleMeasure };
        viewRef.current = view;

        // Theme / settings changes restyle this chart (or rebuild its series) without reloading data.
        const applyStyle = () => {
            if (disposed) return;
            try {
                chart.applyOptions(themeOptions(paletteRef.current));
                chart.applyOptions(settingsOptions(settingsRef.current));
            } catch {
                /* ignore styling failures */
            }
            try {
                mgr.sync(settingsRef.current, paletteRef.current, view.candles, view.tzShift);
            } catch {
                /* a failed rebuild must not take the component down */
            }
            scheduleMeasure();
        };
        applyStyleRef.current = applyStyle;
        try {
            mgr.sync(settingsRef.current, paletteRef.current, [], view.tzShift);
        } catch {
            /* the data effect reports drawing failures */
        }
        scheduleMeasure();

        return () => {
            disposed = true;
            if (viewRef.current === view) viewRef.current = null;
            if (applyStyleRef.current === applyStyle) applyStyleRef.current = null;
            if (rafId) window.cancelAnimationFrame(rafId);
            if (ro) ro.disconnect();
            else window.removeEventListener('resize', resize);
            paneRo?.disconnect();
            observedPanes.clear();
            view.candles = [];
            view.drawnKey = null;
            chart.remove();
        };
    }, []);

    // Data: one history load + one kline stream per (symbol, interval, reload), drawn into the chart above.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const view = viewRef.current;
        if (!view || !symbol) return;
        const { chart, mgr } = view;
        const key = `${symbol}|${chartInterval}`;

        let disposed = false;
        let ready = false; // fresh history drawn: live candles apply directly instead of being buffered
        let gapReloadRequested = false;
        const pending: Candle[] = [];
        const intervalSec = INTERVAL_SECONDS[chartInterval];

        const updateVolLabel = (c: Candle | undefined) => {
            const text = c ? formatCompact(c.quoteVolume) : '—';
            if (text !== volTextRef.current) {
                volTextRef.current = text;
                setVolText(text);
            }
        };
        const applyPrecision = () => {
            const precision = detectPrecision(view.candles);
            mgr.setPriceFormat({ type: 'price', precision, minMove: Number((1 / 10 ** precision).toFixed(precision)) });
        };

        const setAll = () => {
            const candles = view.candles;
            applyPrecision();
            mgr.setAll(candles, view.tzShift);
            updateVolLabel(candles[candles.length - 1]);
            view.scheduleMeasure();
        };

        // A different series was swapped in: let every price scale fit it again and jump to its latest bar
        // (the user's bar spacing is kept).
        const resetViewport = () => {
            try {
                mgr.resetAutoScale();
                chart.timeScale().scrollToRealTime();
            } catch {
                /* cosmetic */
            }
        };

        /** Replaces the drawn candles with `list` (history of this key). Returns false if drawing failed. */
        const draw = (list: Candle[]): boolean => {
            const swap = view.drawnKey !== key;
            const prevLast = view.candles[view.candles.length - 1];
            if (swap) {
                try {
                    chart.applyOptions(intervalOptions(chartInterval));
                } catch {
                    /* cosmetic */
                }
            }
            view.candles = list.slice(-MAX_CANDLES);
            view.tzShift = localOffsetSeconds();
            try {
                setAll();
            } catch {
                return false;
            }
            view.drawnKey = key;
            // A refresh that does not overlap the cached candles is effectively a new series too.
            const disjoint = !swap && !!prevLast && view.candles[0].time > prevLast.time;
            if (swap || disjoint) resetViewport();
            setHasData(true);
            return true;
        };

        const clear = () => {
            view.candles = [];
            view.drawnKey = null;
            try {
                mgr.clear();
            } catch {
                /* ignore */
            }
            setHasData(false);
            updateVolLabel(undefined);
        };

        const fail = (message: string) => {
            clear(); // never leave another (or a stale cached) series behind the error
            setErrorMsg(message);
            setStatus('error');
            setRefreshing(false);
        };

        const applyLive = (c: Candle) => {
            const last = view.candles[view.candles.length - 1];
            if (!last || c.time < last.time) return; // stale / out-of-order message
            if (c.time - last.time > intervalSec) {
                // Missed whole candles (socket gap): re-fetch history instead of drawing a hole.
                if (!gapReloadRequested) {
                    gapReloadRequested = true;
                    setReloadKey((k) => k + 1);
                }
                return;
            }
            const isNewBar = c.time > last.time;
            if (isNewBar) {
                view.candles.push(c);
                if (view.candles.length > MAX_CANDLES) view.candles = view.candles.slice(view.candles.length - MAX_CANDLES);
            } else {
                view.candles[view.candles.length - 1] = c;
            }
            try {
                // Recomputes the indicators on the buffer; pushes the last bar (and finalizes the previous one).
                mgr.updateLast(view.candles, view.tzShift, isNewBar);
            } catch {
                /* never let a single bad tick break the stream */
            }
            updateVolLabel(c);
        };

        // --- first paint: what is on screen while the history request runs ---
        setErrorMsg('');
        if (view.drawnKey === key && view.candles.length) {
            // Same series again (socket-gap reload): keep it on screen and refresh it underneath.
            setStatus('ready');
            setRefreshing(true);
        } else {
            const cached = readCachedCandles(symbol, chartInterval);
            if (cached && draw(cached)) {
                // Instant paint from the cache; the request below replaces it with fresh history.
                setStatus('ready');
                setRefreshing(true);
            } else {
                if (cached) clear(); // a cached series that could not be drawn
                // Nothing for this series yet: the previous candles (if any) stay visible, dimmed.
                updateVolLabel(undefined);
                setHasData(view.candles.length > 0);
                setStatus('loading');
                setRefreshing(false);
            }
        }

        // --- live stream first (buffered), then history, so nothing between the two is lost ---
        let unsubscribe: (() => void) | null = null;
        try {
            unsubscribe = subscribeKline(symbol, chartInterval, (c) => {
                if (disposed) return;
                if (!ready) {
                    pending.push(c);
                    if (pending.length > 50) pending.shift();
                    return;
                }
                applyLive(c);
            });
        } catch {
            unsubscribe = null; // no live updates; history still renders
        }

        fetchKlines(symbol, chartInterval, KLINE_LIMIT)
            .then((list) => {
                if (disposed) return;
                if (!list.length) {
                    fail('Bu sembol için mum verisi bulunamadı.');
                    return;
                }
                if (!draw(list)) {
                    fail('Grafik çizilemedi.');
                    return;
                }
                ready = true;
                const queued = pending.splice(0, pending.length);
                for (const c of queued) applyLive(c);
                setStatus('ready');
                setRefreshing(false);
            })
            .catch((err: unknown) => {
                if (disposed) return;
                fail(err instanceof Error && err.message ? err.message : 'Grafik verisi alınamadı.');
            });

        return () => {
            disposed = true;
            try {
                unsubscribe?.();
            } catch {
                /* ignore */
            }
            pending.length = 0;
        };
    }, [symbol, chartInterval, reloadKey]);

    const { base, quote } = splitSymbol(symbol);
    const displayName = quote ? `${base}/${quote}` : base;
    // Legend of the price-pane overlays and the captions of the sub panes (pane k + 1 = k-th visible pane indicator).
    const overlayLegend = useMemo(
        () =>
            settings.indicators
                .filter((cfg) => cfg.visible && !isPaneIndicator(cfg))
                .map((cfg) => ({ id: cfg.id, label: indicatorShortLabel(cfg), color: themedIndicatorColor(indicatorColor(cfg), palette) })),
        [settings, palette],
    );
    const paneCaptions = useMemo(
        () =>
            settings.indicators
                .filter((cfg) => cfg.visible && isPaneIndicator(cfg))
                .map((cfg) => {
                    const m = /^(.*?)((?:\s+[\d.]+)*)$/.exec(indicatorShortLabel(cfg));
                    return { id: cfg.id, name: m ? m[1] : indicatorShortLabel(cfg), params: m ? m[2].trim() : '' };
                }),
        [settings],
    );
    // Switching to a series without cached history keeps the previous candles on screen, dimmed.
    const dimmed = status === 'loading' && hasData;
    const busy = status === 'loading' || (status === 'ready' && refreshing);

    return (
        <section
            className="relative flex h-full min-h-[300px] w-full min-w-0 flex-col overflow-hidden bg-surface"
            aria-label={`${displayName} grafiği`}
        >
            {/* Header */}
            <header className="flex h-8 min-w-0 shrink-0 items-center gap-1.5 border-b border-border px-2">
                <CoinIcon asset={base || symbol} size={14} />
                <h2 className="min-w-[2.5rem] truncate text-xs font-semibold text-text" title={`${symbol}.P`}>
                    {displayName}
                </h2>
                <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        status === 'ready' ? 'bg-success' : status === 'error' ? 'bg-danger' : 'bg-secondary'
                    } ${busy ? 'animate-pulse' : ''}`}
                    title={
                        status === 'ready'
                            ? refreshing
                                ? 'Güncelleniyor'
                                : 'Canlı'
                            : status === 'error'
                              ? 'Bağlantı hatası'
                              : 'Yükleniyor'
                    }
                />
                {/* Compact interval picker (like the reference's '5m ›'): a row of six buttons does not fit a
                    third of the left column at 1280px and hid the active interval of the right-most chart. */}
                <div className="ml-auto flex shrink-0 items-center gap-1">
                    <div className="relative shrink-0">
                        <select
                            value={chartInterval}
                            onChange={(e) => setChartInterval(e.target.value as ChartInterval)}
                            aria-label="Zaman aralığı"
                            title="Zaman aralığı"
                            className="h-6 cursor-pointer appearance-none rounded-sm border border-border bg-surface-secondary pl-1.5 pr-4 font-mono text-[11px] font-semibold leading-none text-text outline-none transition-colors hover:bg-surface-highlight focus:border-primary"
                        >
                            {INTERVALS.map(({ value, label }) => (
                                <option key={value} value={value} className="bg-surface text-text">
                                    {label}
                                </option>
                            ))}
                        </select>
                        <ChevronDown
                            size={10}
                            aria-hidden="true"
                            className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-secondary"
                        />
                    </div>
                    <ChartSettingsButton />
                </div>
            </header>

            {/* Chart */}
            <div className="relative min-h-0 flex-1">
                {/* Dimming waits 100 ms so a fast load does not blink; un-dimming is immediate. */}
                <div
                    ref={containerRef}
                    className={`absolute inset-0 transition-opacity ${dimmed ? 'opacity-40 duration-200 delay-100' : 'duration-150'}`}
                />

                {/* Price pane legend (Vol of the current candle + overlays) */}
                <div className="pointer-events-none absolute left-2 top-1.5 z-10 flex flex-col gap-0.5 font-mono text-[10px] leading-tight">
                    <span className="text-secondary">
                        Vol <span className="text-text">{volText}</span>
                    </span>
                    {overlayLegend.map((item) => (
                        <span key={item.id} className="flex items-center gap-1 text-secondary">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: item.color }} />
                            {item.label}
                        </span>
                    ))}
                </div>

                {paneCaptions.map((caption, k) => {
                    const top = paneTops[k + 1];
                    if (typeof top !== 'number' || top <= 0) return null;
                    return (
                        <div
                            key={caption.id}
                            className="pointer-events-none absolute left-2 z-10 font-mono text-[10px] leading-none text-secondary"
                            style={{ top: top + 4 }}
                        >
                            {caption.name}
                            {caption.params && <span className="text-muted"> {caption.params}</span>}
                        </div>
                    );
                })}

                {status === 'loading' && !hasData && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center gap-1.5 bg-surface text-xs text-muted">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        <span>Grafik yükleniyor…</span>
                    </div>
                )}

                {dimmed && (
                    <div
                        role="status"
                        aria-label="Grafik yükleniyor"
                        className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
                    >
                        {/* Same 100 ms grace as the dimming (fadeIn: index.css keyframes). */}
                        <span className="flex" style={{ animation: 'fadeIn 150ms ease-out 100ms both' }}>
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-secondary" aria-hidden="true" />
                        </span>
                    </div>
                )}

                {status === 'error' && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-surface p-3 text-center">
                        <p className="flex max-w-[260px] items-start gap-1.5 text-xs text-muted">
                            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
                            <span>{errorMsg || 'Grafik verisi alınamadı.'}</span>
                        </p>
                        <button
                            type="button"
                            onClick={() => setReloadKey((k) => k + 1)}
                            className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-surface-secondary px-2.5 text-xs font-medium text-text outline-none transition-colors hover:bg-surface-highlight focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                        >
                            <RefreshCw className="h-3 w-3" aria-hidden="true" />
                            Tekrar dene
                        </button>
                    </div>
                )}
            </div>
        </section>
    );
};

/** Self-contained price chart (candle type, overlays and indicator panes from the shared chart settings) with live Binance klines. */
export const TerminalChart: React.FC<TerminalChartProps> = memo(TerminalChartInner);
TerminalChart.displayName = 'TerminalChart';
