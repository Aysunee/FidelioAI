import React, { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Info, RefreshCw, TriangleAlert } from 'lucide-react';
import { fetchOrderBookRatio, fetchRatio } from './terminalData';
import { formatBandPct, formatRatioPct, formatTime } from './format';
import type { RatioPeriod, SentimentKind, SideRatio } from './types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

type RatioKind = Exclude<SentimentKind, 'orderBook'>;

const RATIO_KINDS: readonly RatioKind[] = ['orderType', 'longShortAccounts', 'traderPositioning', 'marketExposure'];
const CARD_ORDER: readonly SentimentKind[] = ['orderBook', ...RATIO_KINDS];
const PERIODS: readonly RatioPeriod[] = ['5m', '15m', '1h', '4h', '1d'];

const BOOK_POLL_MS = 5_000;
const RATIO_POLL_MS = 60_000;
const HISTORY_POINTS = 30;
const FALLBACK_ERROR = 'Veri alınamadı. Lütfen daha sonra tekrar deneyin.';

interface MetricMeta {
    title: string;
    longTag: 'L' | 'B';
    shortTag: 'S';
    ratioLabel: string;
    info: string;
}

const METRICS: Record<SentimentKind, MetricMeta> = {
    orderBook: {
        title: 'EMİR DEFTERİ',
        longTag: 'B',
        shortTag: 'S',
        ratioLabel: 'B/S',
        info: 'Binance vadeli emir defterinde, orta fiyatın ±%1 aralığında bekleyen alış (B) ve satış (S) emirlerinin toplam nominal değerine (fiyat × miktar) göre dağılımı. BTC/ETH gibi derin defterlerde 1000 kademe bu aralığa yetmezse iki tarafın da ulaştığı simetrik banda daraltılır (kullanılan bant kartta yazar). Değer ardışık ölçümlerle yumuşatılır ve 5 saniyede bir güncellenir; çizgi bu oturumdaki son 30 ölçümü gösterir.',
    },
    orderType: {
        title: 'EMİR TİPİ',
        longTag: 'B',
        shortTag: 'S',
        ratioLabel: 'B/S',
        info: 'Seçili periyotta piyasa emirleriyle (taker) gerçekleşen alış (B) ve satış (S) hacminin dağılımı. Agresif alıcıların mı yoksa agresif satıcıların mı baskın olduğunu gösterir.',
    },
    longShortAccounts: {
        title: 'LONG/SHORT POZİSYONLARI',
        longTag: 'L',
        shortTag: 'S',
        ratioLabel: 'L/S',
        info: 'Binance\'te bu kontratta pozisyonu bulunan tüm hesapların long ve short tarafa göre dağılımı (hesap sayısına göre). Genel kitle duyarlılığını yansıtır.',
    },
    traderPositioning: {
        title: 'TRADER POZİSYONLARI',
        longTag: 'L',
        shortTag: 'S',
        ratioLabel: 'L/S',
        info: 'Binance\'te marjin bakiyesine göre en büyük trader hesaplarının (ilk %20) long/short dağılımı. Pozisyon büyüklüğüne değil, hesap sayısına göre hesaplanır.',
    },
    marketExposure: {
        title: 'PİYASA MARUZİYETİ',
        longTag: 'L',
        shortTag: 'S',
        ratioLabel: 'L/S',
        info: 'Binance\'te en büyük trader\'ların pozisyon büyüklüğüne göre long/short dağılımı. Hesap sayısı yerine açık pozisyonların toplam büyüklüğü baz alınır; büyük oyuncuların net yönünü gösterir.',
    },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SeriesState {
    key: string;          // symbol (order book) or `${symbol}|${period}` (ratios) the data belongs to
    series: SideRatio[];  // oldest -> newest
    error: string | null;
    loading: boolean;
}

const EMPTY_STATE: SeriesState = { key: '', series: [], error: null, loading: true };

const createRatioState = (): Record<RatioKind, SeriesState> => ({
    orderType: EMPTY_STATE,
    longShortAccounts: EMPTY_STATE,
    traderPositioning: EMPTY_STATE,
    marketExposure: EMPTY_STATE,
});

const toErrorMessage = (err: unknown): string =>
    err instanceof Error && err.message ? err.message : FALLBACK_ERROR;

const isDocumentHidden = (): boolean =>
    typeof document !== 'undefined' && document.visibilityState === 'hidden';

/** Normalizes a split so long + short === 1 (defensive against rounding in the source). */
const normalize = (r: SideRatio): { long: number; short: number } => {
    const total = r.long + r.short;
    if (!Number.isFinite(total) || total <= 0) return { long: 0.5, short: 0.5 };
    return { long: r.long / total, short: r.short / total };
};

// ---------------------------------------------------------------------------
// Sub components
// ---------------------------------------------------------------------------

const Sparkline = memo(function Sparkline({ values }: { values: number[] }) {
    const W = 100;
    const H = 24;
    const PAD = 2;
    const n = values.length;

    if (n < 2) {
        return (
            <div className="flex h-4 w-24 shrink-0 items-center justify-end text-[10px] text-muted sm:w-28" aria-hidden="true">
                —
            </div>
        );
    }

    let min = Math.min(...values);
    let max = Math.max(...values);
    if (max - min < 1e-4) {
        min -= 0.005;
        max += 0.005;
    }
    const x = (i: number) => (i / (n - 1)) * W;
    const y = (v: number) => PAD + (1 - (v - min) / (max - min)) * (H - PAD * 2);

    const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join('');
    const area = `${line}L${W},${H}L0,${H}Z`;
    const last = values[n - 1];
    const color = last >= 0.5 ? 'var(--color-success)' : 'var(--color-danger)';
    const midY = min <= 0.5 && max >= 0.5 ? y(0.5) : null;

    return (
        <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="h-4 w-24 shrink-0 overflow-visible sm:w-28"
            role="img"
            aria-label={`Son ${n} ölçümde long oranı: ${formatRatioPct(values[0])} → ${formatRatioPct(last)}`}
        >
            <path d={area} fill={color} fillOpacity={0.14} stroke="none" />
            {midY !== null && (
                <line
                    x1={0}
                    x2={W}
                    y1={midY}
                    y2={midY}
                    stroke="var(--color-text-secondary)"
                    strokeOpacity={0.45}
                    strokeWidth={1}
                    strokeDasharray="2 2"
                    vectorEffect="non-scaling-stroke"
                />
            )}
            <path
                d={line}
                fill="none"
                stroke={color}
                strokeWidth={1.25}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    );
});

const InfoTip = memo(function InfoTip({
    label,
    text,
    placement,
}: {
    label: string;
    text: string;
    placement: 'top' | 'bottom';
}) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLSpanElement>(null);
    const tooltipId = useId();

    // Close on outside tap / Escape (touch devices have no hover-out).
    useEffect(() => {
        if (!open || typeof document === 'undefined') return;
        const onPointerDown = (e: PointerEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    return (
        <span
            ref={wrapRef}
            className="relative inline-flex"
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
        >
            <button
                type="button"
                className="grid h-5 w-5 place-items-center rounded-sm text-muted outline-none transition-colors hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                aria-label={`${label} hakkında bilgi`}
                aria-describedby={tooltipId}
                aria-expanded={open}
                onClick={() => setOpen(true)}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
            >
                <Info className="h-3 w-3" aria-hidden="true" />
            </button>
            <span
                id={tooltipId}
                role="tooltip"
                className={`pointer-events-none absolute right-0 z-30 w-60 max-w-[calc(100vw-48px)] rounded-sm border border-border-strong bg-surface px-2.5 py-2 text-[11px] font-normal normal-case leading-snug tracking-normal text-text shadow-overlay transition-opacity duration-150 ${
                    placement === 'top' ? 'bottom-full mb-1' : 'top-full mt-1'
                } ${
                    open ? 'visible opacity-100' : 'invisible opacity-0'
                }`}
            >
                {text}
            </span>
        </span>
    );
});

const SplitBar = ({ ratio, meta }: { ratio: SideRatio; meta: MetricMeta }) => {
    const { long, short } = normalize(ratio);
    return (
        <div className="mt-1 flex items-center gap-2 font-mono text-[11px]">
            <span className={`shrink-0 text-success ${long >= short ? 'font-semibold' : ''}`}>
                {meta.longTag} {formatRatioPct(long)}
            </span>
            <div
                className="flex h-1.5 min-w-0 flex-1 gap-px overflow-hidden"
                role="img"
                aria-label={`${meta.longTag === 'B' ? 'Alış' : 'Long'} ${formatRatioPct(long)}, ${meta.longTag === 'B' ? 'satış' : 'short'} ${formatRatioPct(short)}`}
            >
                <div
                    className="h-full shrink-0 bg-success transition-[width] duration-500 ease-out"
                    style={{ width: `${long * 100}%` }}
                />
                <div className="h-full min-w-0 flex-1 bg-danger" />
            </div>
            <span className={`shrink-0 text-danger ${short > long ? 'font-semibold' : ''}`}>
                {formatRatioPct(short)} {meta.shortTag}
            </span>
        </div>
    );
};

const CardSkeleton = () => (
    <div aria-hidden="true">
        <div className="mt-1 flex h-4 items-center gap-2">
            <div className="h-2 w-14 bg-surface-highlight" />
            <div className="h-1.5 flex-1 bg-surface-highlight" />
            <div className="h-2 w-14 bg-surface-highlight" />
        </div>
        <div className="mt-1 flex h-4 items-center justify-between gap-3">
            <div className="h-2 w-20 bg-surface-highlight" />
            <div className="h-2 w-24 bg-surface-highlight sm:w-28" />
        </div>
    </div>
);

interface SentimentCardProps {
    kind: SentimentKind;
    state: SeriesState;
    contextLabel: string;
    tooltipPlacement: 'top' | 'bottom';
}

const SentimentCard = memo(function SentimentCard({ kind, state, contextLabel, tooltipPlacement }: SentimentCardProps) {
    const meta = METRICS[kind];
    const { series, error, loading } = state;
    const latest = series.length > 0 ? series[series.length - 1] : null;

    let body: React.ReactNode;
    if (latest) {
        const { long, short } = normalize(latest);
        const ratioText = short > 0 ? (long / short).toFixed(2) : '—';
        body = (
            <>
                <SplitBar ratio={latest} meta={meta} />
                <div className="mt-1 flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-mono text-[10px] text-muted">
                        {meta.ratioLabel} <span className="text-text">{ratioText}</span>
                        <span className="mx-1">·</span>
                        {contextLabel}
                    </span>
                    <Sparkline values={series.map((p) => normalize(p).long)} />
                </div>
            </>
        );
    } else if (loading) {
        body = <CardSkeleton />;
    } else if (error) {
        body = (
            <div className="mt-1 flex items-start gap-1.5 text-[11px] leading-snug text-danger" role="alert">
                <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{error}</span>
            </div>
        );
    } else {
        body = <div className="mt-1 text-[11px] text-muted">Bu sembol ve periyot için veri bulunmuyor.</div>;
    }

    return (
        <article className="h-full bg-surface px-3 py-2" aria-busy={loading && !latest}>
            <div className="flex h-5 items-center justify-between gap-2">
                <h3 className="truncate text-[10px] font-semibold uppercase tracking-wider text-secondary">{meta.title}</h3>
                <div className="flex shrink-0 items-center gap-1">
                    {latest && error && (
                        <span className="text-warning" title={`Son güncelleme başarısız: ${error}`}>
                            <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                            <span className="sr-only">Son güncelleme başarısız: {error}</span>
                        </span>
                    )}
                    <InfoTip label={meta.title} text={meta.info} placement={tooltipPlacement} />
                </div>
            </div>
            {body}
        </article>
    );
});

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export interface TerminalSentimentPanelProps {
    symbol: string;
    /** Replaces the panel title + symbol badge in the header row (e.g. the tab strip of the terminal's bottom area). */
    titleSlot?: React.ReactNode;
}

export const TerminalSentimentPanel: React.FC<TerminalSentimentPanelProps> = ({ symbol, titleSlot }) => {
    const [period, setPeriod] = useState<RatioPeriod>('5m');
    const [book, setBook] = useState<SeriesState>(EMPTY_STATE);
    const [ratios, setRatios] = useState<Record<RatioKind, SeriesState>>(createRatioState);
    const [lastUpdated, setLastUpdated] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);

    const pendingRef = useRef(0);
    const bookLoadRef = useRef<(() => void) | null>(null);
    const ratioLoadRef = useRef<(() => void) | null>(null);

    const beginRequest = useCallback(() => {
        pendingRef.current += 1;
        setBusy(true);
    }, []);
    const endRequest = useCallback(() => {
        pendingRef.current = Math.max(0, pendingRef.current - 1);
        if (pendingRef.current === 0) setBusy(false);
    }, []);

    // --- Order book: every 5s and on symbol change -------------------------
    useEffect(() => {
        setLastUpdated(null);
        if (!symbol) {
            bookLoadRef.current = null;
            return;
        }
        const key = symbol;
        let cancelled = false;
        let inFlight = false;

        const load = () => {
            if (inFlight || cancelled) return;
            inFlight = true;
            beginRequest();
            fetchOrderBookRatio(key)
                .then((result) => {
                    if (cancelled) return;
                    setBook((prev) => {
                        const base = prev.key === key ? prev.series : [];
                        return result
                            ? { key, series: [...base, result].slice(-HISTORY_POINTS), error: null, loading: false }
                            : { key, series: base, error: 'Emir defteri verisi bulunamadı.', loading: false };
                    });
                    if (result) setLastUpdated(Date.now());
                })
                .catch((err: unknown) => {
                    if (cancelled) return;
                    setBook((prev) => ({
                        key,
                        series: prev.key === key ? prev.series : [],
                        error: toErrorMessage(err),
                        loading: false,
                    }));
                })
                .finally(() => {
                    inFlight = false;
                    endRequest();
                });
        };

        bookLoadRef.current = load;
        load();
        const timer = setInterval(() => {
            if (!isDocumentHidden()) load();
        }, BOOK_POLL_MS);
        const onVisibility = () => {
            if (!isDocumentHidden()) load();
        };
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

        return () => {
            cancelled = true;
            clearInterval(timer);
            if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
            if (bookLoadRef.current === load) bookLoadRef.current = null;
        };
    }, [symbol, beginRequest, endRequest]);

    // --- Ratio endpoints: every 60s and on symbol / period change ----------
    useEffect(() => {
        if (!symbol) {
            ratioLoadRef.current = null;
            return;
        }
        const key = `${symbol}|${period}`;
        let cancelled = false;
        const inFlight: Record<RatioKind, boolean> = {
            orderType: false,
            longShortAccounts: false,
            traderPositioning: false,
            marketExposure: false,
        };

        const loadKind = (kind: RatioKind) => {
            if (inFlight[kind] || cancelled) return;
            inFlight[kind] = true;
            beginRequest();
            fetchRatio(kind, symbol, period, HISTORY_POINTS)
                .then((series) => {
                    if (cancelled) return;
                    setRatios((prev) => ({ ...prev, [kind]: { key, series, error: null, loading: false } }));
                    if (series.length > 0) setLastUpdated(Date.now());
                })
                .catch((err: unknown) => {
                    if (cancelled) return;
                    setRatios((prev) => {
                        const current = prev[kind];
                        return {
                            ...prev,
                            [kind]: {
                                key,
                                series: current.key === key ? current.series : [],
                                error: toErrorMessage(err),
                                loading: false,
                            },
                        };
                    });
                })
                .finally(() => {
                    inFlight[kind] = false;
                    endRequest();
                });
        };
        const loadAll = () => RATIO_KINDS.forEach(loadKind);

        ratioLoadRef.current = loadAll;
        loadAll();
        const timer = setInterval(() => {
            if (!isDocumentHidden()) loadAll();
        }, RATIO_POLL_MS);

        return () => {
            cancelled = true;
            clearInterval(timer);
            if (ratioLoadRef.current === loadAll) ratioLoadRef.current = null;
        };
    }, [symbol, period, beginRequest, endRequest]);

    const handleRefresh = useCallback(() => {
        bookLoadRef.current?.();
        ratioLoadRef.current?.();
    }, []);

    // Data that belongs to a previous symbol/period is shown as loading, never as current.
    const ratioKey = `${symbol}|${period}`;
    const stateFor = (kind: SentimentKind): SeriesState => {
        const s = kind === 'orderBook' ? book : ratios[kind];
        const expectedKey = kind === 'orderBook' ? symbol : ratioKey;
        return s.key === expectedKey ? s : EMPTY_STATE;
    };

    return (
        <section lang="tr" className="flex h-full min-h-0 min-w-0 flex-col bg-surface" aria-label="Piyasa duyarlılığı">
            <header className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3">
                {titleSlot ? (
                    <div className="flex h-8 min-w-0 flex-1 items-center">{titleSlot}</div>
                ) : (
                    // The symbol badge drops out (wraps onto a clipped second line) when the column is too narrow for it.
                    <div className="flex h-8 min-w-0 flex-1 flex-wrap content-start items-center gap-x-2 overflow-hidden">
                        <h2 className="flex h-8 max-w-full items-center text-[11px] font-semibold uppercase tracking-wider text-secondary">
                            <span className="truncate">Piyasa Duyarlılığı</span>
                        </h2>
                        <span className="flex h-8 items-center">
                            <span className="rounded-sm bg-surface-secondary px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-secondary">
                                {symbol ? `${symbol}.P` : '—'}
                            </span>
                        </span>
                    </div>
                )}
                <div className="flex shrink-0 items-center gap-1">
                    <div className="inline-flex rounded-sm border border-border p-0.5" role="group" aria-label="Oran periyodu">
                        {PERIODS.map((p) => {
                            const active = p === period;
                            return (
                                <button
                                    key={p}
                                    type="button"
                                    onClick={() => setPeriod(p)}
                                    aria-pressed={active}
                                    className={`h-5 rounded-sm px-1.5 font-mono text-[11px] leading-none outline-none transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${
                                        active ? 'bg-surface-highlight text-text' : 'text-secondary hover:text-text'
                                    }`}
                                >
                                    {p}
                                </button>
                            );
                        })}
                    </div>
                    <button
                        type="button"
                        onClick={handleRefresh}
                        disabled={!symbol}
                        className="grid h-6 w-6 place-items-center rounded-sm text-secondary outline-none transition-colors hover:bg-surface-secondary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary disabled:opacity-50"
                        aria-label="Verileri yenile"
                        title="Yenile"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
                    </button>
                </div>
            </header>

            <div className="flex h-6 shrink-0 items-center justify-between gap-2 border-b border-border px-3 text-[10px] text-muted">
                <span className="min-w-0 truncate">Emir defteri 5 sn · oranlar 60 sn</span>
                <span className="shrink-0 font-mono">
                    Son güncelleme: {formatTime(lastUpdated)}
                </span>
            </div>

            {symbol ? (
                // One column in the narrow right column (lg); two columns where the panel is wide enough
                // (stacked tablet layout, xl+) so all five cards fit without scrolling. The order book spans both.
                <div className="min-h-0 flex-1 overflow-y-auto">
                    <div className="grid grid-cols-1 gap-px border-b border-border bg-border sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                        {CARD_ORDER.map((kind, index) => (
                            <div key={kind} className={kind === 'orderBook' ? 'min-w-0 bg-surface sm:col-span-2 lg:col-span-1 xl:col-span-2' : 'min-w-0 bg-surface'}>
                                <SentimentCard
                                    kind={kind}
                                    state={stateFor(kind)}
                                    contextLabel={kind === 'orderBook' ? `${formatBandPct(stateFor('orderBook').series[stateFor('orderBook').series.length - 1]?.bandPct) || '±%1'} bant` : period}
                                    tooltipPlacement={index >= 3 ? 'top' : 'bottom'}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="flex flex-1 items-center justify-center p-3 text-xs text-muted">
                    Duyarlılık verilerini görmek için bir sembol seçin.
                </div>
            )}
        </section>
    );
};
