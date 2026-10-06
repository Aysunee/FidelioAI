// Shared, persisted settings for the three Terminal charts (candle type, colours, grid/crosshair and the
// indicator list). One module-level store backs every chart: an edit made from any chart's settings
// panel is applied to all three immediately and saved to localStorage (debounced).
//
// Every value that enters the store goes through sanitizeChartSettings(), so consumers can rely on the
// invariants documented below (valid colours, clamped integer periods, unique ids, at most
// MAX_VISIBLE_PANES visible pane indicators, single-instance types present at most once).

import { useSyncExternalStore } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CandleType = 'candles' | 'heikinAshi' | 'line' | 'area';
export type CrosshairSetting = 'normal' | 'magnet';
export type OverlayIndicatorType = 'bb' | 'dema' | 'ema' | 'sma' | 'vwap';
export type PaneIndicatorType = 'rsi' | 'stochRsi' | 'macd' | 'volume' | 'atr' | 'obv';
export type IndicatorType = OverlayIndicatorType | PaneIndicatorType;
export type LineWidth = 1 | 2 | 3;

interface IndicatorBase {
    id: string;
    visible: boolean;
}

export interface BBConfig extends IndicatorBase {
    type: 'bb';
    period: number;
    mult: number;
    lineColor: string;
    middleColor: string;
    fillColor: string;
}

export interface DemaConfig extends IndicatorBase {
    type: 'dema';
    period: number;
    color: string;
    lineWidth: LineWidth;
}

export interface MaConfig extends IndicatorBase {
    type: 'ema' | 'sma';
    period: number;
    color: string;
    lineWidth: LineWidth;
}

export interface VwapConfig extends IndicatorBase {
    type: 'vwap';
    color: string;
    lineWidth: LineWidth;
}

export interface RsiConfig extends IndicatorBase {
    type: 'rsi';
    period: number;
    maPeriod: number;
    color: string;
    maColor: string;
    upper: number;
    lower: number;
}

export interface StochRsiConfig extends IndicatorBase {
    type: 'stochRsi';
    rsiPeriod: number;
    stochPeriod: number;
    smoothK: number;
    smoothD: number;
    kColor: string;
    dColor: string;
    upper: number;
    lower: number;
}

export interface MacdConfig extends IndicatorBase {
    type: 'macd';
    fast: number;
    slow: number;
    signal: number;
    macdColor: string;
    signalColor: string;
    histUpColor: string;
    histDownColor: string;
}

/** Volume histogram in its own pane (bars coloured by candle direction with the candle colours) + volume SMA; maPeriod 0 = no MA. */
export interface VolumePaneConfig extends IndicatorBase {
    type: 'volume';
    maPeriod: number;
    maColor: string;
}

export interface AtrConfig extends IndicatorBase {
    type: 'atr';
    period: number;
    color: string;
}

/** maPeriod 0 = no MA. */
export interface ObvConfig extends IndicatorBase {
    type: 'obv';
    color: string;
    maPeriod: number;
    maColor: string;
}

export type IndicatorConfig =
    | BBConfig
    | DemaConfig
    | MaConfig
    | VwapConfig
    | RsiConfig
    | StochRsiConfig
    | MacdConfig
    | VolumePaneConfig
    | AtrConfig
    | ObvConfig;

export interface ChartSettings {
    version: 1;
    candleType: CandleType;
    upColor: string | null; // null = theme default (chartTheme palette)
    downColor: string | null; // null = theme default
    gridVertical: boolean;
    gridHorizontal: boolean;
    crosshair: CrosshairSetting;
    showVolumeOverlay: boolean; // volume histogram at the bottom of the price pane
    indicators: IndicatorConfig[]; // array order = legend order; pane indicators get panes in this order (pane 1, 2, ...)
}

// ---------------------------------------------------------------------------
// Constants & labels
// ---------------------------------------------------------------------------

export const OVERLAY_TYPES: readonly OverlayIndicatorType[] = Object.freeze(['bb', 'dema', 'ema', 'sma', 'vwap'] as const);
export const PANE_TYPES: readonly PaneIndicatorType[] = Object.freeze(['rsi', 'stochRsi', 'macd', 'volume', 'atr', 'obv'] as const);

const CANDLE_TYPES: readonly CandleType[] = ['candles', 'heikinAshi', 'line', 'area'];
const CROSSHAIR_SETTINGS: readonly CrosshairSetting[] = ['normal', 'magnet'];
const ALL_TYPES: readonly IndicatorType[] = [...OVERLAY_TYPES, ...PANE_TYPES];

/** Visible pane indicators beyond this are rejected by the UI (and hidden by sanitizeChartSettings). */
export const MAX_VISIBLE_PANES = 4;

/** Upper bound on the indicator list length. */
export const MAX_INDICATORS = 30;

/** EMA and SMA can be added several times, up to this many instances each. */
export const MAX_MA_INSTANCES = 8;

/** Types that can be present at most once. */
export const SINGLE_INSTANCE_TYPES: readonly IndicatorType[] = Object.freeze([
    'bb',
    'dema',
    'vwap',
    'rsi',
    'stochRsi',
    'macd',
    'volume',
    'atr',
    'obv',
] as const);

const PANE_TYPE_SET: ReadonlySet<string> = new Set<string>(PANE_TYPES);
const SINGLE_TYPE_SET: ReadonlySet<string> = new Set<string>(SINGLE_INSTANCE_TYPES);
const TYPE_SET: ReadonlySet<string> = new Set<string>(ALL_TYPES);

export const isPaneIndicator = (cfg: IndicatorConfig): boolean => PANE_TYPE_SET.has(cfg.type);

export const INDICATOR_LABELS: Record<IndicatorType, string> = Object.freeze({
    bb: 'Bollinger Bantları',
    dema: 'DEMA',
    ema: 'EMA',
    sma: 'SMA',
    vwap: 'VWAP',
    rsi: 'RSI',
    stochRsi: 'Stochastic RSI',
    macd: 'MACD',
    volume: 'Hacim',
    atr: 'ATR',
    obv: 'OBV',
});

const formatParam = (n: number): string => String(Number(n.toFixed(2)));

/** Legend text with parameters, e.g. 'EMA 50', 'BB 20 2', 'MACD 12 26 9'. */
export const indicatorShortLabel = (cfg: IndicatorConfig): string => {
    switch (cfg.type) {
        case 'bb':
            return `BB ${formatParam(cfg.period)} ${formatParam(cfg.mult)}`;
        case 'dema':
            return `DEMA ${formatParam(cfg.period)}`;
        case 'ema':
            return `EMA ${formatParam(cfg.period)}`;
        case 'sma':
            return `SMA ${formatParam(cfg.period)}`;
        case 'vwap':
            return 'VWAP';
        case 'rsi':
            return `RSI ${formatParam(cfg.period)}`;
        case 'stochRsi':
            return `Stoch RSI ${formatParam(cfg.rsiPeriod)} ${formatParam(cfg.stochPeriod)} ${formatParam(cfg.smoothK)} ${formatParam(cfg.smoothD)}`;
        case 'macd':
            return `MACD ${formatParam(cfg.fast)} ${formatParam(cfg.slow)} ${formatParam(cfg.signal)}`;
        case 'volume':
            return 'Hacim';
        case 'atr':
            return `ATR ${formatParam(cfg.period)}`;
        case 'obv':
            return 'OBV';
        default:
            return INDICATOR_LABELS[(cfg as IndicatorConfig).type] ?? '';
    }
};

/** Number of visible pane indicators (each one gets its own pane below the price pane). */
export const countVisiblePanes = (indicators: readonly IndicatorConfig[]): number =>
    indicators.reduce((n, cfg) => (cfg.visible && isPaneIndicator(cfg) ? n + 1 : n), 0);

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_COLOR_RE = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/i;

/** '#rgb' / '#rrggbb' / '#rrggbbaa' or 'rgb(r, g, b)' / 'rgba(r, g, b, a)' with channels 0..255 and alpha 0..1. */
export const isValidColor = (value: unknown): value is string => {
    if (typeof value !== 'string' || value.length > 64) return false;
    if (HEX_COLOR_RE.test(value)) return true;
    const m = RGB_COLOR_RE.exec(value);
    if (!m) return false;
    if (Number(m[1]) > 255 || Number(m[2]) > 255 || Number(m[3]) > 255) return false;
    return m[4] === undefined || Number(m[4]) <= 1;
};

// Default colours = the chartTheme.ts dark palette (what the charts looked like before settings existed).
const C = {
    bbLine: 'rgba(59, 130, 246, 0.75)',
    bbMiddle: '#3b82f6',
    bbFill: 'rgba(59, 130, 246, 0.10)',
    dema: '#ec4899',
    rsi: '#a78bfa',
    rsiMa: '#facc15',
    stochK: '#3b82f6',
    stochD: '#f97316',
    vwap: '#f59e0b',
    macd: '#3b82f6',
    macdSignal: '#f97316',
    histUp: 'rgba(34, 197, 94, 0.55)',
    histDown: 'rgba(239, 68, 68, 0.55)',
    volumeMa: '#3b82f6',
    atr: '#f43f5e',
    obv: '#3b82f6',
    obvMa: '#facc15',
} as const;

/** Colours handed out to new EMA / SMA lines (first one not used by any indicator yet). */
const MA_PALETTE: readonly string[] = [
    '#06b6d4',
    '#a855f7',
    '#84cc16',
    '#f97316',
    '#10b981',
    '#6366f1',
    '#d946ef',
    '#eab308',
    '#0ea5e9',
    '#f43f5e',
    '#14b8a6',
    '#fb7185',
];

const MA_PERIOD_CHOICES: readonly number[] = [20, 50, 100, 200];

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const defaultIndicator = (type: IndicatorType, id: string): IndicatorConfig => {
    switch (type) {
        case 'bb':
            return { id, type, visible: true, period: 20, mult: 2, lineColor: C.bbLine, middleColor: C.bbMiddle, fillColor: C.bbFill };
        case 'dema':
            return { id, type, visible: true, period: 20, color: C.dema, lineWidth: 2 };
        case 'ema':
        case 'sma':
            return { id, type, visible: true, period: 20, color: MA_PALETTE[0], lineWidth: 1 };
        case 'vwap':
            return { id, type, visible: true, color: C.vwap, lineWidth: 2 };
        case 'rsi':
            return { id, type, visible: true, period: 14, maPeriod: 14, color: C.rsi, maColor: C.rsiMa, upper: 70, lower: 30 };
        case 'stochRsi':
            return {
                id,
                type,
                visible: true,
                rsiPeriod: 14,
                stochPeriod: 14,
                smoothK: 3,
                smoothD: 3,
                kColor: C.stochK,
                dColor: C.stochD,
                upper: 80,
                lower: 20,
            };
        case 'macd':
            return {
                id,
                type,
                visible: true,
                fast: 12,
                slow: 26,
                signal: 9,
                macdColor: C.macd,
                signalColor: C.macdSignal,
                histUpColor: C.histUp,
                histDownColor: C.histDown,
            };
        case 'volume':
            return { id, type, visible: true, maPeriod: 20, maColor: C.volumeMa };
        case 'atr':
            return { id, type, visible: true, period: 14, color: C.atr };
        case 'obv':
            return { id, type, visible: true, color: C.obv, maPeriod: 0, maColor: C.obvMa };
        default:
            throw new TypeError(`Unknown indicator type: ${String(type)}`);
    }
};

const deepFreeze = <T>(value: T): T => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
    }
    return value;
};

/** Today's look: candles, theme colours, both grids, free crosshair, overlay volume, BB 20/2 + DEMA 20 + RSI 14 + Stoch RSI. Frozen. */
export const DEFAULT_CHART_SETTINGS: ChartSettings = deepFreeze<ChartSettings>({
    version: 1,
    candleType: 'candles',
    upColor: null,
    downColor: null,
    gridVertical: true,
    gridHorizontal: true,
    crosshair: 'normal',
    showVolumeOverlay: true,
    indicators: [
        defaultIndicator('bb', 'bb'),
        defaultIndicator('dema', 'dema'),
        defaultIndicator('rsi', 'rsi'),
        defaultIndicator('stochRsi', 'stochRsi'),
    ],
});

// ---------------------------------------------------------------------------
// Ids & createIndicator
// ---------------------------------------------------------------------------

const randomSuffix = (): string => Math.random().toString(36).slice(2, 8).padEnd(6, '0');

const generateId = (type: string, used: ReadonlySet<string>): string => {
    for (;;) {
        const id = `${type}-${randomSuffix()}`;
        if (!used.has(id)) return id;
    }
};

const collectColors = (indicators: readonly IndicatorConfig[]): Set<string> => {
    const colors = new Set<string>();
    for (const cfg of indicators) {
        for (const [key, v] of Object.entries(cfg)) {
            if (key !== 'id' && key !== 'type' && typeof v === 'string') colors.add(v.trim().toLowerCase());
        }
    }
    return colors;
};

/** A new indicator with sensible defaults and an id unique within `existing`. */
export function createIndicator(type: IndicatorType, existing: IndicatorConfig[]): IndicatorConfig {
    const list = Array.isArray(existing) ? existing.filter((c) => c && typeof c === 'object') : [];
    const used = new Set(list.map((c) => c.id));
    const cfg = defaultIndicator(type, generateId(type, used));

    if (cfg.type === 'ema' || cfg.type === 'sma') {
        const sameType = list.filter((c) => c.type === type) as MaConfig[];
        const usedPeriods = new Set(sameType.map((c) => c.period));
        let period = MA_PERIOD_CHOICES.find((p) => !usedPeriods.has(p));
        if (period === undefined) {
            period = 20;
            for (let p = 10; p <= 500; p += 10) {
                if (!usedPeriods.has(p)) {
                    period = p;
                    break;
                }
            }
        }
        const usedColors = collectColors(list);
        const color = MA_PALETTE.find((c) => !usedColors.has(c)) ?? MA_PALETTE[sameType.length % MA_PALETTE.length];
        return { ...cfg, period, color };
    }
    return cfg;
}

// ---------------------------------------------------------------------------
// Sanitizing
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>;

const isRecord = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

const toNumber = (v: unknown): number | null => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    return null;
};

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
    const n = toNumber(v);
    if (n === null) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
};

const clampFloat = (v: unknown, min: number, max: number, fallback: number): number => {
    const n = toNumber(v);
    if (n === null) return fallback;
    return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
};

const period = (v: unknown, fallback: number): number => clampInt(v, 1, 500, fallback);
const optionalPeriod = (v: unknown, fallback: number): number => clampInt(v, 0, 500, fallback); // 0 = off

const color = (v: unknown, fallback: string): string => {
    const s = typeof v === 'string' ? v.trim() : v;
    return isValidColor(s) ? s : fallback;
};

const nullableColor = (v: unknown): string | null => {
    const s = typeof v === 'string' ? v.trim() : v;
    return isValidColor(s) ? s : null;
};

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

const lineWidth = (v: unknown, fallback: LineWidth): LineWidth => (v === 1 || v === 2 || v === 3 ? v : fallback);

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

/** Levels in 0..100 with lower < upper; an inverted / equal pair falls back to the defaults. */
const levels = (rawUpper: unknown, rawLower: unknown, defUpper: number, defLower: number): { upper: number; lower: number } => {
    const upper = clampFloat(rawUpper, 0, 100, defUpper);
    const lower = clampFloat(rawLower, 0, 100, defLower);
    return lower < upper ? { upper, lower } : { upper: defUpper, lower: defLower };
};

/** Validates one indicator against its type's defaults. Returns null for unknown types. The id is checked by the caller. */
const sanitizeIndicator = (raw: unknown): IndicatorConfig | null => {
    if (!isRecord(raw) || typeof raw.type !== 'string' || !TYPE_SET.has(raw.type)) return null;
    const type = raw.type as IndicatorType;
    const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 64) : '';
    const d = defaultIndicator(type, id);
    const visible = bool(raw.visible, true);

    switch (d.type) {
        case 'bb':
            return {
                id,
                type: d.type,
                visible,
                period: period(raw.period, d.period),
                mult: clampFloat(raw.mult, 0.1, 10, d.mult),
                lineColor: color(raw.lineColor, d.lineColor),
                middleColor: color(raw.middleColor, d.middleColor),
                fillColor: color(raw.fillColor, d.fillColor),
            };
        case 'dema':
            return {
                id,
                type: d.type,
                visible,
                period: period(raw.period, d.period),
                color: color(raw.color, d.color),
                lineWidth: lineWidth(raw.lineWidth, d.lineWidth),
            };
        case 'ema':
        case 'sma':
            return {
                id,
                type: d.type,
                visible,
                period: period(raw.period, d.period),
                color: color(raw.color, d.color),
                lineWidth: lineWidth(raw.lineWidth, d.lineWidth),
            };
        case 'vwap':
            return { id, type: d.type, visible, color: color(raw.color, d.color), lineWidth: lineWidth(raw.lineWidth, d.lineWidth) };
        case 'rsi':
            return {
                id,
                type: d.type,
                visible,
                period: period(raw.period, d.period),
                maPeriod: period(raw.maPeriod, d.maPeriod),
                color: color(raw.color, d.color),
                maColor: color(raw.maColor, d.maColor),
                ...levels(raw.upper, raw.lower, d.upper, d.lower),
            };
        case 'stochRsi':
            return {
                id,
                type: d.type,
                visible,
                rsiPeriod: period(raw.rsiPeriod, d.rsiPeriod),
                stochPeriod: period(raw.stochPeriod, d.stochPeriod),
                smoothK: period(raw.smoothK, d.smoothK),
                smoothD: period(raw.smoothD, d.smoothD),
                kColor: color(raw.kColor, d.kColor),
                dColor: color(raw.dColor, d.dColor),
                ...levels(raw.upper, raw.lower, d.upper, d.lower),
            };
        case 'macd': {
            let fast = period(raw.fast, d.fast);
            let slow = period(raw.slow, d.slow);
            if (fast >= slow) {
                fast = d.fast;
                slow = d.slow;
            }
            return {
                id,
                type: d.type,
                visible,
                fast,
                slow,
                signal: period(raw.signal, d.signal),
                macdColor: color(raw.macdColor, d.macdColor),
                signalColor: color(raw.signalColor, d.signalColor),
                histUpColor: color(raw.histUpColor, d.histUpColor),
                histDownColor: color(raw.histDownColor, d.histDownColor),
            };
        }
        case 'volume':
            return { id, type: d.type, visible, maPeriod: optionalPeriod(raw.maPeriod, d.maPeriod), maColor: color(raw.maColor, d.maColor) };
        case 'atr':
            return { id, type: d.type, visible, period: period(raw.period, d.period), color: color(raw.color, d.color) };
        case 'obv':
            return {
                id,
                type: d.type,
                visible,
                color: color(raw.color, d.color),
                maPeriod: optionalPeriod(raw.maPeriod, d.maPeriod),
                maColor: color(raw.maColor, d.maColor),
            };
        default:
            return null;
    }
};

const cloneIndicators = (list: readonly IndicatorConfig[]): IndicatorConfig[] => list.map((c) => ({ ...c }));

/**
 * Validation & migration for anything read from storage or produced by an updater:
 * unknown / missing fields -> defaults; periods -> integers 1..500 (MA periods of Hacim / OBV 0..500, 0 = off);
 * mult 0.1..10; levels 0..100 with lower < upper; MACD fast < slow; invalid colours -> default;
 * unknown indicator types dropped; single-instance types kept once; EMA / SMA at most MAX_MA_INSTANCES each;
 * at most MAX_INDICATORS indicators; missing / duplicate ids regenerated; visible pane indicators beyond
 * MAX_VISIBLE_PANES hidden. A missing (non-array) `indicators` field restores the default indicator set.
 */
export function sanitizeChartSettings(raw: unknown): ChartSettings {
    const r: Raw = isRecord(raw) ? raw : {};
    const d = DEFAULT_CHART_SETTINGS;

    let indicators: IndicatorConfig[];
    if (Array.isArray(r.indicators)) {
        indicators = [];
        const usedIds = new Set<string>();
        const typeCounts = new Map<string, number>();
        let visiblePanes = 0;
        for (const item of r.indicators) {
            if (indicators.length >= MAX_INDICATORS) break;
            const cfg = sanitizeIndicator(item);
            if (!cfg) continue;
            const count = typeCounts.get(cfg.type) ?? 0;
            if (SINGLE_TYPE_SET.has(cfg.type) ? count >= 1 : count >= MAX_MA_INSTANCES) continue;
            typeCounts.set(cfg.type, count + 1);
            if (!cfg.id || usedIds.has(cfg.id)) cfg.id = generateId(cfg.type, usedIds);
            usedIds.add(cfg.id);
            if (cfg.visible && isPaneIndicator(cfg)) {
                if (visiblePanes >= MAX_VISIBLE_PANES) cfg.visible = false;
                else visiblePanes++;
            }
            indicators.push(cfg);
        }
    } else {
        indicators = cloneIndicators(d.indicators);
    }

    return {
        version: 1,
        candleType: pick(r.candleType, CANDLE_TYPES, d.candleType),
        upColor: nullableColor(r.upColor),
        downColor: nullableColor(r.downColor),
        gridVertical: bool(r.gridVertical, d.gridVertical),
        gridHorizontal: bool(r.gridHorizontal, d.gridHorizontal),
        crosshair: pick(r.crosshair, CROSSHAIR_SETTINGS, d.crosshair),
        showVolumeOverlay: bool(r.showVolumeOverlay, d.showVolumeOverlay),
        indicators,
    };
}

// ---------------------------------------------------------------------------
// Store (module level, shared by every chart and every settings panel)
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'fidelio_terminal_chart_settings_v1';
const PERSIST_DELAY_MS = 150;

let current: ChartSettings | null = null;
let currentJson = '';
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let windowListenersAttached = false;
const listeners = new Set<() => void>();

const hasWindow = (): boolean => typeof window !== 'undefined';

const getStorage = (): Storage | null => {
    try {
        return hasWindow() && window.localStorage ? window.localStorage : null;
    } catch {
        return null; // access can throw (blocked site data)
    }
};

const readStored = (): ChartSettings => {
    try {
        const raw = getStorage()?.getItem(STORAGE_KEY);
        if (raw) return sanitizeChartSettings(JSON.parse(raw));
    } catch {
        /* corrupt JSON / blocked storage -> defaults */
    }
    return sanitizeChartSettings(DEFAULT_CHART_SETTINGS);
};

const emit = (): void => {
    for (const listener of Array.from(listeners)) listener();
};

const flushPersist = (): void => {
    if (persistTimer !== null) {
        clearTimeout(persistTimer);
        persistTimer = null;
    }
    if (!current) return;
    try {
        getStorage()?.setItem(STORAGE_KEY, currentJson);
    } catch {
        /* quota / private mode: keep working in memory */
    }
};

const schedulePersist = (): void => {
    if (!hasWindow()) return;
    if (persistTimer !== null) clearTimeout(persistTimer);
    persistTimer = setTimeout(flushPersist, PERSIST_DELAY_MS);
};

const onStorage = (e: StorageEvent): void => {
    if (e.key !== null && e.key !== STORAGE_KEY) return;
    // sessionStorage events (e.g. sessionStorage.clear() in a same-origin frame, key === null) are not ours.
    const local = getStorage();
    if (e.storageArea && local && e.storageArea !== local) return;
    let next: ChartSettings;
    if (e.key === null || e.newValue === null) {
        next = sanitizeChartSettings(DEFAULT_CHART_SETTINGS); // cleared / removed in another tab
    } else {
        try {
            next = sanitizeChartSettings(JSON.parse(e.newValue));
        } catch {
            return;
        }
    }
    const json = JSON.stringify(next);
    if (json === currentJson) return;
    // The other tab's state is newer: drop our pending (now stale) write.
    if (persistTimer !== null) {
        clearTimeout(persistTimer);
        persistTimer = null;
    }
    current = next;
    currentJson = json;
    emit();
};

const onPageHide = (): void => {
    if (persistTimer !== null) flushPersist();
};

const onVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') onPageHide();
};

const attachWindowListeners = (): void => {
    if (windowListenersAttached || !hasWindow() || typeof window.addEventListener !== 'function') return;
    windowListenersAttached = true;
    window.addEventListener('storage', onStorage);
    window.addEventListener('pagehide', onPageHide);
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', onVisibilityChange);
    }
};

const ensureStore = (): ChartSettings => {
    if (current) return current;
    current = hasWindow() ? readStored() : sanitizeChartSettings(DEFAULT_CHART_SETTINGS);
    currentJson = JSON.stringify(current);
    attachWindowListeners();
    return current;
};

/** Current settings (stable reference until the next effective change). */
export function getChartSettings(): ChartSettings {
    return ensureStore();
}

/** Imperative subscription (e.g. for chart code outside React state). Returns the unsubscribe function. */
export function subscribeChartSettings(listener: () => void): () => void {
    ensureStore();
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

const getServerSnapshot = (): ChartSettings => DEFAULT_CHART_SETTINGS;

/** The shared settings of all Terminal charts; re-renders on every effective change (any chart, any tab). */
export function useChartSettings(): ChartSettings {
    return useSyncExternalStore(subscribeChartSettings, getChartSettings, getServerSnapshot);
}

/**
 * Applies `updater` to the current settings. The result is sanitized, the in-memory store and its
 * subscribers update immediately, and localStorage is written after a short debounce (colour / slider drags).
 * No-op when the sanitized result equals the current settings.
 */
export function updateChartSettings(updater: (prev: ChartSettings) => ChartSettings): void {
    const prev = ensureStore();
    const next = sanitizeChartSettings(updater(prev));
    const json = JSON.stringify(next);
    if (json === currentJson) return; // compared with the serialized snapshot, so in-place mutation of prev is still detected
    current = next;
    currentJson = json;
    schedulePersist();
    emit();
}

/** Restores DEFAULT_CHART_SETTINGS on every chart (and persists it). */
export function resetChartSettings(): void {
    updateChartSettings(() => DEFAULT_CHART_SETTINGS);
}
