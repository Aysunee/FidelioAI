import React, { useCallback, useMemo, useState, useEffect, useSyncExternalStore } from 'react';
import { useMarketData } from '../context/MarketContext';
import { FuturesTicker, Ticker } from '../types';
import { FundingAnalyzer } from '../utils/AnomalyLogic';
import { DEFAULT_FUNDING_INTERVAL_HOURS, toEightHourFundingRate, annualizeFundingRate } from '../utils/formatters';
import { Search, TrendingDown, ArrowUpDown, ArrowUp, ArrowDown, BarChart3, ChevronsDown, ChevronsUp, Activity } from 'lucide-react';
import { CandleChart } from './CandleChart';
import { CoinIcon } from './terminal/CoinIcon';
import { SplitPane } from './terminal/SplitPane';
import { SymbolInsightPanel } from './terminal/SymbolInsightPanel';

interface FundingRatesProps {
    data: Record<string, FuturesTicker>;
    spotData: Record<string, Ticker>;
}

type SortKey = 'symbol' | 'markPrice' | 'fundingRate' | 'priceChangePercent' | 'volume';
type SortDirection = 'asc' | 'desc';

type FundingHistory = { time: number, rate: number }[];

const PAGE_SIZE = 100;
const EMPTY_HISTORY: FundingHistory = [];

// --- Funding interval info (Binance perpetuals settle every 1h, 4h or 8h) ---
// GET /fapi/v1/fundingInfo lists contracts whose interval/cap differs from the default; unlisted ones use 8h.
const FUNDING_INFO_URL = 'https://fapi.binance.com/fapi/v1/fundingInfo';
const FUNDING_INFO_TTL_MS = 60 * 60 * 1000;
const FUNDING_INFO_RETRY_MS = 10 * 60 * 1000;

let fundingInfoCache: { data: Record<string, number>; fetchedAt: number } | null = null;
let fundingInfoRequest: Promise<Record<string, number>> | null = null;

export const fetchFundingIntervals = (): Promise<Record<string, number>> => {
    if (fundingInfoCache && Date.now() - fundingInfoCache.fetchedAt < FUNDING_INFO_TTL_MS) {
        return Promise.resolve(fundingInfoCache.data);
    }
    if (fundingInfoRequest) return fundingInfoRequest;

    fundingInfoRequest = (async () => {
        try {
            const response = await fetch(FUNDING_INFO_URL);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const body = await response.json();
            const intervals: Record<string, number> = {};
            if (Array.isArray(body)) {
                body.forEach((item: any) => {
                    const hours = Number(item?.fundingIntervalHours);
                    if (typeof item?.symbol === 'string' && Number.isFinite(hours) && hours > 0) {
                        intervals[item.symbol] = hours;
                    }
                });
            }
            fundingInfoCache = { data: intervals, fetchedAt: Date.now() };
            return intervals;
        } catch (error) {
            console.warn('[FundingRates] Funding aralıkları alınamadı, 8 saat varsayılıyor:', error);
            return fundingInfoCache?.data ?? {};
        } finally {
            fundingInfoRequest = null;
        }
    })();

    return fundingInfoRequest;
};

// Per-symbol funding interval in hours (symbols missing from the map use DEFAULT_FUNDING_INTERVAL_HOURS)
export const useFundingIntervals = (): Record<string, number> => {
    const [intervals, setIntervals] = useState<Record<string, number>>(() => fundingInfoCache?.data ?? {});

    useEffect(() => {
        let cancelled = false;
        const load = () => {
            fetchFundingIntervals().then(map => {
                if (!cancelled) setIntervals(prev => (prev === map ? prev : map));
            });
        };
        load();
        // Cached for an hour; a failed request is retried on the next tick
        const timer = setInterval(load, FUNDING_INFO_RETRY_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, []);

    return intervals;
};

export const getFundingIntervalHours = (intervals: Record<string, number>, symbol: string): number =>
    intervals[symbol] ?? DEFAULT_FUNDING_INTERVAL_HOURS;

// --- Futures 24h stats (REST seed for contracts that have not streamed a miniTicker yet) ---
const FUTURES_24H_URL = 'https://fapi.binance.com/fapi/v1/ticker/24hr';
const FUTURES_24H_REFRESH_MS = 5 * 60 * 1000;

type Futures24hStats = Record<string, { priceChangePercent: number; volume: number }>;

const useFutures24hStats = (): Futures24hStats => {
    const [stats, setStats] = useState<Futures24hStats>({});

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const response = await fetch(FUTURES_24H_URL);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const body = await response.json();
                if (!Array.isArray(body)) return;
                const next: Futures24hStats = {};
                body.forEach((item: any) => {
                    const change = Number(item?.priceChangePercent);
                    const volume = Number(item?.quoteVolume);
                    if (typeof item?.symbol === 'string' && Number.isFinite(change) && Number.isFinite(volume)) {
                        next[item.symbol] = { priceChangePercent: change, volume };
                    }
                });
                if (!cancelled) setStats(next);
            } catch (error) {
                console.warn('[FundingRates] Vadeli 24s istatistikleri alınamadı:', error);
            }
        };
        load();
        const timer = setInterval(load, FUTURES_24H_REFRESH_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, []);

    return stats;
};

// --- One shared 1s clock for every countdown (instead of one timer per row) ---
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;
let clockNow = Date.now();

const subscribeClock = (listener: () => void) => {
    clockListeners.add(listener);
    if (!clockTimer) {
        clockNow = Date.now();
        clockTimer = setInterval(() => {
            clockNow = Date.now();
            clockListeners.forEach(l => l());
        }, 1000);
    }
    return () => {
        clockListeners.delete(listener);
        if (clockListeners.size === 0 && clockTimer) {
            clearInterval(clockTimer);
            clockTimer = null;
        }
    };
};
const getClockSnapshot = () => clockNow;

const formatCountdown = (diff: number) => {
    if (diff <= 0) return '00:00:00';
    const h = Math.floor(diff / (1000 * 60 * 60));
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const s = Math.floor((diff % (1000 * 60)) / 1000);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

// Funding Countdown Component
const FundingCountdown: React.FC<{ targetTime: number }> = ({ targetTime }) => {
    const now = useSyncExternalStore(subscribeClock, getClockSnapshot, getClockSnapshot);
    return <span className="font-mono">{targetTime ? formatCountdown(targetTime - now) : '--:--:--'}</span>;
};

interface FundingRowData {
    ticker: FuturesTicker;
    changePct: number | null;
    volume: number | null;
    intervalHours: number;
    rate8h: number;
}

interface FundingRowProps {
    ticker: FuturesTicker;
    changePct: number | null;
    intervalHours: number;
    history: FundingHistory;
    isSelected: boolean;
    onSelect: (symbol: string) => void;
    onOpen: (symbol: string) => void; // double click: chart + analysis panels
}

// Shared by the header and the rows so every column lines up.
// Symbol | Mark Price | 24h Change | Funding (interval · countdown + rate) | Trend
const GRID_COLS =
    'minmax(104px,1.3fr) minmax(84px,1fr) minmax(72px,0.8fr) minmax(176px,1.4fr) minmax(136px,1.1fr)';
const TABLE_MIN_WIDTH = 660; // below this the table scrolls sideways inside its panel (never the page)

// Positive funding = longs pay (caution), negative = shorts pay
const fundingClass = (rate: number): string =>
    rate > 0 ? 'text-warning' : rate < 0 ? 'text-success' : 'text-muted';

// Memoized row: re-renders only when its own ticker / history / selection changes
const FundingRow = React.memo<FundingRowProps>(({ ticker, changePct, intervalHours, history, isSelected, onSelect, onOpen }) => {
    const fundingPct = ticker.fundingRate * 100;
    const rate8hPct = toEightHourFundingRate(ticker.fundingRate, intervalHours) * 100;

    // Trend thresholds are defined on the 8h-equivalent rate, so normalize the per-interval history first
    const trend = useMemo(() => FundingAnalyzer.analyze(
        ticker.symbol,
        history.map(p => ({ time: p.time, rate: toEightHourFundingRate(p.rate, intervalHours) }))
    ), [ticker.symbol, history, intervalHours]);
    const sparkline = useMemo(() => {
        if (history.length <= 5) return null;
        const points = history.slice(-15);
        const rates = points.map(p => p.rate);
        const min = Math.min(...rates);
        const max = Math.max(...rates);
        const range = max - min || 0.0001;
        return points.map(p => ((p.rate - min) / range) * 100);
    }, [history]);

    return (
        <div
            onClick={() => onSelect(ticker.symbol)}
            onDoubleClick={() => onOpen(ticker.symbol)}
            title="Çift tıkla: grafik ve analiz panelini aç"
            className={`grid h-7 cursor-pointer select-none items-center gap-x-3 border-b border-border px-3 text-xs ${isSelected
                ? 'bg-surface-highlight'
                : 'hover:bg-surface-secondary'}`}
            style={{
                gridTemplateColumns: GRID_COLS,
                boxShadow: isSelected ? 'inset 2px 0 0 var(--color-brand)' : undefined,
            }}
        >
            {/* Symbol */}
            <div className="flex min-w-0 items-center gap-1.5">
                <CoinIcon asset={ticker.symbol.replace('USDT', '')} size={16} />
                <span className="truncate font-medium text-text">
                    {ticker.symbol.replace('USDT', '')}
                    <span className="ml-1 text-[10px] font-normal text-muted">USDT</span>
                </span>
            </div>

            {/* Mark Price */}
            <div className="truncate text-right font-mono text-text">
                ${ticker.markPrice.toFixed(ticker.markPrice < 1 ? 5 : 2)}
            </div>

            {/* 24h Change (futures) */}
            <div className="truncate text-right font-mono">
                {changePct === null ? (
                    <span className="text-muted">—</span>
                ) : (
                    <span className={changePct >= 0 ? 'text-success' : 'text-danger'}>
                        {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
                    </span>
                )}
            </div>

            {/* Funding Rate (raw per-interval rate; sorted by its 8h equivalent) */}
            <div
                className="flex min-w-0 items-center justify-end gap-3 font-mono"
                title={`${intervalHours} saatlik ham oran. 8 saatlik eşdeğer: ${rate8hPct.toFixed(4)}% · Yıllık: ${(annualizeFundingRate(ticker.fundingRate, intervalHours) * 100).toFixed(2)}%`}
            >
                <span className="shrink-0 text-[10px] text-muted">
                    <span className={intervalHours !== DEFAULT_FUNDING_INTERVAL_HOURS ? 'text-primary' : ''}>{intervalHours} sa</span>
                    {' · '}
                    <FundingCountdown targetTime={ticker.nextFundingTime} />
                </span>
                <span className={`w-[68px] shrink-0 text-right font-medium ${fundingClass(fundingPct)}`}>
                    {fundingPct.toFixed(4)}%
                </span>
            </div>

            {/* Trend Analysis */}
            <div className="flex min-w-0 items-center justify-end gap-2">
                {/* Sparkline */}
                {sparkline && (
                    <div className="flex h-4 w-14 shrink-0 items-end gap-px">
                        {sparkline.map((h, i) => (
                            <div
                                key={i}
                                className={`min-w-[2px] flex-1 opacity-60 ${trend.velocity < 0 ? 'bg-danger' : 'bg-success'}`}
                                style={{ height: `${Math.max(h, 10)}%` }}
                            />
                        ))}
                    </div>
                )}
                <span className="flex w-[58px] shrink-0 justify-end">
                    {trend.direction === 'DIVING' && (
                        <span className="inline-flex items-center gap-0.5 rounded-sm bg-danger-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase text-danger">
                            <ChevronsDown size={11} />
                            DIVE
                        </span>
                    )}
                    {trend.direction === 'SPIKING' && (
                        <span className="inline-flex items-center gap-0.5 rounded-sm bg-success-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase text-success">
                            <ChevronsUp size={11} />
                            SPIKE
                        </span>
                    )}
                    {trend.direction === 'STABLE' && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-muted">
                            <Activity size={11} />
                            Stable
                        </span>
                    )}
                </span>
            </div>
        </div>
    );
});
FundingRow.displayName = 'FundingRow';

export const FundingRates: React.FC<FundingRatesProps> = ({ data, spotData }) => {
    const { fundingHistory } = useMarketData();
    const [searchTerm, setSearchTerm] = useState('');
    const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection }>({
        key: 'fundingRate',
        direction: 'asc'
    });
    const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
    const [showCharts, setShowCharts] = useState(false);
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const openDetail = useCallback((symbol: string) => {
        setSelectedSymbol(symbol);
        setShowCharts(true);
    }, []);
    const fundingIntervals = useFundingIntervals();
    const futures24h = useFutures24hStats();

    // Show the first page again whenever the list definition changes
    useEffect(() => {
        setVisibleCount(PAGE_SIZE);
    }, [searchTerm, sortConfig]);

    const handleSort = (key: SortKey) => {
        setSortConfig(current => ({
            key,
            direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
        }));
    };

    const sortedList = useMemo<FundingRowData[]>(() => {
        let list = Object.values(data) as FuturesTicker[];

        if (searchTerm) {
            list = list.filter(t => t.symbol.toLowerCase().includes(searchTerm.toLowerCase()));
        }

        // 24h change / volume come from the futures contract itself (live miniTicker, REST seed as fallback)
        const rows: FundingRowData[] = list.map(ticker => {
            const seed = futures24h[ticker.symbol];
            const liveChange = Number.isFinite(ticker.priceChangePercent) ? ticker.priceChangePercent as number : null;
            const liveVolume = Number.isFinite(ticker.volume) ? ticker.volume as number : null;
            const intervalHours = getFundingIntervalHours(fundingIntervals, ticker.symbol);
            return {
                ticker,
                changePct: liveChange ?? seed?.priceChangePercent ?? null,
                volume: liveVolume ?? seed?.volume ?? null,
                intervalHours,
                rate8h: toEightHourFundingRate(ticker.fundingRate || 0, intervalHours)
            };
        });

        const getValue = (row: FundingRowData): number | string | null => {
            switch (sortConfig.key) {
                case 'symbol': return row.ticker.symbol;
                case 'markPrice': return row.ticker.markPrice || 0;
                case 'fundingRate': return row.rate8h; // compare contracts on the same 8h basis
                case 'priceChangePercent': return row.changePct;
                case 'volume': return row.volume;
            }
        };

        return rows.sort((a, b) => {
            const aValue = getValue(a);
            const bValue = getValue(b);

            // Missing data always goes last
            if (aValue === null && bValue === null) return 0;
            if (aValue === null) return 1;
            if (bValue === null) return -1;

            if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [data, futures24h, fundingIntervals, searchTerm, sortConfig]);

    useEffect(() => {
        if (!selectedSymbol && sortedList.length > 0) {
            setSelectedSymbol(sortedList[0].ticker.symbol);
        }
    }, [sortedList, selectedSymbol]);

    const selectedTicker = selectedSymbol ? data[selectedSymbol] : null;
    const selectedSpot = selectedSymbol ? spotData[selectedSymbol] : null;
    const selectedRow = selectedSymbol ? sortedList.find(r => r.ticker.symbol === selectedSymbol) : undefined;
    const selectedInterval = selectedSymbol ? getFundingIntervalHours(fundingIntervals, selectedSymbol) : DEFAULT_FUNDING_INTERVAL_HOURS;
    const selectedVolume = selectedRow?.volume ?? null;
    const visibleRows = sortedList.slice(0, visibleCount);

    const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
        if (sortConfig.key !== columnKey) return <ArrowUpDown size={10} className="shrink-0 opacity-40" />;
        return sortConfig.direction === 'asc'
            ? <ArrowUp size={10} className="shrink-0 text-primary" />
            : <ArrowDown size={10} className="shrink-0 text-primary" />;
    };

    const formatVolume = (vol: number) => {
        if (vol >= 1000000) return `${(vol / 1000000).toFixed(2)}M`;
        if (vol >= 1000) return `${(vol / 1000).toFixed(2)}K`;
        return vol.toFixed(0);
    };

    const sortHeader = (key: SortKey) =>
        `flex min-w-0 cursor-pointer items-center gap-1 transition-colors hover:text-text ${sortConfig.key === key ? 'text-text' : ''}`;
    const statLabel = 'text-[10px] uppercase tracking-wider text-muted';
    const actionButton = 'inline-flex h-7 items-center gap-1.5 rounded-sm border px-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary';
    const defaultButton = 'border-border bg-surface-secondary text-text hover:bg-surface-highlight';

    return (
        <div className="flex h-full min-h-0 w-full flex-1 flex-col gap-px bg-border">
            {/* Selected contract strip */}
            {selectedTicker && (
                <section className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] bg-surface xl:grid-cols-[auto_minmax(0,1fr)_auto]">
                    {/* Coin Info */}
                    <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2.5 px-3 py-1.5">
                        <CoinIcon asset={selectedTicker.symbol.replace('USDT', '')} size={24} />
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                                <span className="truncate text-xs font-semibold text-text">
                                    {selectedTicker.symbol.replace('USDT', '')}
                                </span>
                                <span className="shrink-0 rounded-sm bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none text-warning">
                                    PERPETUAL
                                </span>
                            </div>
                            <div className="flex flex-wrap items-baseline gap-x-2">
                                <span className="font-mono text-lg font-semibold leading-6 text-text">
                                    ${selectedTicker.markPrice.toFixed(selectedTicker.markPrice < 1 ? 5 : 2)}
                                </span>
                                <span className="font-mono text-[11px] text-muted">
                                    Spot: {selectedSpot ? `$${selectedSpot.lastPrice.toFixed(selectedSpot.lastPrice < 1 ? 5 : 2)}` : '—'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Stats strip */}
                    <div className="col-span-2 row-start-2 grid grid-cols-2 gap-px border-t border-border bg-border sm:flex sm:gap-0 sm:divide-x sm:divide-border sm:bg-surface xl:col-span-1 xl:col-start-2 xl:row-start-1 xl:border-l xl:border-t-0">
                        <div className="col-span-2 flex min-w-0 flex-col justify-center bg-surface px-3 py-1.5 sm:flex-1 xl:flex-none">
                            <div className={statLabel}>Funding Rate</div>
                            <div className="flex flex-wrap items-baseline gap-x-2">
                                <span className={`font-mono text-sm font-semibold ${selectedTicker.fundingRate > 0 ? 'text-warning' : 'text-success'}`}>
                                    {(selectedTicker.fundingRate * 100).toFixed(4)}%
                                </span>
                                <span className="font-mono text-[10px] text-muted">
                                    {selectedInterval} sa aralık · 8s eşd. {(toEightHourFundingRate(selectedTicker.fundingRate, selectedInterval) * 100).toFixed(4)}% · yıllık {(annualizeFundingRate(selectedTicker.fundingRate, selectedInterval) * 100).toFixed(2)}%
                                </span>
                            </div>
                        </div>
                        <div className="flex flex-col justify-center bg-surface px-3 py-1.5">
                            <div className={statLabel}>Next Funding</div>
                            <div className="font-mono text-sm font-semibold text-text">
                                <FundingCountdown targetTime={selectedTicker.nextFundingTime} />
                            </div>
                        </div>
                        <div className="flex flex-col justify-center bg-surface px-3 py-1.5">
                            <div className={statLabel}>24h Volume</div>
                            <div className="font-mono text-sm font-semibold text-text">
                                {selectedVolume === null ? '—' : `$${formatVolume(selectedVolume)}`}
                            </div>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="col-start-2 row-start-1 flex items-center gap-1 px-3 xl:col-start-3">
                        {/* Coinglass Button */}
                        <a
                            href={`https://www.coinglass.com/funding/${selectedTicker.symbol.replace('USDT', '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`${actionButton} ${defaultButton}`}
                        >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                                <line x1="12" y1="22.08" x2="12" y2="12" />
                            </svg>
                            <span className="sr-only sm:not-sr-only">Coinglass</span>
                        </a>

                        {/* Chart Toggle */}
                        <button
                            onClick={() => setShowCharts(!showCharts)}
                            className={`${actionButton} ${showCharts
                                ? 'border-transparent bg-primary text-primary-contrast hover:opacity-90'
                                : defaultButton}`}
                        >
                            <BarChart3 size={13} className="shrink-0" />
                            <span className="sr-only sm:not-sr-only">{showCharts ? 'Hide Chart' : 'Show Chart'}</span>
                        </button>
                    </div>
                </section>
            )}

            <div className="flex min-h-0 flex-1 flex-col gap-px lg:flex-row">
                {/* Contracts table */}
                <section className="flex min-h-[360px] min-w-0 flex-1 flex-col bg-surface lg:min-h-0">
                    <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
                        <div className="flex min-w-0 items-center gap-2">
                            <TrendingDown size={13} className="shrink-0 text-secondary" />
                            <h2 className="truncate text-[11px] font-semibold uppercase tracking-wider text-secondary">Derivatives Market</h2>
                            <span className="hidden shrink-0 font-mono text-[10px] text-muted sm:inline">{sortedList.length} perpetual contracts</span>
                        </div>

                        {/* Search */}
                        <div className="relative w-full max-w-[200px] shrink">
                            <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" size={12} />
                            <input
                                type="text"
                                placeholder="Search contracts..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                aria-label="Search perpetual contracts"
                                className="h-6 w-full rounded-sm border border-border bg-surface-secondary pl-6 pr-2 text-xs text-text outline-none placeholder:text-muted focus:border-primary"
                            />
                        </div>
                    </header>

                    {/* Table (scrolls inside the panel on both axes) */}
                    <div className="min-h-0 flex-1 overflow-auto">
                        <div style={{ minWidth: TABLE_MIN_WIDTH }}>
                            {/* Table Header */}
                            <div
                                className="sticky top-0 z-10 grid h-7 items-center gap-x-3 border-b border-border bg-surface px-3 text-[10px] font-medium uppercase tracking-wider text-muted"
                                style={{ gridTemplateColumns: GRID_COLS }}
                            >
                                <div className={sortHeader('symbol')} onClick={() => handleSort('symbol')}>
                                    Symbol <SortIcon columnKey="symbol" />
                                </div>
                                <div className={`${sortHeader('markPrice')} justify-end`} onClick={() => handleSort('markPrice')}>
                                    Mark Price <SortIcon columnKey="markPrice" />
                                </div>
                                <div className={`${sortHeader('priceChangePercent')} justify-end`} onClick={() => handleSort('priceChangePercent')}>
                                    24h Change <SortIcon columnKey="priceChangePercent" />
                                </div>
                                <div className={`${sortHeader('fundingRate')} justify-end`} onClick={() => handleSort('fundingRate')} title="Sıralama, farklı aralıklı kontratları karşılaştırabilmek için 8 saatlik eşdeğer orana göre yapılır">
                                    Funding <SortIcon columnKey="fundingRate" />
                                </div>
                                <div className="text-right">
                                    Trend Analysis
                                </div>
                            </div>

                            {/* Table Body */}
                            {visibleRows.map(row => (
                                <FundingRow
                                    key={row.ticker.symbol}
                                    ticker={row.ticker}
                                    changePct={row.changePct}
                                    intervalHours={row.intervalHours}
                                    history={fundingHistory[row.ticker.symbol] || EMPTY_HISTORY}
                                    isSelected={selectedSymbol === row.ticker.symbol}
                                    onSelect={setSelectedSymbol}
                                    onOpen={openDetail}
                                />
                            ))}
                            {sortedList.length > visibleCount && (
                                <button
                                    onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                                    className="h-7 w-full text-[11px] font-medium text-primary transition-colors hover:bg-surface-secondary focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                                >
                                    Daha fazla göster ({sortedList.length - visibleCount} kaldı)
                                </button>
                            )}
                        </div>
                    </div>
                </section>

                {/* Detail column (beside the table at lg+, above it on small screens): TradingView chart on top,
                    the Terminal's Funding akışı / Kurulum / Duyarlılık panels below. Double click a row to open it. */}
                {selectedSymbol && showCharts && (
                    <div className="order-first h-[640px] min-w-0 shrink-0 overflow-hidden bg-surface lg:order-none lg:h-auto lg:w-[46%]">
                        <SplitPane
                            direction="vertical"
                            storageKey="fidelio_funding_detail_split"
                            defaultSizes={[58, 42]}
                            minSizesPx={[200, 160]}
                            className="h-full w-full"
                        >
                            <div className="h-full min-h-0 bg-surface">
                                <CandleChart symbol={`${selectedSymbol}.P`} id={`detail-chart-${selectedSymbol}`} />
                            </div>
                            <SymbolInsightPanel symbol={selectedSymbol} onSelect={setSelectedSymbol} />
                        </SplitPane>
                    </div>
                )}
            </div>
        </div>
    );
};
