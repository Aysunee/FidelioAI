import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
import { Ticker } from '../types';
import { useUser } from './UserContext';
import { readScoped, writeScoped, scopedKey } from '../utils/userStorage';

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

export interface AddTradeResult {
    ok: boolean;
    error?: string;
}

interface PortfolioContextType {
    trades: Trade[];
    holdings: Holding[];
    /** Sum over SELLs of amount * (sellPrice - average cost before the sell). */
    realizedPnL: number;
    addTrade: (trade: Omit<Trade, 'id' | 'status'>) => AddTradeResult;
    deleteTrade: (id: string) => void;
    clearPortfolio: () => void;
    getPortfolioValue: (marketData: Record<string, Ticker>) => number;
    /** realized + unrealized (unrealized only for holdings that have a live price in marketData). */
    getTotalPnL: (marketData?: Record<string, Ticker>) => number;
    /** Turkish warning when the portfolio cannot be saved (storage full / unreadable record kept untouched). */
    storageWarning: string | null;
}

// Per-user storage key (scoped as `fidelio_trades:<userId>` via utils/userStorage).
const PORTFOLIO_KEY = 'fidelio_trades';
const EPSILON = 1e-9;
const DUST = 0.000001;

// 'btc', 'BTC/USDT', 'btc-usdt' -> 'BTCUSDT' (market data only contains USDT pairs).
export const normalizePortfolioSymbol = (input: string): string => {
    const cleaned = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!cleaned) return '';
    return cleaned.endsWith('USDT') ? cleaned : `${cleaned}USDT`;
};

const generateId = () => {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    } catch { /* ignore */ }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const sanitizeTrades = (raw: unknown): Trade[] => {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((t: any) => t && typeof t === 'object')
        .map((t: any): Trade => ({
            id: typeof t.id === 'string' && t.id ? t.id : generateId(),
            symbol: normalizePortfolioSymbol(t.symbol),
            side: t.side === 'SELL' ? 'SELL' : 'BUY',
            price: Number(t.price),
            amount: Number(t.amount),
            date: Number.isFinite(Number(t.date)) ? Number(t.date) : 0,
            notes: typeof t.notes === 'string' ? t.notes : undefined,
            status: t.status === 'CLOSED' ? 'CLOSED' : 'OPEN'
        }))
        .filter(t => t.symbol !== '');
};

const QUOTA_WARNING = 'Portföy kaydedilemedi: tarayıcı depolama alanı dolu. Son değişiklikleriniz sayfa yenilenince kaybolabilir.';
const UNREADABLE_NOT_BACKED_UP_WARNING = 'Kayıtlı portföy verisi okunamadı ve depolama alanı dolu olduğu için yedeklenemedi. Mevcut kaydın üzerine yazılmaması için bu oturumdaki değişiklikler kaydedilmeyecek.';

type PortfolioStore = {
    owner: string | null;
    trades: Trade[];
    // false: the stored record could neither be read nor backed up, so it must never be overwritten.
    persist: boolean;
    // true: data was read from the legacy unscoped key (copying it failed, e.g. storage full);
    // that key is removed only after the first successful write under the user's key.
    fromLegacyKey: boolean;
};

const emptyPortfolio = (owner: string | null, overrides: Partial<PortfolioStore> = {}): PortfolioStore =>
    ({ owner, trades: [], persist: true, fromLegacyKey: false, ...overrides });

const storageGet = (key: string): string | null => {
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
};

const storageSet = (key: string, value: string): boolean => {
    if (typeof window === 'undefined') return false;
    try {
        window.localStorage.setItem(key, value);
        return true;
    } catch {
        return false;
    }
};

const storageRemove = (key: string) => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.removeItem(key);
    } catch { /* ignore */ }
};

// Unreadable record: keep a copy; if even that fails, stop persisting so the original is never overwritten.
const unreadablePortfolio = (owner: string, stored: string): PortfolioStore =>
    storageSet(`${scopedKey(PORTFOLIO_KEY, owner)}:corrupt-backup`, stored)
        ? emptyPortfolio(owner)
        : emptyPortfolio(owner, { persist: false });

const loadPortfolio = (userId: string | null): PortfolioStore => {
    if (!userId) return emptyPortfolio(null);
    const missing = Symbol('missing');
    let raw: unknown = readScoped<unknown>(PORTFOLIO_KEY, userId, missing);
    let fromLegacyKey = false;
    if (raw === missing) {
        // Distinguish "no data yet" from "unreadable data": never silently overwrite a corrupt record.
        const stored = storageGet(scopedKey(PORTFOLIO_KEY, userId));
        if (stored !== null) {
            return stored === 'null' ? emptyPortfolio(userId) : unreadablePortfolio(userId, stored);
        }
        // readScoped could not copy the legacy unscoped key (e.g. QuotaExceededError): read it in place.
        const legacy = storageGet(PORTFOLIO_KEY);
        if (legacy === null || legacy === 'null') return emptyPortfolio(userId);
        try {
            raw = JSON.parse(legacy);
        } catch {
            return unreadablePortfolio(userId, legacy);
        }
        fromLegacyKey = true;
    }
    if (!Array.isArray(raw)) {
        return raw === null ? emptyPortfolio(userId) : unreadablePortfolio(userId, JSON.stringify(raw));
    }
    return emptyPortfolio(userId, { trades: sanitizeTrades(raw), fromLegacyKey });
};

// Average-cost accounting, processed in chronological order (trades are stored newest-first).
export const calculatePortfolio = (trades: Trade[]) => {
    const ordered = trades
        .map((trade, index) => ({ trade, index }))
        // Same timestamp: the later-added trade sits earlier in the array, so reverse index wins the tie.
        .sort((a, b) => (a.trade.date - b.trade.date) || (b.index - a.index))
        .map(x => x.trade);

    const positions: Record<string, { amount: number; cost: number }> = {};
    let realizedPnL = 0;

    for (const trade of ordered) {
        if (!(trade.amount > 0) || !(trade.price > 0)) continue;
        const position = positions[trade.symbol] || (positions[trade.symbol] = { amount: 0, cost: 0 });

        if (trade.side === 'BUY') {
            position.amount += trade.amount;
            position.cost += trade.amount * trade.price;
            continue;
        }

        // SELL: average cost is taken BEFORE reducing the quantity; never sell more than held.
        const quantity = Math.min(trade.amount, position.amount);
        if (quantity <= EPSILON) continue;
        const avgCost = position.amount > EPSILON ? position.cost / position.amount : 0;
        realizedPnL += quantity * (trade.price - avgCost);
        position.amount -= quantity;
        position.cost -= quantity * avgCost;
        if (position.amount <= EPSILON) {
            position.amount = 0;
            position.cost = 0;
        }
    }

    const holdings: Holding[] = Object.entries(positions)
        .filter(([, data]) => data.amount > DUST)
        .map(([symbol, data]) => ({
            symbol,
            amount: data.amount,
            avgPrice: data.amount > EPSILON ? data.cost / data.amount : 0
        }));

    return { holdings, realizedPnL };
};

const formatQty = (value: number) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 8 }).format(value);

const PortfolioContext = createContext<PortfolioContextType | undefined>(undefined);

export const PortfolioProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { user } = useUser();
    const userId = user?.id ? String(user.id) : null;

    const [store, setStore] = useState<PortfolioStore>(() => loadPortfolio(userId));
    // Account switch (or logout): load the right user's data before rendering the previous one's.
    if (store.owner !== userId) {
        setStore(loadPortfolio(userId));
    }
    const trades = store.owner === userId ? store.trades : [];

    const [writeFailed, setWriteFailed] = useState(false);

    useEffect(() => {
        if (!store.owner || !store.persist) return;
        const ok = writeScoped(PORTFOLIO_KEY, store.owner, store.trades);
        // The user's copy is now stored: the legacy unscoped key is no longer needed.
        if (ok && store.fromLegacyKey) storageRemove(PORTFOLIO_KEY);
        if (!ok) console.warn('[Portfolio] Portföy kaydedilemedi: tarayıcı depolama alanı dolu veya kullanılamıyor.');
        setWriteFailed(!ok);
    }, [store]);

    const storageWarning = !store.owner || store.owner !== userId
        ? null
        : !store.persist ? UNREADABLE_NOT_BACKED_UP_WARNING : writeFailed ? QUOTA_WARNING : null;

    const { holdings, realizedPnL } = useMemo(() => calculatePortfolio(trades), [trades]);

    const setTrades = useCallback((updater: (prev: Trade[]) => Trade[]) => {
        setStore(prev => ({ ...prev, trades: updater(prev.trades) }));
    }, []);

    const addTrade = (tradeData: Omit<Trade, 'id' | 'status'>): AddTradeResult => {
        if (!userId) return { ok: false, error: 'İşlem eklemek için giriş yapmalısınız.' };
        const symbol = normalizePortfolioSymbol(tradeData.symbol);
        if (!symbol) return { ok: false, error: 'Sembol boş olamaz.' };
        if (!Number.isFinite(tradeData.price) || tradeData.price <= 0) {
            return { ok: false, error: 'Fiyat sıfırdan büyük olmalıdır.' };
        }
        if (!Number.isFinite(tradeData.amount) || tradeData.amount <= 0) {
            return { ok: false, error: 'Miktar sıfırdan büyük olmalıdır.' };
        }
        if (tradeData.side === 'SELL') {
            const held = holdings.find(h => h.symbol === symbol)?.amount ?? 0;
            const base = symbol.replace(/USDT$/, '');
            if (held <= DUST) {
                return { ok: false, error: `Portföyde satılabilecek ${base} bulunmuyor.` };
            }
            if (tradeData.amount > held + EPSILON) {
                return { ok: false, error: `Elinizdeki miktardan (${formatQty(held)} ${base}) fazla satış yapılamaz.` };
            }
        }

        const newTrade: Trade = {
            ...tradeData,
            symbol,
            date: Number.isFinite(tradeData.date) ? tradeData.date : Date.now(),
            id: generateId(),
            status: 'OPEN'
        };
        setTrades(prev => [newTrade, ...prev]);
        return { ok: true };
    };

    const deleteTrade = (id: string) => {
        setTrades(prev => prev.filter(t => t.id !== id));
    };

    const clearPortfolio = () => {
        setTrades(() => []);
    };

    const getPortfolioValue = (marketData: Record<string, Ticker>) => {
        return holdings.reduce((total, holding) => {
            const live = marketData[holding.symbol]?.lastPrice;
            const price = Number.isFinite(live) && (live as number) > 0 ? (live as number) : holding.avgPrice;
            return total + (holding.amount * price);
        }, 0);
    };

    const getTotalPnL = (marketData?: Record<string, Ticker>) => {
        if (!marketData) return realizedPnL;
        const unrealized = holdings.reduce((total, holding) => {
            const live = marketData[holding.symbol]?.lastPrice;
            if (!Number.isFinite(live) || !((live as number) > 0)) return total;
            return total + holding.amount * ((live as number) - holding.avgPrice);
        }, 0);
        return realizedPnL + unrealized;
    };

    return (
        <PortfolioContext.Provider value={{
            trades,
            holdings,
            realizedPnL,
            addTrade,
            deleteTrade,
            clearPortfolio,
            getPortfolioValue,
            getTotalPnL,
            storageWarning
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
