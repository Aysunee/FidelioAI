import React, { useState, useMemo } from 'react';
import { Signal, Ticker } from '../types';
import { Search, ChevronDown, ChevronUp, Zap, ExternalLink, LineChart, Globe } from 'lucide-react';
import { getStrategyLabel } from '../context/SignalContext';
import { formatPrice, formatTime as formatClockTime } from '../utils/formatters';
import { MARKET_SYMBOL } from '../utils/signalEngines';

// ---------------------------------------------------------------------------
// Signal presentation helpers. One definition for every screen that lists signals
// (SignalFeed, SignalManager, FidelioRadar, the admin tables).
// ---------------------------------------------------------------------------

export type SignalEngineKind = NonNullable<Signal['engine']> | 'OTHER';

// Which rule produced the record. Records written before `engine` existed only carry `source`.
export const getSignalEngine = (sig: Signal): SignalEngineKind => {
    if (sig.engine) return sig.engine;
    const source: string = sig.source ?? '';
    if (source === 'WEBHOOK' || source === 'MANUAL') return source;
    if (source === 'ALGO_MOMENTUM') return 'MOMENTUM';
    if (source === 'ALGO_VOLUME') return 'VOLUME';
    if (source === 'ALGO_DIVERGENCE' || source === 'ALGO_FUNDING') return 'FUNDING';
    return 'OTHER';
};

// Local engines run in this browser on Binance public data; their records never carry a confidence.
export const isLocalEngineSignal = (sig: Signal): boolean => {
    const engine = getSignalEngine(sig);
    return engine === 'MOMENTUM' || engine === 'VOLUME' || engine === 'FUNDING';
};

// Market-wide aggregate of the burst guard (symbol MARKET): not a tradable pair. No coin icon, no price,
// no change since the signal, no chart / exchange links.
export const isMarketSignal = (sig: Pick<Signal, 'symbol'>): boolean => sig.symbol === MARKET_SYMBOL;

// "PİYASA" badge shown instead of a coin for market-wide records.
export const MARKET_BADGE = { text: 'PİYASA', tone: 'bg-info-soft text-info', title: 'Piyasa geneli kayıt: tek bir coin değil, aynı anda koşulu sağlayan coinlerin toplamı.' } as const;

// Funding records come from perpetual contracts; a webhook can mark a perp with a ".P" suffix.
export const isPerpSignal = (sig: Signal): boolean =>
    getSignalEngine(sig) === 'FUNDING' || /Funding|Divergence/.test(sig.strategy) || /(\.P|PERP)$/.test(sig.symbol);

export type SideKind = 'UP' | 'DOWN' | 'NEUTRAL';

export const getSideKind = (side: Signal['side']): SideKind =>
    side === 'NEUTRAL' ? 'NEUTRAL' : side === 'BUY' || side === 'LONG' ? 'UP' : 'DOWN';

const SIDE_TONE: Record<SideKind, string> = {
    UP: 'bg-success-soft text-success',
    DOWN: 'bg-danger-soft text-danger',
    NEUTRAL: 'bg-surface-secondary text-secondary'
};

// Text and colour of the side badge. A local engine reports the direction of the move it measured
// (never advice), so it is worded "Yukarı / Aşağı"; webhook and manual records keep the side they sent.
export const getSideBadge = (sig: Signal): { kind: SideKind; text: string; tone: string; title?: string } => {
    const kind = getSideKind(sig.side);
    if (kind === 'NEUTRAL') {
        return { kind, text: 'Yönsüz', tone: SIDE_TONE.NEUTRAL, title: 'Yönsüz kayıt: bu kural bir yön bildirmez.' };
    }
    if (isLocalEngineSignal(sig)) {
        return {
            kind,
            text: kind === 'UP' ? 'Yukarı' : 'Aşağı',
            tone: SIDE_TONE[kind],
            title: 'Ölçülen hareketin yönü. Tahmin ya da işlem önerisi değildir.'
        };
    }
    return { kind, text: sig.side, tone: SIDE_TONE[kind] };
};

// Used when the context's label helper does not know a key yet.
const FALLBACK_STRATEGY_LABELS: Record<string, string> = {
    Momentum_24h_Up: 'Yeni 24s zirve · güçlü yükseliş',
    Momentum_24h_Down: 'Yeni 24s dip · güçlü düşüş',
    Funding_Regime_Neg: 'Negatif fonlama rejimi',
    RMI_Overbought: '24s momentum · yükseliş (eski kural)',
    RMI_Oversold: '24s momentum · düşüş (eski kural)',
    SmartMoney_Divergence: 'Negatif fonlama + yükselen fiyat (eski kural)'
};

export const getSignalLabel = (strategy: string): string => {
    if (!strategy) return '';
    const label = getStrategyLabel(strategy);
    if (label && label !== strategy) return label;
    if (FALLBACK_STRATEGY_LABELS[strategy]) return FALLBACK_STRATEGY_LABELS[strategy];
    const volume = /^Volume_Spike_([\d.]+)x$/.exec(strategy);
    if (volume) return `Hacim artışı ${volume[1]}x`;
    return strategy;
};

// The measured size of the event. Older volume records carry the ratio only in the strategy key.
export const getMagnitude = (sig: Signal): { text: string; caption: string } | null => {
    if (sig.magnitude && typeof sig.magnitude.text === 'string' && sig.magnitude.text !== '') {
        return { text: sig.magnitude.text, caption: sig.magnitude.caption || '' };
    }
    const volume = /^Volume_Spike_([\d.]+)x$/.exec(sig.strategy);
    if (volume) return { text: `${volume[1]}x`, caption: 'hacim oranı (kayıt etiketinden)' };
    return null;
};

// Confidence is shown only when a webhook / manual payload really carried one (0-1 or 0-100).
export const getPayloadConfidence = (sig: Signal): number | null => {
    if (isLocalEngineSignal(sig)) return null;
    if (typeof sig.confidence !== 'number' || !Number.isFinite(sig.confidence)) return null;
    const percent = sig.confidence <= 1 ? sig.confidence * 100 : sig.confidence;
    return Math.max(0, Math.min(100, Math.round(percent)));
};

// ---------------------------------------------------------------------------

interface SignalFeedProps {
    signals: Signal[];
    marketData: Record<string, Ticker>;
}

type Tab = 'ALL' | 'SPOT' | 'PERP' | 'WEBHOOK';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary';
const PANEL_TITLE = 'text-[11px] font-semibold uppercase tracking-wider text-secondary';
const TAB = `flex h-full shrink-0 items-center whitespace-nowrap border-b-2 text-[11px] font-semibold uppercase tracking-wider transition-colors ${FOCUS_RING}`;
const TAB_ACTIVE = 'border-primary text-text';
const TAB_IDLE = 'border-transparent text-secondary hover:text-text';
const BADGE = 'shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase';
const STAT_LABEL = 'text-[10px] uppercase tracking-wider text-muted';
const LINK_BUTTON = `flex h-7 items-center gap-1.5 rounded-sm border border-border bg-surface-secondary px-2.5 text-xs font-medium text-text transition-colors hover:bg-surface-highlight ${FOCUS_RING}`;

// The layout follows the width of the panel itself (container queries), not the viewport:
// a wide panel shows one table line per signal, a narrow one two compact lines.
const TABLE_HEAD =
    'sticky top-0 z-10 hidden h-7 grid-cols-[164px_minmax(0,1fr)_104px_96px_96px_64px] items-center gap-x-3 border-b border-border bg-surface px-3 text-[10px] font-medium uppercase tracking-wider text-muted [@container(min-width:680px)]:grid';
const ROW =
    'grid cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-3 px-3 py-1 text-xs [@container(min-width:680px)]:h-7 [@container(min-width:680px)]:grid-cols-[164px_minmax(0,1fr)_104px_96px_96px_64px] [@container(min-width:680px)]:py-0';

const CHANGE_HINT =
    'Sinyal anındaki fiyata göre değişim. Yönlü kayıtlarda yön lehine (+) ya da aleyhine (−); yönsüz kayıtlarda ham fiyat değişimi.';

const TABS: { key: Tab; label: string }[] = [
    { key: 'ALL', label: 'Tümü' },
    { key: 'SPOT', label: 'Spot' },
    { key: 'PERP', label: 'Perp' },
    { key: 'WEBHOOK', label: 'Webhook' }
];

// Two decimals; a change that rounds to zero is shown as 0.00% (never "-0.00%").
const roundPct = (value: number) => {
    const rounded = Number(value.toFixed(2));
    return rounded === 0 ? 0 : rounded;
};
const signed = (value: number) => {
    const rounded = roundPct(value);
    return `${rounded > 0 ? '+' : ''}${rounded.toFixed(2)}%`;
};

export const SignalFeed: React.FC<SignalFeedProps> = ({ signals, marketData }) => {
    const [activeTab, setActiveTab] = useState<Tab>('ALL');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    // Price change since the signal. Directional records: in favour of the side (+) or against it (−).
    // Neutral records have no side, so the raw change is returned.
    const getChange = (sig: Signal): number | null => {
        if (isMarketSignal(sig)) return null; // no price, no PnL
        const ticker = marketData[sig.symbol];
        if (!ticker || !(sig.price > 0) || !Number.isFinite(ticker.lastPrice)) return null;
        const rawChange = ((ticker.lastPrice - sig.price) / sig.price) * 100;
        return getSideKind(sig.side) === 'DOWN' ? -rawChange : rawChange;
    };

    const filteredSignals = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();
        return signals.filter(sig => {
            const searchMatch = term === '' ||
                sig.symbol.toLowerCase().includes(term) ||
                sig.strategy.toLowerCase().includes(term) ||
                getSignalLabel(sig.strategy).toLowerCase().includes(term);
            if (!searchMatch) return false;

            if (activeTab === 'WEBHOOK') return getSignalEngine(sig) === 'WEBHOOK';
            if (activeTab === 'PERP') return isPerpSignal(sig);
            if (activeTab === 'SPOT') return !isPerpSignal(sig);
            return true;
        });
    }, [signals, searchTerm, activeTab]);

    const toggleExpand = (id: string) => {
        setExpandedId(prev => prev === id ? null : id);
    };

    const formatTime = (isoStr: string) => formatClockTime(isoStr);

    return (
        <section lang="tr" className="flex h-full min-h-0 min-w-0 flex-col bg-surface [container-type:inline-size] lg:max-h-[100dvh]">
            {/* Header: title, tabs and search share one row when the panel is wide enough */}
            <header className="flex shrink-0 flex-wrap items-stretch border-b border-border">
                <div className="flex h-8 min-w-0 flex-1 items-baseline gap-2 px-3 leading-8 [@container(min-width:760px)]:flex-none">
                    <h2 className={`truncate ${PANEL_TITLE}`}>Sinyal Akışı</h2>
                    <span className="hidden shrink-0 font-mono text-[10px] text-muted [@container(min-width:400px)]:inline">{signals.length} kayıt</span>
                </div>

                {/* Tabs */}
                <div className="order-last flex h-8 w-full items-stretch gap-3 overflow-x-auto border-t border-border px-3 scrollbar-hide [@container(min-width:760px)]:order-none [@container(min-width:760px)]:w-auto [@container(min-width:760px)]:min-w-0 [@container(min-width:760px)]:flex-1 [@container(min-width:760px)]:border-l [@container(min-width:760px)]:border-t-0">
                    {TABS.map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={`${TAB} ${activeTab === tab.key ? TAB_ACTIVE : TAB_IDLE}`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                <div className="flex h-8 shrink-0 items-center gap-1.5 px-3">
                    {/* Search */}
                    <div className="relative w-32">
                        <Search className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-muted" size={12} />
                        <input
                            type="text"
                            placeholder="Ara..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            aria-label="Sinyallerde ara"
                            className="h-6 w-full rounded-sm border border-border bg-surface-secondary pl-6 pr-2 text-xs text-text outline-none placeholder:text-muted focus:border-primary"
                        />
                    </div>
                </div>
            </header>

            {/* Signals List (scrolls inside the panel) */}
            <div className="max-h-[420px] min-h-0 flex-1 overflow-y-auto lg:max-h-none">
                {filteredSignals.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-1 px-3 py-8 text-center text-xs text-muted">
                        <Zap size={14} />
                        <h4>Kayıt yok</h4>
                        <p className="max-w-sm text-[11px]">
                            Bir kural tetiklendiğinde ya da webhook sinyali geldiğinde burada görünür. Sekmeyi ya da aramayı değiştirmeyi deneyin.
                        </p>
                    </div>
                ) : (
                    <div>
                        <div className={TABLE_HEAD}>
                            <div>Sinyal</div>
                            <div>Kural</div>
                            <div className="text-right">Büyüklük</div>
                            <div className="text-right">Sinyal fiyatı</div>
                            <div className="text-right" title={CHANGE_HINT}>Sinyalden beri</div>
                            <div className="text-right">Saat</div>
                        </div>

                        {filteredSignals.map((sig) => {
                            const isExpanded = expandedId === sig.id;
                            const isMarket = isMarketSignal(sig);
                            const badge = getSideBadge(sig);
                            const isNeutral = badge.kind === 'NEUTRAL';
                            const symbolBase = sig.symbol.replace(/\.P$/, '').replace('USDT', '');
                            const iconUrl = `https://assets.coincap.io/assets/icons/${symbolBase.toLowerCase()}@2x.png`;
                            const magnitude = getMagnitude(sig);
                            const confidence = getPayloadConfidence(sig);
                            const change = getChange(sig);
                            const ticker = isMarket ? undefined : marketData[sig.symbol];
                            // Neutral records are never coloured as a gain or a loss
                            const changeRounded = change === null ? 0 : roundPct(change);
                            const changeTone = change === null || isNeutral ? 'text-text' : changeRounded > 0 ? 'text-success' : changeRounded < 0 ? 'text-danger' : 'text-text';
                            const changeLabel = isNeutral ? 'Ham fiyat değişimi' : 'Yöne göre değişim';

                            const isFutures = isPerpSignal(sig);
                            const pairSymbol = sig.symbol.replace(/\.P$/, '');
                            const tvLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${pairSymbol}${isFutures ? '.P' : ''}`;
                            const binanceLink = isFutures
                                ? `https://www.binance.com/en/futures/${pairSymbol}`
                                : `https://www.binance.com/en/trade/${symbolBase}_USDT`;

                            return (
                                <div key={sig.id} className="border-b border-border">
                                    <div
                                        onClick={() => toggleExpand(sig.id)}
                                        className={`${ROW} ${isExpanded ? 'bg-surface-highlight' : 'hover:bg-surface-secondary'}`}
                                        style={isExpanded ? { boxShadow: 'inset 2px 0 0 var(--color-brand)' } : undefined}
                                    >
                                        {/* Symbol + side */}
                                        <div className="flex min-w-0 items-center gap-1.5">
                                            {isExpanded
                                                ? <ChevronUp size={12} className="shrink-0 text-secondary" />
                                                : <ChevronDown size={12} className="shrink-0 text-muted" />}
                                            {isMarket ? (
                                                <>
                                                    <Globe size={14} className="shrink-0 text-info" aria-hidden="true" />
                                                    <span className={`${BADGE} ${MARKET_BADGE.tone}`} title={MARKET_BADGE.title}>{MARKET_BADGE.text}</span>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="h-4 w-4 shrink-0 overflow-hidden rounded-full bg-surface-highlight">
                                                        <img src={iconUrl} className="h-full w-full object-cover" onError={(e) => e.currentTarget.style.display = 'none'} alt={symbolBase} />
                                                    </div>
                                                    <span className="truncate font-medium text-text">{symbolBase}</span>
                                                </>
                                            )}
                                            <span className={`${BADGE} ${badge.tone}`} title={badge.title}>
                                                {badge.text}
                                            </span>
                                        </div>

                                        {/* Signal price */}
                                        <div className="text-right font-mono text-text [@container(min-width:680px)]:order-4">
                                            {isMarket ? <span className="text-muted" title="Piyasa geneli kayıt: fiyatı yok">—</span> : `$${formatPrice(sig.price)}`}
                                        </div>

                                        {/* Change since the signal */}
                                        <div
                                            className="flex items-baseline justify-end gap-1 font-mono [@container(min-width:680px)]:order-5"
                                            title={isNeutral ? 'Ham fiyat değişimi (yönsüz kayıt)' : 'Sinyalden beri, kaydın yönüne göre değişim'}
                                        >
                                            {change === null ? (
                                                <span className="text-muted">—</span>
                                            ) : (
                                                <>
                                                    <span className={changeTone}>{signed(change)}</span>
                                                    {isNeutral && <span className="font-sans text-[10px] text-muted">ham</span>}
                                                </>
                                            )}
                                        </div>

                                        {/* Time */}
                                        <div className="text-right font-mono text-[10px] text-muted [@container(min-width:680px)]:order-6">
                                            {formatTime(sig.time)}
                                        </div>

                                        {/* Rule */}
                                        <div className="col-span-2 min-w-0 truncate pl-[18px] text-[11px] text-secondary [@container(min-width:680px)]:order-2 [@container(min-width:680px)]:col-span-1 [@container(min-width:680px)]:pl-0">
                                            {getSignalLabel(sig.strategy)}
                                        </div>

                                        {/* Magnitude (measured). Webhook / manual records show the confidence only if they sent one. */}
                                        <div className="col-span-2 flex min-w-0 items-baseline justify-end gap-1 [@container(min-width:680px)]:order-3 [@container(min-width:680px)]:col-span-1">
                                            {magnitude ? (
                                                <span className="truncate font-mono text-xs font-semibold text-text" title={magnitude.caption || undefined}>
                                                    {magnitude.text}
                                                </span>
                                            ) : confidence !== null ? (
                                                <span className="flex items-baseline gap-1" title="Webhook / manuel sinyalin kendi gönderdiği güven değeri">
                                                    <span className="text-[10px] text-muted">güven</span>
                                                    <span className="font-mono text-[11px] text-secondary">%{confidence}</span>
                                                </span>
                                            ) : (
                                                <span className="font-mono text-muted">—</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Expanded Details */}
                                    {isExpanded && (
                                        <div className="border-t border-border bg-background">
                                            {/* Measured magnitude */}
                                            {magnitude && (
                                                <div className="flex items-baseline gap-2 border-b border-border px-3 py-1.5">
                                                    <span className={`shrink-0 ${STAT_LABEL}`}>Büyüklük</span>
                                                    <span className="shrink-0 font-mono text-xs font-semibold text-text">{magnitude.text}</span>
                                                    {magnitude.caption && <span className="min-w-0 text-[11px] leading-snug text-secondary">{magnitude.caption}</span>}
                                                </div>
                                            )}

                                            {/* Note */}
                                            <div className="border-b border-border px-3 py-1.5">
                                                <h4 className={STAT_LABEL}>Not</h4>
                                                <p className="text-xs leading-snug text-secondary">
                                                    {sig.note || 'Bu kayıt için not yok.'}
                                                </p>
                                                {isLocalEngineSignal(sig) && (
                                                    <p className="mt-1 text-[11px] leading-snug text-muted">
                                                        {isNeutral
                                                            ? 'Yönsüz kayıt: yalnızca ölçülen durumu bildirir. Tahmin ya da işlem önerisi değildir.'
                                                            : 'Yön, ölçülen hareketin yönüdür. Tahmin ya da işlem önerisi değildir.'}
                                                    </p>
                                                )}
                                            </div>

                                            {/* Stats (a market-wide record has no price: no stats, no links) */}
                                            {!isMarket && (
                                                <>
                                                    <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
                                                        <div className="min-w-0 px-3 py-1.5">
                                                            <div className={STAT_LABEL}>Sinyal fiyatı</div>
                                                            <div className="truncate font-mono text-xs font-semibold text-text">${formatPrice(sig.price)}</div>
                                                        </div>
                                                        <div className="min-w-0 px-3 py-1.5">
                                                            <div className={STAT_LABEL}>Güncel fiyat</div>
                                                            <div className="truncate font-mono text-xs font-semibold text-text">
                                                                {ticker ? `$${formatPrice(ticker.lastPrice)}` : '—'}
                                                            </div>
                                                        </div>
                                                        <div className="min-w-0 px-3 py-1.5">
                                                            <div className={`truncate ${STAT_LABEL}`} title={CHANGE_HINT}>{changeLabel}</div>
                                                            <div className={`truncate font-mono text-xs font-semibold ${changeTone}`}>
                                                                {change === null ? '—' : signed(change)}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Action Buttons */}
                                                    <div className="flex gap-2 px-3 py-1.5">
                                                        <a
                                                            href={tvLink}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className={LINK_BUTTON}
                                                        >
                                                            <LineChart size={12} className="text-secondary" />
                                                            TradingView
                                                        </a>
                                                        <a
                                                            href={binanceLink}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className={LINK_BUTTON}
                                                        >
                                                            <ExternalLink size={12} className="text-secondary" />
                                                            Binance
                                                        </a>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </section>
    );
};
