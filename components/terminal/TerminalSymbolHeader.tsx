import React, { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Clock, ExternalLink } from 'lucide-react';
import type { FuturesRow, SideRatio } from './types';
import { fetchOpenInterest, fetchOrderBookRatio, fetchSpotPrice } from './terminalData';
import {
    formatBandPct,
    formatAmount,
    formatCompact,
    formatCountdown,
    formatFundingInterval,
    formatFundingPct,
    formatPct,
    formatPrice,
    formatRatioPct,
} from './format';
import { CoinIcon } from './CoinIcon';
import {
    EASING_BADGE_CLASS,
    EASING_BADGE_LABEL,
    SQUEEZE_CLASS_BADGE,
    SQUEEZE_CLASS_SHORT,
    formatSignedFunding,
    universeRankSentence,
    upperTr,
    useFundingCandidateSide,
    useSqueezeAssessment,
} from './fundingFlow';
import { FundingSparkline } from './FundingSparkline';

const BOOK_POLL_MS = 5_000;
const MARKET_POLL_MS = 30_000;
const ELEVATED_FUNDING = 0.0001; // 0.01% — Binance default rate

const isHidden = (): boolean => typeof document !== 'undefined' && document.hidden;

const Skeleton: React.FC<{ className: string }> = ({ className }) => (
    <span className={`inline-block bg-surface-highlight ${className}`} />
);

/** 'B xx.xx%' ▬▬▬▬▬▬ 'xx.xx% S' — bid vs ask notional of the order book. */
const OrderBookBar: React.FC<{ book: SideRatio | null | undefined; failed: boolean }> = ({ book, failed }) => {
    if (book === undefined) {
        if (failed) {
            return <span className="flex-1 text-right text-[11px] text-muted">Emir defteri alınamadı</span>;
        }
        return <Skeleton className="flex-1 h-1.5" />;
    }

    const long = book ? book.long : 0.5;
    const title = book
        ? `Emir defteri (orta fiyatın ${formatBandPct(book.bandPct) || '±%1'} aralığı, nominal): Alış ${formatRatioPct(book.long)} · Satış ${formatRatioPct(book.short)}`
        : 'Emir defteri verisi yok';

    return (
        <div
            className={`flex min-w-0 flex-1 items-center gap-2 font-mono text-[11px] ${book ? '' : 'opacity-50'}`}
            title={title}
        >
            <span className="shrink-0 text-success">B {book ? formatRatioPct(book.long) : '—'}</span>
            <div className="flex h-1.5 min-w-[40px] flex-1 gap-px overflow-hidden">
                <div
                    className="h-full shrink-0 bg-success transition-[width] duration-500 ease-out"
                    style={{ width: `${(long * 100).toFixed(2)}%` }}
                />
                <div className="h-full min-w-0 flex-1 bg-danger" />
            </div>
            <span className="shrink-0 text-danger">{book ? formatRatioPct(book.short) : '—'} S</span>
        </div>
    );
};

// ---------------------------------------------------------------------------
// Squeeze line: one 18px row under the market data. Inside the extreme-funding gates it names the symbol's
// descriptive class, the condition count, the 8h-equivalent funding and its rank in the universe; outside
// the gates only the funding history sparkline is shown (no badge that could read as a setup).
// ---------------------------------------------------------------------------

const SPARKLINE_HEIGHT = 18;
const POSITIVE_EXTREME_LABEL = 'Pozitif uç';

interface SqueezeLineProps {
    row: FuturesRow;
    onOpen?: () => void;
}

const SqueezeLine: React.FC<SqueezeLineProps> = ({ row, onOpen }) => {
    const { assessment, history, loading } = useSqueezeAssessment(row);
    const candidateSide = useFundingCandidateSide(row.symbol);

    // Negative gate: the live assessment decides. Positive gate: only the store knows (it is not a squeeze setup).
    const inNegativeGate = assessment !== null && assessment.cls !== 'NONE';
    const easing = !inNegativeGate && candidateSide === 'NEG';
    const positiveExtreme = !inNegativeGate && !easing && candidateSide === 'POS';
    const flagged = inNegativeGate || easing || positiveExtreme;
    const historyPending = loading && history.length === 0;

    let badgeText = '';
    let badgeClass = '';
    let badgeTitle = '';
    if (inNegativeGate && assessment) {
        // One-word class name keeps the line on one row; the full label and description go into the tooltip.
        badgeText = SQUEEZE_CLASS_SHORT[assessment.cls];
        badgeClass = SQUEEZE_CLASS_BADGE[assessment.cls];
        badgeTitle = `${assessment.label}: ${assessment.description}`;
    } else if (easing) {
        badgeText = EASING_BADGE_LABEL;
        badgeClass = EASING_BADGE_CLASS;
        badgeTitle = 'Gevşiyor: oran negatif uç eşiğinin üzerine geri çekildi, ancak −0.0300% bandının içinde olduğu için aday listesinde kalıyor.';
    } else if (positiveExtreme) {
        badgeText = POSITIVE_EXTREME_LABEL;
        badgeClass = 'bg-success-soft text-success';
        badgeTitle = "Pozitif funding uç bölgede: long'lar short'lara ödüyor. Sıkışma kontrolü negatif taraf içindir.";
    }

    const f8Class = assessment ? (assessment.f8 < 0 ? 'text-danger' : assessment.f8 > 0 ? 'text-success' : 'text-text') : 'text-text';
    const missing = assessment ? assessment.items.length - assessment.known : 0;

    const content = (
        <>
            <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[10px] leading-none">
                {flagged && assessment ? (
                    <>
                        <span
                            className={`shrink-0 truncate rounded-sm px-1.5 py-0.5 font-semibold leading-none ${badgeClass}`}
                            title={badgeTitle}
                        >
                            {upperTr(badgeText)}
                        </span>
                        {(inNegativeGate || easing) && (
                            <span
                                className="shrink-0 font-mono text-text"
                                title={`Kurulumun o an sağlanan koşul sayısı${missing > 0 ? ` (${missing} veri yok)` : ''}. Olasılık ya da al/sat önerisi değildir.`}
                            >
                                {assessment.passed} / {assessment.known}
                                <span className="font-sans text-muted"> koşul</span>
                            </span>
                        )}
                        <span className={`shrink-0 font-mono ${f8Class}`} title="Tahmini funding, 8 saate eşdeğer">
                            <span className="font-sans text-muted">f8 </span>
                            {formatSignedFunding(assessment.f8)}
                        </span>
                        <span
                            className="truncate text-secondary"
                            title="Bu sembolün funding oranının kripto USDT perpetual evrenindeki sırası (8 saat eşdeğerine göre)"
                        >
                            {universeRankSentence(assessment.universePercentile)}
                        </span>
                    </>
                ) : (
                    <span className="truncate uppercase tracking-wider text-muted" title="Son ödenen funding oranları (8 saat eşdeğeri); boş çubuk = güncel tahmin">
                        Fonlama geçmişi
                    </span>
                )}
            </div>
            <div className="w-24 shrink-0 overflow-hidden whitespace-nowrap sm:w-32" style={{ height: SPARKLINE_HEIGHT }}>
                {historyPending ? (
                    <div className="flex h-full items-center">
                        <Skeleton className="h-px w-full" />
                    </div>
                ) : (
                    <FundingSparkline
                        history={history}
                        intervalHours={row.fundingIntervalHours}
                        current={row.fundingRate}
                        height={SPARKLINE_HEIGHT}
                    />
                )}
            </div>
            {onOpen && <ChevronRight size={10} aria-hidden="true" className="shrink-0 text-muted group-hover:text-text" />}
        </>
    );

    const layout = `group -mx-3 -mt-0.5 flex min-w-0 items-center gap-2 px-3 text-left`;
    const style = { height: SPARKLINE_HEIGHT };

    if (!onOpen) {
        return (
            <div className={layout} style={style}>
                {content}
            </div>
        );
    }
    return (
        <button
            type="button"
            onClick={onOpen}
            title="Kurulum sekmesini aç: sıkışma kontrol listesi ve fonlama geçmişi"
            aria-label={`${row.symbol} kurulum kontrol listesini aç`}
            className={`${layout} w-[calc(100%+1.5rem)] cursor-pointer outline-none transition-colors hover:bg-surface-secondary focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-primary`}
            style={style}
        >
            {content}
        </button>
    );
};

export interface TerminalSymbolHeaderProps {
    row: FuturesRow | null;
    /** Opens the "Kurulum" (squeeze checklist) tab of the terminal's bottom area. */
    onOpenChecklist?: () => void;
}

export const TerminalSymbolHeader: React.FC<TerminalSymbolHeaderProps> = ({ row, onOpenChecklist }) => {
    const symbol = row?.symbol ?? '';

    // undefined = loading, null = not available
    const [spot, setSpot] = useState<number | null | undefined>(undefined);
    const [openInterest, setOpenInterest] = useState<number | null | undefined>(undefined);
    const [book, setBook] = useState<SideRatio | null | undefined>(undefined);
    const [bookFailed, setBookFailed] = useState(false);
    const [now, setNow] = useState(() => Date.now());

    // Single shared 1s clock for the funding countdown.
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const id = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, []);

    // Spot price + open interest (30s).
    useEffect(() => {
        if (!symbol || typeof window === 'undefined') return undefined;
        let cancelled = false;
        let inFlight = false;
        setSpot(undefined);
        setOpenInterest(undefined);

        const load = async (force: boolean) => {
            if (inFlight || (!force && isHidden())) return;
            inFlight = true;
            // Promise.resolve().then(...) turns any synchronous throw into a settled rejection.
            const [spotRes, oiRes] = await Promise.allSettled([
                Promise.resolve().then(() => fetchSpotPrice(symbol)),
                Promise.resolve().then(() => fetchOpenInterest(symbol)),
            ]);
            inFlight = false;
            if (cancelled) return;
            // On failure keep the last known value; only fall back to '—' if there was none.
            if (spotRes.status === 'fulfilled') setSpot(spotRes.value ?? null);
            else setSpot((prev) => (prev === undefined ? null : prev));
            if (oiRes.status === 'fulfilled') setOpenInterest(oiRes.value ?? null);
            else setOpenInterest((prev) => (prev === undefined ? null : prev));
        };

        void load(true);
        const id = window.setInterval(() => void load(false), MARKET_POLL_MS);
        return () => {
            cancelled = true;
            window.clearInterval(id);
        };
    }, [symbol]);

    // Order book bid/ask split (5s).
    useEffect(() => {
        if (!symbol || typeof window === 'undefined') return undefined;
        let cancelled = false;
        let inFlight = false;
        setBook(undefined);
        setBookFailed(false);

        const load = async (force: boolean) => {
            if (inFlight || (!force && isHidden())) return;
            inFlight = true;
            try {
                const result = await fetchOrderBookRatio(symbol);
                if (!cancelled) {
                    setBook(result ?? null);
                    setBookFailed(false);
                }
            } catch {
                if (!cancelled) setBookFailed(true); // keep the previous bar if we had one
            } finally {
                inFlight = false;
            }
        };

        void load(true);
        const id = window.setInterval(() => void load(false), BOOK_POLL_MS);
        return () => {
            cancelled = true;
            window.clearInterval(id);
        };
    }, [symbol]);

    if (!row) {
        return (
            <section className="flex min-w-0 flex-col gap-2 bg-surface px-3 py-2.5" aria-label="Sembol özeti yükleniyor">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <Skeleton className="h-8 w-8 rounded-full" />
                        <div className="flex flex-col gap-1.5">
                            <Skeleton className="h-2 w-20" />
                            <Skeleton className="h-5 w-28" />
                            <Skeleton className="h-2 w-24" />
                        </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                        <Skeleton className="h-2 w-16" />
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-2 w-14" />
                    </div>
                </div>
                <Skeleton className="h-1.5 w-full" />
                <Skeleton className="-mt-0.5 h-[18px] w-full" />
            </section>
        );
    }

    const change = row.changePct;
    const changeClass = change > 0 ? 'text-success' : change < 0 ? 'text-danger' : 'text-secondary';
    const fr = row.fundingRate;
    const frClass = fr < 0 ? 'text-danger' : fr > ELEVATED_FUNDING ? 'text-success' : 'text-text';
    const remaining = row.nextFundingTime > 0 ? row.nextFundingTime - now : NaN;
    const oiNotional = openInterest != null && Number.isFinite(row.markPrice) ? openInterest * row.markPrice : null;

    return (
        <section lang="tr" className="flex min-w-0 flex-col gap-2 bg-surface px-3 py-2.5" aria-label={`${row.symbol} özeti`}>
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                {/* Left: icon, symbol, price, spot */}
                <div className="flex min-w-0 items-center gap-3">
                    <CoinIcon asset={row.baseAsset} size={32} />
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-[11px]">
                            <span className="truncate font-semibold text-text">
                                {row.symbol}
                                <span className="text-muted">.P</span>
                            </span>
                            <span className="rounded-sm bg-surface-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none text-secondary">
                                Perp
                            </span>
                            <a
                                href={`https://www.binance.com/en/futures/${row.symbol}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded-sm text-muted outline-none transition-colors hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                                title="Binance Vadeli'de aç"
                                aria-label="Binance Vadeli'de aç"
                            >
                                <ExternalLink size={12} aria-hidden="true" />
                            </a>
                        </div>
                        <div className="flex items-baseline gap-2">
                            <span className="font-mono text-2xl font-semibold leading-tight text-text">
                                {formatPrice(row.price)}
                            </span>
                            <span className={`font-mono text-xs font-semibold ${changeClass}`} title="24 saatlik değişim">
                                <span className="mr-1 font-normal text-muted">24s</span>
                                {formatPct(change)}
                            </span>
                        </div>
                        <div className="flex items-center gap-1 font-mono text-[10px] text-muted">
                            <span className="uppercase tracking-wider">SPOT:</span>
                            {spot === undefined ? (
                                <Skeleton className="h-2 w-12" />
                            ) : (
                                <span
                                    className="text-secondary"
                                    title={spot === null ? 'Bu sembol için spot piyasa yok' : 'Binance spot fiyatı'}
                                >
                                    {spot === null ? '—' : formatPrice(spot)}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right: funding */}
                <div className="ml-auto flex shrink-0 flex-col items-end">
                    <span className="text-[10px] tracking-wider text-muted">
                        <span className="uppercase">Fonlama</span> ({formatFundingInterval(row.fundingIntervalHours)})
                    </span>
                    <span
                        className={`flex items-center gap-1 font-mono text-lg font-semibold leading-tight ${frClass}`}
                        title="Güncel fonlama oranı (bir sonraki ödemede uygulanacak tahmini oran)"
                    >
                        {formatFundingPct(fr)}
                        {fr < 0 && <ArrowDownLeft size={14} aria-hidden="true" />}
                        {fr > ELEVATED_FUNDING && <ArrowUpRight size={14} aria-hidden="true" />}
                    </span>
                    <span
                        className="flex items-center gap-1 font-mono text-[10px] text-secondary"
                        title="Bir sonraki fonlamaya kalan süre"
                    >
                        <Clock size={10} aria-hidden="true" />
                        {Number.isFinite(remaining) ? formatCountdown(remaining) : '--:--:--'}
                    </span>
                </div>
            </div>

            {/* Bottom: open interest + order book split */}
            <div className="flex min-w-0 items-center gap-3">
                <div
                    className="flex shrink-0 items-baseline gap-1.5 font-mono text-[11px]"
                    title={
                        oiNotional != null
                            ? `Açık pozisyon: ${formatAmount(openInterest)} kontrat (≈ $${formatCompact(oiNotional)})`
                            : 'Açık pozisyon (kontrat)'
                    }
                >
                    <span className="font-sans text-[10px] uppercase tracking-wider text-muted">Açık Poz.</span>
                    {openInterest === undefined ? (
                        <Skeleton className="h-2 w-16" />
                    ) : (
                        <span className="text-text">{formatAmount(openInterest)}</span>
                    )}
                </div>
                <OrderBookBar book={book} failed={bookFailed} />
            </div>

            {/* Squeeze line: class + condition count + f8 + universe rank (inside the gates), funding history sparkline */}
            <SqueezeLine row={row} onOpen={onOpenChecklist} />
        </section>
    );
};

export default TerminalSymbolHeader;
