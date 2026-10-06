
import React, { useState, useEffect, useRef } from 'react';
import { Ticker, MarketIndex } from '../types';
import { Pencil, X, Plus, GripVertical, TrendingUp, TrendingDown } from 'lucide-react';
import { Modal } from './ui/Modal';

interface GlobalTickerProps {
    spotData: Record<string, Ticker>;
    indicesData: MarketIndex[];
}

const DEFAULT_PINS = ['BTCUSDT', 'ETHUSDT', 'BTC.D', 'TOTAL', 'TOTAL3'];
const PINNED_KEY = 'fidelio_pinned_ticker';

// Market-wide indices that come from CoinGecko (see services/marketData.ts).
const INDEX_SYMBOLS = new Set(['BTC.D', 'TOTAL', 'TOTAL3', 'USDT.D']);
// No free real-time source exists for these; they used to be simulated, so they are no longer shown.
const UNSUPPORTED_PINS = new Set(['NASDAQ', 'S&P 500', 'SPX', 'S&P']);

const isSupportedPin = (symbol: string) => !UNSUPPORTED_PINS.has(symbol.toUpperCase().trim());

const loadPinned = (): string[] => {
    if (typeof window === 'undefined') return DEFAULT_PINS;
    try {
        const saved = localStorage.getItem(PINNED_KEY);
        if (!saved) return DEFAULT_PINS;
        const parsed: unknown = JSON.parse(saved);
        if (!Array.isArray(parsed)) return DEFAULT_PINS;
        return Array.from(new Set(
            parsed.filter((s): s is string => typeof s === 'string' && s.trim() !== '' && isSupportedPin(s))
        ));
    } catch {
        return DEFAULT_PINS;
    }
};

export const GlobalTicker: React.FC<GlobalTickerProps> = ({ spotData, indicesData }) => {
    const [pinned, setPinned] = useState<string[]>(loadPinned);

    const [isEditing, setIsEditing] = useState(false);
    const [newSymbol, setNewSymbol] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem(PINNED_KEY, JSON.stringify(pinned));
        } catch { /* storage unavailable or full: pins are a convenience only */ }
    }, [pinned]);

    const handleRemove = (symbol: string) => {
        setPinned(prev => prev.filter(s => s !== symbol));
    };

    const handleAdd = () => {
        if (!newSymbol) return;
        const formatted = newSymbol.toUpperCase().trim();
        if (!formatted || pinned.includes(formatted) || !isSupportedPin(formatted)) return;
        setPinned(prev => [...prev, formatted]);
        setNewSymbol('');
    };

    // price / change are null when the value is not available (yet); the UI then shows '—'.
    const resolveData = (symbol: string): { price: number | null; change: number | null; isIndex: boolean } | null => {
        if (INDEX_SYMBOLS.has(symbol)) {
            const index = indicesData?.find(i => i.symbol === symbol);
            const price = index && Number.isFinite(index.price) ? index.price : null;
            const change = index && Number.isFinite(index.changePercent) ? index.changePercent : null;
            return { price, change, isIndex: true };
        }

        let searchKey = symbol;
        if (!symbol.endsWith('USDT') && !symbol.includes('.')) searchKey += 'USDT';

        const ticker = spotData?.[searchKey];
        if (ticker) {
            return {
                price: Number.isFinite(ticker.lastPrice) ? ticker.lastPrice : null,
                change: Number.isFinite(ticker.priceChangePercent) ? ticker.priceChangePercent : null,
                isIndex: false
            };
        }
        return null;
    };

    const formatPrice = (symbol: string, price: number) => {
        if (symbol.includes('TOTAL')) {
            if (price >= 1_000_000_000_000) return `$${(price / 1_000_000_000_000).toFixed(3)}T`;
            if (price >= 1_000_000_000) return `$${(price / 1_000_000_000).toFixed(2)}B`;
        }
        if (price < 1) return price.toFixed(5);
        if (price > 1000) return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
        return price.toLocaleString(undefined, { maximumFractionDigits: 3 });
    };

    return (
        <>
            {/* Ticker bar: one flat h-8 row of mono items separated by 1px lines (lg+ only) */}
            <div className="hidden h-8 w-full min-w-0 items-stretch lg:flex">

                {/* Scrollable Content */}
                <div
                    ref={scrollRef}
                    className="flex min-w-0 flex-1 items-stretch divide-x divide-border overflow-x-auto overflow-y-hidden scrollbar-hide"
                >
                    {pinned.map(sym => {
                        const data = resolveData(sym);
                        const priceDisplay = data && data.price !== null ? formatPrice(sym, data.price) : '—';
                        const change = data?.change ?? null;
                        const isPos = change !== null && change >= 0;
                        const isDom = sym.includes('.D');

                        return (
                            <div
                                key={sym}
                                className="flex shrink-0 select-none items-center gap-2 whitespace-nowrap px-3 font-mono text-[11px]"
                                title={data?.isIndex ? 'Kaynak: CoinGecko (yaklaşık 60 sn\'de bir güncellenir)' : undefined}
                            >
                                <span className="font-sans text-[10px] font-semibold uppercase tracking-wider text-muted">{sym}</span>
                                <span className="text-text">
                                    {priceDisplay}{isDom && data?.price !== null && data?.price !== undefined ? '%' : ''}
                                </span>
                                {change === null ? (
                                    <span className="text-muted">—</span>
                                ) : (
                                    <span className={`flex items-center ${isPos ? 'text-success' : 'text-danger'}`}>
                                        {isPos ? <TrendingUp size={10} className="mr-0.5" /> : <TrendingDown size={10} className="mr-0.5" />}
                                        {Math.abs(change).toFixed(2)}%
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Edit Trigger */}
                <div className="flex shrink-0 items-center border-l border-border px-1">
                    <button
                        type="button"
                        onClick={() => setIsEditing(true)}
                        className="grid h-7 w-7 place-items-center rounded-sm text-secondary transition-colors hover:bg-surface-secondary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                        title="Edit Ticker"
                        aria-label="Edit Ticker"
                    >
                        <Pencil size={12} />
                    </button>
                </div>
            </div>

            {/* Modal */}
            <Modal isOpen={isEditing} onClose={() => setIsEditing(false)} title="Global Markets Config" flush>
                <p className="border-b border-border px-3 py-2 text-[11px] text-muted">Drag to reorder or remove pinned assets.</p>
                <div className="max-h-[300px] overflow-y-auto">
                    {pinned.map((sym) => (
                        <div key={sym} className="flex h-8 items-center justify-between gap-2 border-b border-border pl-3 pr-1 hover:bg-surface-secondary">
                            <div className="flex min-w-0 items-center gap-2">
                                <GripVertical size={12} className="shrink-0 cursor-move text-muted" />
                                <span className="truncate font-mono text-xs font-medium text-text">{sym}</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => handleRemove(sym)}
                                aria-label={`Remove ${sym}`}
                                className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-secondary transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    ))}
                </div>

                <div className="flex gap-2 border-b border-border p-3">
                    <input
                        type="text"
                        value={newSymbol}
                        onChange={(e) => setNewSymbol(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                        placeholder="Add Symbol (e.g. SOL, BNB, TOTAL)"
                        className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-surface-secondary px-2 font-mono text-xs uppercase text-text outline-none placeholder:normal-case placeholder:text-muted focus:border-primary"
                    />
                    <button
                        type="button"
                        onClick={handleAdd}
                        disabled={!newSymbol}
                        aria-label="Add"
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-sm bg-primary text-primary-contrast transition-colors hover:opacity-90 disabled:opacity-50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                    >
                        <Plus size={14} />
                    </button>
                </div>

                <div className="flex justify-end p-3">
                    <button
                        type="button"
                        onClick={() => setIsEditing(false)}
                        className="h-7 rounded-sm bg-primary px-2.5 text-xs font-medium text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                    >
                        Save Changes
                    </button>
                </div>
            </Modal>
        </>
    );
};
