import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { Ticker, FuturesTicker, MarketIndex, Liquidation } from '../types';
import { connectToBinance, connectToBinanceFutures, startGlobalIndicesMock, connectToLiquidations } from '../services/marketData';

interface MarketContextType {
    marketData: Record<string, Ticker>;
    futuresData: Record<string, FuturesTicker>;
    indicesData: MarketIndex[];
    liquidations: Liquidation[];
    connectionStatus: 'connected' | 'disconnected' | 'connecting';
    fundingHistory: Record<string, { time: number, rate: number }[]>;
}

const MarketContext = createContext<MarketContextType | undefined>(undefined);

export const MarketProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [marketData, setMarketData] = useState<Record<string, Ticker>>({});
    const [futuresData, setFuturesData] = useState<Record<string, FuturesTicker>>({});
    const [indicesData, setIndicesData] = useState<MarketIndex[]>([]);
    const [liquidations, setLiquidations] = useState<Liquidation[]>([]);
    const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connecting');
    const [fundingHistory, setFundingHistory] = useState<Record<string, { time: number, rate: number }[]>>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('fidelio_funding_history');
            return saved ? JSON.parse(saved) : {};
        }
        return {};
    });

    // WebSocket Connections
    useEffect(() => {
        const disconnect = connectToBinance((newTickers) => {
            setConnectionStatus('connected');
            setMarketData(prev => ({ ...prev, ...newTickers }));
        });
        return () => { disconnect(); setConnectionStatus('disconnected'); };
    }, []);

    useEffect(() => {
        // Note: We are not passing the signal callback here yet. 
        // Signals will be handled by SignalContext observing MarketContext or a separate logic.
        // For now, we just update data.
        const disconnect = connectToBinanceFutures((updates) => {
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
        });
        return () => disconnect();
    }, []);

    // --- Funding History Snapshot Logic ---
    // Snapshots every 60 seconds or on distinct changes would be ideal.
    // For simplicity and trend analysis, we'll do strict 1-minute intervals.
    useEffect(() => {
        const interval = setInterval(() => {
            setFundingHistory(prev => {
                const next = { ...prev };
                const now = Date.now();

                (Object.values(futuresData) as FuturesTicker[]).forEach(ticker => {
                    if (!ticker) return;
                    const history = next[ticker.symbol] || [];

                    const newPoint = { time: now, rate: ticker.fundingRate };

                    // Optimization: If last point is identical, maybe skip?
                    // No, consistent time series is easier for charts.

                    // Sliding Window: Keep last 120 points (2 hours)
                    const updatedHistory = [...history, newPoint].slice(-120);
                    next[ticker.symbol] = updatedHistory;
                });

                // Persist
                if (typeof window !== 'undefined') {
                    // Start async save to avoid blocking UI
                    // Debounce technically better, but 1 min interval is slow enough
                    localStorage.setItem('fidelio_funding_history', JSON.stringify(next));
                }

                return next;
            });
        }, 60 * 1000); // 60 Seconds

        return () => clearInterval(interval);
    }, [futuresData]); // dependency on futuresData ensures we have latest values

    useEffect(() => {
        const disconnect = connectToLiquidations((liq) => {
            setLiquidations(prev => [liq, ...prev].slice(0, 50));
        });
        return () => disconnect();
    }, []);

    useEffect(() => {
        const stopMock = startGlobalIndicesMock(setIndicesData);
        return () => stopMock();
    }, []);

    return (
        <MarketContext.Provider value={{
            marketData,
            futuresData,
            indicesData,
            liquidations,
            connectionStatus,
            fundingHistory // Exposed for consumers
        }}>
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
