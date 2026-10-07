import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Ticker, FuturesTicker, MarketIndex } from '../types';
import { Radar, TrendingUp, TrendingDown, Zap, Droplets, Activity, ChevronDown, Filter, Search, Sparkles, Globe } from 'lucide-react';
import { CandleChart } from './CandleChart';
import { DEFAULT_WATCHLIST } from '../constants';
import { useSignals } from '../context/SignalContext';
import { useUser } from '../context/UserContext';
import { formatPrice, toEightHourFundingRate, DEFAULT_FUNDING_INTERVAL_HOURS } from '../utils/formatters';
import { useFundingIntervals, getFundingIntervalHours } from './FundingRates';
import { BigMoveRadar, bigMovePercent, bigMoveTimeframeText } from './BigMoveRadar';
import { PerpBigMoveRadar } from './PerpBigMoveRadar';
import { useCryptoPerpSymbols } from './AnomalyRadar';
import { getSignalEngine, getSideBadge, getSideKind, getSignalLabel, getMagnitude, isMarketSignal, isPerpSignal, MARKET_BADGE, SignalEngineKind } from './SignalFeed';
import { DASHBOARD_CHART_ID, toChartSymbol } from '../utils/clickIntent';
import { PatternRadar } from './PatternRadar';
import { GlobalTicker } from './GlobalTicker';

interface FidelioRadarProps {
    spotData: Record<string, Ticker>;
    futuresData: Record<string, FuturesTicker>;
    indicesData: MarketIndex[];
    /** Chart symbol controlled by the page (TradingView form: 'BTCUSDT' spot, 'BTCUSDT.P' perpetual). */
    chartSymbol?: string;
    onChartSymbolChange?: (symbol: string) => void;
}

type AnomalyType = 'RISE' | 'FALL' | 'NEG_FUNDING' | 'POS_FUNDING' | 'VOLUME_SPIKE' | 'MARKET_WIDE';

interface Anomaly {
    id: string;
    symbol: string;
    type: AnomalyType;
    value: number;
    message: string;
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary';
const PANEL_TITLE = 'text-[11px] font-semibold uppercase tracking-wider text-secondary';
const BADGE = 'shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase';
const TAB = `flex h-full items-center border-b-2 text-[11px] font-semibold uppercase tracking-wider transition-colors ${FOCUS_RING}`;
const TAB_ACTIVE = 'border-primary text-text';
const TAB_IDLE = 'border-transparent text-secondary hover:text-text';
const FILTER_TOGGLE = `h-6 flex-1 whitespace-nowrap rounded-sm px-1.5 text-[11px] transition-colors ${FOCUS_RING}`;
const FILTER_IDLE = 'text-secondary hover:text-text';
const FILTER_ACTIVE = 'bg-surface-highlight text-text';

type SourceFilter = 'ALL' | Extract<SignalEngineKind, 'WEBHOOK' | 'MOMENTUM' | 'FUNDING' | 'VOLUME'>;

const SOURCE_FILTERS: { key: Exclude<SourceFilter, 'ALL'>; label: string; title: string }[] = [
    { key: 'WEBHOOK', label: 'WEBHOOK', title: 'TradingView webhook sinyalleri' },
    { key: 'MOMENTUM', label: '24s MOM', title: '24 saatlik momentum kuralı' },
    { key: 'FUNDING', label: 'FON', title: 'Negatif fonlama rejimi kuralı' },
    { key: 'VOLUME', label: 'HACİM', title: 'Hacim artışı kuralı' }
];

// Short tag of the rule that produced a record (shown next to the side badge)
const ENGINE_TAG: Partial<Record<SignalEngineKind, string>> = {
    MOMENTUM: '24s MOM',
    FUNDING: 'FON',
    VOLUME: 'HACİM'
};

// Size class of a strip item (a bucket of the measured value, not a rating)
const SEVERITY_TEXT: Record<Anomaly['severity'], string> = { HIGH: 'Büyük', MEDIUM: 'Orta', LOW: 'Küçük' };

const STRIP_WINDOW_MS = 15 * 60 * 1000;

export const FidelioRadar: React.FC<FidelioRadarProps> = ({ spotData, futuresData, indicesData, chartSymbol, onChartSymbolChange }) => {
    const { signals, bigMoves } = useSignals();
    const { user, setViewMode } = useUser();
    const fundingIntervals = useFundingIntervals();
    // Funding cards only look at crypto perpetuals; nothing is shown until the contract list has loaded.
    const { symbols: perpSymbols } = useCryptoPerpSymbols();
    const isAdmin = user?.role === 'admin';

    // Filter State
    const [searchQuery, setSearchQuery] = useState('');
    const [filterSource, setFilterSource] = useState<SourceFilter>('ALL');
    const [filterSide, setFilterSide] = useState<'ALL' | 'UP' | 'DOWN'>('ALL');
    const [activeTab, setActiveTab] = useState<'SIGNALS' | 'PATTERNS'>('SIGNALS');

    // Filter Logic
    const filteredSignals = useMemo(() => {
        return signals.filter(s => {
            const matchesSearch = s.symbol.toLowerCase().includes(searchQuery.toLowerCase());

            const matchesSource = filterSource === 'ALL' || getSignalEngine(s) === filterSource;

            // A neutral record has no side: it matches neither direction filter
            const matchesSide = filterSide === 'ALL' || getSideKind(s.side) === filterSide;

            return matchesSearch && matchesSource && matchesSide;
        });
    }, [signals, searchQuery, filterSource, filterSide]);

    // Chart State
    const [ownSymbol, setOwnSymbol] = useState<string>('BTCUSDT');
    const selectedSymbol = chartSymbol ?? ownSymbol;
    const setSelectedSymbol = onChartSymbolChange ?? setOwnSymbol;
    const [showSymbolDropdown, setShowSymbolDropdown] = useState(false);
    const [showWebhookInfo, setShowWebhookInfo] = useState(false);

    // Available symbols from watchlist
    const availableSymbols = DEFAULT_WATCHLIST.filter(s => spotData && spotData[s]);

    // Strip items: what holds right now (24h change, funding) and what just happened (big moves, volume)
    const anomalies = useMemo(() => {
        const list: Anomaly[] = [];
        const now = Date.now();

        // 1. Spot price moves of the last 15 minutes (1 min / 5 min change)
        bigMoves.forEach(move => {
            if (now - move.timestamp > STRIP_WINDOW_MS) return;
            if (move.type !== 'RISE' && move.type !== 'FALL') return;
            const pct = bigMovePercent(move);
            if (pct === null) return;
            const up = move.type === 'RISE';

            list.push({
                id: `move-${move.id}`,
                symbol: move.symbol,
                type: up ? 'RISE' : 'FALL',
                // the size is stored as an absolute value; drops are shown as negative
                value: up ? pct : -pct,
                message: `${bigMoveTimeframeText(move.timeframe)} ${up ? 'yükseliş' : 'düşüş'}`.trim(),
                severity: move.level === 'HIGH' ? 'HIGH' : 'MEDIUM'
            });
        });

        // 2. 24h change beyond ±10%
        if (spotData) {
            Object.values(spotData).forEach((t: Ticker) => {
                if (!t.symbol.endsWith('USDT')) return;

                // One item per symbol: a recent move already listed above wins
                if (list.some(a => a.symbol === t.symbol)) return;

                if (t.priceChangePercent > 10) {
                    list.push({
                        id: `gainer-${t.symbol}`,
                        symbol: t.symbol,
                        type: 'RISE',
                        value: t.priceChangePercent,
                        message: '24 saatlik değişim',
                        severity: t.priceChangePercent > 20 ? 'HIGH' : 'MEDIUM'
                    });
                }
                if (t.priceChangePercent < -10) {
                    list.push({
                        id: `loser-${t.symbol}`,
                        symbol: t.symbol,
                        type: 'FALL',
                        value: t.priceChangePercent,
                        message: '24 saatlik değişim',
                        severity: t.priceChangePercent < -20 ? 'HIGH' : 'MEDIUM'
                    });
                }
            });
        }

        // 3. Funding of crypto perpetuals. Thresholds are on the 8h-equivalent rate (contracts settle
        //    every 1h, 4h or 8h), so this waits for the interval list as well as the contract list.
        //    The label only states the sign and the level.
        if (futuresData && perpSymbols && Object.keys(fundingIntervals).length > 0) {
            Object.values(futuresData).forEach((f: FuturesTicker) => {
                if (!perpSymbols.has(f.symbol) || !Number.isFinite(f.fundingRate)) return;
                const intervalHours = getFundingIntervalHours(fundingIntervals, f.symbol);
                const fundingPct = toEightHourFundingRate(f.fundingRate, intervalHours) * 100;
                const intervalNote = intervalHours !== DEFAULT_FUNDING_INTERVAL_HOURS ? ` · ${intervalHours} sa kontrat` : '';
                const spotChange = spotData?.[f.symbol]?.priceChangePercent;
                const hasSpotChange = typeof spotChange === 'number' && Number.isFinite(spotChange);
                const priceNote = hasSpotChange ? ` · 24s fiyat ${spotChange > 0 ? '+' : ''}${spotChange.toFixed(1)}%` : '';

                if (fundingPct < -0.05) {
                    list.push({
                        id: `neg-${f.symbol}`,
                        symbol: f.symbol,
                        type: 'NEG_FUNDING',
                        value: fundingPct,
                        message: `Negatif fonlama · 8s eşd.${priceNote}${intervalNote}`,
                        severity: fundingPct < -0.1 ? 'HIGH' : 'MEDIUM'
                    });
                } else if (fundingPct >= 0.1 && hasSpotChange && spotChange < -0.5) {
                    list.push({
                        id: `pos-${f.symbol}`,
                        symbol: f.symbol,
                        type: 'POS_FUNDING',
                        value: fundingPct,
                        message: `Pozitif fonlama · 8s eşd.${priceNote}${intervalNote}`,
                        severity: 'HIGH'
                    });
                }
            });
        }

        // 4. Volume records of the last 15 minutes (from the signal engine). A market-wide aggregate
        //    (symbol MARKET) is one item with its coin count, not a ratio.
        signals.forEach(s => {
            if (getSignalEngine(s) !== 'VOLUME') return;
            const signalTime = new Date(s.time).getTime();
            if (!(now - signalTime < STRIP_WINDOW_MS)) return;

            if (isMarketSignal(s)) {
                const coins = s.magnitude && Number.isFinite(s.magnitude.value) ? s.magnitude.value : 0;
                list.push({
                    id: s.id,
                    symbol: s.symbol,
                    type: 'MARKET_WIDE',
                    value: coins, // rendered as e.g. "12 coin"
                    message: getSignalLabel(s.strategy),
                    severity: 'MEDIUM'
                });
                return;
            }

            // Prefer the measured magnitude; older records carry the ratio only as "N.Nx"
            // in the strategy key (Volume_Spike_5.4x) or in the note.
            const parsed = /([\d.]+)x/.exec(s.strategy) ?? /([\d.]+)x/.exec(s.note || '');
            const multiplier = s.magnitude && Number.isFinite(s.magnitude.value)
                ? s.magnitude.value
                : parsed ? parseFloat(parsed[1]) : 0;

            list.push({
                id: s.id,
                symbol: s.symbol,
                type: 'VOLUME_SPIKE',
                value: multiplier, // rendered as e.g. "5.4x"
                message: s.magnitude?.caption || 'Hacim oranı',
                severity: multiplier >= 10 ? 'HIGH' : 'MEDIUM'
            });
        });

        return list.sort((a, b) => {
            if (a.severity === 'HIGH' && b.severity !== 'HIGH') return -1;
            if (b.severity === 'HIGH' && a.severity !== 'HIGH') return 1;
            return 0;
        }).slice(0, 4);
    }, [spotData, futuresData, signals, bigMoves, fundingIntervals, perpSymbols]);

    const getStyle = (type: AnomalyType) => {
        switch (type) {
            case 'RISE': return { text: 'text-success', icon: TrendingUp };
            case 'FALL': return { text: 'text-danger', icon: TrendingDown };
            case 'NEG_FUNDING': return { text: 'text-warning', icon: Droplets };
            case 'POS_FUNDING': return { text: 'text-warning', icon: Droplets };
            case 'VOLUME_SPIKE': return { text: 'text-primary', icon: Activity };
            case 'MARKET_WIDE': return { text: 'text-info', icon: Globe };
            default: return { text: 'text-info', icon: Radar };
        }
    };

    const formatAnomalyValue = (anomaly: Anomaly) => {
        if (anomaly.type === 'VOLUME_SPIKE') return `${anomaly.value.toFixed(1)}x`;
        if (anomaly.type === 'MARKET_WIDE') return `${Math.round(anomaly.value)} coin`;
        const digits = anomaly.type === 'NEG_FUNDING' || anomaly.type === 'POS_FUNDING' ? 3 : 2;
        return `${anomaly.value > 0 ? '+' : ''}${anomaly.value.toFixed(digits)}%`;
    };

    // The chart may show a perpetual ('XYZUSDT.P'): its header shows the contract's mark price.
    const chartPair = selectedSymbol.replace(/\.P$/, '');
    const isPerpChart = chartPair !== selectedSymbol;
    const perpTicker = isPerpChart ? futuresData?.[chartPair] : undefined;
    const selectedTicker = !isPerpChart && spotData ? spotData[chartPair] : undefined;
    const headerPrice = isPerpChart ? perpTicker?.markPrice : selectedTicker?.lastPrice;
    const headerChange = isPerpChart ? perpTicker?.priceChangePercent : selectedTicker?.priceChangePercent;

    return (
        <div className="grid w-full grid-cols-1 gap-px bg-border lg:h-full lg:max-h-[100dvh] lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_300px] lg:grid-rows-[minmax(0,3fr)_auto_minmax(0,2fr)] xl:grid-cols-[minmax(0,1fr)_340px]">

            {/* Chart panel */}
            <section id={DASHBOARD_CHART_ID} className="flex h-[400px] min-h-0 min-w-0 flex-col bg-surface lg:h-auto">
                <header className="flex h-8 shrink-0 items-stretch border-b border-border">
                    {/* Symbol Selector */}
                    <div className="relative flex shrink-0">
                        <button
                            onClick={() => setShowSymbolDropdown(!showSymbolDropdown)}
                            className={`flex items-center gap-1 px-3 text-xs font-semibold text-text transition-colors hover:bg-surface-secondary ${FOCUS_RING}`}
                        >
                            <span>{chartPair.replace(/USDT$/, '')}/USDT</span>
                            {isPerpChart && <span className="text-[10px] font-semibold text-warning">PERP</span>}
                            <ChevronDown size={12} className="text-secondary" />
                        </button>

                        {showSymbolDropdown && (
                            <div className="absolute left-0 top-full z-50 max-h-80 w-52 overflow-y-auto rounded-sm border border-border-strong bg-surface shadow-overlay">
                                {availableSymbols.map(sym => (
                                    <button
                                        key={sym}
                                        onClick={() => {
                                            setSelectedSymbol(sym);
                                            setShowSymbolDropdown(false);
                                        }}
                                        className={`flex h-7 w-full items-center justify-between border-b border-border px-3 text-left text-xs transition-colors hover:bg-surface-secondary ${sym === selectedSymbol ? 'bg-surface-highlight' : ''}`}
                                        style={sym === selectedSymbol ? { boxShadow: 'inset 2px 0 0 var(--color-brand)' } : undefined}
                                    >
                                        <span className="font-medium text-text">{sym.replace('USDT', '')}</span>
                                        <span className={`font-mono ${spotData[sym]?.priceChangePercent > 0 ? 'text-success' : 'text-danger'}`}>
                                            {spotData[sym]?.priceChangePercent > 0 ? '+' : ''}{spotData[sym]?.priceChangePercent.toFixed(2)}%
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Price + 24h change */}
                    <div className="flex shrink-0 items-center gap-2 border-l border-border px-3 font-mono">
                        <span className="font-sans text-[10px] uppercase tracking-wider text-muted">Price</span>
                        <span className="text-sm font-semibold leading-none text-text">
                            ${typeof headerPrice === 'number' && Number.isFinite(headerPrice) ? formatPrice(headerPrice) : '...'}
                        </span>
                        {typeof headerChange === 'number' && Number.isFinite(headerChange) && (
                            <span className={`text-xs leading-none ${headerChange > 0 ? 'text-success' : 'text-danger'}`}>
                                {headerChange > 0 ? '+' : ''}{headerChange.toFixed(2)}%
                            </span>
                        )}
                    </div>

                    {/* Ticker strip */}
                    <div className="hidden min-w-0 flex-1 overflow-hidden border-l border-border xl:block">
                        <GlobalTicker spotData={spotData} indicesData={indicesData} />
                    </div>
                </header>

                <div className="min-h-0 w-full flex-1">
                    <CandleChart symbol={selectedSymbol} id={`fidelio-radar-${selectedSymbol}`} />
                </div>
            </section>

            {/* Fidelio Signals */}
            <section lang="tr" className="flex h-[420px] min-h-0 min-w-0 flex-col bg-surface lg:h-auto">
                <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
                    <div className="flex h-full items-center gap-3">
                        <button
                            onClick={() => setActiveTab('SIGNALS')}
                            className={`${TAB} ${activeTab === 'SIGNALS' ? TAB_ACTIVE : TAB_IDLE}`}
                        >
                            Sinyaller
                        </button>
                        <button
                            onClick={() => setActiveTab('PATTERNS')}
                            className={`${TAB} ${activeTab === 'PATTERNS' ? TAB_ACTIVE : TAB_IDLE}`}
                        >
                            Formasyonlar
                        </button>
                    </div>
                    <div className="flex items-center gap-2">
                        {isAdmin && (
                            <button
                                onClick={() => setShowWebhookInfo(!showWebhookInfo)}
                                className={`h-6 whitespace-nowrap rounded-sm px-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${FOCUS_RING} ${showWebhookInfo
                                    ? 'bg-warning-soft text-warning'
                                    : 'text-secondary hover:bg-surface-secondary hover:text-text'}`}
                            >
                                Webhook bilgisi
                            </button>
                        )}
                        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-success">
                            <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                            Canlı
                        </div>
                    </div>
                </header>

                {/* Webhook Info Panel */}
                {isAdmin && showWebhookInfo && (
                    <div className="shrink-0 border-b border-border px-3 py-2 text-xs">
                        <p className="mb-2 leading-snug text-secondary">
                            TradingView webhook adresi, gizli anahtar ve hazır mesaj şablonları yönetici panelindeki Webhook görünümünde yer alır.
                        </p>
                        <button
                            onClick={() => setViewMode('webhook')}
                            className={`flex h-7 w-full items-center justify-center gap-1.5 rounded-sm border border-border bg-surface-secondary px-2.5 text-xs font-medium text-text transition-colors hover:bg-surface-highlight ${FOCUS_RING}`}
                        >
                            <Zap size={12} className="text-warning" />
                            Webhook görünümünü aç
                        </button>
                    </div>
                )}

                {/* Content based on Tab */}
                {activeTab === 'SIGNALS' ? (
                    <>
                        {/* Filters Toolbar */}
                        <div className="flex shrink-0 flex-col gap-1 border-b border-border px-3 py-1">
                            <div className="flex items-center gap-2">
                                <div className="relative min-w-0 flex-1">
                                    <Search size={12} className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-muted" />
                                    <input
                                        type="text"
                                        placeholder="Filtrele..."
                                        aria-label="Sembole göre filtrele"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="h-6 w-full rounded-sm border border-border bg-surface-secondary pl-6 pr-2 text-xs text-text outline-none placeholder:text-muted focus:border-primary"
                                    />
                                </div>
                                <div className="flex w-32 shrink-0 rounded-sm border border-border p-0.5">
                                    <button
                                        onClick={() => setFilterSide(filterSide === 'UP' ? 'ALL' : 'UP')}
                                        className={`${FILTER_TOGGLE} ${filterSide === 'UP' ? 'bg-success-soft text-success' : FILTER_IDLE}`}
                                        title="Yönü yukarı olan kayıtlar (Buy / Long dahil)"
                                    >
                                        YUKARI
                                    </button>
                                    <button
                                        onClick={() => setFilterSide(filterSide === 'DOWN' ? 'ALL' : 'DOWN')}
                                        className={`${FILTER_TOGGLE} ${filterSide === 'DOWN' ? 'bg-danger-soft text-danger' : FILTER_IDLE}`}
                                        title="Yönü aşağı olan kayıtlar (Sell / Short dahil)"
                                    >
                                        AŞAĞI
                                    </button>
                                </div>
                            </div>
                            <div className="flex rounded-sm border border-border p-0.5">
                                {SOURCE_FILTERS.map(({ key, label, title }) => (
                                    <button
                                        key={key}
                                        onClick={() => setFilterSource(filterSource === key ? 'ALL' : key)}
                                        className={`${FILTER_TOGGLE} ${filterSource === key ? FILTER_ACTIVE : FILTER_IDLE}`}
                                        title={title}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto">
                            {filteredSignals.length === 0 ? (
                                <div className="flex h-full items-center justify-center gap-1.5 px-3 py-8 text-xs text-muted">
                                    <Filter size={14} />
                                    <p>Kayıt yok</p>
                                </div>
                            ) : (
                                filteredSignals.slice(0, 20).map((signal) => {
                                    const badge = getSideBadge(signal);
                                    const engine = getSignalEngine(signal);
                                    const engineTag = ENGINE_TAG[engine];
                                    const magnitude = getMagnitude(signal);
                                    // A market-wide record is not a pair: no chart to open, no price.
                                    const isMarket = isMarketSignal(signal);
                                    return (
                                        <div
                                            key={signal.id}
                                            onClick={isMarket ? undefined : () => setSelectedSymbol(toChartSymbol(signal.symbol, isPerpSignal(signal)))}
                                            className={`border-b border-border px-3 py-1 text-xs ${isMarket ? '' : 'cursor-pointer hover:bg-surface-secondary'}`}
                                        >
                                            <div className="flex items-center gap-1.5">
                                                {isMarket ? (
                                                    <span className={`${BADGE} ${MARKET_BADGE.tone}`} title={MARKET_BADGE.title}>{MARKET_BADGE.text}</span>
                                                ) : (
                                                    <span className="truncate font-medium text-text">
                                                        {signal.symbol.replace('USDT', '')}
                                                    </span>
                                                )}
                                                <span className={`${BADGE} ${badge.tone}`} title={badge.title}>
                                                    {badge.text}
                                                </span>
                                                {engine === 'WEBHOOK' && (
                                                    <span className={`${BADGE} flex items-center gap-0.5 bg-warning-soft text-warning`}>
                                                        <Zap size={8} fill="currentColor" /> WH
                                                    </span>
                                                )}
                                                {engineTag && (
                                                    <span className={`${BADGE} bg-surface-secondary text-secondary`}>
                                                        {engineTag}
                                                    </span>
                                                )}
                                                <span className="ml-auto shrink-0 font-mono text-text">
                                                    {isMarket ? <span className="text-muted">—</span> : `$${formatPrice(signal.price)}`}
                                                </span>
                                            </div>

                                            <div className="flex items-center justify-between gap-2">
                                                <span className="min-w-0 truncate text-[11px] text-secondary">{getSignalLabel(signal.strategy)}</span>
                                                <span className="flex shrink-0 items-baseline gap-2">
                                                    {magnitude && (
                                                        <span className="font-mono text-[11px] font-semibold text-text" title={magnitude.caption || undefined}>
                                                            {magnitude.text}
                                                        </span>
                                                    )}
                                                    <span className="font-mono text-[10px] text-muted">
                                                        {new Date(signal.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </>
                ) : (
                    <PatternRadar onOpenChart={setSelectedSymbol} />
                )}
            </section>

            {/* Anomalies strip */}
            <section lang="tr" className="flex min-w-0 flex-col bg-surface lg:col-span-2 lg:flex-row">
                <header
                    className="flex h-7 shrink-0 items-center border-b border-border px-3 lg:h-auto lg:w-28 lg:border-b-0 lg:border-r"
                    title="Son 15 dakikanın 1 dk / 5 dk fiyat hareketleri ve hacim kayıtları, 24 saatte ±%10'u aşan coinler, 8 saatlik eşdeğer fonlaması uçta olan kripto perp kontratları. En çok 4 satır."
                >
                    <h2 className={PANEL_TITLE}>Anomaliler</h2>
                </header>
                {anomalies.length > 0 ? (
                    <div className="grid min-w-0 flex-1 grid-cols-1 lg:grid-cols-4 lg:divide-x lg:divide-border">
                        {anomalies.map(anomaly => {
                            const style = getStyle(anomaly.type);
                            const Icon = style.icon;
                            const isMarket = anomaly.type === 'MARKET_WIDE';
                            return (
                                <div
                                    key={anomaly.id}
                                    onClick={isMarket ? undefined : () => setSelectedSymbol(toChartSymbol(anomaly.symbol, anomaly.type === 'NEG_FUNDING' || anomaly.type === 'POS_FUNDING'))}
                                    className={`grid h-7 min-w-0 grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] items-center gap-x-1.5 border-b border-border px-3 text-xs transition-colors last:border-b-0 lg:h-10 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:content-center lg:gap-y-0.5 lg:border-b-0 ${isMarket ? '' : 'cursor-pointer hover:bg-surface-secondary'}`}
                                >
                                    <Icon size={12} className={`shrink-0 ${style.text}`} />
                                    <span className="truncate font-medium text-text" title={isMarket ? MARKET_BADGE.title : undefined}>
                                        {isMarket ? 'Piyasa' : anomaly.symbol.replace('USDT', '')}
                                    </span>
                                    <span className="min-w-0 truncate text-[10px] uppercase tracking-wider text-muted lg:order-4 lg:col-span-2" title={anomaly.message}>{anomaly.message}</span>
                                    <span className={`text-right font-mono font-semibold lg:order-3 ${style.text}`}>
                                        {formatAnomalyValue(anomaly)}
                                    </span>
                                    <span className={`${BADGE} justify-self-end lg:order-5 ${anomaly.severity === 'HIGH' ? 'bg-danger-soft text-danger' :
                                        anomaly.severity === 'MEDIUM' ? 'bg-warning-soft text-warning' :
                                            'bg-surface-secondary text-secondary'
                                        }`} title="Büyüklük sınıfı">
                                        {SEVERITY_TEXT[anomaly.severity]}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 px-3 text-xs text-muted lg:h-10">
                        <Sparkles size={14} />
                        <p>Şu an koşulu sağlayan yok</p>
                    </div>
                )}
            </section>

            {/* Big Move Radars */}
            <div className="grid min-h-0 min-w-0 grid-cols-1 gap-px lg:col-span-2 lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)]">
                {/* Binance Spot Big Move */}
                <BigMoveRadar onOpenChart={setSelectedSymbol} />

                {/* Perp Big Move Radar */}
                <PerpBigMoveRadar onOpenChart={setSelectedSymbol} />
            </div>
        </div>
    );
};
