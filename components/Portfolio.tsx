import React, { useMemo, useState } from 'react';
import { Ticker } from '../types';
import { PieChart, Pie, Cell, Tooltip } from 'recharts';
import { Wallet, History, Plus, X, Trash2 } from 'lucide-react';
import { usePortfolio, normalizePortfolioSymbol } from '../context/PortfolioContext';

interface PortfolioProps {
    data: Record<string, Ticker>;
}

// Allocation series colours (data encoding): theme tokens first, one extra hue for the fifth slice.
const COLORS = ['var(--color-brand)', 'var(--color-success)', 'var(--color-warning)', 'var(--color-info)', '#EC4899'];

// Shared by header and rows so every column lines up; below the min width the table scrolls inside its panel.
const HOLDING_COLS = 'minmax(88px,1.2fr) minmax(60px,1fr) minmax(72px,1fr) minmax(84px,1fr) minmax(92px,1fr)';
const HOLDING_MIN_WIDTH = 460;
const TRADE_COLS = 'minmax(128px,1.3fr) minmax(76px,1fr) 44px minmax(76px,1fr) minmax(60px,0.9fr) 24px';
const TRADE_MIN_WIDTH = 480;

const INPUT_CLASS = 'h-7 rounded-sm border border-border bg-surface-secondary px-2 text-xs text-text placeholder:text-muted outline-none focus:border-primary';
const ICON_BUTTON_CLASS = 'grid h-6 w-6 place-items-center rounded-sm transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary';
const PANEL_HEADER_CLASS = 'h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-3';
const PANEL_TITLE_CLASS = 'flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-secondary';
const TABLE_HEAD_CLASS = 'sticky top-0 z-10 grid h-7 items-center gap-x-2 border-b border-border bg-surface px-3 text-[10px] font-medium uppercase tracking-wider text-muted';
const TABLE_ROW_CLASS = 'grid h-7 items-center gap-x-2 border-b border-border px-3 text-xs hover:bg-surface-secondary';
const KPI_LABEL_CLASS = 'text-[10px] uppercase tracking-wider text-muted';

const signClass = (value: number) => (value > 0 ? 'text-success' : value < 0 ? 'text-danger' : 'text-text');

// Consistent tr-TR number formatting (decimal comma, thousands dot); missing values show as '—'.
const fmtUsd = (value: number, signed = false) => {
    if (!Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('tr-TR', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        signDisplay: signed ? 'exceptZero' : 'auto'
    } as Intl.NumberFormatOptions).format(value);
};

const fmtPrice = (value: number) => {
    if (!Number.isFinite(value)) return '—';
    if (Math.abs(value) >= 1) return fmtUsd(value);
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'USD', maximumSignificantDigits: 6 }).format(value);
};

const fmtPct = (value: number) => {
    if (!Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('tr-TR', {
        style: 'percent',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        signDisplay: 'exceptZero'
    } as Intl.NumberFormatOptions).format(value / 100);
};

const fmtQty = (value: number) => {
    if (!Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 8 }).format(value);
};

const parseInput = (value: string) => Number(String(value).trim().replace(',', '.'));

export const Portfolio: React.FC<PortfolioProps> = ({ data }) => {
    const { trades, holdings, realizedPnL, addTrade, deleteTrade, clearPortfolio, storageWarning } = usePortfolio();
    const [activeTab, setActiveTab] = useState<'assets' | 'history'>('assets');
    const [isAdding, setIsAdding] = useState(false);
    const [newSymbol, setNewSymbol] = useState('');
    const [newSide, setNewSide] = useState<'BUY' | 'SELL'>('BUY');
    const [newPrice, setNewPrice] = useState('');
    const [newQty, setNewQty] = useState('');
    const [formError, setFormError] = useState<string | null>(null);
    const [formNotice, setFormNotice] = useState<string | null>(null);

    const handleAddTrade = () => {
        if (!newSymbol.trim() || !newPrice.trim() || !newQty.trim()) {
            setFormError('Sembol, fiyat ve miktar alanları zorunludur.');
            return;
        }
        const symbol = normalizePortfolioSymbol(newSymbol);
        // Only the format is enforced: the live feed fills in gradually, so a missing price is not an error.
        if (!/^[A-Z0-9]{1,20}USDT$/.test(symbol)) {
            setFormError('Geçersiz sembol. Örnek: BTC veya BTCUSDT.');
            return;
        }
        // SELLs and symbols already held are checked against the holding by addTrade, not against market data.
        const isHeld = holdings.some(h => h.symbol === symbol);
        const missingLivePrice = newSide === 'BUY' && !isHeld && !data[symbol];
        const result = addTrade({
            symbol,
            side: newSide,
            price: parseInput(newPrice),
            amount: parseInput(newQty),
            date: Date.now()
        });
        if (!result.ok) {
            setFormError(result.error || 'İşlem eklenemedi.');
            return;
        }
        setFormError(null);
        setFormNotice(missingLivePrice
            ? `${symbol} için canlı fiyat henüz yok; işlem kaydedildi ve fiyat gelene kadar maliyet değeriyle izlenecek. Sembolü doğru girdiğinizden emin olun.`
            : null);
        setIsAdding(false);
        setNewSymbol('');
        setNewPrice('');
        setNewQty('');
    };

    const metrics = useMemo(() => {
        let totalValue = 0;
        let pricedCost = 0;
        let unrealizedPnL = 0;
        let missingPriceCount = 0;

        const items = holdings.map(h => {
            const live = data[h.symbol]?.lastPrice;
            const hasPrice = typeof live === 'number' && Number.isFinite(live) && live > 0;
            const cost = h.amount * h.avgPrice;
            // No live price: value is shown at cost and excluded from unrealized P&L (no silent "0%").
            const value = hasPrice ? h.amount * (live as number) : cost;
            const pnl = hasPrice ? value - cost : null;
            totalValue += value;
            if (hasPrice) {
                pricedCost += cost;
                unrealizedPnL += value - cost;
            } else {
                missingPriceCount += 1;
            }
            return {
                ...h,
                hasPrice,
                currentPrice: hasPrice ? (live as number) : null,
                value,
                pnl,
                pnlPercent: pnl === null || cost === 0 ? null : (pnl / cost) * 100
            };
        });

        return {
            totalValue,
            totalPnL: realizedPnL + unrealizedPnL,
            unrealizedPnL,
            realizedPnL,
            unrealizedPercent: pricedCost === 0 ? 0 : (unrealizedPnL / pricedCost) * 100,
            missingPriceCount,
            items: items.sort((a, b) => b.value - a.value)
        };
    }, [holdings, data, realizedPnL]);

    const chartData = metrics.items.map(i => ({
        name: i.symbol.replace('USDT', ''),
        value: i.value
    }));

    const isProfitable = metrics.totalPnL >= 0;

    return (
        <div className="flex h-full min-h-0 w-full flex-1 flex-col bg-surface">
            {/* KPI strip */}
            <div className="grid shrink-0 grid-cols-2 gap-px border-b border-border bg-border lg:grid-cols-4">
                <div className="min-w-0 bg-surface px-3 py-2">
                    <div className={KPI_LABEL_CLASS}>Total Balance</div>
                    <div className="flex items-baseline gap-1.5">
                        <span className="truncate font-mono text-base font-semibold text-text">{fmtUsd(metrics.totalValue)}</span>
                        <span className="text-[10px] text-muted">USDT</span>
                    </div>
                </div>
                <div className="min-w-0 bg-surface px-3 py-2">
                    <div lang="tr" className={KPI_LABEL_CLASS}>toplam K/Z</div>
                    <div className={`truncate font-mono text-base font-semibold ${isProfitable ? 'text-success' : 'text-danger'}`}>
                        {fmtUsd(metrics.totalPnL, true)}
                    </div>
                </div>
                <div className="min-w-0 bg-surface px-3 py-2">
                    <div lang="tr" className={KPI_LABEL_CLASS}>Gerçekleşen</div>
                    <div className={`truncate font-mono text-base font-semibold ${signClass(metrics.realizedPnL)}`}>
                        {fmtUsd(metrics.realizedPnL, true)}
                    </div>
                </div>
                <div className="min-w-0 bg-surface px-3 py-2">
                    <div lang="tr" className={KPI_LABEL_CLASS}>Açık pozisyon</div>
                    <div className={`flex flex-wrap items-baseline gap-x-1.5 font-mono ${signClass(metrics.unrealizedPnL)}`}>
                        <span className="truncate text-base font-semibold">{fmtUsd(metrics.unrealizedPnL, true)}</span>
                        <span className="text-[11px]">({fmtPct(metrics.unrealizedPercent)})</span>
                    </div>
                </div>
            </div>

            {storageWarning && (
                <div role="alert" className="shrink-0 border-b border-border bg-warning-soft px-3 py-1.5 text-[11px] text-warning">
                    {storageWarning}
                </div>
            )}

            {metrics.missingPriceCount > 0 && (
                <div className="shrink-0 border-b border-border bg-warning-soft px-3 py-1.5 text-[11px] text-warning">
                    {metrics.missingPriceCount} varlık için canlı fiyat bulunamadı; maliyet değeriyle gösteriliyor ve K/Z'ye dahil edilmiyor.
                </div>
            )}

            {/* Tabs: only below lg, where a single panel is shown at a time */}
            <div className="flex h-8 shrink-0 items-stretch border-b border-border px-1 lg:hidden">
                <button
                    onClick={() => setActiveTab('assets')}
                    className={`flex items-center gap-1.5 border-b-2 px-3 text-[11px] font-medium uppercase tracking-wider transition-colors ${activeTab === 'assets'
                        ? 'border-primary text-text'
                        : 'border-transparent text-secondary hover:text-text'
                        }`}
                >
                    <Wallet size={12} />
                    Assets
                </button>
                <button
                    onClick={() => setActiveTab('history')}
                    className={`flex items-center gap-1.5 border-b-2 px-3 text-[11px] font-medium uppercase tracking-wider transition-colors ${activeTab === 'history'
                        ? 'border-primary text-text'
                        : 'border-transparent text-secondary hover:text-text'
                        }`}
                >
                    <History size={12} />
                    History
                </button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] gap-px bg-border lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                {/* Holdings */}
                <section className={`min-h-0 min-w-0 flex-col bg-surface ${activeTab === 'assets' ? 'flex' : 'hidden lg:flex'}`}>
                    <header className={`hidden lg:flex ${PANEL_HEADER_CLASS}`}>
                        <h2 className={PANEL_TITLE_CLASS}>
                            <Wallet size={12} />
                            Assets
                        </h2>
                    </header>

                    <div className="flex min-h-0 flex-1 flex-col md:flex-row lg:flex-col xl:flex-row">
                        {/* Allocation */}
                        <div className="flex shrink-0 items-start justify-center border-b border-border p-2 md:w-40 md:border-b-0 md:border-r lg:w-auto lg:border-b lg:border-r-0 xl:w-40 xl:border-b-0 xl:border-r">
                            <div className="relative h-28 w-28">
                                {/* Empty portfolio: an empty ring instead of a blank square */}
                                {chartData.length === 0 && (
                                    <div aria-hidden="true" className="absolute inset-0.5 rounded-full border-[18px] border-surface-highlight" />
                                )}
                                <PieChart width={112} height={112}>
                                    <Pie
                                        data={chartData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={36}
                                        outerRadius={54}
                                        paddingAngle={2}
                                        dataKey="value"
                                        stroke="none"
                                        isAnimationActive={false}
                                    >
                                        {chartData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: 'var(--bg-surface)',
                                            border: '1px solid var(--color-border-strong)',
                                            borderRadius: 2,
                                            boxShadow: 'var(--shadow-overlay)',
                                            padding: '4px 8px',
                                            fontSize: 11
                                        }}
                                        itemStyle={{ color: 'var(--color-text)', padding: 0 }}
                                        formatter={(value: number) => [fmtUsd(value), '']}
                                    />
                                </PieChart>
                                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                    <Wallet size={14} className="text-muted" />
                                </div>
                            </div>
                        </div>

                        {/* Holdings table */}
                        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
                            <div role="table" lang="tr" style={{ minWidth: HOLDING_MIN_WIDTH }}>
                                <div role="row" className={TABLE_HEAD_CLASS} style={{ gridTemplateColumns: HOLDING_COLS }}>
                                    <div role="columnheader">Varlık</div>
                                    <div role="columnheader" className="text-right">Adet</div>
                                    <div role="columnheader" className="text-right">Ort.</div>
                                    <div role="columnheader" className="text-right">Değer</div>
                                    <div role="columnheader" className="text-right">K/Z</div>
                                </div>
                                {metrics.items.map((item, index) => {
                                    const color = COLORS[index % COLORS.length];
                                    const symbolBase = item.symbol.replace('USDT', '');
                                    const iconUrl = `https://assets.coincap.io/assets/icons/${symbolBase.toLowerCase()}@2x.png`;

                                    return (
                                        <div
                                            key={item.symbol}
                                            role="row"
                                            className={TABLE_ROW_CLASS}
                                            style={{ gridTemplateColumns: HOLDING_COLS }}
                                        >
                                            <div role="cell" className="flex min-w-0 items-center gap-1.5">
                                                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                                                <span className="h-4 w-4 shrink-0 overflow-hidden rounded-full bg-surface-secondary">
                                                    <img
                                                        src={iconUrl}
                                                        className="h-full w-full object-cover"
                                                        onError={(e) => e.currentTarget.style.display = 'none'}
                                                        alt={symbolBase}
                                                    />
                                                </span>
                                                <span className="truncate font-medium text-text">{symbolBase}</span>
                                            </div>
                                            <div role="cell" className="truncate text-right font-mono text-text">{fmtQty(item.amount)}</div>
                                            <div role="cell" className="truncate text-right font-mono text-secondary">{fmtPrice(item.avgPrice)}</div>
                                            <div role="cell" className="truncate text-right font-mono text-text">{fmtUsd(item.value)}</div>
                                            {item.pnlPercent === null ? (
                                                <div role="cell" className="truncate text-right text-[11px] text-warning">Canlı fiyat yok</div>
                                            ) : (
                                                <div role="cell" className={`truncate text-right font-mono ${(item.pnl ?? 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                                                    {fmtPct(item.pnlPercent)}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </section>

                {/* Trade history */}
                <section className={`min-h-0 min-w-0 flex-col bg-surface ${activeTab === 'history' ? 'flex' : 'hidden lg:flex'}`}>
                    <header className={`flex ${PANEL_HEADER_CLASS}`}>
                        <h3 className={PANEL_TITLE_CLASS}>
                            <History size={12} />
                            Trade History
                        </h3>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                aria-label="Portföyü temizle"
                                title="Portföyü temizle"
                                disabled={trades.length === 0}
                                onClick={() => {
                                    if (typeof window === 'undefined') return;
                                    if (window.confirm('Tüm portföy işlemleri kalıcı olarak silinecek. Bu işlem geri alınamaz. Emin misiniz?')) {
                                        clearPortfolio();
                                    }
                                }}
                                className={`${ICON_BUTTON_CLASS} text-secondary hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-40`}
                            >
                                <Trash2 size={14} />
                            </button>
                            <button
                                type="button"
                                aria-label={isAdding ? 'Formu kapat' : 'İşlem ekle'}
                                onClick={() => { setIsAdding(!isAdding); setFormError(null); setFormNotice(null); }}
                                className={`${ICON_BUTTON_CLASS} ${isAdding
                                    ? 'bg-surface-highlight text-text'
                                    : 'text-secondary hover:bg-surface-secondary hover:text-text'
                                    }`}
                            >
                                {isAdding ? <X size={14} /> : <Plus size={14} />}
                            </button>
                        </div>
                    </header>

                    {/* Add form: one compact row */}
                    {isAdding && (
                        <div className="shrink-0 border-b border-border px-3 py-2">
                            <div className="grid grid-cols-6 gap-2 sm:flex sm:flex-wrap sm:items-center">
                                <input
                                    type="text"
                                    placeholder="SEMBOL (örn. BTC)"
                                    aria-label="Sembol"
                                    value={newSymbol}
                                    onChange={e => setNewSymbol(e.target.value.toUpperCase())}
                                    className={`${INPUT_CLASS} col-span-4 w-full uppercase sm:w-36`}
                                />
                                <select
                                    value={newSide}
                                    onChange={e => setNewSide(e.target.value as any)}
                                    className={`${INPUT_CLASS} col-span-2 w-full sm:w-20`}
                                >
                                    <option value="BUY">BUY</option>
                                    <option value="SELL">SELL</option>
                                </select>
                                <input
                                    type="number"
                                    step="any"
                                    min="0"
                                    inputMode="decimal"
                                    placeholder="FİYAT"
                                    aria-label="Fiyat"
                                    value={newPrice}
                                    onChange={e => setNewPrice(e.target.value)}
                                    className={`${INPUT_CLASS} col-span-2 w-full font-mono sm:w-24`}
                                />
                                <input
                                    type="number"
                                    step="any"
                                    min="0"
                                    inputMode="decimal"
                                    placeholder="MİKTAR"
                                    aria-label="Miktar"
                                    value={newQty}
                                    onChange={e => setNewQty(e.target.value)}
                                    className={`${INPUT_CLASS} col-span-2 w-full font-mono sm:w-24`}
                                />
                                <button
                                    type="button"
                                    onClick={handleAddTrade}
                                    className="col-span-2 h-7 whitespace-nowrap rounded-sm bg-primary px-2.5 text-xs font-medium text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                                >
                                    Log Trade
                                </button>
                            </div>
                            {formError && (
                                <div role="alert" className="mt-1.5 text-[11px] text-danger">
                                    {formError}
                                </div>
                            )}
                        </div>
                    )}

                    {formNotice && (
                        <div role="status" className="shrink-0 border-b border-border bg-warning-soft px-3 py-1.5 text-[11px] text-warning">
                            {formNotice}
                        </div>
                    )}

                    {/* Trade list */}
                    <div className="min-h-0 flex-1 overflow-auto">
                        {trades.length === 0 ? (
                            <div className="flex h-full min-h-[96px] items-center justify-center gap-2 px-3 text-xs text-muted">
                                <History size={14} className="shrink-0" />
                                <p>No trades logged yet. Click + to add one.</p>
                            </div>
                        ) : (
                            <div role="table" lang="tr" style={{ minWidth: TRADE_MIN_WIDTH }}>
                                <div role="row" className={TABLE_HEAD_CLASS} style={{ gridTemplateColumns: TRADE_COLS }}>
                                    <div role="columnheader">Tarih</div>
                                    <div role="columnheader">Sembol</div>
                                    <div role="columnheader">Yön</div>
                                    <div role="columnheader" className="text-right">Fiyat</div>
                                    <div role="columnheader" className="text-right">Adet</div>
                                    <div role="columnheader" />
                                </div>
                                {trades.map((trade) => (
                                    <div
                                        key={trade.id}
                                        role="row"
                                        className={TABLE_ROW_CLASS}
                                        style={{ gridTemplateColumns: TRADE_COLS }}
                                    >
                                        <div role="cell" className="truncate font-mono text-[11px] text-secondary">
                                            {new Date(trade.date).toLocaleString('tr-TR')}
                                        </div>
                                        <div role="cell" className="truncate font-medium text-text">{trade.symbol}</div>
                                        <div role="cell">
                                            <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase ${trade.side === 'BUY'
                                                ? 'bg-success-soft text-success'
                                                : 'bg-danger-soft text-danger'
                                                }`}>
                                                {trade.side}
                                            </span>
                                        </div>
                                        <div role="cell" className="truncate text-right font-mono text-text">{fmtPrice(trade.price)}</div>
                                        <div role="cell" className="truncate text-right font-mono text-secondary">{fmtQty(trade.amount)}</div>
                                        <div role="cell" className="flex justify-end">
                                            <button
                                                type="button"
                                                aria-label="İşlemi sil"
                                                onClick={() => deleteTrade(trade.id)}
                                                className="grid h-6 w-6 place-items-center rounded-sm text-muted transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
};
