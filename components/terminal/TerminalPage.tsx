import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
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

// ---------------------------------------------------------------------------
// Bottom area tabs (right column, under the symbol header)
// ---------------------------------------------------------------------------

type BottomTab = 'funding' | 'checklist' | 'sentiment';

// Labels are typed in capitals: CSS `uppercase` under lang="tr" would render 'Funding' as 'FUNDİNG'.
const BOTTOM_TABS: ReadonlyArray<{ key: BottomTab; label: string; title: string }> = [
    { key: 'funding', label: 'FUNDING AKIŞI', title: 'Uç funding adayları ve funding olayları (durum tespiti, tahmin değildir)' },
    { key: 'checklist', label: 'KURULUM', title: 'Seçili sembol için short sıkışması kurulum koşulları ve fonlama geçmişi' },
    { key: 'sentiment', label: 'DUYARLILIK', title: 'Seçili sembolün piyasa duyarlılığı (emir defteri, long/short oranları)' },
];
const DEFAULT_TAB: BottomTab = 'funding';

const isBottomTab = (value: unknown): value is BottomTab =>
    value === 'funding' || value === 'checklist' || value === 'sentiment';

const tabId = (tab: BottomTab): string => `terminal-bottom-tab-${tab}`;
const tabPanelId = (tab: BottomTab): string => `terminal-bottom-panel-${tab}`;

const readStoredTab = (): BottomTab => {
    if (typeof window === 'undefined') return DEFAULT_TAB;
    try {
        const stored = window.localStorage.getItem(TAB_STORAGE_KEY);
        if (isBottomTab(stored)) return stored;
    } catch {
        /* storage blocked */
    }
    return DEFAULT_TAB;
};

const writeStoredTab = (tab: BottomTab): void => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {
        /* storage blocked or full: the tab simply is not remembered */
    }
};

interface BottomTabStripProps {
    active: BottomTab;
    onChange: (tab: BottomTab) => void;
}

/**
 * Tab strip of the bottom area. It is rendered INSIDE the active panel's header row (in place of the panel
 * title), so the panel keeps its own controls on the right and there is no second header.
 */
const BottomTabStrip: React.FC<BottomTabStripProps> = ({ active, onChange }) => {
    const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
        e.preventDefault();
        const index = BOTTOM_TABS.findIndex((t) => t.key === active);
        const last = BOTTOM_TABS.length - 1;
        const next =
            e.key === 'Home' ? 0 : e.key === 'End' ? last : e.key === 'ArrowLeft' ? (index <= 0 ? last : index - 1) : index >= last ? 0 : index + 1;
        onChange(BOTTOM_TABS[next].key);
    };

    return (
        <div role="tablist" aria-label="Alt panel" className="-ml-2 flex h-8 min-w-0 items-stretch">
            {BOTTOM_TABS.map((tab) => {
                const selected = tab.key === active;
                return (
                    <button
                        key={tab.key}
                        type="button"
                        role="tab"
                        id={tabId(tab.key)}
                        aria-selected={selected}
                        aria-controls={tabPanelId(tab.key)}
                        tabIndex={selected ? 0 : -1}
                        title={tab.title}
                        onClick={() => onChange(tab.key)}
                        onKeyDown={onKeyDown}
                        className={`flex h-8 shrink-0 items-center whitespace-nowrap px-2 text-[11px] font-semibold uppercase tracking-wider outline-none transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-primary ${
                            selected ? 'text-text shadow-[inset_0_-2px_0_var(--color-brand)]' : 'text-secondary hover:text-text'
                        }`}
                    >
                        {tab.label}
                    </button>
                );
            })}
        </div>
    );
};

/** Returns the same object when the patch changes nothing, so memoized rows skip re-rendering. */
const mergeRow = (row: FuturesRow, patch: Partial<FuturesRow>): FuturesRow => {
    let next: FuturesRow | null = null;
    for (const key of Object.keys(patch) as Array<keyof FuturesRow>) {
        const value = patch[key];
        if (value === undefined || value === row[key]) continue;
        if (!next) next = { ...row };
        (next as unknown as Record<string, unknown>)[key] = value;
    }
    return next ?? row;
};

const applyPatch = (
    prev: FuturesRow[],
    patch: Record<string, Partial<FuturesRow>>,
    index: Map<string, number>,
): FuturesRow[] => {
    if (!prev.length) return prev;
    let next: FuturesRow[] | null = null;
    for (const symbol of Object.keys(patch)) {
        const i = index.get(symbol);
        if (i === undefined) continue;
        const current = (next ?? prev)[i];
        if (!current || current.symbol !== symbol) continue; // index belongs to another universe snapshot
        const merged = mergeRow(current, patch[symbol]);
        if (merged === current) continue;
        if (!next) next = prev.slice();
        next[i] = merged;
    }
    return next ?? prev;
};

// ---------------------------------------------------------------------------
// Panel error boundary: one failing panel must not take the whole terminal down.
// ---------------------------------------------------------------------------

interface PanelBoundaryProps {
    name: string;
    /** Rendered in a header row above the fallback, so e.g. a tab strip stays usable when its panel fails. */
    fallbackHeader?: React.ReactNode;
    children?: React.ReactNode;
}

interface PanelBoundaryState {
    failed: boolean;
}

class PanelBoundary extends React.Component<PanelBoundaryProps, PanelBoundaryState> {
    state: PanelBoundaryState = { failed: false };

    static getDerivedStateFromError(): PanelBoundaryState {
        return { failed: true };
    }

    componentDidCatch(error: unknown): void {
        console.error(`[Terminal] ${this.props.name} hatası`, error);
    }

    private retry = (): void => {
        this.setState({ failed: false });
    };

    render(): React.ReactNode {
        if (!this.state.failed) return this.props.children;
        const alert = (
            <div
                role="alert"
                className="flex h-full min-h-[120px] w-full flex-col items-center justify-center gap-2 bg-surface p-3 text-center"
            >
                <p className="flex items-center gap-1.5 text-xs text-muted">
                    <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
                    <span>{this.props.name} gösterilirken bir hata oluştu.</span>
                </p>
                <button
                    type="button"
                    onClick={this.retry}
                    className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-surface-secondary px-2.5 text-xs font-medium text-text outline-none transition-colors hover:bg-surface-highlight focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                >
                    <RefreshCw className="h-3 w-3" aria-hidden="true" />
                    Tekrar dene
                </button>
            </div>
        );
        if (!this.props.fallbackHeader) return alert;
        return (
            <div className="flex h-full min-h-0 w-full flex-col bg-surface">
                <header className="flex h-8 shrink-0 items-center border-b border-border px-3">
                    <div className="flex h-8 min-w-0 flex-1 items-center">{this.props.fallbackHeader}</div>
                </header>
                <div className="min-h-0 flex-1">{alert}</div>
            </div>
        );
    }
}

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
    const [bottomTab, setBottomTab] = useState<BottomTab>(readStoredTab);

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
        writeStoredTab(bottomTab);
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
