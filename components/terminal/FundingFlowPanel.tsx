import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { FundingEvent, FundingEventType, FundingSide } from '../../utils/fundingSqueeze';
import { formatCompact, formatCountdown, formatPrice, formatTime } from './format';
import {
    EASING_BADGE_CLASS,
    EASING_BADGE_LABEL,
    SQUEEZE_CLASS_BADGE,
    SQUEEZE_CLASS_SHORT,
    formatSignedFunding,
    formatSignedPct,
    isEasingCandidate,
    useFundingFlow,
} from './fundingFlow';
import type { FundingCandidate } from './fundingFlow';

// ---------------------------------------------------------------------------
// Funding flow panel: active extreme-funding candidates + the live event feed.
// Everything shown is a description of the current state ("durum tespiti"), not a forecast.
// ---------------------------------------------------------------------------

type SideFilter = 'NEG' | 'POS' | 'ALL';

const FILTERS: ReadonlyArray<{ key: SideFilter; label: string; title: string }> = [
    { key: 'NEG', label: 'Negatif', title: "Negatif funding: short'lar long'lara ödüyor" },
    { key: 'POS', label: 'Pozitif', title: "Pozitif funding: long'lar short'lara ödüyor" },
    { key: 'ALL', label: 'Tümü', title: 'İki taraf birlikte' },
];

// Shared by the header and the rows so every column lines up. The numeric minimums are the widths of the
// data at 11px ('−0.8610/4s' 67 + 2 of air after the f8 column, '03:41:59' 54, '+15.3' 34) and of the widest
// badge ('GEVŞİYOR' 61), so that in a 420px wide panel — even while its (thin, 4px) scrollbar is showing —
// the symbol column keeps the 74px a 'MOVRUSDT.P' needs. The '%' sign lives in the column headers (as in
// the watchlist) to keep cells narrow.
const GRID_COLS =
    'minmax(56px,1.6fr) minmax(47px,0.9fr) minmax(69px,1.15fr) minmax(54px,0.9fr) minmax(34px,0.7fr) minmax(35px,0.7fr) minmax(61px,1fr)';
const GRID_GAP = 'gap-x-[3px]';
const TABLE_MIN_WIDTH = 398; // below this the table scrolls sideways inside its section (never the page)

/** Percent for a 34px cell: one decimal, none from 100 up ('+15.3' · '−0.4' · '+154'). */
const formatNarrowPct = (pct: number): string => formatSignedPct(pct, Math.abs(pct) >= 99.95 ? 0 : 1, false);

const LOW_LIQUIDITY_TITLE = 'Düşük likidite: 24 saatlik hacim 5M USDT altında';

const COLUMNS: ReadonlyArray<{ label: string; title: string; align: 'left' | 'right' }> = [
    { label: 'Sembol', title: 'USDT perpetual sözleşme', align: 'left' },
    { label: 'f8 %', title: 'Tahmini funding oranı, 8 saate eşdeğer (%). Farklı ödeme aralıkları bu sütunda karşılaştırılabilir.', align: 'right' },
    { label: 'Oran %', title: 'Ham tahmini oran (%) / ödeme aralığı (saat)', align: 'right' },
    { label: 'Kalan', title: 'Bir sonraki funding ödemesine kalan süre', align: 'right' },
    { label: '24s %', title: '24 saatlik fiyat değişimi (%)', align: 'right' },
    { label: 'ΔOI 4s', title: 'Açık pozisyonun (kontrat adedi) son 4 saatteki değişimi (%). Saatlik veridir, en fazla 1 saat geriden gelir.', align: 'right' },
    { label: 'Sınıf', title: 'Durum sınıfı: funding, fiyat ve açık pozisyonun birlikte tarifi. Tahmin değildir.', align: 'right' },
];

const EVENT_BADGE: Record<FundingEventType, string> = {
    FLIP: 'Dönüş',
    EXTREME: 'Uç',
    DEEPENING: 'Derinleşme',
    EASING: 'Hafifleme',
    EXIT: 'Çıkış',
};

const eventBadgeClass = (event: FundingEvent): string => {
    if (event.type === 'FLIP') return 'bg-primary-soft text-primary';
    if (event.type === 'EXIT') return 'bg-surface-secondary text-secondary';
    if (event.type === 'EASING') return 'bg-warning-soft text-warning';
    return event.side === 'NEG' ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success';
};

const eventHeadline = (event: FundingEvent): string => {
    const neg = event.side === 'NEG';
    switch (event.type) {
        case 'FLIP':
            return `${event.initial ? 'Son ödemeye göre funding' : 'Funding'} ${neg ? '+ → −' : '− → +'} döndü`;
        case 'EXTREME':
            if (event.initial) return neg ? 'Açılışta negatif uçta' : 'Açılışta pozitif uçta';
            return neg ? 'Negatif uca girdi' : 'Pozitif uca girdi';
        case 'DEEPENING':
            return neg ? 'Negatif funding derinleşti' : 'Pozitif funding yükseldi';
        case 'EASING':
            return neg ? 'Negatif funding hafifledi' : 'Pozitif funding hafifledi';
        default:
            return neg ? 'Negatif uçtan çıktı' : 'Pozitif uçtan çıktı';
    }
};

/** 'Funding + → − döndü · −0.0700% / 4s (önceki +0.0050%, fark −0.0750%)' */
const eventSentence = (event: FundingEvent): string => {
    let text = `${eventHeadline(event)} · ${formatSignedFunding(event.rate)} / ${event.intervalHours}s`;
    if (event.prevSettledRate !== null) {
        text += ` (önceki ${formatSignedFunding(event.prevSettledRate)}`;
        if (event.diff !== null) text += `, fark ${formatSignedFunding(event.diff)}`;
        text += ')';
    }
    return text;
};

const signClass = (n: number): string => (n < 0 ? 'text-danger' : n > 0 ? 'text-success' : 'text-secondary');

const matchesFilter = (side: FundingSide, filter: SideFilter): boolean => filter === 'ALL' || side === filter;

const onActivateKey = (e: React.KeyboardEvent, activate: () => void): void => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
    }
};

const ROW_FOCUS =
    'outline-none focus-visible:bg-surface-secondary focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-primary';
const ROW_SELECTED = 'bg-surface-highlight shadow-[inset_2px_0_0_var(--color-brand)]';

/** One shared clock for every countdown in the panel. */
const useSecondTick = (): number => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        setNow(Date.now());
        const id = window.setInterval(() => setNow(Date.now()), 1_000);
        return () => window.clearInterval(id);
    }, []);
    return now;
};

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

// The mark is a positioned box ('relative' inline, 'absolute' in the table gutter), which keeps its
// absolutely positioned sr-only text inside it: the scrolling lists clip it instead of it stretching the page.
const LowLiquidityMark = ({ gutter = false }: { gutter?: boolean }) => (
    <span
        className={`inline-flex shrink-0 text-warning ${gutter ? 'absolute -left-[10px] top-1/2 -translate-y-1/2' : 'relative'}`}
        title={LOW_LIQUIDITY_TITLE}
    >
        <AlertTriangle size={gutter ? 8 : 10} strokeWidth={gutter ? 2.5 : 2} aria-hidden="true" />
        <span className="sr-only">Düşük likidite</span>
    </span>
);

interface CandidateRowProps {
    candidate: FundingCandidate;
    selected: boolean;
    easing: boolean; // eased back out of the gate, still inside the hysteresis band
    countdown: string;
    onSelect: (symbol: string) => void;
}

const CandidateRow = memo(function CandidateRow({ candidate, selected, easing, countdown, onSelect }: CandidateRowProps) {
    const c = candidate;
    const neg = c.side === 'NEG';
    const oi4 = c.details?.oiChange4hPct;
    const a = c.assessment;

    let badgeText: string;
    let badgeClass: string;
    let badgeTitle: string;
    if (easing) {
        badgeText = EASING_BADGE_LABEL;
        badgeClass = EASING_BADGE_CLASS;
        badgeTitle = neg
            ? 'Gevşiyor: oran negatif uç eşiğinin üzerine geri çekildi, ancak −0.0300% bandının içinde olduğu için listede kalıyor. Bandın dışına çıkınca listeden düşer.'
            : 'Gevşiyor: oran pozitif uç eşiğinin altına geri çekildi, ancak +0.0300% bandının içinde olduğu için listede kalıyor. Bandın dışına çıkınca listeden düşer.';
    } else if (neg && a) {
        badgeText = SQUEEZE_CLASS_SHORT[a.cls];
        badgeClass = SQUEEZE_CLASS_BADGE[a.cls];
        const missing = a.items.length - a.known;
        badgeTitle = `${a.label} — ${a.passed} / ${a.known} koşul${missing > 0 ? ` (${missing} veri yok)` : ''}\n${a.description}`;
    } else if (neg) {
        badgeText = 'Negatif';
        badgeClass = 'bg-surface-secondary text-secondary';
        badgeTitle = 'Negatif funding uç bölgede';
    } else {
        badgeText = 'Pozitif';
        badgeClass = 'bg-surface-secondary text-secondary';
        badgeTitle = "Pozitif funding uç bölgede (long'lar ödüyor). Sıkışma kontrolü negatif taraf içindir.";
    }

    const rowTitle =
        `${c.symbol} · uç bölgede görüldüğü an: ${formatTime(c.since)} · fiyat ${formatPrice(c.price)} · 24s hacim ${formatCompact(c.quoteVolume)}` +
        (c.lowLiquidity ? ' (düşük likidite)' : '') +
        (c.prevSettledRate !== null
            ? ` · önceki ödeme ${formatSignedFunding(c.prevSettledRate)}${c.diff !== null ? `, fark ${formatSignedFunding(c.diff)}` : ''}`
            : '');

    return (
        <div
            role="row"
            tabIndex={0}
            aria-current={selected ? 'true' : undefined}
            onClick={() => onSelect(c.symbol)}
            onKeyDown={(e) => onActivateKey(e, () => onSelect(c.symbol))}
            className={`grid h-7 cursor-pointer items-center ${GRID_GAP} border-b border-border px-3 text-[11px] ${ROW_FOCUS} ${
                selected ? ROW_SELECTED : 'hover:bg-surface-secondary'
            }`}
            style={{ gridTemplateColumns: GRID_COLS }}
        >
            {/* The low-liquidity mark sits in the row's left padding, so it costs the symbol no width. */}
            <div role="cell" className="relative flex min-w-0 items-center" title={rowTitle}>
                {c.lowLiquidity && <LowLiquidityMark gutter />}
                <span className="truncate font-medium text-text">
                    {c.symbol}
                    <span className="text-muted">.P</span>
                </span>
            </div>
            <div role="cell" className={`truncate text-right font-mono font-semibold ${neg ? 'text-danger' : 'text-success'}`}>
                {formatSignedFunding(c.f8, false)}
            </div>
            <div role="cell" className="truncate text-right font-mono text-text">
                {formatSignedFunding(c.rate, false)}
                <span className="text-muted">/{c.intervalHours}s</span>
            </div>
            <div role="cell" className="truncate text-right font-mono text-secondary">
                {countdown}
            </div>
            <div
                role="cell"
                className={`truncate text-right font-mono ${signClass(c.changePct)}`}
                title={`24 saatlik değişim: ${formatSignedPct(c.changePct)}`}
            >
                {formatNarrowPct(c.changePct)}
            </div>
            <div role="cell" className="truncate text-right font-mono">
                {typeof oi4 === 'number' && Number.isFinite(oi4) ? (
                    <span className={signClass(oi4)}>{formatNarrowPct(oi4)}</span>
                ) : c.detailsLoading ? (
                    <span className="inline-block h-2 w-7 bg-surface-highlight align-middle" aria-label="Yükleniyor" />
                ) : (
                    <span className="text-muted">—</span>
                )}
            </div>
            <div role="cell" className="flex min-w-0 justify-end">
                <span
                    className={`truncate rounded-sm px-1 py-0.5 text-[10px] font-semibold uppercase leading-none ${badgeClass}`}
                    title={badgeTitle}
                >
                    {badgeText}
                </span>
            </div>
        </div>
    );
});

interface EventRowProps {
    event: FundingEvent;
    selected: boolean;
    remaining: string | null; // live countdown to the funding payment the event refers to; null once it has passed
    onSelect: (symbol: string) => void;
}

const EventRow = memo(function EventRow({ event, selected, remaining, onSelect }: EventRowProps) {
    return (
        <li
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            onClick={() => onSelect(event.symbol)}
            onKeyDown={(e) => onActivateKey(e, () => onSelect(event.symbol))}
            className={`cursor-pointer border-b border-border px-3 py-1.5 text-xs ${ROW_FOCUS} ${
                selected ? ROW_SELECTED : 'hover:bg-surface-secondary'
            }`}
        >
            <div className="flex h-4 items-center gap-2">
                <time className="shrink-0 font-mono text-[10px] text-muted" dateTime={new Date(event.time).toISOString()}>
                    {formatTime(event.time)}
                </time>
                <span className="min-w-0 truncate font-medium text-text">
                    {event.symbol}
                    <span className="text-muted">.P</span>
                </span>
                {event.lowLiquidity && <LowLiquidityMark />}
                <span
                    className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none ${eventBadgeClass(event)}`}
                >
                    {EVENT_BADGE[event.type]}
                </span>
                <span
                    className={`ml-auto shrink-0 font-mono ${event.side === 'NEG' ? 'text-danger' : 'text-success'}`}
                    title="Olay anındaki tahmini oran, 8 saate eşdeğer"
                >
                    <span className="mr-1 font-sans text-[10px] text-muted">f8</span>
                    {formatSignedFunding(event.f8)}
                </span>
            </div>
            {/* The countdown is its own unit: next to a short sentence, on a line of its own after a long one. */}
            <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] leading-4 text-secondary [font-variant-numeric:tabular-nums]">
                <span className="min-w-0">{eventSentence(event)}</span>
                {remaining !== null && (
                    <span className="whitespace-nowrap text-muted" title="Olayın ait olduğu funding ödemesine kalan süre">
                        kalan {remaining}
                    </span>
                )}
            </p>
        </li>
    );
});

const SkeletonRows = ({ count }: { count: number }) => (
    <div aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
            <div key={i} className="flex h-7 items-center gap-3 border-b border-border px-3">
                <span className="h-2 w-20 bg-surface-highlight" />
                <span className="ml-auto h-2 w-10 bg-surface-highlight" />
                <span className="h-2 w-12 bg-surface-highlight" />
                <span className="h-2 w-12 bg-surface-highlight" />
            </div>
        ))}
    </div>
);

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export interface FundingFlowPanelProps {
    selectedSymbol: string;
    onSelect: (symbol: string) => void;
    /** Replaces the panel title in the header row (e.g. the tab strip of the terminal's bottom area). */
    titleSlot?: React.ReactNode;
}

export const FundingFlowPanel: React.FC<FundingFlowPanelProps> = ({ selectedSymbol, onSelect, titleSlot }) => {
    const flow = useFundingFlow();
    const now = useSecondTick();
    const [filter, setFilter] = useState<SideFilter>('NEG');
    const [hideLowLiquidity, setHideLowLiquidity] = useState(false);

    // Stable handler so memoized rows do not re-render when the parent passes a new closure.
    const onSelectRef = useRef(onSelect);
    onSelectRef.current = onSelect;
    const handleSelect = useCallback((symbol: string) => onSelectRef.current(symbol), []);

    const { candidates, hiddenCandidates } = useMemo(() => {
        const bySide = flow.candidates.filter((c) => matchesFilter(c.side, filter));
        const visible = hideLowLiquidity ? bySide.filter((c) => !c.lowLiquidity) : bySide;
        return { candidates: visible, hiddenCandidates: bySide.length - visible.length };
    }, [flow.candidates, filter, hideLowLiquidity]);

    const events = useMemo(
        () => flow.events.filter((e) => matchesFilter(e.side, filter) && !(hideLowLiquidity && e.lowLiquidity)),
        [flow.events, filter, hideLowLiquidity],
    );

    const stats = flow.stats;
    const gateText = !stats
        ? ''
        : filter === 'NEG'
            ? `eşik ≤ ${formatSignedFunding(stats.negGate)}`
            : filter === 'POS'
                ? `eşik ≥ ${formatSignedFunding(stats.posGate)}`
                : `eşik ≤ ${formatSignedFunding(stats.negGate)} / ≥ ${formatSignedFunding(stats.posGate)}`;
    const gateTitle = stats
        ? `Uç bölge eşiği (8 saate eşdeğer oran): sabit ±0.0500% ile ${stats.count} kripto perpetual'in en uç %2'lik sınırından daha uç olanı. ` +
          'Bir sembol eşiği en az 60 saniye boyunca aşarsa listeye girer, oran ±0.0300% bandının dışına çıkınca listeden düşer. ' +
          'Hisse, döviz ve emtia (TradFi) sözleşmeleri kapsam dışıdır.'
        : undefined;

    const emptyCandidates =
        filter === 'NEG'
            ? 'Şu anda negatif uçta sembol yok.'
            : filter === 'POS'
                ? 'Şu anda pozitif uçta sembol yok.'
                : 'Şu anda uç funding bölgesinde sembol yok.';

    const subHeader =
        'flex h-6 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-secondary px-3 text-[10px] uppercase tracking-wider text-muted';

    return (
        <section lang="tr" className="flex h-full min-h-0 min-w-0 flex-col bg-surface" aria-label="Funding akışı">
            <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
                {titleSlot ? (
                    <div className="flex h-8 min-w-0 flex-1 items-center">{titleSlot}</div>
                ) : (
                    <h2 className="truncate text-[11px] font-semibold uppercase tracking-wider text-secondary">FUNDING AKIŞI</h2>
                )}
                <div className="inline-flex shrink-0 rounded-sm border border-border p-0.5" role="group" aria-label="Funding yönü">
                    {FILTERS.map((f) => {
                        const active = f.key === filter;
                        return (
                            <button
                                key={f.key}
                                type="button"
                                onClick={() => setFilter(f.key)}
                                aria-pressed={active}
                                title={f.title}
                                className={`h-5 rounded-sm px-1.5 text-[10px] leading-none outline-none transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${
                                    active ? 'bg-surface-highlight text-text' : 'text-secondary hover:text-text'
                                }`}
                            >
                                {f.label}
                            </button>
                        );
                    })}
                </div>
            </header>

            <div className="flex h-6 shrink-0 items-center justify-between gap-2 border-b border-border px-3 text-[10px] text-muted">
                <span className="min-w-0 truncate" title="f8: tahmini funding oranının 8 saate eşdeğeri (oran × 8 / ödeme aralığı)">
                    f8 = 8 saate eşdeğer tahmini oran
                </span>
                <label className="flex shrink-0 cursor-pointer items-center gap-1 text-secondary hover:text-text" title={LOW_LIQUIDITY_TITLE}>
                    <input
                        type="checkbox"
                        checked={hideLowLiquidity}
                        onChange={(e) => setHideLowLiquidity(e.target.checked)}
                        className="h-3 w-3 cursor-pointer accent-primary"
                    />
                    düşük likidite gizle
                </label>
            </div>

            {/* Section 1: active candidates */}
            <div className={subHeader}>
                <span className="truncate">
                    Aktif adaylar
                    {flow.ready && <span className="ml-1.5 font-mono text-secondary">{candidates.length}</span>}
                </span>
                <span className="shrink-0 font-mono normal-case tracking-normal" title={gateTitle}>
                    {gateText}
                </span>
            </div>
            <div className="scrollbar-thin max-h-[45%] min-h-0 shrink-0 overflow-auto">
                <div role="table" aria-label="Aktif funding adayları" style={{ minWidth: TABLE_MIN_WIDTH }}>
                    <div
                        role="row"
                        className={`sticky top-0 z-10 grid h-7 items-center ${GRID_GAP} border-b border-border bg-surface px-3 text-[10px] font-medium uppercase text-muted`}
                        style={{ gridTemplateColumns: GRID_COLS }}
                    >
                        {COLUMNS.map((col) => (
                            <div
                                key={col.label}
                                role="columnheader"
                                title={col.title}
                                className={`truncate ${col.align === 'right' ? 'text-right' : ''}`}
                            >
                                {col.label}
                            </div>
                        ))}
                    </div>

                    {!flow.ready && <SkeletonRows count={3} />}

                    {flow.ready && candidates.length === 0 && (
                        <div className="px-3 py-4 text-center text-xs text-muted">
                            {emptyCandidates}
                            {hiddenCandidates > 0 && ` (${hiddenCandidates} düşük likiditeli sembol gizlendi)`}
                        </div>
                    )}

                    {candidates.map((c) => (
                        <CandidateRow
                            key={`${c.side}:${c.symbol}`}
                            candidate={c}
                            selected={c.symbol === selectedSymbol}
                            easing={isEasingCandidate(c, stats)}
                            countdown={formatCountdown(c.nextFundingTime - now)}
                            onSelect={handleSelect}
                        />
                    ))}
                </div>
            </div>

            {/* Section 2: event feed */}
            <div className={subHeader}>
                <span className="truncate">
                    Olaylar
                    {events.length > 0 && <span className="ml-1.5 font-mono text-secondary">{events.length}</span>}
                </span>
                <span className="shrink-0 normal-case tracking-normal">en yeni üstte</span>
            </div>
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
                {events.length === 0 ? (
                    <div className="px-3 py-6 text-center text-xs leading-relaxed text-muted">
                        {flow.ready
                            ? 'Henüz olay yok. Funding yön değişimleri ve uç bölgeye giriş/çıkışlar burada listelenir.'
                            : 'Funding verileri yükleniyor…'}
                    </div>
                ) : (
                    <ul role="list">
                        {events.map((e) => (
                            <EventRow
                                key={e.id}
                                event={e}
                                selected={e.symbol === selectedSymbol}
                                remaining={e.nextFundingTime > now ? formatCountdown(e.nextFundingTime - now) : null}
                                onSelect={handleSelect}
                            />
                        ))}
                    </ul>
                )}
            </div>

            <footer className="flex h-6 shrink-0 items-center border-t border-border px-3 text-[10px] text-muted">
                <span className="truncate">Durum tespiti — tahmin değildir.</span>
            </footer>
        </section>
    );
};
