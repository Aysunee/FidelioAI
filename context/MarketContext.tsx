import React, { createContext, useContext, useState, useEffect, useRef, useMemo, ReactNode } from 'react';
import { Ticker, FuturesTicker, MarketIndex, Liquidation } from '../types';
import { connectToBinance, connectToBinanceFutures, startGlobalMarketPoller, connectToLiquidations, fetchSpotTickerSnapshot, StreamStatus } from '../services/marketData';

type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';
type FundingHistory = Record<string, { time: number, rate: number }[]>;

interface MarketContextType {
    marketData: Record<string, Ticker>;
    futuresData: Record<string, FuturesTicker>;
    indicesData: MarketIndex[];
    liquidations: Liquidation[];
    // Spot stream status. 'connected' only while data is actually flowing (a silent stream counts as disconnected).
    connectionStatus: ConnectionStatus;
    futuresConnectionStatus: ConnectionStatus;
    // True when the spot stream is open but has not delivered data for more than STALE_AFTER_MS.
    isStale: boolean;
    fundingHistory: FundingHistory;
}

const MarketContext = createContext<MarketContextType | undefined>(undefined);

const STALE_AFTER_MS = 10 * 1000;

// --- Funding history persistence ---
// In memory: up to 2h (120 one-minute points) for every perp.
// In localStorage: only the last hour (the trend analysis window) for the most liquid perps,
// in a compact format. The full history used to be ~4M characters and could exceed the quota.
const FUNDING_HISTORY_KEY = 'fidelio_funding_history';
const FUNDING_MEMORY_POINTS = 120;
const FUNDING_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const FUNDING_PERSIST_POINTS = 60;
const FUNDING_PERSIST_SYMBOLS = 150;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const loadFundingHistory = (): FundingHistory => {
    if (typeof window === 'undefined') return {};
    try {
        const raw = localStorage.getItem(FUNDING_HISTORY_KEY);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        const cutoff = Date.now() - FUNDING_MAX_AGE_MS;
        const result: FundingHistory = {};

        // Compact format: { v: 2, d: { SYMBOL: [[time, rate], ...] } }
        if (isRecord(parsed) && parsed.v === 2 && isRecord(parsed.d)) {
            Object.entries(parsed.d).forEach(([symbol, points]) => {
                if (!Array.isArray(points)) return;
                const list = points
                    .filter((p): p is [number, number] => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] >= cutoff)
                    .map(([time, rate]) => ({ time, rate }));
                if (list.length > 0) result[symbol] = list.slice(-FUNDING_MEMORY_POINTS);
            });
            return result;
        }

        // Legacy format: { SYMBOL: [{ time, rate }, ...] }
        if (isRecord(parsed)) {
            Object.entries(parsed).forEach(([symbol, points]) => {
                if (!Array.isArray(points)) return;
                const list = points
                    .filter((p): p is { time: number, rate: number } => isRecord(p) && Number.isFinite(p.time) && Number.isFinite(p.rate) && (p.time as number) >= cutoff)
                    .map(p => ({ time: p.time, rate: p.rate }));
                if (list.length > 0) result[symbol] = list.slice(-FUNDING_MEMORY_POINTS);
            });
        }
        return result;
    } catch {
        try { localStorage.removeItem(FUNDING_HISTORY_KEY); } catch { /* ignore */ }
        return {};
    }
};

const persistFundingHistory = (history: FundingHistory, futures: Record<string, FuturesTicker>) => {
    if (typeof window === 'undefined') return;

    const symbols = Object.keys(history)
        .filter(symbol => history[symbol] && history[symbol].length > 0)
        .sort((a, b) => (futures[b]?.volume ?? 0) - (futures[a]?.volume ?? 0));

    const build = (limit: number) => {
        const d: Record<string, [number, number][]> = {};
        symbols.slice(0, limit).forEach(symbol => {
            d[symbol] = history[symbol].slice(-FUNDING_PERSIST_POINTS).map(p => [p.time, p.rate] as [number, number]);
        });
        return JSON.stringify({ v: 2, d });
    };

    try {
        localStorage.setItem(FUNDING_HISTORY_KEY, build(FUNDING_PERSIST_SYMBOLS));
    } catch {
        // Quota exceeded or storage disabled: retry once with fewer symbols, otherwise give up silently.
        try {
            localStorage.setItem(FUNDING_HISTORY_KEY, build(Math.floor(FUNDING_PERSIST_SYMBOLS / 3)));
        } catch {
            try { localStorage.removeItem(FUNDING_HISTORY_KEY); } catch { /* ignore */ }
        }
    }
};

const toConnectionStatus = (status: StreamStatus, stale: boolean): ConnectionStatus =>
    status === 'connected' ? (stale ? 'disconnected' : 'connected') : status;

// `enabled` lets the app keep all market streams/pollers off while nobody is logged in.
export const MarketProvider: React.FC<{ children: ReactNode; enabled?: boolean }> = ({ children, enabled = true }) => {
    const [marketData, setMarketData] = useState<Record<string, Ticker>>({});
    const [futuresData, setFuturesData] = useState<Record<string, FuturesTicker>>({});
    const futuresDataRef = useRef(futuresData);
    useEffect(() => {
        futuresDataRef.current = futuresData;
    }, [futuresData]);
    const [indicesData, setIndicesData] = useState<MarketIndex[]>([]);
    const [liquidations, setLiquidations] = useState<Liquidation[]>([]);
    const [spotStatus, setSpotStatus] = useState<StreamStatus>(enabled ? 'connecting' : 'disconnected');
    const [futuresStatus, setFuturesStatus] = useState<StreamStatus>(enabled ? 'connecting' : 'disconnected');
    const [isStale, setIsStale] = useState(false);
    const [isFuturesStale, setIsFuturesStale] = useState(false);
    const [fundingHistory, setFundingHistory] = useState<FundingHistory>(loadFundingHistory);

    // Last time each stream delivered data (or (re)connected), used by the stale indicator.
    const lastSpotDataRef = useRef<number>(Date.now());
    const lastFuturesDataRef = useRef<number>(Date.now());
    const spotStatusRef = useRef<StreamStatus>(spotStatus);
    const futuresStatusRef = useRef<StreamStatus>(futuresStatus);

    // WebSocket Connections
    useEffect(() => {
        if (!enabled) {
            setSpotStatus('disconnected');
            return;
        }
        const disconnect = connectToBinance(
            (newTickers) => {
                lastSpotDataRef.current = Date.now();
                setMarketData(prev => ({ ...prev, ...newTickers }));
            },
            (status) => {
                spotStatusRef.current = status;
                if (status === 'connected') lastSpotDataRef.current = Date.now();
                setSpotStatus(status);
            }
        );
        // Thinly traded coins have no stream data until their next trade: fill them from one REST
        // snapshot. Stream values already received are newer and win.
        const snapshotAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
        fetchSpotTickerSnapshot(snapshotAbort?.signal)
            .then(snapshot => setMarketData(prev => ({ ...snapshot, ...prev })))
            .catch(err => {
                if ((err as { name?: string })?.name !== 'AbortError') console.warn('[Market] Spot 24s özeti alınamadı:', err);
            });
        return () => {
            snapshotAbort?.abort();
            disconnect();
            spotStatusRef.current = 'disconnected';
            setSpotStatus('disconnected');
        };
    }, [enabled]);

    useEffect(() => {
        if (!enabled) {
            setFuturesStatus('disconnected');
            return;
        }
        const disconnect = connectToBinanceFutures(
            (updates) => {
                lastFuturesDataRef.current = Date.now();
                setFuturesData(prev => {
                    const next = { ...prev };
                    Object.values(updates).forEach((update: Partial<FuturesTicker>) => {
                        const symbol = update.symbol!;
                        const current = prev[symbol];
                        next[symbol] = {
                            ...current,
                            ...update,
                            symbol,
                            markPrice: update.markPrice ?? current?.markPrice ?? 0,
                            fundingRate: update.fundingRate ?? current?.fundingRate ?? 0,
                            nextFundingTime: update.nextFundingTime ?? current?.nextFundingTime ?? 0,
                            indexPrice: update.indexPrice ?? current?.indexPrice ?? 0,
                            sessionStartRate: current?.sessionStartRate ?? update.fundingRate,
                            sessionChange: current?.sessionChange ?? 0
                        } as FuturesTicker;
                    });
                    return next;
                });
            },
            (status) => {
                futuresStatusRef.current = status;
                if (status === 'connected') lastFuturesDataRef.current = Date.now();
                setFuturesStatus(status);
            }
        );
        return () => {
            disconnect();
            futuresStatusRef.current = 'disconnected';
            setFuturesStatus('disconnected');
        };
    }, [enabled]);

    // Stale-data indicator: an open socket that stopped delivering data is not "connected".
    useEffect(() => {
        if (!enabled) {
            setIsStale(false);
            setIsFuturesStale(false);
            return;
        }
        const timer = setInterval(() => {
            const now = Date.now();
            const spotStale = spotStatusRef.current === 'connected' && now - lastSpotDataRef.current > STALE_AFTER_MS;
            const futuresStale = futuresStatusRef.current === 'connected' && now - lastFuturesDataRef.current > STALE_AFTER_MS;
            setIsStale(prev => (prev === spotStale ? prev : spotStale));
            setIsFuturesStale(prev => (prev === futuresStale ? prev : futuresStale));
        }, 2000);
        return () => clearInterval(timer);
    }, [enabled]);

    // --- Funding History Snapshot Logic ---
    // One snapshot per minute. The updater is pure; persistence happens in a separate effect.
    useEffect(() => {
        if (!enabled) return;
        const interval = setInterval(() => {
            const now = Date.now();
            // Do not record frozen values while the futures stream is down or silent.
            if (futuresStatusRef.current !== 'connected' || now - lastFuturesDataRef.current > STALE_AFTER_MS) return;
            const tickers = Object.values(futuresDataRef.current) as FuturesTicker[];
            if (tickers.length === 0) return;
            const cutoff = now - FUNDING_MAX_AGE_MS;

            setFundingHistory(prev => {
                const next: FundingHistory = {};
                tickers.forEach(ticker => {
                    if (!ticker || !ticker.symbol || !Number.isFinite(ticker.fundingRate)) return;
                    const history = (prev[ticker.symbol] || []).filter(p => p.time >= cutoff);
                    next[ticker.symbol] = [...history, { time: now, rate: ticker.fundingRate }].slice(-FUNDING_MEMORY_POINTS);
                });
                return next;
            });
        }, 60 * 1000); // 60 Seconds

        return () => clearInterval(interval);
    }, [enabled]);

    const skipFirstPersistRef = useRef(true);
    useEffect(() => {
        if (skipFirstPersistRef.current) {
            skipFirstPersistRef.current = false;
            return;
        }
        persistFundingHistory(fundingHistory, futuresDataRef.current);
    }, [fundingHistory]);

    useEffect(() => {
        if (!enabled) return;
        const disconnect = connectToLiquidations((liq) => {
            setLiquidations(prev => [liq, ...prev].slice(0, 50));
        });
        return () => disconnect();
    }, [enabled]);

    useEffect(() => {
        if (!enabled) return;
        const stopPoller = startGlobalMarketPoller(setIndicesData);
        return () => stopPoller();
    }, [enabled]);

    const connectionStatus = toConnectionStatus(spotStatus, isStale);
    const futuresConnectionStatus = toConnectionStatus(futuresStatus, isFuturesStale);

    const value = useMemo<MarketContextType>(() => ({
        marketData,
        futuresData,
        indicesData,
        liquidations,
        connectionStatus,
        futuresConnectionStatus,
        isStale,
        fundingHistory // Exposed for consumers
    }), [marketData, futuresData, indicesData, liquidations, connectionStatus, futuresConnectionStatus, isStale, fundingHistory]);

    return (
        <MarketContext.Provider value={value}>
            {children}
        </MarketContext.Provider>
    );
};

export const useMarketData = () => {
    const context = useContext(MarketContext);
    if (!context) {
        throw new Error('useMarketData must be used within a MarketProvider');
    }
    return context;
};
