import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Ticker } from '../types';
import {
    Crosshair, Activity, Zap,
    Settings, Play, Pause, Sliders, Trash2, Clock,
    LineChart, ExternalLink
} from 'lucide-react';
import { CoinIcon } from './terminal/CoinIcon';

interface SpotScannerProps {
    data: Record<string, Ticker>;
}

// --- Data Structures ---

interface AnalyzerState {
    symbol: string;
    price: number;
    priceChangePercent: number;

    // Accumulated Flow
    buyVolume: number;
    sellVolume: number;
    totalVolumeWindow: number; // Quote Volume (USDT)

    // Metrics
    pressure: number; // 0 to 100
    rvol: number; // Relative Volume Multiplier
    netFlow: number; // Net USDT

    updatedAt: number;
}

// Wrapper for the UI list to handle "Sticky" behavior
interface DetectedSignal extends AnalyzerState {
    status: 'ACTIVE' | 'COOLDOWN';
    lastActiveAt: number; // Timestamp when it last met strict rules
    firstDetectedAt: number;
}

interface ScannerRules {
    minRvol: number;
    minPressure: number;
    maxPressure: number;
    minFlowUsdt: number; // Minimum volume (USDT) in the ~10s flow window to filter dust
    minPriceChange: number;
    maxPriceChange: number;
}

type PresetName = 'DEFAULT' | 'WHALE_ACCUMULATION' | 'BREAKOUT' | 'DIP_SNIPER';

const RETENTION_MS = 45000; // Keep signals for 45 seconds after they stop meeting criteria

// Flow metrics are an exponentially weighted window: volume decays by 10% per second,
// i.e. a time constant of ~10 seconds (NOT one minute).
const DECAY_PER_SECOND = 0.90;
const FLOW_WINDOW_LABEL = '~10 sn';

// An analyzer that has not seen new volume for this long is stale: it can no longer be ACTIVE
// (illiquid coins would otherwise keep a single old volume spike forever).
const STALE_MS = 15000;

// Valid ranges for the numeric rule inputs (invalid / empty input is never written into the rules)
const RULE_LIMITS: Record<keyof ScannerRules, [number, number]> = {
    minRvol: [0, 100],
    minPressure: [0, 100],
    maxPressure: [0, 100],
    minFlowUsdt: [0, 10_000_000],
    minPriceChange: [-100, 10_000],
    maxPriceChange: [-100, 10_000]
};

// Stablecoins to ignore to reduce noise
const IGNORED_COINS = ['USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'USDE', 'EURI', 'EUR', 'AEUR'];

const PRESETS: Record<PresetName, ScannerRules> = {
    DEFAULT: {
        minRvol: 1.2,
        minPressure: 0,
        maxPressure: 100,
        minFlowUsdt: 1000,
        minPriceChange: -100,
        maxPriceChange: 100
    },
    WHALE_ACCUMULATION: {
        minRvol: 2.0,
        minPressure: 60, // Buying pressure present
        maxPressure: 100,
        minFlowUsdt: 10000, // Moderate Volume
        minPriceChange: -3, // Price hasn't pumped yet
        maxPriceChange: 3   // Catching before the pump
    },
    BREAKOUT: {
        minRvol: 3.0,
        minPressure: 60,
        maxPressure: 100,
        minFlowUsdt: 15000,
        minPriceChange: 1, // Already moving up
        maxPriceChange: 15
    },
    DIP_SNIPER: {
        minRvol: 1.8,
        minPressure: 50, // Absorption starting (neutral to buy)
        maxPressure: 100,
        minFlowUsdt: 5000,
        minPriceChange: -20, // Creating a bottom
        maxPriceChange: -2
    }
};

// Results table: shared by the header and the rows so every column lines up.
// Asset | Price | 24h % | Momentum | RVOL | Net flow | links
const GRID_COLS =
    'minmax(104px,1.3fr) minmax(70px,0.9fr) minmax(56px,0.7fr) minmax(190px,2.4fr) minmax(48px,0.6fr) minmax(88px,1fr) 44px';
const TABLE_MIN_WIDTH = 700; // below this the table scrolls sideways inside its panel (never the page)

// Signal lifecycle (pure: safe to run twice under StrictMode)
const evaluateSignals = (
    currentSignals: Record<string, DetectedSignal>,
    analyzers: Record<string, AnalyzerState>,
    rules: ScannerRules,
    loopTime: number
): Record<string, DetectedSignal> => {
    const nextSignals = { ...currentSignals };
    let signalListChanged = false;

    Object.values(analyzers).forEach((analysis: AnalyzerState) => {
        // Rule Check (stale analyzers never match)
        let isMatch = true;
        if (loopTime - analysis.updatedAt > STALE_MS) isMatch = false;
        else if (analysis.totalVolumeWindow < rules.minFlowUsdt) isMatch = false;
        else if (analysis.rvol < rules.minRvol) isMatch = false;
        else if (analysis.pressure < rules.minPressure) isMatch = false;
        else if (analysis.pressure > rules.maxPressure) isMatch = false;
        else if (analysis.priceChangePercent < rules.minPriceChange) isMatch = false;
        else if (analysis.priceChangePercent > rules.maxPriceChange) isMatch = false;

        const existing = nextSignals[analysis.symbol];

        if (isMatch) {
            // NEW or CONTINUING Signal -> Set ACTIVE
            nextSignals[analysis.symbol] = {
                ...analysis,
                status: 'ACTIVE',
                lastActiveAt: loopTime,
                firstDetectedAt: existing ? existing.firstDetectedAt : loopTime
            };
            signalListChanged = true;
        } else if (existing) {
            // NO MATCH, but exists -> COOLDOWN or REMOVE
            if (loopTime - existing.lastActiveAt < RETENTION_MS) {
                // Keep updating data, but mark as COOLDOWN
                nextSignals[analysis.symbol] = {
                    ...analysis, // Update price/vol/pressure
                    status: 'COOLDOWN',
                    lastActiveAt: existing.lastActiveAt, // Don't refresh timer
                    firstDetectedAt: existing.firstDetectedAt
                };
                signalListChanged = true;
            } else {
                // Expired
                delete nextSignals[analysis.symbol];
                signalListChanged = true;
            }
        }
    });

    return signalListChanged ? nextSignals : currentSignals;
};

// Number input that keeps the typed text locally and only commits finite, clamped values
const RuleNumberInput: React.FC<{
    value: number;
    min: number;
    max: number;
    placeholder: string;
    onCommit: (value: number) => void;
}> = ({ value, min, max, placeholder, onCommit }) => {
    const [draft, setDraft] = useState(String(value));

    useEffect(() => {
        setDraft(String(value));
    }, [value]);

    return (
        <input
            type="number"
            value={draft}
            min={min}
            max={max}
            onChange={(e) => {
                setDraft(e.target.value);
                const parsed = parseFloat(e.target.value);
                if (Number.isFinite(parsed)) onCommit(Math.min(max, Math.max(min, parsed)));
            }}
            onBlur={() => setDraft(String(value))}
            className="h-7 w-1/2 min-w-0 rounded-sm border border-border bg-surface-secondary px-2 text-center font-mono text-xs text-text placeholder:text-muted outline-none focus:border-primary"
            placeholder={placeholder}
        />
    );
};

export const SpotScanner: React.FC<SpotScannerProps> = ({ data }) => {
    // Raw Analysis State (only used for computation, never rendered -> kept in a ref)
    const analyzersRef = useRef<Record<string, AnalyzerState>>({});

    // Persistence State (The list displayed to user)
    const [detectedSignals, setDetectedSignals] = useState<Record<string, DetectedSignal>>({});

    // Cockpit State
    const [isPaused, setIsPaused] = useState(false);
    const [showConfig, setShowConfig] = useState(true);
    const [activePreset, setActivePreset] = useState<PresetName>('DEFAULT');
    const [rules, setRules] = useState<ScannerRules>(PRESETS.DEFAULT);

    // Refs
    const prevDataRef = useRef<Record<string, { vol: number, price: number, time: number }>>({});

    // --- Core Algorithm (Data Processing) ---
    useEffect(() => {
        if (isPaused) return;

        const now = Date.now();
        const updates: Record<string, AnalyzerState> = {};

        Object.values(data).forEach((t: Ticker) => {
            if (!t.symbol.endsWith('USDT')) return;

            // Filter out Stablecoins
            const symbolBase = t.symbol.replace('USDT', '');
            if (IGNORED_COINS.includes(symbolBase)) return;

            const prev = prevDataRef.current[t.symbol];
            const currentAnalyzer = analyzersRef.current[t.symbol] || {
                symbol: t.symbol,
                price: t.lastPrice,
                priceChangePercent: t.priceChangePercent,
                buyVolume: 0,
                sellVolume: 0,
                totalVolumeWindow: 0,
                pressure: 50,
                rvol: 0,
                netFlow: 0,
                updatedAt: now
            };

            if (prev) {
                const timeDelta = now - prev.time;

                // Process tick (>500ms debounce for metric calculation)
                if (timeDelta > 500) {
                    const volDelta = t.volume - prev.vol; // Change in Quote Volume
                    const priceDelta = t.lastPrice - prev.price;

                    if (volDelta > 0) {
                        const isBuy = priceDelta > 0 || (priceDelta === 0 && t.lastPrice >= prev.price); // Simple tick rule

                        // Time-based decay keeps the window at ~10 seconds even for rarely traded coins
                        const elapsedSec = Math.max(0, (now - currentAnalyzer.updatedAt) / 1000);
                        const decay = Math.pow(DECAY_PER_SECOND, elapsedSec);
                        const newBuyVol = (currentAnalyzer.buyVolume * decay) + (isBuy ? volDelta : 0);
                        const newSellVol = (currentAnalyzer.sellVolume * decay) + (!isBuy ? volDelta : 0);
                        const total = newBuyVol + newSellVol;

                        // Metrics
                        const pressure = total > 0 ? (newBuyVol / total) * 100 : 50;

                        // RVOL Logic
                        // Avg daily ms flow = volume / 86,400,000
                        const avgRate = t.volume / 86400000;
                        const currentRate = volDelta / timeDelta;
                        const rvol = avgRate > 0 ? currentRate / avgRate : 0;

                        updates[t.symbol] = {
                            ...currentAnalyzer,
                            price: t.lastPrice,
                            priceChangePercent: t.priceChangePercent,
                            buyVolume: newBuyVol,
                            sellVolume: newSellVol,
                            totalVolumeWindow: total,
                            pressure,
                            rvol,
                            netFlow: newBuyVol - newSellVol,
                            updatedAt: now
                        };
                    }
                }
            }

            if (!prev || (now - prev.time > 500)) {
                prevDataRef.current[t.symbol] = { vol: t.volume, price: t.lastPrice, time: now };
            }
        });

        const nextAnalyzers = Object.keys(updates).length > 0
            ? { ...analyzersRef.current, ...updates }
            : analyzersRef.current;
        analyzersRef.current = nextAnalyzers;

        // --- SIGNAL LIFECYCLE MANAGEMENT (Retention + staleness) ---
        setDetectedSignals(currentSignals => evaluateSignals(currentSignals, nextAnalyzers, rules, now));
    }, [data, isPaused, rules]); // Re-run logic when Rules change to immediately filter/unfilter

    // --- Display Sorting ---
    const sortedSignals = useMemo(() => {
        return Object.values(detectedSignals).sort((a: DetectedSignal, b: DetectedSignal) => {
            // 1. Status Priority: ACTIVE > COOLDOWN
            if (a.status === 'ACTIVE' && b.status === 'COOLDOWN') return -1;
            if (a.status === 'COOLDOWN' && b.status === 'ACTIVE') return 1;

            // 2. Score Priority (RVOL + NetFlow)
            const scoreA = (a.rvol * 2) + (Math.abs(a.netFlow) / 10000);
            const scoreB = (b.rvol * 2) + (Math.abs(b.netFlow) / 10000);
            return scoreB - scoreA;
        });
    }, [detectedSignals]);

    // --- Handlers ---
    const applyPreset = (name: PresetName) => {
        setActivePreset(name);
        setRules(PRESETS[name]);
        // Optional: Clear existing signals when switching strategies? 
        // User might prefer to keep them, so we leave them to decay naturally or verify against new rules.
    };

    const handleRuleChange = (field: keyof ScannerRules, value: number) => {
        if (!Number.isFinite(value)) return; // never write NaN into the rules
        const [min, max] = RULE_LIMITS[field];
        setRules(prev => ({ ...prev, [field]: Math.min(max, Math.max(min, value)) }));
        setActivePreset('DEFAULT'); // Custom now
    };

    const clearSignals = () => {
        setDetectedSignals({});
    };

    const togglePause = () => {
        if (isPaused) {
            // Volume accumulated while frozen must not be attributed to a single tick after resuming
            prevDataRef.current = {};
        }
        setIsPaused(!isPaused);
    };

    const presetRow = (active: boolean) =>
        `flex h-7 w-full min-w-0 items-center gap-2 px-3 text-left text-xs transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${active
            ? 'bg-surface-highlight font-medium text-text'
            : 'bg-surface text-secondary hover:bg-surface-secondary hover:text-text'}`;
    const presetMarker = (active: boolean): React.CSSProperties | undefined =>
        active ? { boxShadow: 'inset 2px 0 0 var(--color-brand)' } : undefined;

    const subHeader = 'flex h-7 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-secondary px-3 text-[10px] font-medium uppercase tracking-wider text-muted';
    const rangeInput = 'block h-1 w-full cursor-pointer appearance-none rounded-none bg-surface-highlight accent-primary';
    const filterLabel = 'truncate text-[11px] text-secondary';
    const filterValue = 'shrink-0 font-mono text-[11px] font-medium text-text';

    return (
        <div className="flex h-full min-h-0 w-full flex-1 flex-col gap-px bg-border lg:flex-row">

            {/* Left panel: Cockpit Controls */}
            <aside className={`${showConfig ? 'flex' : 'hidden'} min-h-0 shrink-0 flex-col bg-surface lg:w-60`}>
                <header className="flex h-8 shrink-0 items-center border-b border-border px-3">
                    <h2 className="text-[11px] font-semibold uppercase tracking-wider text-secondary">Mission Control</h2>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto">
                    {/* Presets */}
                    <div className={subHeader}>Strategy Presets</div>
                    <div className="grid grid-cols-1 gap-px border-b border-border bg-border sm:grid-cols-3 lg:grid-cols-1">
                        <button
                            onClick={() => applyPreset('WHALE_ACCUMULATION')}
                            className={presetRow(activePreset === 'WHALE_ACCUMULATION')}
                            style={presetMarker(activePreset === 'WHALE_ACCUMULATION')}
                        >
                            <Activity size={13} className="shrink-0" /> Whale Accumulation
                        </button>
                        <button
                            onClick={() => applyPreset('BREAKOUT')}
                            className={presetRow(activePreset === 'BREAKOUT')}
                            style={presetMarker(activePreset === 'BREAKOUT')}
                        >
                            <Zap size={13} className="shrink-0" /> Breakout Hunter
                        </button>
                        <button
                            onClick={() => applyPreset('DIP_SNIPER')}
                            className={presetRow(activePreset === 'DIP_SNIPER')}
                            style={presetMarker(activePreset === 'DIP_SNIPER')}
                        >
                            <Crosshair size={13} className="shrink-0" /> Dip Sniper
                        </button>
                    </div>

                    {/* Custom Rules */}
                    <div className={subHeader}>
                        <span>Custom Filters</span>
                        <button
                            onClick={() => applyPreset('DEFAULT')}
                            className="rounded-sm px-1 text-[10px] font-medium normal-case tracking-normal text-primary hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                        >
                            Reset
                        </button>
                    </div>

                    <div className="grid grid-cols-2 gap-px border-b border-border bg-border md:grid-cols-4 lg:grid-cols-1">
                        {/* RVOL Slider */}
                        <div className="min-w-0 bg-surface px-3 py-2">
                            <div className="mb-2 flex items-center justify-between gap-2">
                                <span className={filterLabel}>Min RVOL</span>
                                <span className="shrink-0 font-mono text-[11px] font-medium text-primary">{rules.minRvol.toFixed(1)}x</span>
                            </div>
                            <input
                                type="range" min="0" max="20" step="0.5"
                                value={rules.minRvol}
                                onChange={(e) => handleRuleChange('minRvol', parseFloat(e.target.value))}
                                className={rangeInput}
                            />
                        </div>

                        {/* Min USDT Flow */}
                        <div className="min-w-0 bg-surface px-3 py-2">
                            <div className="mb-2 flex items-center justify-between gap-2">
                                <span className={filterLabel}>Min Hacim ({FLOW_WINDOW_LABEL}, $)</span>
                                <span className={filterValue}>${(rules.minFlowUsdt / 1000).toFixed(0)}k</span>
                            </div>
                            <input
                                type="range" min="0" max="200000" step="5000"
                                value={rules.minFlowUsdt}
                                onChange={(e) => handleRuleChange('minFlowUsdt', parseFloat(e.target.value))}
                                className={rangeInput}
                            />
                        </div>

                        {/* Pressure Range */}
                        <div className="min-w-0 bg-surface px-3 py-2">
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                                <span className={filterLabel}>Buy Pressure %</span>
                                <span className={filterValue}>{rules.minPressure}% - {rules.maxPressure}%</span>
                            </div>
                            <div className="flex gap-1">
                                <RuleNumberInput
                                    value={rules.minPressure}
                                    min={RULE_LIMITS.minPressure[0]}
                                    max={RULE_LIMITS.minPressure[1]}
                                    onCommit={(v) => handleRuleChange('minPressure', v)}
                                    placeholder="Min"
                                />
                                <RuleNumberInput
                                    value={rules.maxPressure}
                                    min={RULE_LIMITS.maxPressure[0]}
                                    max={RULE_LIMITS.maxPressure[1]}
                                    onCommit={(v) => handleRuleChange('maxPressure', v)}
                                    placeholder="Max"
                                />
                            </div>
                        </div>

                        {/* Price Change Range */}
                        <div className="min-w-0 bg-surface px-3 py-2">
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                                <span className={filterLabel}>24h Change %</span>
                                <span className={filterValue}>{rules.minPriceChange}% to {rules.maxPriceChange}%</span>
                            </div>
                            <div className="flex gap-1">
                                <RuleNumberInput
                                    value={rules.minPriceChange}
                                    min={RULE_LIMITS.minPriceChange[0]}
                                    max={RULE_LIMITS.minPriceChange[1]}
                                    onCommit={(v) => handleRuleChange('minPriceChange', v)}
                                    placeholder="Min"
                                />
                                <RuleNumberInput
                                    value={rules.maxPriceChange}
                                    min={RULE_LIMITS.maxPriceChange[0]}
                                    max={RULE_LIMITS.maxPriceChange[1]}
                                    onCommit={(v) => handleRuleChange('maxPriceChange', v)}
                                    placeholder="Max"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main panel: Scanner List */}
            <section className="flex min-h-[320px] min-w-0 flex-1 flex-col bg-surface lg:min-h-0">

                {/* Toolbar */}
                <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
                    <div className="flex min-w-0 items-center gap-2">
                        <button
                            onClick={() => setShowConfig(!showConfig)}
                            className={`-ml-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-sm transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${showConfig
                                ? 'bg-surface-highlight text-text'
                                : 'text-secondary hover:bg-surface-secondary hover:text-text'}`}
                        >
                            <Sliders size={14} />
                        </button>
                        <h2 className="truncate text-[11px] font-semibold uppercase tracking-wider text-secondary">
                            Fidelio Spot Cockpit
                        </h2>
                        <span className="shrink-0 rounded-sm bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">PRO</span>
                        <span className="hidden truncate text-[11px] text-muted xl:inline">
                            Real-time flow analysis with signal retention.
                        </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                        <span className="mr-1 hidden items-baseline gap-1.5 sm:flex">
                            <span className="font-mono text-[11px] font-medium text-text">{sortedSignals.length} Signals</span>
                            <span className="hidden text-[10px] text-muted md:inline">Active & Retained</span>
                        </span>
                        <button
                            onClick={clearSignals}
                            className="grid h-7 w-7 place-items-center rounded-sm text-secondary transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                            title="Clear List"
                        >
                            <Trash2 size={14} />
                        </button>
                        <button
                            onClick={togglePause}
                            className={`inline-flex h-7 items-center gap-1.5 rounded-sm border px-2.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${isPaused
                                ? 'border-transparent bg-warning-soft text-warning hover:opacity-80'
                                : 'border-border bg-surface-secondary text-text hover:bg-surface-highlight'}`}
                        >
                            {isPaused ? <Play size={11} fill="currentColor" /> : <Pause size={11} fill="currentColor" />}
                            {isPaused ? 'RESUME' : 'FREEZE'}
                        </button>
                    </div>
                </header>

                {/* Results Table (scrolls inside the panel on both axes) */}
                <div className="min-h-0 flex-1 overflow-auto">
                    <div className="flex min-h-full flex-col" style={{ minWidth: TABLE_MIN_WIDTH }}>
                        {/* Headers */}
                        <div
                            className="sticky top-0 z-10 grid h-7 shrink-0 items-center gap-x-3 border-b border-border bg-surface px-3 text-[10px] font-medium uppercase tracking-wider text-muted"
                            style={{ gridTemplateColumns: GRID_COLS }}
                        >
                            <div>Asset</div>
                            <div className="text-right">Price</div>
                            <div className="text-right">24h %</div>
                            <div>Momentum (Pressure)</div>
                            <div className="text-right">RVOL</div>
                            <div className="text-right">Net Akış ({FLOW_WINDOW_LABEL})</div>
                            <div />
                        </div>

                        {/* Rows */}
                        {sortedSignals.length === 0 ? (
                            <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 py-8 text-center text-xs text-muted">
                                <p className="flex items-center gap-1.5">
                                    <Settings size={14} className="shrink-0" />
                                    No signals matching your strict rules.
                                </p>
                                <p className="text-[11px]">Waiting for volume spikes...</p>
                            </div>
                        ) : (
                            sortedSignals.map(item => {
                                const symbolBase = item.symbol.replace('USDT', '');
                                const buyPct = item.pressure;
                                const sellPct = 100 - buyPct;

                                // Status
                                const isActive = item.status === 'ACTIVE';

                                // Calculate retention progress for cooldown items
                                const now = Date.now();
                                const msSinceActive = now - item.lastActiveAt;
                                const timeLeftPct = isActive ? 100 : Math.max(0, 100 - (msSinceActive / RETENTION_MS) * 100);

                                // Visual Cues
                                const isSuperHighRvol = item.rvol > 5;
                                const isBreakout = item.pressure > 75 && item.rvol > 3;
                                const isAccumulation = item.pressure > 70 && Math.abs(item.priceChangePercent) < 2;

                                const tvLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${item.symbol}`;
                                const binanceLink = `https://www.binance.com/en/trade/${symbolBase}_USDT`;

                                return (
                                    <div
                                        key={item.symbol}
                                        tabIndex={0}
                                        className={`relative grid h-7 shrink-0 items-center gap-x-3 border-b border-border px-3 text-xs outline-none focus-visible:bg-surface-secondary ${isActive
                                            ? (isBreakout ? 'bg-success-soft' : 'hover:bg-surface-secondary')
                                            : 'opacity-60 hover:opacity-80'}`}
                                        style={{ gridTemplateColumns: GRID_COLS }}
                                    >

                                        {/* Cooldown Bar */}
                                        {!isActive && (
                                            <div
                                                className="absolute bottom-0 left-0 h-0.5 bg-border-strong transition-all duration-1000"
                                                style={{ width: `${timeLeftPct}%` }}
                                            />
                                        )}

                                        {/* Asset */}
                                        <div className="flex min-w-0 items-center gap-1.5">
                                            <CoinIcon asset={symbolBase} size={16} />
                                            <span className="truncate font-medium text-text">{symbolBase}</span>
                                            {isSuperHighRvol && <Zap size={11} className="shrink-0 fill-warning text-warning" />}
                                            {isAccumulation && (
                                                <span className="shrink-0 rounded-sm bg-primary-soft px-1 text-[9px] font-semibold uppercase leading-4 text-primary">
                                                    ACC
                                                </span>
                                            )}
                                            {!isActive && <Clock size={11} className="shrink-0 text-muted" />}
                                        </div>

                                        {/* Price */}
                                        <div className="truncate text-right font-mono text-text">
                                            {item.price < 1 ? item.price.toFixed(5) : item.price.toFixed(2)}
                                        </div>

                                        {/* 24h Change */}
                                        <div className={`truncate text-right font-mono ${item.priceChangePercent >= 0 ? 'text-success' : 'text-danger'}`}>
                                            {item.priceChangePercent >= 0 ? '+' : ''}{item.priceChangePercent.toFixed(2)}%
                                        </div>

                                        {/* Pressure Meter */}
                                        <div className="flex min-w-0 items-center gap-2 font-mono text-[10px]">
                                            <span className={`w-[60px] shrink-0 whitespace-nowrap ${buyPct > 50 ? 'font-semibold text-success' : 'text-muted'}`}>{buyPct.toFixed(0)}% Buy</span>
                                            <div className="relative flex h-1.5 min-w-0 flex-1 overflow-hidden bg-surface-highlight">
                                                {/* Center Marker */}
                                                <div className="absolute bottom-0 left-1/2 top-0 z-10 w-px bg-surface"></div>
                                                <div
                                                    className="h-full bg-success transition-all duration-300"
                                                    style={{ width: `${buyPct}%`, opacity: buyPct > 50 ? 1 : 0.4 }}
                                                />
                                                <div
                                                    className="h-full bg-danger transition-all duration-300"
                                                    style={{ width: `${sellPct}%`, opacity: sellPct > 50 ? 1 : 0.4 }}
                                                />
                                            </div>
                                            <span className={`w-[60px] shrink-0 whitespace-nowrap text-right ${sellPct > 50 ? 'font-semibold text-danger' : 'text-muted'}`}>{sellPct.toFixed(0)}% Sell</span>
                                        </div>

                                        {/* RVOL */}
                                        <div className={`truncate text-right font-mono ${item.rvol > 3 ? 'font-semibold text-primary' : 'text-text'}`}>
                                            {item.rvol.toFixed(1)}x
                                        </div>

                                        {/* Net Flow */}
                                        <div className={`truncate text-right font-mono font-medium ${item.netFlow > 0 ? 'text-success' : 'text-danger'}`}>
                                            {item.netFlow > 0 ? '+' : '-'}${Math.abs(item.netFlow).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                        </div>

                                        {/* Links */}
                                        <div className="flex items-center justify-end gap-0.5">
                                            <a
                                                href={tvLink} target="_blank" rel="noopener noreferrer"
                                                className="grid h-5 w-5 place-items-center rounded-sm text-muted transition-colors hover:bg-surface-highlight hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary" title="TradingView"
                                            >
                                                <LineChart size={12} />
                                            </a>
                                            <a
                                                href={binanceLink} target="_blank" rel="noopener noreferrer"
                                                className="grid h-5 w-5 place-items-center rounded-sm text-muted transition-colors hover:bg-surface-highlight hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary" title="Binance"
                                            >
                                                <ExternalLink size={12} />
                                            </a>
                                        </div>

                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </section>
        </div>
    );
};
