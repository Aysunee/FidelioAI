import React, { useState, useEffect, useMemo } from 'react';
import { useSignals } from '../context/SignalContext';
import { BigMoveSignal } from '../types';
import { formatPrice } from '../utils/formatters';
import { ArrowUpRight, ArrowDownRight, Activity, TrendingUp, TrendingDown, Zap, AlertTriangle, PlayCircle, PauseCircle, Filter, Link, BarChart2, Globe, Search } from 'lucide-react';
import { describeBigMove, BIG_MOVE_LEVEL_TEXT, BIG_MOVE_LEVEL_FILTERS } from './BigMoveRadar';

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary';
const SEGMENT = `h-6 rounded-sm px-1.5 text-[11px] transition-colors whitespace-nowrap ${FOCUS_RING}`;
const SEGMENT_ACTIVE = 'bg-surface-highlight text-text';
const SEGMENT_IDLE = 'text-secondary hover:text-text';
const ROW_ACTION = `grid h-5 w-5 place-items-center rounded-sm text-secondary transition-colors hover:bg-surface-highlight hover:text-text ${FOCUS_RING}`;

// One table line when the panel itself (not the viewport) is wide enough, two compact lines otherwise.
const ROW =
    'grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 border-b border-border px-3 py-1 text-xs hover:bg-surface-secondary [@container(min-width:520px)]:h-7 [@container(min-width:520px)]:grid-cols-[140px_minmax(0,1fr)_160px_60px] [@container(min-width:520px)]:py-0';

const TYPE_FILTERS: { key: 'ALL' | 'RISE' | 'FALL'; label: string }[] = [
    { key: 'ALL', label: 'Tümü' },
    { key: 'RISE', label: 'Yükseliş' },
    { key: 'FALL', label: 'Düşüş' }
];

export const PerpBigMoveRadar: React.FC = () => {
    const { futuresBigMoves } = useSignals();
    const [isPaused, setIsPaused] = useState(false);
    const [filterType, setFilterType] = useState<'ALL' | 'RISE' | 'FALL'>('ALL');
    const [filterLevel, setFilterLevel] = useState<'ALL' | 'HIGH' | 'MID' | 'SMALL'>('ALL');
    const [searchQuery, setSearchQuery] = useState('');
    const [isHovering, setIsHovering] = useState(false);

    const filteredMoves = useMemo(() => {
        let filtered = futuresBigMoves;

        if (searchQuery) {
            filtered = filtered.filter(m => m.symbol.toLowerCase().includes(searchQuery.toLowerCase()));
        }

        if (filterType !== 'ALL') {
            filtered = filtered.filter(m => m.type === filterType);
        }

        if (filterLevel !== 'ALL') {
            filtered = filtered.filter(m => m.level === filterLevel);
        }

        return filtered;
    }, [futuresBigMoves, filterType, filterLevel, searchQuery]);

    const [displayMoves, setDisplayMoves] = useState<BigMoveSignal[]>([]);

    useEffect(() => {
        if (!isPaused && !isHovering) {
            setDisplayMoves(filteredMoves);
        }
    }, [filteredMoves, isPaused, isHovering]);

    const getIcon = (type: BigMoveSignal['type']) => {
        switch (type) {
            case 'RISE': return <TrendingUp size={12} className="shrink-0 text-success" />;
            case 'FALL': return <TrendingDown size={12} className="shrink-0 text-danger" />;
            case 'HIGH': return <ArrowUpRight size={12} className="shrink-0 text-warning" />;
            case 'LOW': return <ArrowDownRight size={12} className="shrink-0 text-primary" />;
            case 'PULLBACK': return <Activity size={12} className="shrink-0 text-warning" />;
            case 'RALLY': return <Activity size={12} className="shrink-0 text-info" />;
            case 'VOL_SPIKE': return <Zap size={12} className="shrink-0 text-warning" />;
            default: return <AlertTriangle size={12} className="shrink-0 text-secondary" />;
        }
    };

    const getLevelColor = (level: BigMoveSignal['level']) => {
        switch (level) {
            case 'HIGH': return 'bg-danger-soft text-danger';
            case 'MID': return 'bg-warning-soft text-warning';
            default: return 'bg-surface-secondary text-secondary';
        }
    };

    return (
        <section lang="tr" className="flex h-full min-h-0 min-w-0 flex-col bg-surface [container-type:inline-size] lg:max-h-[100dvh]">
            {/* Header */}
            <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
                <h2 className="truncate text-[11px] font-semibold uppercase tracking-wider text-secondary" title="Binance USDT-M kripto perp: kısa sürede büyük fiyat değişimi, yeni 24 saatlik uçlar, zirveden geri çekilme ve dipten toparlanma">Perp Büyük Hareket</h2>

                <div className="flex shrink-0 items-center gap-1">
                    {/* Search Bar */}
                    <div className="relative w-28">
                        <Search size={12} className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-muted" />
                        <input
                            type="text"
                            placeholder="Ara..."
                            aria-label="Sembol ara"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="h-6 w-full rounded-sm border border-border bg-surface-secondary pl-6 pr-2 text-xs text-text outline-none placeholder:text-muted focus:border-primary"
                        />
                    </div>

                    <button
                        onClick={() => setIsPaused(!isPaused)}
                        className={`grid h-7 w-7 place-items-center rounded-sm transition-colors hover:bg-surface-secondary hover:text-text ${FOCUS_RING} ${isPaused ? 'text-warning' : 'text-secondary'}`}
                        title={isPaused ? 'Güncellemeyi sürdür' : 'Güncellemeyi duraklat'}
                        aria-label={isPaused ? 'Güncellemeyi sürdür' : 'Güncellemeyi duraklat'}
                    >
                        {isPaused ? <PlayCircle size={14} /> : <PauseCircle size={14} />}
                    </button>
                </div>
            </header>

            {/* Filters */}
            <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-[3px]">
                <div className="inline-flex rounded-sm border border-border p-0.5">
                    {TYPE_FILTERS.map(({ key, label }) => (
                        <button
                            key={key}
                            onClick={() => setFilterType(key)}
                            className={`${SEGMENT} ${filterType === key ? SEGMENT_ACTIVE : SEGMENT_IDLE}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                <div className="inline-flex rounded-sm border border-border p-0.5" title="Hareketin büyüklük sınıfı">
                    {BIG_MOVE_LEVEL_FILTERS.map(({ key, label }) => (
                        <button
                            key={key}
                            onClick={() => setFilterLevel(key)}
                            className={`${SEGMENT} ${filterLevel === key ? SEGMENT_ACTIVE : SEGMENT_IDLE}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {/* List */}
            <div
                className="max-h-[360px] min-h-0 flex-1 overflow-y-auto lg:max-h-none"
                onMouseEnter={() => setIsHovering(true)}
                onMouseLeave={() => setIsHovering(false)}
            >
                {displayMoves.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-1 px-3 py-8 text-center text-xs text-muted">
                        <Filter size={14} />
                        <p>Kayıt yok</p>
                        <p className="text-[11px]">Açılıştan sonra oluşan hareketler burada listelenir. Filtre seçiliyse değiştirmeyi deneyin.</p>
                    </div>
                ) : (
                    displayMoves.map((move) => (
                        <div
                            key={move.id}
                            onClick={() => {
                                const symbol = move.symbol.replace('USDT', '_USDT');
                                window.open(`https://www.binance.com/en/futures/${symbol}`, '_blank');
                            }}
                            className={ROW}
                        >
                            <div className="order-1 flex min-w-0 items-center gap-1.5 [@container(min-width:520px)]:order-none">
                                {getIcon(move.type)}
                                <span className="truncate font-medium text-text">{move.symbol.replace('USDT', '')}</span>
                                <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase ${getLevelColor(move.level)}`} title="Hareketin büyüklük sınıfı">
                                    {BIG_MOVE_LEVEL_TEXT[move.level] ?? move.level}
                                </span>
                            </div>

                            <div className="order-3 min-w-0 truncate text-[11px] text-secondary [@container(min-width:520px)]:order-none" title={move.description}>
                                {describeBigMove(move)}
                            </div>

                            <div className="order-2 flex items-center justify-end gap-2 font-mono [@container(min-width:520px)]:order-none">
                                <span className="text-text">${formatPrice(move.price)}</span>
                                <span className="text-[10px] text-muted">
                                    {new Date(move.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </span>
                            </div>

                            {/* Action Buttons */}
                            <div className="order-4 flex items-center justify-end [@container(min-width:520px)]:order-none" onClick={(e) => e.stopPropagation()}>
                                <button
                                    onClick={() => window.open(`https://www.binance.com/en/futures/${move.symbol.replace('USDT', '_USDT')}`, '_blank')}
                                    className={ROW_ACTION}
                                    title="Binance Futures"
                                >
                                    <Link size={12} />
                                </button>
                                <button
                                    onClick={() => window.open(`https://www.tradingview.com/chart/?symbol=BINANCE:${move.symbol}.P`, '_blank')}
                                    className={ROW_ACTION}
                                    title="TradingView"
                                >
                                    <BarChart2 size={12} />
                                </button>
                                <button
                                    onClick={() => window.open(`https://coinmarketcap.com/currencies/search/?q=${move.symbol.replace('USDT', '')}`, '_blank')}
                                    className={ROW_ACTION}
                                    title="CoinMarketCap"
                                >
                                    <Globe size={12} />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </section>
    );
};
