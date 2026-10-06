import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowDownLeft,
    ArrowDownRight,
    ArrowUpRight,
    ChevronDown,
    ChevronUp,
    ChevronsUpDown,
    Search,
    TriangleAlert,
    X,
} from 'lucide-react';
import type { FuturesRow, SideRatio } from './types';
import { fetchMarketExposure, prefetchKlines } from './terminalData';
import { CoinIcon } from './CoinIcon';
import { formatCompact, formatFundingInterval, formatFundingPct, formatPct, formatPrice, formatRatioPct } from './format';
import { EASING_BADGE_LABEL, getFundingInfoFor, useFundingFlow } from './fundingFlow';
import { SQUEEZE_CLASS_LABELS, fundingTo8h } from '../../utils/fundingSqueeze';
import type { FundingSide } from '../../utils/fundingSqueeze';

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

// 'f8' (8h-equivalent funding) has no column of its own: the 'Negatif' quick filter sorts by it and the
// FR column header shows its arrow meanwhile.
type SortKey =
    | 'symbol'
    | 'price'
    | 'changePct'
    | 'quoteVolume'
    | 'fundingRate'
    | 'frDelta'
    | 'fundingIntervalHours'
    | 'exposure'
    | 'f8';
type SortDir = 'asc' | 'desc';

interface ColumnDef {
    key: Exclude<SortKey, 'f8'>;
    label: string;
    title: string;
    align: 'left' | 'right';
}

const COLUMNS: ColumnDef[] = [
    { key: 'symbol', label: 'Sembol', title: 'Sembol (USDT perpetual)', align: 'left' },
    { key: 'price', label: 'Fiyat', title: 'Son fiyat', align: 'right' },
    { key: 'changePct', label: 'Değ%', title: '24 saatlik değişim', align: 'right' },
    { key: 'quoteVolume', label: 'Hacim (USD)', title: '24 saatlik işlem hacmi (USDT)', align: 'right' },
    {
        key: 'fundingRate',
        label: 'FR (%)',
        title: 'Güncel (tahmini) fonlama oranı (%). Nokta: uç funding adayı (kırmızı negatif, yeşil pozitif taraf).',
        align: 'right',
    },
    {
        key: 'frDelta',
        label: 'FR Δ',
        title: 'Fonlama değişimi: tahmini oran − son ödenen oran (yüzde puanı). Negatif = son ödemeden beri düştü.',
        align: 'right',
    },
    { key: 'fundingIntervalHours', label: 'FR aralığı', title: 'Fonlama aralığı', align: 'right' },
    {
        key: 'exposure',
        label: 'Piyasa Mrz.',
        title: 'Piyasa maruziyeti: top trader pozisyon oranında (5dk) baskın tarafın payı. Yeşil = long ağırlıklı, kırmızı = short ağırlıklı.',
        align: 'right',
    },
];

// Shared by header, rows and skeletons so every column lines up.
// Sized so the whole table fits the right column at 1280px+ (the reference layout, 42% = 537px) without
// scrolling: minimums 485 + 7 gaps × 3 + padding 24 = 530. The minimums keep the data readable
// ('SANDUSDT.P', '118,291.70', '• −0.0011 ↙', '−0.0750'); the weights hand the spare width to the columns
// whose uppercase header label is wider than their data (volume, funding interval, exposure), so the labels
// (and the sort arrow of the active column) fit as well.
const GRID_COLS =
    'minmax(88px,1.25fr) minmax(64px,0.9fr) minmax(47px,0.65fr) minmax(74px,1.1fr) minmax(66px,0.9fr) minmax(50px,0.8fr) minmax(42px,0.9fr) minmax(54px,1.05fr)';
const GRID_GAP = 'gap-x-[3px]';
const TABLE_MIN_WIDTH = 530; // below this the table scrolls sideways inside its panel (never the page)

// ---------------------------------------------------------------------------
// Quick filters (funding based; the store in fundingFlow.ts supplies candidates and settled rates)
// ---------------------------------------------------------------------------

type QuickFilter = 'ALL' | 'NEG' | 'EXTREME' | 'FLIPPED';

const QUICK_FILTERS: ReadonlyArray<{ key: QuickFilter; label: string; title: string; hint: string }> = [
    { key: 'ALL', label: 'Tümü', title: 'Tüm semboller', hint: '' },
    {
        key: 'NEG',
        label: 'Negatif',
        title: "Tahmini funding oranı negatif olanlar (short'lar long'lara ödüyor). 8 saate eşdeğer orana göre en negatiften başlayarak sıralanır.",
        hint: 'FR < 0 · 8s eşdeğerine göre sıralı',
    },
    {
        key: 'EXTREME',
        label: 'Uç',
        title: "Uç funding adayları: 8 saate eşdeğer oran, evrenin en uç %2'lik sınırını (en az ±0.0500%) 60 saniyedir aşanlar. Funding akışı panelindeki aday listesiyle aynıdır.",
        hint: 'uç funding adayları',
    },
    {
        key: 'FLIPPED',
        label: 'Yeni döndü',
        title: 'Son ödenen funding oranı sıfır veya pozitifken güncel tahmini oranı negatife dönenler.',
        hint: 'son ödeme ≥ 0, tahmin < 0',
    },
];

const matchesQuickFilter = (row: FuturesRow, filter: QuickFilter): boolean => {
    switch (filter) {
        case 'NEG':
            return row.fundingRate < 0;
        case 'EXTREME':
            return getFundingInfoFor(row.symbol)?.isCandidate === true;
        case 'FLIPPED': {
            if (!(row.fundingRate < 0)) return false;
            const info = getFundingInfoFor(row.symbol);
            return info !== null && info.prevSettledRate !== null && info.prevSettledRate >= 0;
        }
        default:
            return true;
    }
};

/** Tooltip of the candidate dot: the symbol's descriptive class (never advice). */
const candidateLabelFor = (info: NonNullable<ReturnType<typeof getFundingInfoFor>>): string => {
    const cls = info.cls === null ? (info.f8 < 0 ? 'Negatif uç' : 'Pozitif uç') : info.cls === 'NONE' ? EASING_BADGE_LABEL : SQUEEZE_CLASS_LABELS[info.cls];
    return `Uç funding adayı · ${cls}`;
};

const PAGE_SIZE = 150;
const EXPOSURE_TTL_MS = 5 * 60_000;
const EXPOSURE_RETRY_MS = 60_000;
const EXPOSURE_DEBOUNCE_MS = 300;
const EXPOSURE_REFRESH_TICK_MS = 60_000;
const ELEVATED_FUNDING = 0.0001; // 0.01% — Binance default; above this longs pay a premium
const PREFETCH_INTENT_DELAY_MS = 120; // pointer must rest on a row this long before its candles are warmed up

type ExposureState = Record<string, SideRatio | null>;
type ExposureResult = SideRatio | null | 'error';

const isHidden = (): boolean => typeof document !== 'undefined' && document.hidden;

// Keyboard (Tab) focus only: a mouse click also focuses the row, but then the click itself loads the charts.
const isKeyboardFocus = (el: HTMLElement): boolean => {
    try {
        return el.matches(':focus-visible');
    } catch {
        return true; // selector unsupported: treat as keyboard focus (prefetching is harmless)
    }
};

// Heat tint of a row: encodes the size of the 24h move (data colour, built from the theme tokens).
const tintBackground = (changePct: number): string | undefined => {
    if (!Number.isFinite(changePct) || changePct === 0) return undefined;
    const strength = Math.min(1, Math.abs(changePct) / 15);
    const pct = 5 + strength * 14; // 5% .. 19% of the success / danger token
    const token = changePct > 0 ? 'var(--color-success)' : 'var(--color-danger)';
    const mix = (p: number) => `color-mix(in srgb, ${token} ${p.toFixed(1)}%, transparent)`;
    return `linear-gradient(90deg, transparent 0%, ${mix(pct * 0.4)} 45%, ${mix(pct)} 100%)`;
};

const fundingClass = (rate: number): string =>
    rate < 0 ? 'text-danger' : rate > ELEVATED_FUNDING ? 'text-success' : 'text-text';

const deltaClass = (delta: number | null): string =>
    delta === null ? 'text-muted' : delta < 0 ? 'text-danger' : delta > 0 ? 'text-success' : 'text-secondary';

/** Funding delta (fraction) as percent points with an explicit sign, 4 decimals: '+0.0016' · '-0.0750' · '0.0000'. */
const formatDelta = (delta: number, withSymbol = false): string => {
    const body = formatFundingPct(Math.abs(delta), 4, withSymbol);
    if (Number.parseFloat(body) === 0) return body;
    return `${delta < 0 ? '-' : '+'}${body}`;
};

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface WatchRowProps {
    row: FuturesRow;
    selected: boolean;
    exposure: SideRatio | null | undefined;
    /** Predicted − last settled funding rate (fraction); null until the settled rates are known. */
    frDelta: number | null;
    /** Side of the symbol's active extreme-funding episode; null when it is not a candidate. */
    candidateSide: FundingSide | null;
    candidateLabel: string | null;
    onSelect: (symbol: string) => void;
    register: (el: HTMLElement) => () => void;
    /** Hover/keyboard-focus intent: warms up the row's candles after a short delay (stable callback). */
    onIntent: (symbol: string) => void;
    onIntentEnd: (symbol: string) => void;
}

const ExposureCell: React.FC<{ exposure: SideRatio | null | undefined }> = ({ exposure }) => {
    if (exposure === undefined) {
        return <span className="inline-block h-2 w-10 bg-surface-highlight" />;
    }
    if (exposure === null) return <span className="text-muted">—</span>;
    const longDominant = exposure.long >= exposure.short;
    const value = longDominant ? exposure.long : exposure.short;
    return (
        <span
            className={`inline-flex items-center justify-end gap-0.5 ${longDominant ? 'text-success' : 'text-danger'}`}
            title={`Long ${formatRatioPct(exposure.long)} · Short ${formatRatioPct(exposure.short)}`}
        >
            {formatRatioPct(value)}
            {longDominant ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
        </span>
    );
};

const WatchRow = React.memo<WatchRowProps>(({
    row,
    selected,
    exposure,
    frDelta,
    candidateSide,
    candidateLabel,
    onSelect,
    register,
    onIntent,
    onIntentEnd,
}) => {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        return register(el);
    }, [register]);

    const tint = tintBackground(row.changePct);
    const chgClass = row.changePct > 0 ? 'text-success' : row.changePct < 0 ? 'text-danger' : 'text-secondary';
    const fr = row.fundingRate;

    return (
        <div
            ref={ref}
            data-symbol={row.symbol}
            role="row"
            tabIndex={0}
            aria-selected={selected}
            onClick={() => onSelect(row.symbol)}
            onPointerEnter={(e) => {
                if (e.pointerType !== 'touch') onIntent(row.symbol); // no hover on touch screens (taps select directly)
            }}
            onPointerLeave={() => onIntentEnd(row.symbol)}
            onFocus={(e) => {
                if (isKeyboardFocus(e.currentTarget)) onIntent(row.symbol);
            }}
            onBlur={() => onIntentEnd(row.symbol)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(row.symbol);
                }
            }}
            className={`grid h-7 cursor-pointer items-center ${GRID_GAP} border-b border-border px-3 text-[11px] outline-none focus-visible:bg-surface-secondary focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-primary ${
                selected ? 'bg-surface-highlight' : 'hover:bg-surface-secondary'
            }`}
            style={{
                gridTemplateColumns: GRID_COLS,
                backgroundImage: tint,
                boxShadow: selected ? 'inset 2px 0 0 var(--color-brand)' : undefined,
            }}
        >
            <div role="cell" className="flex items-center gap-1.5 min-w-0">
                <CoinIcon asset={row.baseAsset} size={14} />
                <span className="truncate font-medium text-text">
                    {row.symbol}
                    <span className="text-muted">.P</span>
                </span>
            </div>
            <div role="cell" className="text-right font-mono text-text truncate">
                {formatPrice(row.price)}
            </div>
            <div role="cell" className={`text-right font-mono truncate ${chgClass}`}>
                {formatPct(row.changePct)}
            </div>
            <div role="cell" className="text-right font-mono text-text truncate">
                {formatCompact(row.quoteVolume)}
            </div>
            <div role="cell" className={`flex items-center justify-end gap-0.5 font-mono ${fundingClass(fr)}`}>
                {candidateSide && (
                    <span
                        role="img"
                        aria-label={candidateLabel ?? 'Uç funding adayı'}
                        title={candidateLabel ?? undefined}
                        className={`mr-0.5 h-[5px] w-[5px] shrink-0 rounded-full ${candidateSide === 'NEG' ? 'bg-danger' : 'bg-success'}`}
                    />
                )}
                <span className="truncate">{formatFundingPct(fr, 4, false)}</span>
                {fr < 0 && <ArrowDownLeft size={10} className="shrink-0" />}
            </div>
            <div
                role="cell"
                className={`text-right font-mono truncate ${deltaClass(frDelta)}`}
                title={frDelta === null ? 'Son ödenen oran henüz bilinmiyor' : `Tahmin − son ödeme: ${formatDelta(frDelta, true)}`}
            >
                {frDelta === null ? '—' : formatDelta(frDelta)}
            </div>
            <div role="cell" className="text-right font-mono text-text">
                {formatFundingInterval(row.fundingIntervalHours)}
            </div>
            <div role="cell" className="text-right font-mono">
                <ExposureCell exposure={exposure} />
            </div>
        </div>
    );
});
WatchRow.displayName = 'WatchRow';

const SkeletonRows: React.FC<{ count: number }> = ({ count }) => (
    <>
        {Array.from({ length: count }, (_, i) => (
            <div
                key={i}
                className={`grid h-7 items-center ${GRID_GAP} border-b border-border px-3`}
                style={{ gridTemplateColumns: GRID_COLS }}
            >
                <div className="flex items-center gap-1.5">
                    <span className="h-3.5 w-3.5 rounded-full bg-surface-highlight" />
                    <span className="h-2 w-16 bg-surface-highlight" />
                </div>
                {Array.from({ length: COLUMNS.length - 1 }, (__, j) => (
                    <span key={j} className="h-2 w-10 justify-self-end bg-surface-highlight" />
                ))}
            </div>
        ))}
    </>
);

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

export interface TerminalWatchlistProps {
    rows: FuturesRow[];
    selectedSymbol: string;
    onSelect: (symbol: string) => void;
    loading: boolean;
    error: string | null;
}

export const TerminalWatchlist: React.FC<TerminalWatchlistProps> = ({
    rows,
    selectedSymbol,
    onSelect,
    loading,
    error,
}) => {
    const [search, setSearch] = useState('');
    const [sortKey, setSortKey] = useState<SortKey>('quoteVolume');
    const [sortDir, setSortDir] = useState<SortDir>('desc');
    const [quickFilter, setQuickFilter] = useState<QuickFilter>('ALL');
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const [exposure, setExposure] = useState<ExposureState>({});

    // Funding store (candidates, settled rates): the snapshot changes at most once per second and only when
    // something changed. Rows receive primitives derived from it, so they do not re-render on store ticks.
    const flow = useFundingFlow();
    const flowVersion = flow.updatedAt;
    const flowReady = flow.ready;

    // The sort that was active before the 'Negatif' filter forced the 8h-equivalent order.
    const sortBeforeNegRef = useRef<{ key: SortKey; dir: SortDir } | null>(null);

    // Stable select handler so memoized rows don't re-render when the parent passes a new closure.
    const onSelectRef = useRef(onSelect);
    onSelectRef.current = onSelect;
    const handleSelect = useCallback((symbol: string) => onSelectRef.current(symbol), []);

    // ---- Candle prefetch on hover / keyboard focus (one shared timer for the whole list) ----
    const selectedSymbolRef = useRef(selectedSymbol);
    selectedSymbolRef.current = selectedSymbol;
    const intentTimerRef = useRef<number | null>(null);
    const intentSymbolRef = useRef<string | null>(null);

    /** Cancels the pending prefetch; with a symbol, only if that symbol is the pending one. */
    const cancelIntent = useCallback((symbol?: string) => {
        if (symbol !== undefined && intentSymbolRef.current !== symbol) return;
        if (intentTimerRef.current !== null && typeof window !== 'undefined') window.clearTimeout(intentTimerRef.current);
        intentTimerRef.current = null;
        intentSymbolRef.current = null;
    }, []);

    const handleIntent = useCallback(
        (symbol: string) => {
            if (typeof window === 'undefined') return;
            if (intentSymbolRef.current === symbol && intentTimerRef.current !== null) return; // already pending
            cancelIntent();
            if (symbol === selectedSymbolRef.current) return; // its charts are already loaded
            intentSymbolRef.current = symbol;
            intentTimerRef.current = window.setTimeout(() => {
                intentTimerRef.current = null;
                intentSymbolRef.current = null;
                if (symbol === selectedSymbolRef.current) return; // selected meanwhile: the charts fetch it themselves
                try {
                    prefetchKlines(symbol);
                } catch {
                    /* prefetching is best-effort */
                }
            }, PREFETCH_INTENT_DELAY_MS);
        },
        [cancelIntent],
    );

    useEffect(() => () => cancelIntent(), [cancelIntent]);

    // ---- Lazy market-exposure loading for rows that are actually on screen ----
    const scrollRef = useRef<HTMLDivElement>(null);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const elementsRef = useRef<Set<HTMLElement>>(new Set());
    const visibleRef = useRef<Set<string>>(new Set());
    const requestedAtRef = useRef<Map<string, number>>(new Map());
    const pendingRef = useRef<Map<string, ExposureResult>>(new Map());
    const flushTimerRef = useRef<number | null>(null);
    const requestTimerRef = useRef<number | null>(null);
    const mountedRef = useRef(false);
    const noObserverRef = useRef(false);

    const flushResults = useCallback(() => {
        flushTimerRef.current = null;
        if (!mountedRef.current || pendingRef.current.size === 0) return;
        const batch = pendingRef.current;
        pendingRef.current = new Map();
        setExposure((prev) => {
            let changed = false;
            const next: ExposureState = { ...prev };
            batch.forEach((value, symbol) => {
                if (value === 'error') {
                    // Keep the last good value on a failed refresh; otherwise show '—'.
                    if (prev[symbol] !== undefined) return;
                    next[symbol] = null;
                } else {
                    next[symbol] = value;
                }
                changed = true;
            });
            return changed ? next : prev;
        });
    }, []);

    const pushResult = useCallback(
        (symbol: string, value: ExposureResult) => {
            pendingRef.current.set(symbol, value);
            if (flushTimerRef.current === null && typeof window !== 'undefined') {
                flushTimerRef.current = window.setTimeout(flushResults, 250);
            }
        },
        [flushResults],
    );

    const requestVisible = useCallback(() => {
        requestTimerRef.current = null;
        if (!mountedRef.current) return;
        const now = Date.now();
        visibleRef.current.forEach((symbol) => {
            const last = requestedAtRef.current.get(symbol);
            if (last !== undefined && now - last < EXPOSURE_TTL_MS) return;
            requestedAtRef.current.set(symbol, now);
            let request: Promise<SideRatio | null>;
            try {
                request = fetchMarketExposure(symbol);
            } catch (err) {
                request = Promise.reject(err);
            }
            request.then(
                (value) => pushResult(symbol, value ?? null),
                () => {
                    // Retry sooner than the normal TTL after a failure.
                    requestedAtRef.current.set(symbol, Date.now() - EXPOSURE_TTL_MS + EXPOSURE_RETRY_MS);
                    pushResult(symbol, 'error');
                },
            );
        });
    }, [pushResult]);

    const scheduleRequest = useCallback(() => {
        if (typeof window === 'undefined') return;
        if (requestTimerRef.current !== null) window.clearTimeout(requestTimerRef.current);
        // Debounced: fast scrolling through the list only fetches rows where the user stops.
        requestTimerRef.current = window.setTimeout(requestVisible, EXPOSURE_DEBOUNCE_MS);
    }, [requestVisible]);

    const register = useCallback(
        (el: HTMLElement) => {
            elementsRef.current.add(el);
            if (observerRef.current) {
                observerRef.current.observe(el);
            } else if (noObserverRef.current && visibleRef.current.size < 40) {
                // No IntersectionObserver support: treat the first rows as visible.
                const sym = el.dataset.symbol;
                if (sym) visibleRef.current.add(sym);
                scheduleRequest();
            }
            return () => {
                elementsRef.current.delete(el);
                observerRef.current?.unobserve(el);
                const sym = el.dataset.symbol;
                if (sym) visibleRef.current.delete(sym);
            };
        },
        [scheduleRequest],
    );

    useEffect(() => {
        mountedRef.current = true;
        if (typeof window === 'undefined') return undefined;

        if (typeof IntersectionObserver === 'undefined') {
            noObserverRef.current = true;
            elementsRef.current.forEach((el) => {
                const sym = el.dataset.symbol;
                if (sym && visibleRef.current.size < 40) visibleRef.current.add(sym);
            });
            scheduleRequest();
        } else {
            const observer = new IntersectionObserver(
                (entries) => {
                    for (const entry of entries) {
                        const sym = (entry.target as HTMLElement).dataset.symbol;
                        if (!sym) continue;
                        if (entry.isIntersecting) visibleRef.current.add(sym);
                        else visibleRef.current.delete(sym);
                    }
                    scheduleRequest();
                },
                { root: scrollRef.current, rootMargin: '80px 0px' },
            );
            observerRef.current = observer;
            // Rows mount (and register) before this parent effect runs.
            elementsRef.current.forEach((el) => observer.observe(el));
        }

        // One shared timer refreshes exposures of on-screen rows once their TTL has passed.
        const refreshId = window.setInterval(() => {
            if (!isHidden()) requestVisible();
        }, EXPOSURE_REFRESH_TICK_MS);

        return () => {
            mountedRef.current = false;
            observerRef.current?.disconnect();
            observerRef.current = null;
            window.clearInterval(refreshId);
            if (requestTimerRef.current !== null) window.clearTimeout(requestTimerRef.current);
            if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
            requestTimerRef.current = null;
            flushTimerRef.current = null;
        };
    }, [requestVisible, scheduleRequest]);

    // ---- Filtering & sorting ----
    const searched = useMemo(() => {
        const q = search.trim().toUpperCase();
        if (!q) return rows;
        return rows.filter((r) => r.symbol.includes(q) || r.baseAsset.toUpperCase().includes(q));
    }, [rows, search]);

    // Live count of every quick filter over the searched rows (what each one would show).
    const counts = useMemo(() => {
        const c: Record<QuickFilter, number> = { ALL: searched.length, NEG: 0, EXTREME: 0, FLIPPED: 0 };
        for (const r of searched) {
            if (r.fundingRate < 0) c.NEG += 1;
            const info = flowReady ? getFundingInfoFor(r.symbol) : null;
            if (!info) continue;
            if (info.isCandidate) c.EXTREME += 1;
            if (r.fundingRate < 0 && info.prevSettledRate !== null && info.prevSettledRate >= 0) c.FLIPPED += 1;
        }
        return c;
        // flowVersion: the store's candidates / settled rates changed (the function reads module state).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searched, flowReady, flowVersion]);

    const filtered = useMemo(
        () => (quickFilter === 'ALL' ? searched : searched.filter((r) => matchesQuickFilter(r, quickFilter))),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [searched, quickFilter, flowVersion],
    );

    // Only re-sort on exposure updates while actually sorting by exposure.
    const exposureForSort = sortKey === 'exposure' ? exposure : null;
    // Likewise, the settled rates only matter while sorting by the funding delta.
    const flowVersionForSort = sortKey === 'frDelta' ? flowVersion : 0;

    const sorted = useMemo(() => {
        const dir = sortDir === 'asc' ? 1 : -1;
        const arr = filtered.slice();
        const byName = (a: FuturesRow, b: FuturesRow) => a.symbol.localeCompare(b.symbol);

        if (sortKey === 'symbol') {
            arr.sort((a, b) => dir * byName(a, b));
            return arr;
        }

        const valueOf = (r: FuturesRow): number => {
            if (sortKey === 'exposure') {
                const e = exposureForSort?.[r.symbol];
                return e ? e.long : NaN; // long share: most long-heavy first when descending
            }
            if (sortKey === 'f8') return fundingTo8h(r.fundingRate, r.fundingIntervalHours);
            if (sortKey === 'frDelta') return getFundingInfoFor(r.symbol)?.diff ?? NaN;
            return r[sortKey];
        };

        arr.sort((a, b) => {
            const va = valueOf(a);
            const vb = valueOf(b);
            const aMissing = !Number.isFinite(va);
            const bMissing = !Number.isFinite(vb);
            if (aMissing || bMissing) {
                if (aMissing && bMissing) return byName(a, b);
                return aMissing ? 1 : -1; // missing values always last
            }
            if (va !== vb) return dir * (va - vb);
            if (sortKey === 'fundingIntervalHours') {
                const fr = dir * (a.fundingRate - b.fundingRate);
                if (fr !== 0 && Number.isFinite(fr)) return fr;
            }
            return byName(a, b);
        });
        return arr;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filtered, sortKey, sortDir, exposureForSort, flowVersionForSort]);

    const shown = useMemo(() => sorted.slice(0, visibleCount), [sorted, visibleCount]);
    const remaining = sorted.length - shown.length;

    const toggleSort = (key: ColumnDef['key']) => {
        if (key === sortKey || (key === 'fundingRate' && sortKey === 'f8')) {
            // While the 'Negatif' filter sorts by the 8h-equivalent, the FR header toggles that order's direction.
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(key);
            setSortDir(key === 'symbol' ? 'asc' : 'desc');
        }
        setVisibleCount(PAGE_SIZE);
    };

    const onQuickFilter = (next: QuickFilter) => {
        if (next === quickFilter) return;
        if (next === 'NEG') {
            // Most negative first, compared on an 8h basis (1h / 4h / 8h intervals are not comparable raw).
            if (sortKey !== 'f8') sortBeforeNegRef.current = { key: sortKey, dir: sortDir };
            setSortKey('f8');
            setSortDir('asc');
        } else if (quickFilter === 'NEG' && sortKey === 'f8') {
            const prev = sortBeforeNegRef.current ?? { key: 'quoteVolume' as const, dir: 'desc' as const };
            sortBeforeNegRef.current = null;
            setSortKey(prev.key);
            setSortDir(prev.dir);
        }
        setQuickFilter(next);
        setVisibleCount(PAGE_SIZE);
    };

    const onSearchChange = (value: string) => {
        setSearch(value);
        setVisibleCount(PAGE_SIZE);
    };

    const showSkeleton = loading && rows.length === 0;
    const showFatalError = !loading && !!error && rows.length === 0;
    const activeQuickFilter = QUICK_FILTERS.find((f) => f.key === quickFilter) ?? QUICK_FILTERS[0];
    const filterHint = quickFilter === 'NEG' && sortKey !== 'f8' ? 'FR < 0' : activeQuickFilter.hint;

    return (
        <section
            lang="tr"
            className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface"
            aria-label="Vadeli işlemler izleme listesi"
        >
            {/* Panel header: title, count, search */}
            <header className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3">
                <h2 lang="en" className="text-[11px] font-semibold uppercase tracking-wider text-secondary">
                    Watchlist
                </h2>
                <span
                    className="rounded-sm bg-surface-secondary px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-secondary"
                    title={search || quickFilter !== 'ALL' ? `${filtered.length} / ${rows.length} sembol` : `${rows.length} sembol`}
                >
                    {showSkeleton ? '…' : filtered.length}
                </span>
                <div className="relative ml-auto w-full max-w-[180px]">
                    <Search
                        size={12}
                        aria-hidden="true"
                        className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted"
                    />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => onSearchChange(e.target.value)}
                        placeholder="Sembol ara…"
                        aria-label="Sembol ara"
                        spellCheck={false}
                        autoComplete="off"
                        className="h-6 w-full rounded-sm border border-border bg-surface-secondary pl-6 pr-6 text-[11px] text-text outline-none placeholder:text-muted focus:border-primary"
                    />
                    {search && (
                        <button
                            type="button"
                            onClick={() => onSearchChange('')}
                            className="absolute right-1 top-1/2 grid h-4 w-4 -translate-y-1/2 place-items-center rounded-sm text-secondary outline-none hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                            aria-label="Aramayı temizle"
                        >
                            <X size={12} aria-hidden="true" />
                        </button>
                    )}
                </div>
            </header>

            {/* Quick filters (funding based), with live counts */}
            <div className="flex h-6 shrink-0 items-center gap-2 border-b border-border px-3">
                <div className="inline-flex shrink-0 rounded-sm border border-border p-0.5" role="group" aria-label="Hızlı filtre">
                    {QUICK_FILTERS.map((f) => {
                        const active = f.key === quickFilter;
                        const count = counts[f.key];
                        return (
                            <button
                                key={f.key}
                                type="button"
                                onClick={() => onQuickFilter(f.key)}
                                aria-pressed={active}
                                title={f.title}
                                className={`flex h-5 items-center gap-1 rounded-sm px-1.5 text-[10px] leading-none outline-none transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${
                                    active ? 'bg-surface-highlight text-text' : 'text-secondary hover:text-text'
                                }`}
                            >
                                {f.label}
                                <span className={`font-mono ${active ? 'text-secondary' : 'text-muted'}`} aria-label={`${count} sembol`}>
                                    {showSkeleton ? '…' : count}
                                </span>
                            </button>
                        );
                    })}
                </div>
                {filterHint && (
                    <span className="ml-auto min-w-0 truncate text-right text-[10px] text-muted" title={activeQuickFilter.title}>
                        {filterHint}
                    </span>
                )}
            </div>

            {error && rows.length > 0 && (
                <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-danger-soft px-3 py-1 text-[10px] text-danger">
                    <TriangleAlert size={11} className="shrink-0" aria-hidden="true" />
                    <span className="truncate">{error}</span>
                </div>
            )}

            {/* Table (scrolls internally on both axes; never the page) */}
            <div ref={scrollRef} className="max-h-[420px] min-h-0 flex-1 overflow-auto lg:max-h-none">
                <div role="table" aria-label="Watchlist" style={{ minWidth: TABLE_MIN_WIDTH }}>
                    <div
                        role="row"
                        className={`sticky top-0 z-10 grid h-7 items-center ${GRID_GAP} border-b border-border bg-surface px-3 text-[10px] font-medium uppercase text-muted`}
                        style={{ gridTemplateColumns: GRID_COLS }}
                    >
                        {COLUMNS.map((col) => {
                            const viaF8 = col.key === 'fundingRate' && sortKey === 'f8';
                            const active = col.key === sortKey || viaF8;
                            const Icon = !active ? ChevronsUpDown : sortDir === 'asc' ? ChevronUp : ChevronDown;
                            return (
                                <button
                                    key={col.key}
                                    type="button"
                                    role="columnheader"
                                    aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                                    title={viaF8 ? `${col.title} Şu an 8 saate eşdeğer orana göre sıralı.` : col.title}
                                    onClick={() => toggleSort(col.key)}
                                    className={`group flex h-full min-w-0 items-center gap-0.5 uppercase outline-none transition-colors hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${
                                        col.align === 'right' ? 'justify-end text-right' : 'justify-start'
                                    } ${active ? 'text-text' : ''}`}
                                >
                                    <span className="truncate">{col.label}</span>
                                    {/* Inactive columns show the sort hint only on hover, so the labels fit narrow columns. */}
                                    <Icon
                                        size={10}
                                        aria-hidden="true"
                                        className={`shrink-0 ${active ? '' : 'hidden opacity-40 group-hover:inline-block'}`}
                                    />
                                </button>
                            );
                        })}
                    </div>

                    {showSkeleton && <SkeletonRows count={14} />}

                    {showFatalError && (
                        <div className="flex flex-col items-center justify-center gap-1 px-3 py-8 text-center text-xs text-muted">
                            <p className="flex items-center gap-1.5">
                                <TriangleAlert size={14} className="shrink-0 text-danger" aria-hidden="true" />
                                <span className="text-secondary">{error}</span>
                            </p>
                            <p>Bağlantınızı kontrol edip sayfayı yenilemeyi deneyin.</p>
                        </div>
                    )}

                    {!showSkeleton && !showFatalError && sorted.length === 0 && (
                        <div className="px-3 py-8 text-center text-xs text-muted">
                            {search
                                ? `"${search}" ile eşleşen sembol bulunamadı.`
                                : quickFilter !== 'ALL'
                                    ? !flowReady && quickFilter !== 'NEG'
                                        ? 'Funding verileri yükleniyor…'
                                        : `"${activeQuickFilter.label}" filtresiyle eşleşen sembol yok.`
                                    : 'Gösterilecek sembol yok.'}
                        </div>
                    )}

                    {shown.map((row) => {
                        const info = flowReady ? getFundingInfoFor(row.symbol) : null;
                        const candidateSide: FundingSide | null = info?.isCandidate ? (info.f8 < 0 ? 'NEG' : 'POS') : null;
                        return (
                            <WatchRow
                                key={row.symbol}
                                row={row}
                                selected={row.symbol === selectedSymbol}
                                exposure={exposure[row.symbol]}
                                frDelta={info?.diff ?? null}
                                candidateSide={candidateSide}
                                candidateLabel={info && candidateSide ? candidateLabelFor(info) : null}
                                onSelect={handleSelect}
                                register={register}
                                onIntent={handleIntent}
                                onIntentEnd={cancelIntent}
                            />
                        );
                    })}

                    {remaining > 0 && (
                        <button
                            type="button"
                            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                            className="h-7 w-full text-[11px] font-medium text-secondary outline-none transition-colors hover:bg-surface-secondary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-primary"
                        >
                            Daha fazla göster ({remaining} kaldı)
                        </button>
                    )}
                </div>
            </div>
        </section>
    );
};

export default TerminalWatchlist;
