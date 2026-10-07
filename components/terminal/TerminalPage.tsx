import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ChartInterval, FuturesRow } from './types';
import { fetchFuturesUniverse, prefetchKlines, subscribeFuturesTickers } from './terminalData';
import { TerminalChart } from './TerminalChart';
import { TerminalWatchlist } from './TerminalWatchlist';
import { TerminalSymbolHeader } from './TerminalSymbolHeader';
import { TerminalSentimentPanel } from './TerminalSentimentPanel';
import { FundingFlowPanel } from './FundingFlowPanel';
import { SqueezeChecklist } from './SqueezeChecklist';
import { feedFundingRows } from './fundingFlow';
import { SplitPane } from './SplitPane';
import { applyPatch } from './universePatch';
import { BottomTabStrip, PanelBoundary, readStoredTab, tabId, tabPanelId, writeStoredTab, type BottomTab } from './bottomTabs';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'fidelio_terminal_symbol';
const TAB_STORAGE_KEY = 'fidelio_terminal_bottom_tab';
const DEFAULT_SYMBOL = 'BTCUSDT';
const CHART_INTERVALS: readonly ChartInterval[] = ['5m', '1h', '1d'];
const UNIVERSE_RETRY_BASE_MS = 5_000;
const UNIVERSE_RETRY_MAX_MS = 60_000;
const UNIVERSE_ERROR = 'Vadeli işlem piyasa listesi alınamadı.';
const WARMUP_DELAY_MS = 1_500; // let the selected symbol's charts go first
const WARMUP_IDLE_TIMEOUT_MS = 2_000;
const WARMUP_SYMBOL_COUNT = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Binance symbols are short and URL-safe (some contain non-Latin letters, e.g. 币安人生USDT).
const isPlausibleSymbol = (value: unknown): value is string =>
    typeof value === 'string' && value.length >= 3 && value.length <= 40 && !/[\s/?#&%]/.test(value);

const readStoredSymbol = (): string => {
    if (typeof window === 'undefined') return DEFAULT_SYMBOL;
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (isPlausibleSymbol(stored)) return stored.toUpperCase();
    } catch {
        /* storage blocked (private mode etc.) */
    }
    return DEFAULT_SYMBOL;
};

const writeStoredSymbol = (symbol: string): void => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(STORAGE_KEY, symbol);
    } catch {
        /* storage blocked or full: the selection simply is not remembered */
    }
};

// The page re-renders once per second with ticker patches; the sentiment panel only depends on the symbol.
const SentimentPanel = memo(TerminalSentimentPanel);

const DESKTOP_QUERY = '(min-width: 1024px)';

// True on lg+ screens (resizable layout); false on the server and on small screens (stacked layout).
const useIsDesktop = (): boolean => {
    const [isDesktop, setIsDesktop] = useState<boolean>(() =>
        typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP_QUERY).matches : false,
    );
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mql = window.matchMedia(DESKTOP_QUERY);
        const onChange = () => setIsDesktop(mql.matches);
        onChange();
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
    }, []);
    return isDesktop;
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const TerminalPage: React.FC = () => {
    const isDesktop = useIsDesktop();
    const [rows, setRows] = useState<FuturesRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedSymbol, setSelectedSymbol] = useState<string>(readStoredSymbol);
    const [bottomTab, setBottomTab] = useState<BottomTab>(() => readStoredTab(TAB_STORAGE_KEY));

    // symbol -> position in `rows`. Patches only replace elements, so positions never change
    // until a new universe snapshot arrives.
    const indexRef = useRef<Map<string, number>>(new Map());

    // ---- Funding flow store: every universe update (snapshot or ticker patch) is pushed to the detector ----
    // (cheap: the store keeps the reference and runs at most one detection pass per second).
    useEffect(() => {
        if (!rows.length) return;
        try {
            feedFundingRows(rows);
        } catch (err) {
            console.warn('[Terminal] funding akışı beslenemedi', err);
        }
    }, [rows]);

    // ---- Universe: REST snapshot, retried with backoff until it succeeds ----
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        let cancelled = false;
        let attempt = 0;
        let retryTimer: number | null = null;

        const load = () => {
            retryTimer = null;
            let request: Promise<FuturesRow[]>;
            try {
                request = fetchFuturesUniverse();
            } catch (err) {
                request = Promise.reject(err);
            }
            request
                .then((list) => {
                    if (cancelled) return;
                    indexRef.current = new Map(list.map((row, i) => [row.symbol, i]));
                    setRows(list);
                    setError(null);
                    setLoading(false);
                })
                .catch((err: unknown) => {
                    if (cancelled) return;
                    setError(err instanceof Error && err.message ? err.message : UNIVERSE_ERROR);
                    // Only the first attempt shows the skeleton; retries keep the error visible.
                    setLoading(false);
                    const delay = Math.min(UNIVERSE_RETRY_MAX_MS, UNIVERSE_RETRY_BASE_MS * 2 ** attempt);
                    attempt += 1;
                    retryTimer = window.setTimeout(load, delay);
                });
        };

        load();
        return () => {
            cancelled = true;
            if (retryTimer !== null) window.clearTimeout(retryTimer);
        };
    }, []);

    // ---- Live tickers + funding (batched by the data module to <= 1 patch / second) ----
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        let unsubscribe: (() => void) | null = null;
        try {
            unsubscribe = subscribeFuturesTickers((patch) => {
                setRows((prev) => applyPatch(prev, patch, indexRef.current));
            });
        } catch {
            unsubscribe = null; // REST snapshot still renders, just without live updates
        }
        return () => {
            try {
                unsubscribe?.();
            } catch {
                /* ignore */
            }
        };
    }, []);

    // ---- Selected symbol: persisted, and replaced if it is no longer listed ----
    useEffect(() => {
        writeStoredSymbol(selectedSymbol);
    }, [selectedSymbol]);

    const hasUniverse = rows.length > 0;
    useEffect(() => {
        if (!hasUniverse || indexRef.current.has(selectedSymbol)) return;
        const fallback = indexRef.current.has(DEFAULT_SYMBOL) ? DEFAULT_SYMBOL : rows[0]?.symbol;
        if (fallback && fallback !== selectedSymbol) setSelectedSymbol(fallback);
        // `rows` is read only for the fallback; re-running on every ticker patch is unnecessary.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasUniverse, selectedSymbol]);

    // ---- Warm-up: once the universe is in, prefetch candles of the most traded other symbols ----
    // (the likeliest next clicks), after a short delay and only when the browser is idle.
    const rowsRef = useRef(rows);
    rowsRef.current = rows;
    const selectedSymbolRef = useRef(selectedSymbol);
    selectedSymbolRef.current = selectedSymbol;
    const warmedUpRef = useRef(false);

    useEffect(() => {
        if (!hasUniverse || warmedUpRef.current || typeof window === 'undefined') return undefined;
        let delayTimer: number | null = null;
        let idleHandle: number | null = null;

        const warmUp = () => {
            idleHandle = null;
            warmedUpRef.current = true;
            const selected = selectedSymbolRef.current;
            const top = rowsRef.current
                .filter((row) => row.symbol !== selected && Number.isFinite(row.quoteVolume))
                .sort((a, b) => b.quoteVolume - a.quoteVolume)
                .slice(0, WARMUP_SYMBOL_COUNT);
            for (const row of top) {
                try {
                    prefetchKlines(row.symbol);
                } catch {
                    /* prefetching is best-effort */
                }
            }
        };

        delayTimer = window.setTimeout(() => {
            delayTimer = null;
            if (typeof window.requestIdleCallback === 'function') {
                idleHandle = window.requestIdleCallback(warmUp, { timeout: WARMUP_IDLE_TIMEOUT_MS });
            } else {
                warmUp();
            }
        }, WARMUP_DELAY_MS);

        return () => {
            if (delayTimer !== null) window.clearTimeout(delayTimer);
            if (idleHandle !== null && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleHandle);
        };
    }, [hasUniverse]);

    const handleSelect = useCallback((symbol: string) => {
        if (isPlausibleSymbol(symbol)) setSelectedSymbol(symbol);
    }, []);

    // ---- Bottom tabs: persisted; the strip lives inside the active panel, so after a switch (which
    // remounts it) focus is put back on the newly active tab for keyboard users.
    const refocusTabRef = useRef(false);
    const selectTab = useCallback((tab: BottomTab) => {
        refocusTabRef.current = typeof document !== 'undefined' && document.activeElement?.getAttribute('role') === 'tab';
        setBottomTab(tab);
    }, []);
    const openChecklist = useCallback(() => {
        refocusTabRef.current = false;
        setBottomTab('checklist');
    }, []);

    useEffect(() => {
        writeStoredTab(TAB_STORAGE_KEY, bottomTab);
        if (!refocusTabRef.current || typeof document === 'undefined') return;
        refocusTabRef.current = false;
        document.getElementById(tabId(bottomTab))?.focus();
    }, [bottomTab]);

    const selectedRow = useMemo<FuturesRow | null>(() => {
        const i = indexRef.current.get(selectedSymbol);
        const row = i === undefined ? undefined : rows[i];
        return row && row.symbol === selectedSymbol ? row : null;
    }, [rows, selectedSymbol]);

    // Stable between tab switches, so the memoized sentiment panel does not re-render on every ticker tick.
    const tabStrip = useMemo(() => <BottomTabStrip active={bottomTab} onChange={selectTab} />, [bottomTab, selectTab]);

    // Every panel is a flat `bg-surface` block; the 1px lines between them are the dividers of the
    // SplitPanes (desktop) or the `gap-px bg-border` grid (stacked layout).
    const cell = 'h-full min-h-0 min-w-0 bg-surface';

    const watchlistPanel = (
        <PanelBoundary name="İzleme listesi">
            <TerminalWatchlist
                rows={rows}
                selectedSymbol={selectedSymbol}
                onSelect={handleSelect}
                loading={loading}
                error={error}
            />
        </PanelBoundary>
    );

    const headerPanel = (
        <PanelBoundary name="Sembol özeti">
            {!selectedRow && !loading && error && rows.length === 0 ? (
                // Universe failed: the header has no row to show, so say so instead of an endless skeleton.
                <div role="status" className="flex items-center gap-1.5 px-3 py-3 text-xs text-muted">
                    <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
                    <span>{selectedSymbol} verisi bekleniyor, bağlantı yeniden deneniyor…</span>
                </div>
            ) : (
                <TerminalSymbolHeader row={selectedRow} onOpenChecklist={openChecklist} />
            )}
        </PanelBoundary>
    );

    // Only the active tab's panel is mounted (a hidden panel must not poll).
    let bottomPanel: React.ReactNode;
    switch (bottomTab) {
        case 'checklist':
            bottomPanel = (
                <PanelBoundary name="Kurulum kontrolü" fallbackHeader={tabStrip}>
                    <SqueezeChecklist row={selectedRow} titleSlot={tabStrip} />
                </PanelBoundary>
            );
            break;
        case 'sentiment':
            bottomPanel = (
                <PanelBoundary name="Piyasa duyarlılığı" fallbackHeader={tabStrip}>
                    <SentimentPanel symbol={selectedSymbol} titleSlot={tabStrip} />
                </PanelBoundary>
            );
            break;
        default:
            bottomPanel = (
                <PanelBoundary name="Funding akışı" fallbackHeader={tabStrip}>
                    <FundingFlowPanel selectedSymbol={selectedSymbol} onSelect={handleSelect} titleSlot={tabStrip} />
                </PanelBoundary>
            );
    }
    const bottomArea = (
        <div
            role="tabpanel"
            id={tabPanelId(bottomTab)}
            aria-labelledby={tabId(bottomTab)}
            className="h-full min-h-0 min-w-0 bg-surface"
        >
            {bottomPanel}
        </div>
    );

    const charts = CHART_INTERVALS.map((interval) => (
        <PanelBoundary key={interval} name="Grafik">
            <TerminalChart symbol={selectedSymbol} defaultInterval={interval} />
        </PanelBoundary>
    ));

    if (isDesktop) {
        // Fills <main> edge to edge (the shell gives it the height between the header and the bottom
        // strip); every divider can be dragged (sizes are remembered per browser).
        return (
            <div className="h-full min-h-0 w-full min-w-0 overflow-hidden bg-surface">
                <h1 className="sr-only">Terminal</h1>
                <SplitPane
                    direction="horizontal"
                    storageKey="fidelio_terminal_layout_main"
                    defaultSizes={[58, 42]}
                    minSizesPx={[360, 340]}
                    className="h-full"
                >
                    <SplitPane
                        direction="horizontal"
                        storageKey="fidelio_terminal_layout_charts"
                        defaultSizes={[1, 1, 1]}
                        minSizesPx={[160, 160, 160]}
                        className="h-full"
                    >
                        {charts.map((chart, i) => (
                            <div key={CHART_INTERVALS[i]} className={cell}>
                                {chart}
                            </div>
                        ))}
                    </SplitPane>
                    <SplitPane
                        direction="vertical"
                        storageKey="fidelio_terminal_layout_right"
                        defaultSizes={[0.38, 0.62]}
                        minSizesPx={[140, 260]}
                        className="h-full"
                    >
                        <div className={cell}>{watchlistPanel}</div>
                        <div className="flex h-full min-h-0 min-w-0 flex-col bg-surface">
                            <div className="shrink-0 border-b border-border">{headerPanel}</div>
                            <div className="min-h-0 flex-1">{bottomArea}</div>
                        </div>
                    </SplitPane>
                </SplitPane>
            </div>
        );
    }

    // Mobile / tablet: stacked and naturally tall; <main> scrolls. The tabbed area gets a fixed height so
    // its panels (which scroll internally) have something to fill.
    return (
        <div className="grid w-full min-w-0 grid-cols-1 gap-px bg-border">
            <h1 className="sr-only">Terminal</h1>
            <div className="h-[420px] min-w-0 bg-surface">{watchlistPanel}</div>
            <div className="min-w-0 bg-surface">{headerPanel}</div>
            <div className="h-[520px] min-w-0 bg-surface">{bottomArea}</div>
            {charts.map((chart, i) => (
                <div key={CHART_INTERVALS[i]} className="h-[440px] min-w-0 bg-surface sm:h-[500px]">
                    {chart}
                </div>
            ))}
        </div>
    );
};

export default TerminalPage;
