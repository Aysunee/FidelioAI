import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ticker, PriceAlert } from '../types';
import { Plus, Trash2, Bell, Search, LineChart, ExternalLink, LayoutGrid, List, ChevronUp, ChevronDown } from 'lucide-react';
import { formatPrice, formatTime } from '../utils/formatters';

// Price alerts as stored by SignalContext: triggered alerts stay in the list with isActive: false.
type WatchlistAlert = PriceAlert & { triggeredAt?: number; triggeredPrice?: number };

interface WatchlistProps {
    symbols: string[];
    data: Record<string, Ticker>;
    activeAlerts?: WatchlistAlert[];
    onRemove?: (symbol: string) => void;
    onAdd?: (symbol: string) => void;
    onSetAlert?: (symbol: string) => void;
    onRemoveAlert?: (id: string) => void;
}

type Tab = 'favorites' | 'all' | 'movers' | 'alerts';
type ViewMode = 'list' | 'heatmap';
type SortField = 'symbol' | 'lastPrice' | 'priceChangePercent' | 'volume';

// Long lists (All Pairs / Top Movers have hundreds of rows) are rendered in pages.
const PAGE_SIZE = 100;

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary';
const PANEL_TITLE = 'text-[11px] font-semibold uppercase tracking-wider text-secondary';
const TAB = `flex h-full shrink-0 items-center whitespace-nowrap border-b-2 text-[11px] font-semibold uppercase tracking-wider transition-colors ${FOCUS_RING}`;
const TAB_ACTIVE = 'border-primary text-text';
const TAB_IDLE = 'border-transparent text-secondary hover:text-text';
const VIEW_TOGGLE = `grid h-6 w-6 place-items-center rounded-sm transition-colors ${FOCUS_RING}`;
const ROW_ACTION = `grid h-5 w-5 place-items-center rounded-sm text-secondary transition-colors hover:bg-surface-highlight ${FOCUS_RING}`;
// Shared by the header and the rows so every column lines up: pair | row actions | price | 24h %.
// The actions column is empty (0 wide) until a row is hovered / focused; on touch screens it is always shown.
const TABLE_COLS = 'grid grid-cols-[minmax(0,1.3fr)_auto_minmax(0,1fr)_60px] items-center gap-x-2 px-3';

interface WatchlistRowProps {
    ticker: Ticker;
    hasActiveAlert: boolean;
    isFavoritesTab: boolean;
    onAdd: (symbol: string) => void;
    onRemove: (symbol: string) => void;
    onSetAlert: (symbol: string) => void;
}

const WatchlistRow = React.memo<WatchlistRowProps>(({ ticker, hasActiveAlert, isFavoritesTab, onAdd, onRemove, onSetAlert }) => {
    const isPositive = ticker.priceChangePercent >= 0;
    const symbolBase = ticker.symbol.replace('USDT', '');
    const iconUrl = `https://assets.coincap.io/assets/icons/${symbolBase.toLowerCase()}@2x.png`;
    const tvLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${ticker.symbol}`;
    const binanceLink = `https://www.binance.com/en/trade/${symbolBase}_USDT`;

    return (
        // tabIndex lets keyboard / touch users reveal the actions via focus.
        <div
            tabIndex={0}
            className={`group ${TABLE_COLS} h-7 cursor-pointer border-b border-border text-xs outline-none hover:bg-surface-secondary focus-within:bg-surface-secondary focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-primary`}
        >
            {/* Pair */}
            <div className="col-start-1 flex min-w-0 items-center gap-1.5">
                <div className="h-4 w-4 shrink-0 overflow-hidden rounded-full bg-surface-highlight">
                    <img src={iconUrl} loading="lazy" className="h-full w-full object-cover" onError={(e) => e.currentTarget.style.display = 'none'} alt={symbolBase} />
                </div>
                <span className="truncate font-medium text-text">{symbolBase}</span>
                <span className="shrink-0 text-[10px] text-muted">USDT</span>
                {hasActiveAlert && <Bell size={10} className="shrink-0 fill-current text-warning" />}
            </div>

            {/* Row Actions: shown on hover/focus; always visible on touch devices (no hover) */}
            <div className="col-start-2 hidden items-center group-hover:flex group-focus-within:flex [@media(hover:none)]:flex">
                <a
                    href={tvLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`View ${symbolBase} on TradingView`}
                    className={`${ROW_ACTION} hover:text-text`}
                >
                    <LineChart size={12} />
                </a>
                <a
                    href={binanceLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Trade ${symbolBase} on Binance`}
                    className={`${ROW_ACTION} hover:text-warning`}
                >
                    <ExternalLink size={12} />
                </a>
                <button
                    onClick={() => onSetAlert(ticker.symbol)}
                    aria-label={`Set price alert for ${symbolBase}`}
                    className={`${ROW_ACTION} hover:text-primary`}
                >
                    <Bell size={12} />
                </button>
                {isFavoritesTab ? (
                    <button
                        onClick={() => onRemove(ticker.symbol)}
                        aria-label={`Remove ${symbolBase} from favorites`}
                        className={`${ROW_ACTION} hover:text-danger`}
                    >
                        <Trash2 size={12} />
                    </button>
                ) : (
                    <button
                        onClick={() => onAdd(ticker.symbol)}
                        aria-label={`Add ${symbolBase} to favorites`}
                        className={`${ROW_ACTION} hover:text-success`}
                    >
                        <Plus size={12} />
                    </button>
                )}
            </div>

            {/* Price (explicit columns: the hidden actions cell must not shift price / 24h % one column left) */}
            <div className="col-start-3 truncate text-right font-mono text-text">
                ${ticker.lastPrice < 1 ? formatPrice(ticker.lastPrice) : ticker.lastPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </div>

            {/* 24h % */}
            <div className={`col-start-4 truncate text-right font-mono ${isPositive ? 'text-success' : 'text-danger'}`}>
                {isPositive ? '+' : ''}{ticker.priceChangePercent?.toFixed(2)}%
            </div>
        </div>
    );
});
WatchlistRow.displayName = 'WatchlistRow';

// Active and triggered price alerts, with a delete button for each.
const PriceAlertList: React.FC<{ alerts: WatchlistAlert[]; onRemove?: (id: string) => void }> = ({ alerts, onRemove }) => {
    if (alerts.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center gap-1 px-3 py-8 text-center text-xs text-muted">
                <Bell size={14} />
                <p>Henüz fiyat alarmı yok.</p>
                <p className="text-[11px]">Bir paritenin satırındaki zil simgesiyle alarm kurabilirsiniz.</p>
            </div>
        );
    }

    return (
        <ul>
            {alerts.map(alert => {
                const symbolBase = alert.symbol.replace('USDT', '');
                const conditionText = alert.condition === 'ABOVE' ? 'Üstüne çıkınca' : 'Altına inince';
                return (
                    <li
                        key={alert.id}
                        className="flex items-center justify-between gap-2 border-b border-border py-1 pl-3 pr-1.5 text-xs hover:bg-surface-secondary"
                    >
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                                <span className="font-medium text-text">{symbolBase}</span>
                                <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase ${alert.isActive
                                    ? 'bg-warning-soft text-warning'
                                    : 'bg-surface-secondary text-secondary'
                                    }`}>
                                    {alert.isActive ? 'Aktif' : 'Tetiklendi'}
                                </span>
                                <span className="truncate font-mono text-[11px] text-secondary">
                                    {conditionText} ${formatPrice(alert.targetPrice)}
                                </span>
                            </div>
                            {!alert.isActive && alert.triggeredAt !== undefined && (
                                <div className="font-mono text-[10px] text-muted">
                                    {new Date(alert.triggeredAt).toLocaleDateString('tr-TR')} {formatTime(alert.triggeredAt, false)}
                                    {alert.triggeredPrice !== undefined && <> · ${formatPrice(alert.triggeredPrice)}</>}
                                </div>
                            )}
                        </div>
                        {onRemove && (
                            <button
                                type="button"
                                onClick={() => onRemove(alert.id)}
                                aria-label={`${symbolBase} alarmını sil`}
                                title="Alarmı sil"
                                className={`grid h-6 w-6 shrink-0 place-items-center rounded-sm text-secondary transition-colors hover:bg-danger-soft hover:text-danger ${FOCUS_RING}`}
                            >
                                <Trash2 size={12} />
                            </button>
                        )}
                    </li>
                );
            })}
        </ul>
    );
};

export const Watchlist: React.FC<WatchlistProps> = ({ symbols, data, activeAlerts = [], onRemove, onAdd, onSetAlert, onRemoveAlert }) => {
    const [activeTab, setActiveTab] = useState<Tab>('favorites');
    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<{ field: SortField; dir: 'asc' | 'desc' }>({ field: 'priceChangePercent', dir: 'desc' });
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

    // Stable callbacks so memoized rows do not re-render just because the parent passed new functions
    const handlersRef = useRef({ onAdd, onRemove, onSetAlert });
    handlersRef.current = { onAdd, onRemove, onSetAlert };
    const handleAdd = useCallback((symbol: string) => handlersRef.current.onAdd?.(symbol), []);
    const handleRemove = useCallback((symbol: string) => handlersRef.current.onRemove?.(symbol), []);
    const handleSetAlert = useCallback((symbol: string) => handlersRef.current.onSetAlert?.(symbol), []);

    // Start from the first page whenever the list definition changes
    useEffect(() => {
        setVisibleCount(PAGE_SIZE);
    }, [activeTab, search, sort, viewMode]);

    // Handlers
    const handleSort = (field: SortField) => {
        setSort(prev => ({
            field,
            dir: prev.field === field && prev.dir === 'desc' ? 'asc' : 'desc'
        }));
    };

    // Data Processing
    const displayData = useMemo(() => {
        let list: Ticker[] = [];

        if (activeTab === 'alerts') return list;

        if (activeTab === 'favorites') {
            list = symbols.map(s => data[s] || { symbol: s, lastPrice: 0, priceChangePercent: 0, volume: 0, updatedAt: 0 } as Ticker);
        } else {
            list = (Object.values(data) as Ticker[]).filter(t => t.symbol.endsWith('USDT'));
        }

        if (search) {
            list = list.filter(t => t.symbol.includes(search.toUpperCase()));
        }

        return list.sort((a, b) => {
            let valA = a[sort.field];
            let valB = b[sort.field];

            if (activeTab === 'movers' && sort.field === 'priceChangePercent') {
                valA = Math.abs(a.priceChangePercent);
                valB = Math.abs(b.priceChangePercent);
            }

            if (valA > valB) return sort.dir === 'asc' ? 1 : -1;
            if (valA < valB) return sort.dir === 'asc' ? -1 : 1;
            return 0;
        });

    }, [symbols, data, activeTab, search, sort]);

    const hasAlert = (symbol: string) => activeAlerts.some(a => a.symbol === symbol && a.isActive);

    // Alerts tab: active first, newest first; the search box filters by symbol
    const alertList = useMemo(() => {
        const query = search.trim().toUpperCase();
        return activeAlerts
            .filter(a => !query || a.symbol.includes(query))
            .sort((a, b) => (Number(b.isActive) - Number(a.isActive)) || (b.createdAt - a.createdAt));
    }, [activeAlerts, search]);

    const visibleData = displayData.slice(0, visibleCount);
    const remaining = displayData.length - visibleData.length;
    const showMoreButton = remaining > 0 && (
        <button
            onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
            className={`h-7 w-full text-[11px] font-medium text-primary transition-colors hover:bg-surface-secondary ${FOCUS_RING}`}
        >
            Daha fazla göster ({remaining} kaldı)
        </button>
    );

    const sortIcon = (field: SortField) => {
        if (sort.field !== field) return null;
        return sort.dir === 'asc' ? <ChevronUp size={10} className="shrink-0" /> : <ChevronDown size={10} className="shrink-0" />;
    };

    return (
        <section className="flex h-full min-h-0 min-w-0 flex-col bg-surface [container-type:inline-size] lg:max-h-[100dvh]">
            {/* Header */}
            <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
                <div className="flex min-w-0 items-baseline gap-2">
                    <h2 className={`truncate ${PANEL_TITLE}`}>Market Overview</h2>
                    <span className="hidden shrink-0 font-mono text-[10px] text-muted [@container(min-width:400px)]:inline">
                        {activeTab === 'alerts' ? `${alertList.length} alarm` : `${displayData.length} pairs`}
                    </span>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                    {/* Search */}
                    <div className="relative w-28">
                        <Search className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-muted" size={12} />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search pairs..."
                            aria-label="Search market pairs"
                            className="h-6 w-full rounded-sm border border-border bg-surface-secondary pl-6 pr-2 text-xs text-text outline-none placeholder:text-muted focus:border-primary"
                        />
                    </div>

                    {/* View Toggle */}
                    <div className="inline-flex rounded-sm border border-border p-0.5">
                        <button
                            onClick={() => setViewMode('list')}
                            aria-label="List view"
                            className={`${VIEW_TOGGLE} ${viewMode === 'list' ? 'bg-surface-highlight text-text' : 'text-secondary hover:text-text'}`}
                        >
                            <List size={12} />
                        </button>
                        <button
                            onClick={() => setViewMode('heatmap')}
                            aria-label="Heatmap view"
                            className={`${VIEW_TOGGLE} ${viewMode === 'heatmap' ? 'bg-surface-highlight text-text' : 'text-secondary hover:text-text'}`}
                        >
                            <LayoutGrid size={12} />
                        </button>
                    </div>
                </div>
            </header>

            {/* Tabs */}
            <div className="flex h-8 shrink-0 items-stretch gap-3 overflow-x-auto border-b border-border px-3 scrollbar-hide">
                {[
                    { key: 'favorites' as Tab, label: 'Favorites' },
                    { key: 'all' as Tab, label: 'All Pairs' },
                    { key: 'movers' as Tab, label: 'Top Movers' },
                    { key: 'alerts' as Tab, label: 'Alarmlar' }
                ].map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => {
                            setActiveTab(tab.key);
                            setSort({ field: tab.key === 'movers' ? 'priceChangePercent' : 'symbol', dir: 'desc' });
                        }}
                        className={`${TAB} ${activeTab === tab.key ? TAB_ACTIVE : TAB_IDLE}`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Content (scrolls inside the panel) */}
            <div className="max-h-[420px] min-h-0 flex-1 overflow-auto lg:max-h-none">
                {activeTab === 'alerts' ? (
                    <PriceAlertList alerts={alertList} onRemove={onRemoveAlert} />
                ) : viewMode === 'list' ? (
                    <div>
                        {/* Table Header */}
                        <div className={`sticky top-0 z-10 ${TABLE_COLS} h-7 border-b border-border bg-surface text-[10px] font-medium uppercase tracking-wider text-muted`}>
                            <div className="flex cursor-pointer items-center gap-0.5 transition-colors hover:text-text" onClick={() => handleSort('symbol')}>
                                Pair{sortIcon('symbol')}
                            </div>
                            <div aria-hidden="true" />
                            <div className="flex cursor-pointer items-center justify-end gap-0.5 transition-colors hover:text-text" onClick={() => handleSort('lastPrice')}>
                                Price{sortIcon('lastPrice')}
                            </div>
                            <div className="flex cursor-pointer items-center justify-end gap-0.5 transition-colors hover:text-text" onClick={() => handleSort('priceChangePercent')}>
                                24h %{sortIcon('priceChangePercent')}
                            </div>
                        </div>

                        {/* Table Body */}
                        <div>
                            {visibleData.map((ticker) => (
                                <WatchlistRow
                                    key={ticker.symbol}
                                    ticker={ticker}
                                    hasActiveAlert={hasAlert(ticker.symbol)}
                                    isFavoritesTab={activeTab === 'favorites'}
                                    onAdd={handleAdd}
                                    onRemove={handleRemove}
                                    onSetAlert={handleSetAlert}
                                />
                            ))}
                            {showMoreButton}
                        </div>
                    </div>
                ) : (
                    <div className="overflow-hidden">
                        <div className="-mr-px grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))]">
                            {visibleData.map((ticker) => {
                                const pct = ticker.priceChangePercent;
                                const isPositive = pct >= 0;
                                const intensity = Math.min(Math.abs(pct) * 10, 100) / 100;

                                // Data-encoding colour: stronger move -> stronger tint of the success / danger token
                                const bgColor = `color-mix(in srgb, var(${isPositive ? '--color-success' : '--color-danger'}) ${Math.round(10 + intensity * 40)}%, transparent)`;

                                return (
                                    <div
                                        key={ticker.symbol}
                                        className="flex h-12 min-w-0 cursor-pointer flex-col items-center justify-center border-b border-r border-border px-1 text-center hover:outline hover:outline-1 hover:-outline-offset-1 hover:outline-primary"
                                        style={{ backgroundColor: bgColor }}
                                        onClick={() => window.open(`https://www.tradingview.com/chart/?symbol=BINANCE:${ticker.symbol}`, '_blank')}
                                    >
                                        <div className="max-w-full truncate text-xs font-medium text-text">
                                            {ticker.symbol.replace('USDT', '')}
                                        </div>
                                        <div className="font-mono text-[11px] text-text">
                                            {isPositive ? '+' : ''}{pct.toFixed(2)}%
                                        </div>
                                    </div>
                                );
                            })}
                            {showMoreButton && <div className="col-span-full">{showMoreButton}</div>}
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
};
