import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Ticker } from '../types';

export interface Trade {
    id: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    price: number;
    amount: number;
    date: number;
    notes?: string;
    status: 'OPEN' | 'CLOSED';
    pnl?: number;
}

export interface Holding {
    symbol: string;
    amount: number;
    avgPrice: number;
}

interface PortfolioContextType {
    trades: Trade[];
    holdings: Holding[];
    addTrade: (trade: Omit<Trade, 'id' | 'status'>) => void;
    closeTrade: (id: string, exitPrice: number) => void;
    deleteTrade: (id: string) => void;
    getPortfolioValue: (marketData: Record<string, Ticker>) => number;
    getTotalPnL: () => number;
}

const PortfolioContext = createContext<PortfolioContextType | undefined>(undefined);

export const PortfolioProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [trades, setTrades] = useState<Trade[]>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('fidelio_trades');
            return saved ? JSON.parse(saved) : [];
        }
        return [];
    });

    const [holdings, setHoldings] = useState<Holding[]>([]);

    useEffect(() => {
        localStorage.setItem('fidelio_trades', JSON.stringify(trades));
        calculateHoldings();
    }, [trades]);

    const calculateHoldings = () => {
        const tempHoldings: Record<string, { amount: number, cost: number }> = {};

        trades.forEach(trade => {
            if (!tempHoldings[trade.symbol]) {
                tempHoldings[trade.symbol] = { amount: 0, cost: 0 };
            }

            if (trade.side === 'BUY') {
                tempHoldings[trade.symbol].amount += trade.amount;
                tempHoldings[trade.symbol].cost += trade.amount * trade.price;
            } else {
                tempHoldings[trade.symbol].amount -= trade.amount;
                // Cost reduction logic can be complex (FIFO/LIFO), simplified here:
                // We reduce cost proportionally to the amount sold
                const currentAvg = tempHoldings[trade.symbol].cost / (tempHoldings[trade.symbol].amount + trade.amount);
                tempHoldings[trade.symbol].cost -= trade.amount * currentAvg;
            }
        });

        const holdingList = Object.entries(tempHoldings)
            .filter(([_, data]) => data.amount > 0.000001) // Filter dust
            .map(([symbol, data]) => ({
                symbol,
                amount: data.amount,
                avgPrice: data.cost / data.amount
            }));

        setHoldings(holdingList);
    };

    const addTrade = (tradeData: Omit<Trade, 'id' | 'status'>) => {
        const newTrade: Trade = {
            ...tradeData,
            id: Math.random().toString(36).substring(7),
            status: 'OPEN'
        };
        setTrades(prev => [newTrade, ...prev]);
    };

    const closeTrade = (id: string, exitPrice: number) => {
        setTrades(prev => prev.map(t => {
            if (t.id !== id) return t;
            const pnl = (exitPrice - t.price) * t.amount * (t.side === 'BUY' ? 1 : -1);
            return { ...t, status: 'CLOSED', pnl };
        }));
    };

    const deleteTrade = (id: string) => {
        setTrades(prev => prev.filter(t => t.id !== id));
    };

    const clearPortfolio = () => {
        setTrades([]);
        localStorage.removeItem('fidelio_trades');
    };

    const getPortfolioValue = (marketData: Record<string, Ticker>) => {
        return holdings.reduce((total, holding) => {
            const price = marketData[holding.symbol]?.lastPrice || holding.avgPrice;
            return total + (holding.amount * price);
        }, 0);
    };

    const getTotalPnL = () => {
        // Realized PnL from closed trades
        return trades.reduce((total, trade) => total + (trade.pnl || 0), 0);
    };

    return (
        <PortfolioContext.Provider value={{
            trades,
            holdings,
            addTrade,
            closeTrade,
            deleteTrade,
            getPortfolioValue,
            getTotalPnL
        }}>
            {children}
        </PortfolioContext.Provider>
    );
};

export const usePortfolio = () => {
    const context = useContext(PortfolioContext);
    if (!context) {
        throw new Error('usePortfolio must be used within a PortfolioProvider');
    }
    return context;
};
