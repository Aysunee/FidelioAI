import React, { useState, useEffect, useMemo, useRef } from 'react';
import { FuturesTicker, Ticker } from '../types';
import { anomalyDetector, FundingAnalyzer } from '../utils/AnomalyLogic';
import { getCryptoPerpSymbols } from '../services/marketData';
import { DEFAULT_FUNDING_INTERVAL_HOURS, toEightHourFundingRate, formatTime } from '../utils/formatters';
import { useFundingIntervals, getFundingIntervalHours } from './FundingRates';
import { Link2Off, TrendingUp, TrendingDown, Activity } from 'lucide-react';

interface AnomalyRadarProps {
    data: Record<string, FuturesTicker>;
    spotData: Record<string, Ticker>;
    fundingHistory: Record<string, { time: number, rate: number }[]>;
}

// --- Shared crypto-perp universe -------------------------------------------------------------
// TRADING + PERPETUAL USDT crypto contracts (services/marketData keeps the list for an hour).
// `symbols` stays null until the list has loaded; futures-based work is skipped until then.
const PERP_LIST_REFRESH_MS = 60 * 60 * 1000;
const PERP_LIST_RETRY_MS = 60 * 1000;

export const useCryptoPerpSymbols = (): { symbols: Set<string> | null; failed: boolean } => {
    const [state, setState] = useState<{ symbols: Set<string> | null; failed: boolean }>({ symbols: null, failed: false });

    useEffect(() => {
        let disposed = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const load = () => {
            getCryptoPerpSymbols()
                .then(symbols => {
                    if (disposed) return;
                    const usable = symbols instanceof Set && symbols.size > 0;
                    setState(prev => {
                        if (!usable) return prev.failed ? prev : { symbols: prev.symbols, failed: true };
                        return prev.symbols === symbols && !prev.failed ? prev : { symbols, failed: false };
                    });
                    timer = setTimeout(load, usable ? PERP_LIST_REFRESH_MS : PERP_LIST_RETRY_MS);
                })
                .catch(() => {
                    if (disposed) return;
                    setState(prev => (prev.failed ? prev : { symbols: prev.symbols, failed: true }));
                    timer = setTimeout(load, PERP_LIST_RETRY_MS);
                });
        };

        load();
        return () => {
            disposed = true;
            if (timer) clearTimeout(timer);
        };
    }, []);

    return state;
};

// --- Radar rows ------------------------------------------------------------------------------
// Every row states what was measured. The cards group rows by the condition that holds right now.
type RadarGroup = 'DECOUPLING' | 'NEG_FUNDING' | 'RELATIVE_RISE' | 'FUNDING_RISING';

interface RadarItem {
    id: string;          // stable across scans: condition + symbol
    symbol: string;
    group: RadarGroup;
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
    description: string;
    timestamp: number;   // first time the condition was seen in this session
    priceChange?: number; // 24h, percent
}

const signedPct = (value: number, digits = 2) => `${value > 0 ? '+' : value < 0 ? '−' : ''}%${Math.abs(value).toFixed(digits)}`;

// --- Helper UI Components (module scope so the panels are not re-created / remounted on every render) ---

const AnomalyPanel: React.FC<{ title: string; rule: string; icon: any; items: RadarItem[]; emptyText: string }> = ({ title, rule, icon: Icon, items, emptyText }) => (
    <section className="flex min-h-0 min-w-0 flex-col bg-surface">
        <header className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3" title={rule}>
            <Icon size={13} className="shrink-0 text-secondary" />
            <h2 className="truncate text-[11px] font-semibold uppercase tracking-wider text-secondary">{title}</h2>
            <span className="ml-auto shrink-0 rounded-sm bg-surface-secondary px-1.5 py-0.5 font-mono text-[10px] font-semibold text-secondary">{items.length}</span>
        </header>

        <div className="max-h-[360px] min-h-[72px] flex-1 overflow-y-auto lg:max-h-none lg:min-h-0">
            {items.length === 0 ? (
                <div className="flex h-full min-h-[72px] items-center justify-center gap-1.5 px-3 text-center text-xs text-muted">
                    <Activity size={14} className="shrink-0" />
                    {emptyText}
                </div>
            ) : (
                items.map(item => (
                    <div
                        key={item.id}
                        className="border-b border-border px-3 py-1.5 text-xs hover:bg-surface-secondary"
                        style={{ boxShadow: `inset 2px 0 0 var(${item.severity === 'HIGH' ? '--color-danger' : '--color-warning'})` }}
                    >
                        <div className="flex items-center gap-1.5">
                            <span className="truncate font-medium text-text">{item.symbol.replace('USDT', '')}</span>
                            {item.priceChange !== undefined && Number.isFinite(item.priceChange) && item.priceChange !== 0 && (
                                <span
                                    className={`shrink-0 rounded-sm px-1 py-0.5 font-mono text-[10px] leading-none ${item.priceChange > 0 ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}
                                    title="Spot fiyatın 24 saatlik değişimi"
                                >
                                    24s {item.priceChange > 0 ? '+' : ''}{item.priceChange.toFixed(2)}%
                                </span>
                            )}
                            <span className="ml-auto shrink-0 font-mono text-[10px] text-muted" title="Koşulun bu oturumda ilk görüldüğü saat">
                                {formatTime(item.timestamp, false)}
                            </span>
                        </div>
                        <p className="mt-0.5 text-[11px] leading-snug text-secondary">{item.description}</p>
                    </div>
                ))
            )}
        </div>
    </section>
);

export const AnomalyRadar: React.FC<AnomalyRadarProps> = ({ data, spotData, fundingHistory }) => {
    const fundingIntervals = useFundingIntervals();
    const { symbols: perpSymbols, failed: perpListFailed } = useCryptoPerpSymbols();
    const [scan, setScan] = useState<{ items: RadarItem[]; time: number | null; scanned: number }>(() => ({ items: [], time: null, scanned: 0 }));

    // Stable key -> first time the condition was seen (so keys and the shown time do not change every scan)
    const firstSeenRef = useRef<Map<string, number>>(new Map());

    // Effect: run the detection loop over spot pairs that also trade as a crypto perpetual
    useEffect(() => {
        if (!perpSymbols) return; // contract list not loaded yet: no futures work
        if (Object.keys(data).length === 0 || Object.keys(spotData).length === 0) return;

        const btcTicker = spotData['BTCUSDT'];
        if (!btcTicker) return;

        const now = Date.now();
        const previousSeen = firstSeenRef.current;
        const seen = new Map<string, number>();
        const detected: RadarItem[] = [];
        let scanned = 0;

        const add = (item: Omit<RadarItem, 'id' | 'timestamp'>, variant = '') => {
            const id = `${item.group}:${item.symbol}${variant ? `:${variant}` : ''}`;
            const firstSeen = previousSeen.get(id) ?? now;
            seen.set(id, firstSeen);
            detected.push({ ...item, id, timestamp: firstSeen });
        };

        const btcChange = btcTicker.priceChangePercent;
        // Funding intervals (1h / 4h / 8h) come from GET /fapi/v1/fundingInfo. Until that list has
        // loaded the 8h-equivalent rate of most contracts would be off by 2x, so funding rows wait.
        const intervalsLoaded = Object.keys(fundingIntervals).length > 0;

        (Object.values(spotData) as Ticker[]).forEach(spot => {
            if (!perpSymbols.has(spot.symbol)) return;
            const futures = data[spot.symbol];
            if (!futures) return;
            scanned++;

            const base = spot.symbol.replace('USDT', '');
            const coinChange = spot.priceChangePercent;

            // 1. Moving against BTC over 24h
            const decoupling = anomalyDetector.detectDecoupling(spot, btcTicker);
            if (decoupling) {
                add({
                    symbol: spot.symbol,
                    group: 'DECOUPLING',
                    severity: decoupling.severity,
                    description: `24s değişim: BTC ${signedPct(btcChange)}, ${base} ${signedPct(coinChange)}`,
                    priceChange: coinChange
                }, coinChange > 0 ? 'up' : 'down');
            }

            // 2. Negative funding while the price is up over 24h. The rate is compared as an
            //    8h-equivalent (contracts settle every 1h / 4h / 8h).
            const intervalHours = getFundingIntervalHours(fundingIntervals, futures.symbol);
            const funding8h = toEightHourFundingRate(futures.fundingRate, intervalHours);
            const intervalNote = intervalHours !== DEFAULT_FUNDING_INTERVAL_HOURS ? ` · ${intervalHours} sa aralık` : '';
            const negativeFunding = intervalsLoaded ? anomalyDetector.detectFundingArbitrage({ ...futures, fundingRate: funding8h }, spot) : null;
            if (negativeFunding) {
                add({
                    symbol: spot.symbol,
                    group: 'NEG_FUNDING',
                    severity: negativeFunding.severity,
                    description: `Fonlama ${signedPct(funding8h * 100, 4)} (8s eşdeğeri) · 24s fiyat ${signedPct(coinChange)}${intervalNote}`,
                    priceChange: coinChange
                }, 'level');
            }

            // 3. 24h rise well above BTC's
            const rise = anomalyDetector.detectPump(spot, btcTicker);
            if (rise) {
                const aboveBtc = coinChange - (Number.isFinite(btcChange) ? btcChange : 0);
                add({
                    symbol: spot.symbol,
                    group: 'RELATIVE_RISE',
                    severity: rise.severity,
                    description: `BTC'den ${aboveBtc.toFixed(1)} puan fazla (BTC ${signedPct(btcChange)}) · 24s hacim $${(spot.volume / 1_000_000).toFixed(1)}M`,
                    priceChange: coinChange
                });
            }

            // 4. Funding slope over the last hour (8h-equivalent, from the session history)
            const history = fundingHistory[spot.symbol];
            if (intervalsLoaded && history && history.length > 5) {
                const normalizedHistory = intervalHours === DEFAULT_FUNDING_INTERVAL_HOURS
                    ? history
                    : history.map(p => ({ time: p.time, rate: toEightHourFundingRate(p.rate, intervalHours) }));
                const trend = FundingAnalyzer.analyze(spot.symbol, normalizedHistory);
                if (trend.direction !== 'STABLE') {
                    const falling = trend.direction === 'DIVING';
                    add({
                        symbol: spot.symbol,
                        group: falling ? 'NEG_FUNDING' : 'FUNDING_RISING',
                        severity: trend.intensity > 70 ? 'HIGH' : 'MEDIUM',
                        description: `Fonlama ${falling ? 'düşüyor' : 'yükseliyor'}: saatte ${signedPct(trend.velocity * 100, 3)} (son 1 saatin eğimi, 8s eşdeğeri)${intervalNote}`
                    }, 'slope');
                }
            }
        });

        firstSeenRef.current = seen;
        setScan({ items: detected, time: now, scanned });

    }, [data, spotData, fundingHistory, fundingIntervals, perpSymbols]); // Re-run when data updates

    // Group rows by condition for the cards
    const grouped = useMemo(() => ({
        decoupling: scan.items.filter(a => a.group === 'DECOUPLING'),
        negFunding: scan.items.filter(a => a.group === 'NEG_FUNDING'),
        relativeRise: scan.items.filter(a => a.group === 'RELATIVE_RISE'),
        fundingRising: scan.items.filter(a => a.group === 'FUNDING_RISING'),
    }), [scan.items]);

    // Honest empty state: say why a card is empty
    const emptyText = !perpSymbols
        ? (perpListFailed ? 'Kontrat listesi alınamadı, yeniden denenecek' : 'Kontrat listesi yükleniyor…')
        : scan.time === null
            ? 'Piyasa verisi bekleniyor…'
            : 'Şu an koşulu sağlayan yok';

    return (
        <div lang="tr" className="flex min-h-full w-full flex-1 flex-col gap-px bg-border lg:h-full lg:min-h-0">
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-px md:grid-cols-2 lg:grid-rows-2 xl:grid-cols-4 xl:grid-rows-1">

                {/* 1. Moving against BTC */}
                <AnomalyPanel
                    title="BTC'den ayrışan"
                    rule="BTC 24 saatte %0.8'den fazla düşmüşken coin %1.5'ten fazla yükselmiş, ya da BTC %0.8'den fazla yükselmişken coin %1.5'ten fazla düşmüş."
                    icon={Link2Off}
                    items={grouped.decoupling}
                    emptyText={emptyText}
                />

                {/* 2. Negative / falling funding */}
                <AnomalyPanel
                    title="Negatif / düşen fonlama"
                    rule="8 saatlik eşdeğer fonlama −%0.01'in altında ve 24 saatlik fiyat +%3'ün üstünde; ya da fonlama son 1 saatte saatte %0.05'ten hızlı düşüyor (en az 30 dakikalık oturum verisiyle)."
                    icon={TrendingDown}
                    items={grouped.negFunding}
                    emptyText={emptyText}
                />

                {/* 3. 24h rise relative to BTC */}
                <AnomalyPanel
                    title="24s yükseliş (BTC'ye göre)"
                    rule="24 saatlik hacmi en az 1 milyon USDT olan coin, 24 saatte en az %6 ve BTC'den en az 6 puan fazla yükselmiş."
                    icon={TrendingUp}
                    items={grouped.relativeRise}
                    emptyText={emptyText}
                />

                {/* 4. Rising funding */}
                <AnomalyPanel
                    title="Fonlama yükseliyor"
                    rule="8 saatlik eşdeğer fonlama son 1 saatte saatte %0.05'ten hızlı yükseliyor (en az 30 dakikalık oturum verisiyle)."
                    icon={Activity}
                    items={grouped.fundingRising}
                    emptyText={emptyText}
                />
            </div>

            {/* Footer / Status Area */}
            <footer className="flex h-6 shrink-0 items-center justify-between gap-2 bg-surface px-3 text-[10px] text-muted">
                <span className="truncate">
                    {perpSymbols && scan.time !== null
                        ? `${scan.scanned} coin tarandı (spot paritesi olan kripto perp kontratları)`
                        : 'Tarama başlamadı'}
                </span>
                <span className="shrink-0 font-mono">Son tarama: {scan.time === null ? '--:--' : formatTime(scan.time)}</span>
            </footer>
        </div>
    );
};
