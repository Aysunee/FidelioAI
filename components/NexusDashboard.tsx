import React, { useState, useMemo, useEffect } from 'react';
import {
    Activity, Layers, Link as LinkIcon, Search, Zap, BarChart3,
    ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown
} from 'lucide-react';
import { useMarketData } from '../context/MarketContext';
import { FuturesTicker, Ticker } from '../types';
import { formatPrice } from '../utils/formatters';
import {
    addPriceData,
    calculateCorrelationMatrix,
    getSampleCount,
    formatCorrelationWindow,
    MIN_SAMPLES,
    CorrelationMatrix as CorrelationMatrixType
} from '../utils/correlationEngine';
import CorrelationMatrix from './CorrelationMatrix';
import { useCryptoPerpSymbols } from './AnomalyRadar';
import ErrorBoundary from './ErrorBoundary';
import { CoinIcon } from './terminal/CoinIcon';

// --- DATA CONSTANTS ---
const CATEGORIES = [
    { name: "Smart Contract Platforms", coins: ["ETH", "SOL", "BNB", "ADA", "DOT"], desc: "Akıllı sözleşmeler ve dApp altyapısı." },
    { name: "DeFi", coins: ["UNI", "LINK", "AAVE", "SKY"], desc: "Aracısız finansal işlemler ve protokoller." },
    { name: "Memes", coins: ["DOGE", "SHIB", "PEPE", "FLOKI", "BONK", "WIF"], desc: "Topluluk odaklı, şaka amaçlı varlıklar." },
    { name: "AI & Big Data", coins: ["FET", "NEAR", "RENDER", "GRT"], desc: "Yapay zeka ve veri işleme." },
    { name: "Layer 2 (L2)", coins: ["ARB", "OP", "POL", "MNT"], desc: "Ölçeklendirme çözümleri." },
    { name: "RWA", coins: ["ONDO", "LINK", "MANTRA"], desc: "Gerçek dünya varlıkları." },
    { name: "Gaming / Metaverse", coins: ["AXS", "SAND", "MANA", "GALA", "IMX"], desc: "Oyun ve sanal evrenler." },
    { name: "Liquid Staking", coins: ["LDO", "RPL", "ENA"], desc: "Likidite sağlayan staking." },
    { name: "Solana Ecosystem", coins: ["SOL", "JUP", "RAY", "PYTH"], desc: "Solana ağı projeleri." },
    { name: "DePIN", coins: ["RENDER", "HNT", "FIL", "AR"], desc: "Fiziksel altyapı ağları." },
    { name: "Oracles", coins: ["LINK", "PYTH", "BAND"], desc: "Veri akışı sağlayıcıları." },
    { name: "Privacy", coins: ["XMR", "ZEC", "ROSE", "SCRT"], desc: "Gizlilik odaklı." },
    { name: "Storage", coins: ["FIL", "AR", "STORJ", "SC"], desc: "Veri depolama." },
    { name: "CEX Tokens", coins: ["BNB", "OKB", "CRO", "KCS"], desc: "Borsa tokenları." },
    { name: "Payments", coins: ["XRP", "XLM", "ACH"], desc: "Ödeme sistemleri." },
    { name: "Bitcoin Ecosystem", coins: ["STX", "ORDI", "SATS"], desc: "BTC katmanları." },
    { name: "Fan Tokens", coins: ["SANTOS", "BAR", "CITY", "PORTO", "LAZIO", "PSG", "OG", "ASR", "ATM", "ACM"], desc: "Spor ve taraftar tokenları." },
    { name: "Çin Kökenli / Odaklı", coins: ["TRX", "VET", "NEO", "QTUM", "FIL", "CAKE", "CFX", "SUN", "CKB", "SUSHI", "ACH", "JST", "ONT", "NKN", "GHST", "HOOK", "WAN", "DYDX", "PHB"], desc: "Asya pazarı odaklı projeler." },
    { name: "2017 Boğa Efsaneleri", coins: ["XRP", "TRX", "ADA", "BCH", "ZEC", "XMR", "XLM", "LTC", "ETC", "FIL", "XTZ", "IOTA", "NEO", "A"], desc: "Eski döngülerin popüler coinleri." }
];

const CORRELATIONS = [
    { driver: "WLFI", followers: ["TRUMP", "MELANIA"], note: "Politik Tokenlar" },
    { driver: "BTC", followers: ["ETH", "SOL", "AVAX", "ADA"], note: "Piyasa Liderleri (TOTAL)" },
    { driver: "DOGE", followers: ["PEPE", "SHIB"], note: "OG Memes" },
    { driver: "FLOKI", followers: ["BONK"], note: "Köpek Tokenları" },
    { driver: "WIF", followers: ["NEIRO", "GIGGLE"], note: "Yeni Nesil Meme" },
    { driver: "AVAX", followers: ["JOE"], note: "Avalanche Ekosistemi" },
    { driver: "NEO", followers: ["ONT", "GAS"], note: "Legacy China" },
    { driver: "ADA", followers: ["XLM"], note: "Eski Nesil L1" },
    { driver: "ATOM", followers: ["KAVA", "ALGO"], note: "Cosmos & Interop" },
    { driver: "SANTOS", followers: ["PORTO", "LAZIO"], note: "Fan Token Liderleri" },
    { driver: "USTC", followers: ["LUNC"], note: "Terra Classic" },
    { driver: "LUNC", followers: ["ANC", "MIR"], note: "Terra Classic Eco" },
    { driver: "MANA", followers: ["SAND", "ENJ"], note: "Metaverse" },
    { driver: "AXS", followers: ["SLP"], note: "Play to Earn" },
    { driver: "SFP", followers: ["C98", "TWT"], note: "Cüzdan Tokenları" },
    { driver: "JST", followers: ["SUN"], note: "Tron Ekosistemi" },
];

// Single symbol mapping used by every Nexus table. Symbols without live data (delisted, not on spot,
// or not streamed yet) are handled by the data gate below, not by special cases here.
const getSymbolPair = (symbol: string): string => {
    const s = symbol.toUpperCase();
    if (s === "TOTAL") return "BTCUSDT";
    if (s === "SATS") return "1000SATSUSDT";
    const specialRules: Record<string, string> = {
        "BONK": "BONKUSDT", "PEPE": "PEPEUSDT", "SHIB": "SHIBUSDT", "FLOKI": "FLOKIUSDT", "WIF": "WIFUSDT"
    };
    return specialRules[s] || `${s}USDT`;
};

// Coins renamed on Binance: list entry -> former ticker (shown next to the name and matched by search).
const FORMER_TICKERS: Record<string, string> = { RENDER: 'RNDR', POL: 'MATIC', SKY: 'MKR', MANTRA: 'OM', A: 'EOS' };

const matchesCoin = (coin: string, lowSearch: string): boolean =>
    coin.toLowerCase().includes(lowSearch) || (FORMER_TICKERS[coin]?.toLowerCase().includes(lowSearch) ?? false);

// Coins without any Binance market (other exchanges' tokens, delisted projects): price and 24h change
// come from CoinGecko instead.
const COINGECKO_IDS: Record<string, string> = {
    MNT: 'mantle', OKB: 'okb', CRO: 'crypto-com-chain', KCS: 'kucoin-shares', HNT: 'helium', SCRT: 'secret',
    STORJ: 'storj', NKN: 'nkn', GHST: 'aavegotchi', HOOK: 'hooked-protocol', WAN: 'wanchain',
    PHB: 'phoenix-global', ANC: 'anchor-protocol', MIR: 'mirror-protocol'
};
const COINGECKO_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price';
const COINGECKO_REFRESH_MS = 2 * 60 * 1000;

type QuoteSource = 'spot' | 'perp' | 'coingecko';
interface Quote {
    price: number | null;
    change: number | null; // 24h change, percent
    source: QuoteSource;
}
type QuoteLookup = (symbol: string) => Quote | null;
type CoinGeckoQuotes = Record<string, { price: number | null; change: number | null }>;

const SOURCE_NOTE: Record<Exclude<QuoteSource, 'spot'>, { tag: string; title: string }> = {
    perp: { tag: 'PERP', title: 'Spotta işlem görmüyor: fiyat ve değişim Binance vadeli (perp) kontratından' },
    coingecko: { tag: 'CG', title: "Binance'te işlem görmüyor: fiyat ve değişim CoinGecko'dan (2 dakikada bir)" }
};

const finiteOrNull = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

// Binance spot first; a coin that is not on spot falls back to its USDT-M perpetual (only contracts that
// are trading: settled ones keep a frozen mark price in the futures data), then to CoinGecko.
const buildQuoteLookup = (
    marketData: Record<string, Ticker>,
    futuresData: Record<string, FuturesTicker>,
    tradingPerps: Set<string> | null,
    coinGecko: CoinGeckoQuotes
): QuoteLookup => (symbol: string) => {
    const pair = getSymbolPair(symbol);
    const spot = marketData[pair];
    if (spot) return { price: finiteOrNull(spot.lastPrice), change: finiteOrNull(spot.priceChangePercent), source: 'spot' };
    const perp = tradingPerps?.has(pair) ? futuresData[pair] : undefined;
    if (perp) return { price: finiteOrNull(perp.markPrice), change: finiteOrNull(perp.priceChangePercent), source: 'perp' };
    const cg = coinGecko[symbol.toUpperCase()];
    if (cg) return { price: cg.price, change: cg.change, source: 'coingecko' };
    return null;
};

// Shared across mounts so switching tabs/pages does not refetch inside the refresh interval.
let coinGeckoCache: { quotes: CoinGeckoQuotes; fetchedAt: number } | null = null;

const useCoinGeckoQuotes = (): CoinGeckoQuotes => {
    const [quotes, setQuotes] = useState<CoinGeckoQuotes>(() => coinGeckoCache?.quotes ?? {});

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        let cancelled = false;
        const ids = [...new Set(Object.values(COINGECKO_IDS))].join(',');

        const load = async () => {
            if (coinGeckoCache && Date.now() - coinGeckoCache.fetchedAt < COINGECKO_REFRESH_MS - 1000) {
                setQuotes(coinGeckoCache.quotes);
                return;
            }
            if (document.visibilityState === 'hidden') return;
            try {
                const url = `${COINGECKO_PRICE_URL}?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
                const response = await fetch(url, { headers: { Accept: 'application/json' } });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const body = await response.json();
                const next: CoinGeckoQuotes = {};
                for (const [symbol, id] of Object.entries(COINGECKO_IDS)) {
                    const row = body?.[id];
                    if (!row) continue;
                    const price = finiteOrNull(row.usd);
                    next[symbol] = { price: price !== null && price > 0 ? price : null, change: finiteOrNull(row.usd_24h_change) };
                }
                coinGeckoCache = { quotes: next, fetchedAt: Date.now() };
                if (!cancelled) setQuotes(next);
            } catch (err) {
                // Keep the last known values; the next interval retries.
                console.warn("[Nexus] CoinGecko fiyatları alınamadı:", err);
            }
        };

        load();
        const timer = window.setInterval(load, COINGECKO_REFRESH_MS);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, []);

    return quotes;
};

// Heuristic "direction agreement" of two 24h moves (-1..1). NOT a statistical correlation:
// sign = same/opposite direction, magnitude = similarity of the move sizes.
const getDirectionAgreement = (a: number, b: number): number => {
    const sameDirection = (a >= 0) === (b >= 0);
    const magnitude = Math.max(0, 1 - Math.abs(a - b) / 10);
    return sameDirection ? magnitude : -magnitude;
};

type CorrelationSource = 'live' | 'estimated' | 'none';
type CorrelationQuality = 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';

interface FollowerInfo {
    symbol: string;
    change: number | null;
    isLagging: boolean;
    correlation: number | null;
    // 24h direction-agreement heuristic, always computed when both moves are known (used for group averages)
    agreement: number | null;
    source: CorrelationSource;
}

interface CorrelationGroup {
    driver: string;
    followers: FollowerInfo[];
    note: string;
    maxChange: number | null;
    driverChange: number | null;
    hasOpportunity: boolean;
    avgCorrelation: number | null;
    correlationSource: CorrelationSource;
    correlationQuality: CorrelationQuality;
}

// Thresholds depend on the metric: Pearson r on ~1s returns is structurally low (Epps effect), while the
// 24h direction-agreement heuristic is often above 0.9, so the two are never graded on the same scale.
const QUALITY_THRESHOLDS: Record<'live' | 'estimated', { strong: number; moderate: number }> = {
    live: { strong: 0.5, moderate: 0.25 },
    estimated: { strong: 0.7, moderate: 0.4 }
};

const getQuality = (value: number | null, source: CorrelationSource): CorrelationQuality => {
    if (value === null || source === 'none') return 'NONE';
    const { strong, moderate } = QUALITY_THRESHOLDS[source];
    if (value > strong) return 'STRONG';
    if (value > moderate) return 'MODERATE';
    return 'WEAK';
};

const SOURCE_RANK: Record<CorrelationSource, number> = { live: 2, estimated: 1, none: 0 };

const cn = (...classes: any[]) => classes.filter(Boolean).join(' ');

// --- TABLE COMPONENTS ---

// Shared by every Nexus table so the columns of the group, driver and coin rows line up.
const TABLE_CLASS = "w-full min-w-[560px] table-fixed border-separate border-spacing-0 text-xs";
// Horizontal padding is set per column (first: pl-3 pr-2, numbers: px-2, last: pl-4 pr-3)
const TH_CLASS = "sticky top-0 z-10 h-7 border-b border-border bg-surface text-[10px] font-medium uppercase tracking-wider text-muted";
const TD_CLASS = "h-7 border-b border-border";
const BADGE_CLASS = "shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase";

const TableColumns: React.FC = () => (
    <colgroup>
        <col style={{ width: '32%' }} />
        <col style={{ width: '20%' }} />
        <col style={{ width: '16%' }} />
        <col />
    </colgroup>
);

const ArchitectTableRow: React.FC<{
    symbol: string;
    price?: number | string;
    change?: number | string;
    role?: string;
    isDriver?: boolean;
    isLagging?: boolean;
    cluster?: string;
    source?: QuoteSource;
}> = ({ symbol, price, change, role, isDriver = false, isLagging = false, cluster, source }) => {
    const formerTicker = FORMER_TICKERS[symbol];
    const sourceNote = source && source !== 'spot' ? SOURCE_NOTE[source] : null;
    const changeValue = change === undefined || change === null || change === '' ? NaN : Number(change);
    const priceValue = price === undefined || price === null || price === '' ? NaN : Number(price);
    const isPositive = !Number.isFinite(changeValue) || changeValue >= 0;

    // Safety check for symbol
    if (!symbol) return null;

    return (
        <tr className="hover:bg-surface-secondary" title={cluster}>
            <td
                className={cn(TD_CLASS, "pr-2", isDriver ? "pl-3" : "pl-8")}
                // Lagging follower: warning marker on the left edge of the row
                style={isLagging ? { boxShadow: 'inset 2px 0 0 var(--color-warning)' } : undefined}
            >
                <div className="flex min-w-0 items-center gap-1.5">
                    <CoinIcon asset={symbol} size={16} />
                    <span className={cn("truncate text-text", isDriver ? "font-semibold" : "font-medium")}>{symbol}</span>
                    {formerTicker && (
                        <span className="shrink-0 text-[10px] text-muted" title={`Binance'te ${formerTicker} adıyla listeleniyordu`}>eski {formerTicker}</span>
                    )}
                    {sourceNote && (
                        <span className={cn(BADGE_CLASS, "bg-surface-secondary text-secondary")} title={sourceNote.title}>{sourceNote.tag}</span>
                    )}
                    {isDriver && <Zap size={12} className="shrink-0 text-primary" />}
                    {isLagging && <Activity size={12} className="shrink-0 text-warning" />}
                </div>
            </td>
            <td className={cn(TD_CLASS, "truncate px-2 text-right font-mono text-text")}>
                {Number.isFinite(priceValue) && priceValue > 0
                    ? `$${priceValue < 1 ? formatPrice(priceValue) : priceValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
                    : <span className="text-muted">---</span>}
            </td>
            <td
                className={cn(TD_CLASS, "truncate px-2 text-right font-mono", isPositive ? "text-success" : "text-danger")}
                title={sourceNote?.title}
            >
                {Number.isFinite(changeValue)
                    ? `${changeValue.toFixed(2)}%`
                    : <span className="font-sans text-[10px] uppercase tracking-wider text-muted">veri yok</span>}
            </td>
            <td className={cn(TD_CLASS, "pl-4 pr-3")}>
                <div className="flex min-w-0 items-center gap-2">
                    <span className={cn(
                        "truncate text-[10px] font-medium uppercase tracking-wider",
                        isDriver ? "text-primary" : isLagging ? "text-warning" : "text-muted"
                    )}>
                        {role || (isDriver ? "Primary Driver" : "Secondary Pair")}
                    </span>
                    {isLagging && (
                        <span className={cn(BADGE_CLASS, "bg-warning-soft text-warning")}>Opportunity</span>
                    )}
                </div>
            </td>
        </tr>
    );
};

const MAJOR_SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 
    'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'POLUSDT', 'LINKUSDT',
    'UNIUSDT', 'ATOMUSDT', 'LTCUSDT', 'BCHUSDT', 'ALGOUSDT',
    'VETUSDT', 'FILUSDT', 'TRXUSDT', 'ETCUSDT', 'XLMUSDT'
];

export const NexusDashboard: React.FC = () => {
    const { marketData, futuresData } = useMarketData();
    const coinGeckoQuotes = useCoinGeckoQuotes();
    const { symbols: tradingPerps } = useCryptoPerpSymbols();
    const quote = useMemo(
        () => buildQuoteLookup(marketData, futuresData, tradingPerps, coinGeckoQuotes),
        [marketData, futuresData, tradingPerps, coinGeckoQuotes]
    );
    const [activeTab, setActiveTab] = useState<'clusters' | 'correlations' | 'matrix'>('clusters');
    const [correlationMatrix, setCorrelationMatrix] = useState<CorrelationMatrixType | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
    const [sortConfig, setSortConfig] = useState<{ field: 'name' | 'velocity' | 'price' | 'change', direction: 'asc' | 'desc' }>({
        field: 'velocity',
        direction: 'desc'
    });

    const toggleCat = (name: string) => {
        const next = new Set(expandedCats);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        setExpandedCats(next);
    };

    const handleSort = (field: 'name' | 'velocity' | 'price' | 'change') => {
        setSortConfig(prev => ({
            field,
            direction: prev.field === field && prev.direction === 'desc' ? 'asc' : 'desc'
        }));
    };

    // Track ~1s price samples for the live matrix. Only the symbols the matrix uses are recorded, and all
    // of them share one timestamp per snapshot so their return series can be aligned.
    useEffect(() => {
        const sampleTime = Date.now();
        MAJOR_SYMBOLS.forEach(symbol => {
            const ticker = marketData[symbol];
            if (ticker) addPriceData(symbol, Number(ticker.lastPrice), sampleTime);
        });
    }, [marketData]);

    // Recalculate the matrix periodically (only once enough samples exist)
    useEffect(() => {
        const interval = setInterval(() => {
            const symbolsWithData = MAJOR_SYMBOLS.filter(symbol => getSampleCount(symbol) > MIN_SAMPLES);

            if (symbolsWithData.length >= 3) {
                try {
                    const matrix = calculateCorrelationMatrix(symbolsWithData);
                    setCorrelationMatrix(matrix.pairs.length > 0 ? matrix : null);
                } catch (err) {
                    console.error('[Correlation] Error calculating matrix:', err);
                }
            } else {
                setCorrelationMatrix(null);
            }
        }, 5000);

        return () => clearInterval(interval);
    }, []);

    const correlationWindowLabel = correlationMatrix ? formatCorrelationWindow(correlationMatrix.windowMs) : '';

    // Driver/follower groups. Followers without live data never get a correlation or a lag alert.
    // A real (short-window) correlation is used when the matrix has the pair; otherwise a clearly
    // labelled 24h "direction agreement" heuristic is shown instead.
    const correlations = useMemo<CorrelationGroup[]>(() => {
        return CORRELATIONS.map(corr => {
            const driverPair = getSymbolPair(corr.driver);
            const driverChange = quote(corr.driver)?.change ?? null;

            const followers: FollowerInfo[] = corr.followers.map(followerSymbol => {
                const pair = getSymbolPair(followerSymbol);
                const change = quote(followerSymbol)?.change ?? null;

                if (change === null || driverChange === null) {
                    return { symbol: followerSymbol, change, isLagging: false, correlation: null, agreement: null, source: 'none' as const };
                }

                const livePair = correlationMatrix?.pairs.find(p =>
                    (p.symbolA === driverPair && p.symbolB === pair) ||
                    (p.symbolA === pair && p.symbolB === driverPair)
                );
                const agreement = getDirectionAgreement(driverChange, change);
                const correlation = livePair ? livePair.correlation : agreement;

                // Lag detection
                const isLagging = Math.abs(correlation) > 0.5 &&
                    driverChange > 2.0 &&
                    change < 0.5 &&
                    (driverChange - change) > 1.5;

                return {
                    symbol: followerSymbol,
                    change,
                    isLagging,
                    correlation,
                    agreement,
                    source: livePair ? 'live' as const : 'estimated' as const
                };
            });

            const withData = followers.filter(f => f.correlation !== null);
            const knownChanges = [driverChange, ...followers.map(f => f.change)].filter((c): c is number => c !== null);
            // The group average uses ONE metric only: live Pearson r when every follower with data has it,
            // otherwise the 24h heuristic for all of them (live r and the heuristic are never mixed).
            const correlationSource: CorrelationSource = withData.length === 0
                ? 'none'
                : withData.every(f => f.source === 'live') ? 'live' : 'estimated';
            const groupValues = withData.map(f => (correlationSource === 'live' ? f.correlation : f.agreement) as number);
            const avgCorrelation = groupValues.length > 0
                ? groupValues.reduce((sum, v) => sum + v, 0) / groupValues.length
                : null;

            return {
                ...corr,
                followers,
                maxChange: knownChanges.length > 0 ? Math.max(...knownChanges) : null,
                driverChange,
                hasOpportunity: followers.some(f => f.isLagging),
                avgCorrelation,
                correlationSource,
                correlationQuality: getQuality(avgCorrelation, correlationSource)
            };
        });
    }, [quote, correlationMatrix]);

    const processedData = useMemo(() => {
        const lowSearch = searchTerm.toLowerCase();

        if (activeTab === 'clusters') {
            const clusters = CATEGORIES.map(cat => {
                const filteredCoins = cat.coins.filter(c => matchesCoin(c, lowSearch) || cat.name.toLowerCase().includes(lowSearch));
                const validChanges = cat.coins
                    .map(c => quote(c)?.change ?? null)
                    .filter((c): c is number => c !== null);
                const avgChange = validChanges.length > 0
                    ? validChanges.reduce((acc, c) => acc + c, 0) / validChanges.length
                    : 0;

                // Also sort coins within cluster if price/change sort is active
                const sortedCoins = [...filteredCoins].sort((a, b) => {
                    // Only sort coins if the sortConfig field is 'price' or 'change'
                    if (sortConfig.field !== 'price' && sortConfig.field !== 'change') {
                        return 0; // No coin-level sorting for 'name' or 'velocity'
                    }

                    const quoteA = quote(a);
                    const quoteB = quote(b);
                    const valA = sortConfig.field === 'price' ? quoteA?.price : quoteA?.change;
                    const valB = sortConfig.field === 'price' ? quoteB?.price : quoteB?.change;
                    // Coins without data always go last
                    if (valA == null || valB == null) return valA == null ? (valB == null ? 0 : 1) : -1;

                    return sortConfig.direction === 'desc' ? valB - valA : valA - valB;
                });

                return { ...cat, filteredCoins: sortedCoins, avgChange };
            }).filter(cat => cat.filteredCoins.length > 0);

            // Sort clusters
            return clusters.sort((a, b) => {
                if (sortConfig.field === 'name') {
                    return sortConfig.direction === 'desc'
                        ? b.name.localeCompare(a.name)
                        : a.name.localeCompare(b.name);
                }
                // Default or 'velocity' sort
                return sortConfig.direction === 'desc' ? b.avgChange - a.avgChange : a.avgChange - b.avgChange;
            });
        } else if (activeTab === 'correlations') {
            return correlations
                .filter(corr =>
                    matchesCoin(corr.driver, lowSearch) ||
                    corr.followers.some(f => matchesCoin(f.symbol, lowSearch)) ||
                    corr.note.toLowerCase().includes(lowSearch)
                )
                .sort((a, b) => {
                    // Prioritize those with active opportunities, then by correlation strength, then by max momentum
                    if (a.hasOpportunity !== b.hasOpportunity) return a.hasOpportunity ? -1 : 1;
                    // Values are only comparable within the same metric: live r groups first, then the
                    // heuristic ones, groups without data (null) last
                    if (a.correlationSource !== b.correlationSource) {
                        return SOURCE_RANK[b.correlationSource] - SOURCE_RANK[a.correlationSource];
                    }
                    const corrA = a.avgCorrelation ?? -Infinity;
                    const corrB = b.avgCorrelation ?? -Infinity;
                    if (corrB !== corrA) return corrB > corrA ? 1 : -1;
                    const maxA = a.maxChange ?? -Infinity;
                    const maxB = b.maxChange ?? -Infinity;
                    return maxB === maxA ? 0 : maxB > maxA ? 1 : -1;
                });
        } else {
            return []; // matrix tab handles its own data
        }
    }, [searchTerm, activeTab, sortConfig, correlations, quote]);

    return (
        // Fills the view at every width (flex-1 inside the shell's column, h-full inside a grid cell);
        // the tabs stay put and only the content below them scrolls.
        <section className="flex w-full flex-1 flex-col bg-surface lg:h-full lg:min-h-0" aria-label="Nexus">
            {/* Tabs + search (the search drops to its own row on narrow screens) */}
            <header className="flex shrink-0 flex-wrap items-stretch border-b border-border">
                <div
                    role="tablist"
                    className="flex h-8 w-full items-stretch gap-4 overflow-x-auto border-b border-border px-3 scrollbar-hide sm:w-auto sm:border-b-0"
                >
                    <TabButton
                        active={activeTab === 'clusters'}
                        onClick={() => setActiveTab('clusters')}
                        icon={<Layers size={12} />}
                        label="Alpha Clusters"
                    />
                    <TabButton
                        active={activeTab === 'correlations'}
                        onClick={() => setActiveTab('correlations')}
                        icon={<LinkIcon size={12} />}
                        label="Correlations"
                    />
                    <TabButton
                        active={activeTab === 'matrix'}
                        onClick={() => setActiveTab('matrix')}
                        icon={<BarChart3 size={12} />}
                        label="Live Matrix"
                    />
                </div>

                <div className="relative flex h-8 w-full items-center px-3 sm:ml-auto sm:w-64">
                    <Search className="pointer-events-none absolute left-[18px] top-1/2 -translate-y-1/2 text-muted" size={12} />
                    <input
                        type="text"
                        placeholder="Search Nexus..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="h-6 w-full rounded-sm border border-border bg-surface-secondary pl-6 pr-2 text-xs text-text outline-none placeholder:text-muted focus:border-primary"
                    />
                </div>
            </header>

            {/* Content: scrolls inside the panel on both axes, never the page */}
            <div className="relative min-h-[320px] flex-1">
            <div className="absolute inset-0 overflow-auto">
                {activeTab === 'matrix' ? (
                    <ErrorBoundary>
                        {correlationMatrix ? (
                            <CorrelationMatrix matrix={correlationMatrix} />
                        ) : (
                            <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-1.5 px-4 py-6 text-center">
                                <h3 className="flex items-center gap-1.5 text-xs text-secondary">
                                    <Activity size={14} className="shrink-0" />
                                    Korelasyon verisi toplanıyor
                                </h3>
                                <p className="max-w-md text-[11px] leading-snug text-muted">
                                    Kısa vadeli korelasyon için her sembolden en az {MIN_SAMPLES} fiyat örneği (yaklaşık saniyede bir)
                                    gerekiyor; bu 1-2 dakika sürer. Veri yalnızca bu sayfa açıkken toplanır.
                                </p>
                                <p className="font-mono text-[11px] text-secondary">
                                    Hazır sembol: {MAJOR_SYMBOLS.filter(symbol => getSampleCount(symbol) > MIN_SAMPLES).length}/{MAJOR_SYMBOLS.length}
                                </p>
                            </div>
                        )}
                    </ErrorBoundary>
                ) : activeTab === 'correlations' ? (
                    <ErrorBoundary>
                        <CorrelationTableContent
                            processedData={processedData as CorrelationGroup[]}
                            quote={quote}
                            windowLabel={correlationWindowLabel}
                        />
                    </ErrorBoundary>
                ) : (
                <table className={TABLE_CLASS}>
                    <TableColumns />
                    <thead>
                        <tr>
                            <th
                                className={cn(TH_CLASS, "pl-3 pr-2 text-left")}
                                aria-sort={sortConfig.field === 'name' ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                            >
                                <button type="button" onClick={() => handleSort('name')} className={SORT_BUTTON_CLASS}>
                                    Asset Cluster
                                    <SortIcon active={sortConfig.field === 'name'} direction={sortConfig.direction} />
                                </button>
                            </th>
                            <th
                                className={cn(TH_CLASS, "px-2 text-right")}
                                aria-sort={sortConfig.field === 'price' ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                            >
                                <button type="button" onClick={() => handleSort('price')} className={cn(SORT_BUTTON_CLASS, "justify-end")}>
                                    Live Price
                                    <SortIcon active={sortConfig.field === 'price'} direction={sortConfig.direction} />
                                </button>
                            </th>
                            <th
                                className={cn(TH_CLASS, "px-2 text-right")}
                                aria-sort={(sortConfig.field === 'change' || sortConfig.field === 'velocity') ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                            >
                                <button type="button" onClick={() => handleSort('change')} className={cn(SORT_BUTTON_CLASS, "justify-end")}>
                                    24h Velocity
                                    <SortIcon active={sortConfig.field === 'change' || sortConfig.field === 'velocity'} direction={sortConfig.direction} />
                                </button>
                            </th>
                            <th className={cn(TH_CLASS, "pl-4 pr-3 text-left")}>Market Role</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(processedData as any[]).map((cat) => {
                            const expanded = expandedCats.has(cat.name);
                            return (
                                <React.Fragment key={cat.name}>
                                    <tr
                                        onClick={() => toggleCat(cat.name)}
                                        className={cn(
                                            "cursor-pointer hover:bg-surface-secondary",
                                            expanded && "bg-surface-secondary"
                                        )}
                                    >
                                        <td colSpan={2} className={cn(TD_CLASS, "pl-3 pr-2")}>
                                            <button
                                                type="button"
                                                aria-expanded={expanded}
                                                className="flex max-w-full items-center gap-1.5 text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                                            >
                                                <ChevronRight
                                                    size={12}
                                                    className={cn("shrink-0 text-secondary transition-transform", expanded && "rotate-90")}
                                                />
                                                <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-text">{cat.name}</span>
                                            </button>
                                        </td>
                                        <td className={cn(TD_CLASS, "truncate px-2 text-right font-mono", cat.avgChange >= 0 ? "text-success" : "text-danger")}>
                                            <span className="mr-1 font-sans text-[10px] text-muted">AVG.</span>
                                            {cat.avgChange.toFixed(2)}%
                                        </td>
                                        <td className={TD_CLASS} />
                                    </tr>
                                    {expanded && cat.filteredCoins.map((coin: string) => {
                                        const data = quote(coin);
                                        return (
                                            <ArchitectTableRow
                                                key={coin}
                                                symbol={coin}
                                                price={data?.price ?? undefined}
                                                change={data?.change ?? undefined}
                                                source={data?.source}
                                                cluster={cat.name}
                                            />
                                        );
                                    })}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
                )}
            </div>
            </div>
        </section>
    );
};

// Separate component for Correlations table to better isolate errors
const CorrelationTableContent: React.FC<{
    processedData: CorrelationGroup[];
    quote: QuoteLookup;
    windowLabel: string;
}> = ({ processedData, quote, windowLabel }) => {
    const formatSigned = (value: number) => (value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2));

    const getBadgeTitle = (source: CorrelationSource) => {
        if (source === 'live') return `Son ${windowLabel || 'birkaç dakika'} içindeki ~1 sn aralıklı getirilerden hesaplanan Pearson korelasyonu (kısa vadeli)`;
        if (source === 'estimated') return "24 saatlik değişimlerin benzerliğinden türetilen sezgisel yön uyumu; istatistiksel korelasyon değildir";
        return "Takipçiler için canlı veri yok";
    };

    return (
        <table className={TABLE_CLASS}>
            <TableColumns />
            <thead>
                <tr>
                    <th className={cn(TH_CLASS, "pl-3 pr-2 text-left")}>Asset Cluster</th>
                    <th className={cn(TH_CLASS, "px-2 text-right")}>Live Price</th>
                    <th className={cn(TH_CLASS, "px-2 text-right")}>24h Velocity</th>
                    <th className={cn(TH_CLASS, "pl-4 pr-3 text-left")}>Market Role</th>
                </tr>
            </thead>
            <tbody>
                {processedData.map((corr) => (
                    <React.Fragment key={`${corr.driver}-${corr.note}`}>
                        {/* Group header: note + correlation quality */}
                        <tr className="bg-surface-secondary">
                            <td colSpan={4} className={cn(TD_CLASS, "px-3")}>
                                <div className="flex items-center justify-between gap-3">
                                    <span className={cn(
                                        "truncate text-[11px] font-semibold uppercase tracking-wider",
                                        corr.hasOpportunity ? "text-warning" : "text-secondary"
                                    )}>{corr.note}</span>
                                    <div className="flex shrink-0 items-center gap-2">
                                        {corr.hasOpportunity && (
                                            <span className={cn(BADGE_CLASS, "bg-warning-soft text-warning")}>LAGGING ALERT</span>
                                        )}
                                        <span
                                            className={cn(
                                                BADGE_CLASS,
                                                "font-mono",
                                                corr.correlationQuality === 'STRONG'
                                                    ? "bg-success-soft text-success"
                                                    : corr.correlationQuality === 'MODERATE'
                                                    ? "bg-info-soft text-info"
                                                    : "bg-surface-highlight text-secondary"
                                            )}
                                            title={getBadgeTitle(corr.correlationSource)}
                                        >
                                            {corr.avgCorrelation === null
                                                ? 'veri yok'
                                                : corr.correlationSource === 'live'
                                                    ? `r=${corr.avgCorrelation.toFixed(2)}`
                                                    : `uyum ~${corr.avgCorrelation.toFixed(2)}`}
                                        </span>
                                        <span className="w-24 text-right font-mono text-[10px] uppercase text-muted">
                                            Peak: {corr.maxChange === null ? '—' : `${corr.maxChange.toFixed(2)}%`}
                                        </span>
                                    </div>
                                </div>
                            </td>
                        </tr>
                        {/* Driver Row */}
                        {(() => {
                            const data = quote(corr.driver);
                            return (
                                <ArchitectTableRow
                                    symbol={corr.driver}
                                    price={data?.price ?? undefined}
                                    change={data?.change ?? undefined}
                                    source={data?.source}
                                    isDriver={true}
                                    role="Catalyst Driver"
                                />
                            );
                        })()}
                        {/* Follower Rows */}
                        {corr.followers.filter(f => f && f.symbol).map((f, idx) => {
                            const data = quote(f.symbol);
                            let roleText: string;
                            if (f.correlation === null) {
                                roleText = f.change === null ? "Takipçi · veri yok" : "Takipçi · sürücü verisi yok";
                            } else {
                                roleText = f.isLagging ? "Geride Kalan Takipçi" : "Takipçi";
                                roleText += f.source === 'live'
                                    ? ` (r ${formatSigned(f.correlation)})`
                                    : ` (uyum ~${formatSigned(f.correlation)})`;
                            }
                            return (
                                <ArchitectTableRow
                                    key={f.symbol || idx}
                                    symbol={f.symbol}
                                    price={data?.price ?? undefined}
                                    change={data?.change ?? undefined}
                                    source={data?.source}
                                    isLagging={f.isLagging}
                                    role={roleText}
                                />
                            );
                        })}
                    </React.Fragment>
                ))}
            </tbody>
        </table>
    );
};

const SORT_BUTTON_CLASS = "group flex w-full items-center gap-0.5 uppercase tracking-wider hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary";

const SortIcon: React.FC<{ active: boolean, direction: 'asc' | 'desc' }> = ({ active, direction }) => {
    if (!active) return <ChevronsUpDown size={10} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />;
    return direction === 'asc'
        ? <ChevronUp size={10} className="shrink-0 text-primary" />
        : <ChevronDown size={10} className="shrink-0 text-primary" />;
};

const TabButton: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }> = ({ active, onClick, icon, label }) => (
    <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={onClick}
        className={cn(
            "flex h-full shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 text-[11px] font-semibold uppercase tracking-wider transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary",
            active
                ? "border-primary text-text"
                : "border-transparent text-secondary hover:text-text"
        )}
    >
        {icon}
        {label}
    </button>
);
