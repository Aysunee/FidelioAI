import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo, ReactNode } from 'react';
import { io } from 'socket.io-client';
import { Signal, Side, NotificationRule, ToastMessage, PriceAlert, Ticker, FuturesTicker, BigMoveSignal } from '../types';
import { useMarketData } from './MarketContext';
import { useUser } from './UserContext';
import { notificationManager, notifyBigMove, notifySignal, notifyPriceAlert } from '../utils/notifications';
import { patternScanner, DetectedPattern } from '../services/patternScanner';
import { getCryptoPerpSymbols, getCryptoPerpSymbolsSync } from '../services/marketData';
import { SOCKET_URL, ApiError, apiJson } from '../utils/config';
import { readScoped, writeScoped } from '../utils/userStorage';
import { getEngineStatus, putEngineSettings, type EngineStatus } from '../utils/engineApi';
import { mergeSignalOutcome, normalizeSignalOutcome } from '../utils/scorecardApi';
import {
    DEFAULT_SIGNAL_SETTINGS,
    EMPTY_ENGINE_STATS,
    MARKET_SYMBOL,
    MARKET_WIDE_STRATEGY_LABELS,
    SIGNAL_SETTINGS_VERSION,
    STRATEGY_FUNDING_REGIME_NEG,
    STRATEGY_MOMENTUM_DOWN,
    STRATEGY_MOMENTUM_UP,
    isMarketWideEndStrategy,
    isMarketWideStrategy,
    moveDirectionLabel,
    sanitizeSignalSettings,
    selectSpotUniverse,
    stepExtremeTrack,
    type EngineStat,
    type EngineStats,
    type ExtremeTrack,
    type FundingRegimeEntry,
    type SignalSettings
} from '../utils/signalEngines';

// Settings schema (version 2), its bounds and the live counter types live next to the engines.
export { DEFAULT_SIGNAL_SETTINGS, SIGNAL_SETTINGS_LIMITS } from '../utils/signalEngines';
export type { SignalSettings, EngineStat, EngineStats, FundingRegimeEntry } from '../utils/signalEngines';
export type { EngineStatus } from '../utils/engineApi';

type Priority = 'LOW' | 'MEDIUM' | 'HIGH';

interface NotificationSettings {
    soundEnabled: boolean;
    browserNotificationsEnabled: boolean;
    notifyOnBigMoves: boolean;
    notifyOnSignals: boolean;
    notifyOnPriceAlerts: boolean;
    minPriorityLevel: Priority;
    telegramBotToken?: string;
    telegramChatId?: string;
}

// A price alert as stored for the user; triggered alerts stay in the list (isActive: false).
export type StoredPriceAlert = PriceAlert & { triggeredAt?: number; triggeredPrice?: number };

interface SignalContextType {
    signals: Signal[];
    setSignals: React.Dispatch<React.SetStateAction<Signal[]>>;
    rules: NotificationRule[];
    setRules: React.Dispatch<React.SetStateAction<NotificationRule[]>>;
    priceAlerts: StoredPriceAlert[];
    setPriceAlerts: React.Dispatch<React.SetStateAction<StoredPriceAlert[]>>;
    removePriceAlert: (id: string) => void;
    toasts: ToastMessage[];
    addToast: (title: string, description: string, type?: ToastMessage['type']) => void;
    dismissToast: (id: string) => void;
    handleDeleteSignal: (id: string) => void;
    handleClearAllSignals: () => void;
    handleManualSignal: (signal: Signal) => void;
    alertModal: { isOpen: boolean; symbol: string | null };
    openAlertModal: (symbol: string) => void;
    closeAlertModal: () => void;
    handleCreateAlert: (price: number, condition: 'ABOVE' | 'BELOW') => void;
    // Global settings of the server signal engine (GET /api/engine/status), the same for every user.
    signalSettings: SignalSettings;
    // Admin only: PUT /api/engine/settings. Resolves to true when the server accepted the settings.
    updateSignalSettings: (settings: SignalSettings) => Promise<boolean>;
    // "Right now N of M symbols are beyond this threshold", per engine, as reported by the server.
    engineStats: EngineStats;
    // Perps that are inside the negative funding gate right now (including the ones found when the
    // engine started, which are never emitted as signals).
    fundingRegimeActive: FundingRegimeEntry[];
    // Last status of the server engine (null until the first successful request), polled every 15 s
    // while the tab is visible.
    engineStatus: EngineStatus | null;
    // Message of the last failed status request (null after a success) and when the status was received.
    engineStatusError: string | null;
    engineStatusAt: number;
    bigMoves: BigMoveSignal[];
    futuresBigMoves: BigMoveSignal[];
    notificationSettings: NotificationSettings;
    updateNotificationSettings: (settings: Partial<NotificationSettings>) => void;
    requestNotificationPermission: () => Promise<boolean>;
    patterns: DetectedPattern[];
}

const SignalContext = createContext<SignalContextType | undefined>(undefined);

// ---------------------------------------------------------------------------
// Signal policy: the three signal engines (momentum, volume, funding) run on the server, 24/7 in
// one place. Their records are stored in MySQL and arrive here like every shared signal: GET
// /api/signals history + socket.io 'new_signal'. TradingView (/api/webhook) and an admin's manual
// injection (POST /api/signals) are the other shared sources. Nothing algorithmic runs in this
// browser except the live big-move views and the pattern scanner.
// ---------------------------------------------------------------------------

// Per-user storage keys (scoped by user id through utils/userStorage)
const RULES_KEY = 'fidelio_rules';
const NOTIFICATION_SETTINGS_KEY = 'fidelio_notification_settings';
const PRICE_ALERTS_KEY = 'fidelio_price_alerts';
const SIGNAL_VIEW_KEY = 'fidelio_signal_view';

const MAX_SERVER_SIGNALS = 200;
const MAX_ENGINE_SIGNALS = 200;
const LOCAL_ID_PREFIX = 'local_';
const TELEGRAM_MAX_PER_MINUTE = 20;

// Server engine status: polled while the tab is visible (paused when hidden, refreshed on return).
const ENGINE_STATUS_POLL_MS = 15000;
// Signal history (with the outcomes measured since) is fetched again this often while the tab is visible;
// outcomes resolved by another server process only reach this browser this way.
const HISTORY_REFRESH_MS = 5 * 60 * 1000;
const HISTORY_REFRESH_CHECK_MS = 60 * 1000;
const FUTURES_META_POLL_MS = 60000;        // cached for an hour inside the service; this only retries failures
// Futures rows older than this are not evaluated (stream down or the tab just woke up).
const FUTURES_FRESH_MS = 90000;
// A pause this long between two scans re-seeds the big-move state instead of reporting a burst.
const BIG_MOVE_MAX_GAP_MS = 5 * 60 * 1000;

const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
    soundEnabled: false, // Default: Sound alerts OFF
    browserNotificationsEnabled: false,
    notifyOnBigMoves: true,
    notifyOnSignals: true,
    notifyOnPriceAlerts: true,
    minPriorityLevel: 'MEDIUM'
};

interface SignalViewState {
    // Non-admin "clear": server signals at or before this time are hidden for this user only.
    clearedAt: number;
    hiddenIds: string[];
}

const DEFAULT_SIGNAL_VIEW: SignalViewState = { clearedAt: 0, hiddenIds: [] };

// Honest display names. 'RMI_*' and 'SmartMoney_Divergence' are the keys of the previous engine
// versions; they are no longer produced and stay here only so that stored history remains readable
// (no RMI was ever computed: those were 24h price-change thresholds).
const STRATEGY_LABELS: Record<string, string> = {
    [STRATEGY_MOMENTUM_UP]: '24s Momentum (yükseliş)',
    [STRATEGY_MOMENTUM_DOWN]: '24s Momentum (düşüş)',
    [STRATEGY_FUNDING_REGIME_NEG]: 'Negatif Fonlama Rejimi',
    // Market-wide aggregates of the burst guard: 'Piyasa geneli düşüş · 24s momentum',
    // 'Piyasa geneli hacim artışı · düşüşte', 'Piyasa geneli hacim artışı', '… · bitti'
    ...MARKET_WIDE_STRATEGY_LABELS,
    RMI_Overbought: '24s Momentum (yükseliş, eski kural)',
    RMI_Oversold: '24s Momentum (düşüş, eski kural)',
    SmartMoney_Divergence: 'Fonlama Uyumsuzluğu (eski kural)'
};

export const getStrategyLabel = (strategy: string): string => {
    if (!strategy) return '';
    if (STRATEGY_LABELS[strategy]) return STRATEGY_LABELS[strategy];
    const volume = /^Volume_Spike_([\d.]+)x$/.exec(strategy);
    if (volume) return `Hacim Sıçraması ${volume[1]}x`;
    return strategy;
};

const PRIORITY_RANK: Record<Priority, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
const meetsMinPriority = (priority: Priority, min: Priority) => PRIORITY_RANK[priority] >= PRIORITY_RANK[min];

// Market-wide aggregate of the burst guard: symbol MARKET (not a tradable pair, price 0), produced by the
// momentum or volume engine instead of dozens of single records when the whole market moves.
const isMarketAggregate = (signal: Pick<Signal, 'symbol' | 'strategy' | 'engine' | 'source'>) =>
    signal.symbol === MARKET_SYMBOL
    && isMarketWideStrategy(signal.strategy)
    && (signal.engine === 'MOMENTUM' || signal.engine === 'VOLUME' || signal.source === 'ALGO_MOMENTUM' || signal.source === 'ALGO_VOLUME');

// Shared (webhook / manual) signals are the primary product and count as HIGH. Engine records are
// descriptive events: momentum and funding LOW, volume MEDIUM. No engine record is HIGH. A market-wide
// aggregate is MEDIUM (one notification per market event instead of dozens), its closing record LOW.
// Same rules as the server's Telegram (engine/notify.ts signalPriority).
export const getSignalPriority = (signal: Signal): Priority => {
    if (isMarketAggregate(signal)) return isMarketWideEndStrategy(signal.strategy) ? 'LOW' : 'MEDIUM';
    switch (signal.engine) {
        case 'MOMENTUM': return 'LOW';
        case 'VOLUME': return 'MEDIUM';
        case 'FUNDING': return 'LOW';
        default: break;
    }
    switch (signal.source) {
        case 'ALGO_MOMENTUM': return 'LOW';
        case 'ALGO_VOLUME': return 'MEDIUM';
        case 'ALGO_DIVERGENCE': return 'LOW';
        default: return 'HIGH';
    }
};

// Records of the signal engines: their side is the direction of the measured move, not advice.
const isEngineSignal = (signal: Pick<Signal, 'engine'>) =>
    signal.engine === 'MOMENTUM' || signal.engine === 'VOLUME' || signal.engine === 'FUNDING';

// Engine records, including stored rows of the old engine versions (source only, no engine field).
const isAlgoRecord = (signal: Signal) =>
    isEngineSignal(signal) || (typeof signal.source === 'string' && signal.source.startsWith('ALGO_'));

// Momentum / volume engine records (also stored rows with an ALGO_* source only) are watch alerts.
const isWatchAlertRecord = (signal: Signal) =>
    signal.engine === 'MOMENTUM' || signal.engine === 'VOLUME'
    || (!signal.engine && (signal.source === 'ALGO_MOMENTUM' || signal.source === 'ALGO_VOLUME'));

// "BTCUSDT BUY" for shared signals; "BTCUSDT · hareket yönü yukarı" / "BTCUSDT · yönsüz" for engine records;
// "Piyasa geneli · hareket yönü aşağı" for a market-wide aggregate.
const signalHeadline = (signal: Signal): string => {
    if (isEngineSignal(signal)) {
        const name = signal.symbol === MARKET_SYMBOL ? 'Piyasa geneli' : signal.symbol;
        return `${name} · ${signal.side === 'NEUTRAL' ? 'yönsüz' : `hareket yönü ${moveDirectionLabel(signal.side)}`}`;
    }
    return `${signal.symbol} ${signal.side === 'NEUTRAL' ? 'Yönsüz' : signal.side}`;
};

// Strategy label plus the measured size ("24s Momentum (yükseliş) +9.1%"). The volume label already
// carries its ratio; a market-wide aggregate adds its coin count ("Piyasa geneli hacim artışı · düşüşte · 12 coin").
const signalSummary = (signal: Signal): string => {
    const label = getStrategyLabel(signal.strategy);
    if (signal.magnitude && isMarketAggregate(signal)) return `${label} · ${signal.magnitude.text}`;
    return signal.magnitude && signal.engine !== 'VOLUME' ? `${label} ${signal.magnitude.text}` : label;
};

// --- Safe parsing / schema merge helpers ---
const isRecord = (value: unknown): value is Record<string, any> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const toNumber = (value: unknown, fallback: number, min = -Infinity, max = Infinity) => {
    // null / '' / booleans would coerce to 0 or 1 (an old NaN setting is stored as null): use the default instead
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return fallback;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

const toBool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

const sanitizeNotificationSettings = (raw: unknown): NotificationSettings => {
    const r = isRecord(raw) ? raw : {};
    const d = DEFAULT_NOTIFICATION_SETTINGS;
    const level = r.minPriorityLevel;
    return {
        soundEnabled: toBool(r.soundEnabled, d.soundEnabled),
        browserNotificationsEnabled: toBool(r.browserNotificationsEnabled, d.browserNotificationsEnabled),
        notifyOnBigMoves: toBool(r.notifyOnBigMoves, d.notifyOnBigMoves),
        notifyOnSignals: toBool(r.notifyOnSignals, d.notifyOnSignals),
        notifyOnPriceAlerts: toBool(r.notifyOnPriceAlerts, d.notifyOnPriceAlerts),
        minPriorityLevel: level === 'LOW' || level === 'MEDIUM' || level === 'HIGH' ? level : d.minPriorityLevel,
        telegramBotToken: typeof r.telegramBotToken === 'string' ? r.telegramBotToken : undefined,
        telegramChatId: typeof r.telegramChatId === 'string' ? r.telegramChatId : undefined
    };
};

const RULE_SIDES = new Set(['ANY', 'BUY', 'SELL', 'LONG', 'SHORT', 'CLOSE', 'NEUTRAL']);

const sanitizeRules = (raw: unknown): NotificationRule[] => {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(isRecord)
        .map((rule): NotificationRule | null => {
            const condition = isRecord(rule.condition) ? rule.condition : {};
            const channels = isRecord(rule.channels) ? rule.channels : {};
            const side = typeof condition.side === 'string' && RULE_SIDES.has(condition.side) ? condition.side : 'ANY';
            if (typeof rule.id !== 'string' && typeof rule.id !== 'number') return null;
            return {
                id: String(rule.id),
                name: typeof rule.name === 'string' ? rule.name : '',
                condition: {
                    symbol: typeof condition.symbol === 'string' ? condition.symbol : '',
                    side: side as NotificationRule['condition']['side']
                },
                channels: {
                    inApp: toBool(channels.inApp, true),
                    browser: toBool(channels.browser, false)
                }
            };
        })
        .filter((rule): rule is NotificationRule => rule !== null);
};

const sanitizePriceAlerts = (raw: unknown): StoredPriceAlert[] => {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(isRecord)
        .filter(a => typeof a.id === 'string' && typeof a.symbol === 'string'
            && Number.isFinite(a.targetPrice) && a.targetPrice > 0
            && (a.condition === 'ABOVE' || a.condition === 'BELOW'))
        .map(a => ({
            id: a.id,
            symbol: a.symbol,
            targetPrice: a.targetPrice,
            condition: a.condition,
            isActive: toBool(a.isActive, true),
            createdAt: toNumber(a.createdAt, Date.now()),
            triggeredAt: Number.isFinite(a.triggeredAt) ? a.triggeredAt : undefined,
            triggeredPrice: Number.isFinite(a.triggeredPrice) ? a.triggeredPrice : undefined
        }))
        .slice(-200);
};

const sanitizeSignalView = (raw: unknown): SignalViewState => {
    const r = isRecord(raw) ? raw : {};
    return {
        clearedAt: toNumber(r.clearedAt, 0, 0),
        hiddenIds: Array.isArray(r.hiddenIds) ? r.hiddenIds.filter((id: unknown): id is string => typeof id === 'string').slice(-500) : []
    };
};

const loadRules = (userId: string | null) => (userId ? sanitizeRules(readScoped<unknown>(RULES_KEY, userId, [])) : []);
const loadNotificationSettings = (userId: string | null) =>
    (userId ? sanitizeNotificationSettings(readScoped<unknown>(NOTIFICATION_SETTINGS_KEY, userId, null)) : DEFAULT_NOTIFICATION_SETTINGS);
const loadPriceAlerts = (userId: string | null) => (userId ? sanitizePriceAlerts(readScoped<unknown>(PRICE_ALERTS_KEY, userId, [])) : []);
const loadSignalView = (userId: string | null) => (userId ? sanitizeSignalView(readScoped<unknown>(SIGNAL_VIEW_KEY, userId, null)) : DEFAULT_SIGNAL_VIEW);

// --- Signal helpers ---
const SIDES = new Set<Side>(['BUY', 'SELL', 'LONG', 'SHORT', 'CLOSE', 'NEUTRAL']);
const SOURCES = new Set(['WEBHOOK', 'ALGO_MOMENTUM', 'ALGO_DIVERGENCE', 'ALGO_VOLUME', 'MANUAL']);

const isLocalSignal = (signal: Pick<Signal, 'id'>) => signal.id.startsWith(LOCAL_ID_PREFIX);

const signalTime = (signal: Signal) => {
    const t = Date.parse(signal.time);
    return Number.isFinite(t) ? t : 0;
};

const toIsoTime = (value: unknown): string => {
    if (typeof value === 'string' && value.trim() !== '') return value;
    if (typeof value === 'number' && Number.isFinite(value)) {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    return new Date().toISOString();
};

// The server engine writes these sources; `engine` is only accepted when it matches the source.
const ENGINE_BY_SOURCE: Partial<Record<NonNullable<Signal['source']>, 'MOMENTUM' | 'VOLUME' | 'FUNDING'>> = {
    ALGO_MOMENTUM: 'MOMENTUM',
    ALGO_VOLUME: 'VOLUME',
    ALGO_DIVERGENCE: 'FUNDING'
};

// The measured size stored next to an engine record (signal_meta.magnitude).
const normalizeMagnitude = (raw: unknown): Signal['magnitude'] => {
    if (!isRecord(raw)) return undefined;
    const value = Number(raw.value);
    if (!Number.isFinite(value) || typeof raw.text !== 'string' || raw.text.trim() === '') return undefined;
    return {
        value,
        text: raw.text.slice(0, 40),
        caption: typeof raw.caption === 'string' ? raw.caption.slice(0, 160) : ''
    };
};

// Server ids can never be mistaken for browser-local ones.
const toClientSignalId = (raw: unknown): string => {
    const id = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';
    return id.startsWith(LOCAL_ID_PREFIX) ? `srv_${id}` : id;
};

// Validates a signal coming from the server (history or socket) before it reaches the UI.
const normalizeServerSignal = (raw: unknown): Signal | null => {
    if (!isRecord(raw)) return null;
    const id = toClientSignalId(raw.id);
    const symbol = typeof raw.symbol === 'string' ? raw.symbol.trim().toUpperCase() : '';
    const side = (typeof raw.side === 'string' ? raw.side.trim().toUpperCase() : '') as Side;
    const price = Number(raw.price);
    if (!id || !symbol || !SIDES.has(side) || !Number.isFinite(price)) return null;
    const confidence = raw.confidence === null || raw.confidence === undefined ? NaN : Number(raw.confidence);
    const source = typeof raw.source === 'string' && SOURCES.has(raw.source) ? raw.source as Signal['source'] : undefined;
    // Engine records of the server carry engine + magnitude (signal_meta). Stored rows of the old
    // algorithm versions ('ALGO_*' without meta) get no engine: their rules were different.
    const sourceEngine = source ? ENGINE_BY_SOURCE[source] : undefined;
    const engine: Signal['engine'] = source === 'WEBHOOK' || source === 'MANUAL'
        ? source
        : sourceEngine && raw.engine === sourceEngine ? sourceEngine : undefined;
    const isEngine = engine === 'MOMENTUM' || engine === 'VOLUME' || engine === 'FUNDING';
    // What happened after the signal (forward tracking). A market-wide record is not tracked.
    const outcome = symbol === MARKET_SYMBOL ? undefined : normalizeSignalOutcome(raw.outcome);
    return {
        id,
        strategy: typeof raw.strategy === 'string' && raw.strategy.trim() ? raw.strategy : 'Webhook',
        symbol,
        side,
        price,
        time: toIsoTime(raw.time),
        note: typeof raw.note === 'string' ? raw.note : '',
        // Engines never write a confidence: their measured size is in `magnitude`.
        confidence: !isEngine && Number.isFinite(confidence) ? confidence : undefined,
        source,
        engine,
        magnitude: isEngine ? normalizeMagnitude(raw.magnitude) : undefined,
        ...(outcome ? { outcome } : {})
    };
};

// Keeps outcome horizons this browser already knows (e.g. from a 'signal_outcome' event that arrived
// while a history request was in flight): a resolved horizon never becomes unresolved again.
const withKnownOutcomes = (incoming: Signal[], known: Signal[]): Signal[] => {
    const outcomes = new Map<string, NonNullable<Signal['outcome']>>();
    known.forEach(signal => { if (signal.outcome) outcomes.set(signal.id, signal.outcome); });
    if (outcomes.size === 0) return incoming;
    return incoming.map(signal => {
        const prev = outcomes.get(signal.id);
        if (!prev) return signal;
        const outcome = mergeSignalOutcome(prev, signal.outcome);
        return outcome === signal.outcome ? signal : { ...signal, outcome };
    });
};

// Merge by id (incoming wins), newest first, with separate caps so engine records can never push
// shared (webhook/manual) signals out of the list.
const mergeSignals = (prev: Signal[], incoming: Signal[]): Signal[] => {
    const byId = new Map<string, Signal>();
    [...withKnownOutcomes(incoming, prev), ...prev].forEach(signal => {
        if (!byId.has(signal.id)) byId.set(signal.id, signal);
    });
    const sorted = Array.from(byId.values()).sort((a, b) => signalTime(b) - signalTime(a));
    let engineCount = 0;
    let sharedCount = 0;
    return sorted.filter(signal => {
        if (isLocalSignal(signal) || isAlgoRecord(signal)) return ++engineCount <= MAX_ENGINE_SIGNALS;
        return ++sharedCount <= MAX_SERVER_SIGNALS;
    });
};

const sameStat = (a: EngineStat, b: EngineStat) => a.matching === b.matching && a.universe === b.universe;

const sameSettings = (a: SignalSettings, b: SignalSettings) =>
    a.momentum.threshold === b.momentum.threshold && a.momentum.cooldownHours === b.momentum.cooldownHours
    && a.volume.ratio === b.volume.ratio && a.volume.cooldownHours === b.volume.cooldownHours
    && a.funding.thresholdPct === b.funding.thresholdPct && a.funding.cooldownHours === b.funding.cooldownHours;

const sameActiveFunding = (a: FundingRegimeEntry[], b: FundingRegimeEntry[]) =>
    a.length === b.length && a.every((entry, i) =>
        entry.symbol === b[i].symbol && entry.f8Pct === b[i].f8Pct && entry.since === b[i].since);

// The server's "active now" list ({ symbol, f8 (fraction), since }) in the engine's entry shape.
const toFundingRegimeEntries = (status: EngineStatus): FundingRegimeEntry[] =>
    status.activeFunding.map(item => ({
        symbol: item.symbol,
        f8Pct: item.f8 * 100,
        // Without an episode peak in the status, the current level is the best known value.
        peakF8Pct: (item.peakF8 ?? item.f8) * 100,
        since: item.since
    }));

const formatSignalPrice = (price: number) => {
    if (!Number.isFinite(price)) return '—';
    if (Math.abs(price) >= 1) return price.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
    return price.toPrecision(4);
};

const sanitizeTelegramText = (value: string, max: number) =>
    value.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').slice(0, max);

// Plain text (no parse_mode): strategy/note may contain '_' or '*' that would break Markdown,
// and webhook-supplied text must not be able to inject formatting.
const buildTelegramText = (signal: Signal) => {
    // Colour = direction (for engine records: of the measured move). A record without a direction is white.
    // Momentum / volume records are watch alerts (no edge over random entry): arrows, never green / red.
    const up = signal.side === 'BUY' || signal.side === 'LONG';
    const watch = isWatchAlertRecord(signal);
    const emoji = signal.side === 'NEUTRAL' ? '⚪' : watch ? (up ? '⬆️' : '⬇️') : up ? '🟢' : '🔴';
    const time = new Date(signal.time);
    const timeText = Number.isNaN(time.getTime()) ? signal.time : time.toLocaleTimeString('tr-TR');
    // Same order as the server text (engine/notify.ts): the watch line right under the headline.
    const lines = [`${emoji} ${signalHeadline(signal)}`];
    if (watch) lines.push('İzleme uyarısı · alım/satım önerisi değil');
    lines.push(`Strateji: ${sanitizeTelegramText(getStrategyLabel(signal.strategy), 120)}`);
    if (signal.magnitude) {
        lines.push(`Ölçüm: ${sanitizeTelegramText(`${signal.magnitude.text} (${signal.magnitude.caption})`, 160)}`);
    }
    // MARKET is not a pair: no price line.
    if (signal.symbol !== MARKET_SYMBOL) lines.push(`Fiyat: $${formatSignalPrice(signal.price)}`);
    lines.push(`Zaman: ${timeText}`);
    if (signal.note) lines.push(`Not: ${sanitizeTelegramText(signal.note, 500)}`);
    if (isEngineSignal(signal)) lines.push('(Sinyal motoru kaydı; işlem önerisi değildir)');
    return lines.join('\n');
};

// --- Big move de-duplication ---
// One record per symbol + window + direction (not per level). Inside the window the same move is
// reported once; if it grows to a higher level, the existing entry is replaced (upgrade) instead of
// adding a duplicate.
type MoveLevel = BigMoveSignal['level'];
const LEVEL_RANK: Record<MoveLevel, number> = { SMALL: 1, MID: 2, HIGH: 3 };
interface MoveRecord { at: number; level: MoveLevel; id: string }

const claimMove = (
    records: Record<string, MoveRecord>,
    key: string,
    now: number,
    windowMs: number,
    level: MoveLevel,
    id: string
): string | null => {
    const record = records[key];
    if (!record || now - record.at > windowMs) {
        records[key] = { at: now, level, id };
        return id;
    }
    if (LEVEL_RANK[level] > LEVEL_RANK[record.level]) {
        record.level = level;
        return record.id; // upgrade: reuse the id so the existing entry is replaced
    }
    return null;
};

const pruneMoveRecords = (records: Record<string, MoveRecord>, now: number) => {
    Object.keys(records).forEach(key => {
        if (now - records[key].at > 60 * 60 * 1000) delete records[key];
    });
};

// Per-symbol scanner memory (price history, extreme tracks) is dropped for symbols that have not
// been seen for a day (delisted, or out of the universe), so the maps cannot grow without bound.
const SYMBOL_MEMORY_MS = 24 * 60 * 60 * 1000;
const SYMBOL_PRUNE_EVERY_MS = 5 * 60 * 1000;

const pruneSymbolMaps = (lastSeen: Record<string, number>, now: number, maps: Record<string, unknown>[]) => {
    Object.keys(lastSeen).forEach(symbol => {
        if (now - lastSeen[symbol] <= SYMBOL_MEMORY_MS) return;
        delete lastSeen[symbol];
        maps.forEach(map => { delete map[symbol]; });
    });
};

const mergeMoves = (prev: BigMoveSignal[], entries: BigMoveSignal[]) => {
    const ids = new Set(entries.map(e => e.id));
    return [...entries, ...prev.filter(m => !ids.has(m.id))].slice(0, 50);
};

export const SignalProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { marketData, futuresData, connectionStatus, futuresConnectionStatus } = useMarketData();
    const { isAuthenticated, user } = useUser();
    const userId = user?.id !== undefined && user?.id !== null && String(user.id) !== '' ? String(user.id) : null;
    const isAdmin = user?.role === 'admin';

    const [signals, setSignals] = useState<Signal[]>([]);
    const [toasts, setToasts] = useState<ToastMessage[]>([]);

    // Per-user persisted state (contract B). Loaded for the current user, re-loaded when the user changes.
    const [hydratedUserId, setHydratedUserId] = useState<string | null>(userId);
    const [rules, setRules] = useState<NotificationRule[]>(() => loadRules(userId));
    const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(() => loadNotificationSettings(userId));
    const [priceAlerts, setPriceAlerts] = useState<StoredPriceAlert[]>(() => loadPriceAlerts(userId));
    const [signalView, setSignalView] = useState<SignalViewState>(() => loadSignalView(userId));

    const [alertModal, setAlertModal] = useState<{ isOpen: boolean; symbol: string | null }>({ isOpen: false, symbol: null });
    const [patterns, setPatterns] = useState<DetectedPattern[]>([]);
    const [bigMoves, setBigMoves] = useState<BigMoveSignal[]>([]);
    const [futuresBigMoves, setFuturesBigMoves] = useState<BigMoveSignal[]>([]);
    // Server engine: global settings, counters and status (GET /api/engine/status, see the poll below).
    // Settings / counters / active list keep their identity while the numbers do not change.
    const [signalSettings, setSignalSettings] = useState<SignalSettings>(DEFAULT_SIGNAL_SETTINGS);
    const [engineStats, setEngineStats] = useState<EngineStats>(EMPTY_ENGINE_STATS);
    const [fundingRegimeActive, setFundingRegimeActive] = useState<FundingRegimeEntry[]>([]);
    const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
    const [engineStatusError, setEngineStatusError] = useState<string | null>(null);
    const [engineStatusAt, setEngineStatusAt] = useState(0);

    // Refs (intervals and socket handlers read the latest values without being re-created)
    const marketDataRef = useRef(marketData);
    const futuresDataRef = useRef(futuresData);
    const notificationSettingsRef = useRef(notificationSettings);
    // Whether the server sends engine signals to Telegram itself (the browser then skips them);
    // null until the first engine status arrived.
    const serverTelegramRef = useRef<boolean | null>(null);
    // Fetches the engine status right away (used after saving the settings).
    const refreshEngineStatusRef = useRef<(() => void) | null>(null);
    const rulesRef = useRef(rules);
    const spotLiveRef = useRef(connectionStatus === 'connected');
    const futuresLiveRef = useRef(futuresConnectionStatus === 'connected');
    const firedAlertIdsRef = useRef<Set<string>>(new Set());
    const notifiedSignalIdsRef = useRef<Set<string>>(new Set());
    const telegramSentRef = useRef<number[]>([]);
    const telegramErrorShownRef = useRef(false);
    // Local time of the last futures batch; stale rows (sleeping tab, stream down) are not evaluated.
    const futuresDataAtRef = useRef(0);

    // Declared before the other effects so they always see the values of the current commit.
    useEffect(() => {
        if (futuresDataRef.current !== futuresData) futuresDataAtRef.current = Date.now();
        marketDataRef.current = marketData;
        futuresDataRef.current = futuresData;
        notificationSettingsRef.current = notificationSettings;
        serverTelegramRef.current = engineStatus ? engineStatus.telegram.server === true : null;
        rulesRef.current = rules;
        spotLiveRef.current = connectionStatus === 'connected';
        futuresLiveRef.current = futuresConnectionStatus === 'connected';
    });

    // Switch persisted state when the logged-in user changes (login / logout / account switch).
    useEffect(() => {
        if (hydratedUserId === userId) return;
        setRules(loadRules(userId));
        setNotificationSettings(loadNotificationSettings(userId));
        setPriceAlerts(loadPriceAlerts(userId));
        setSignalView(loadSignalView(userId));
        setSignals([]);
        setPatterns([]);
        setBigMoves([]);
        setFuturesBigMoves([]);
        setEngineStats(EMPTY_ENGINE_STATS);
        setFundingRegimeActive([]);
        firedAlertIdsRef.current.clear();
        notifiedSignalIdsRef.current.clear();
        setHydratedUserId(userId);
    }, [userId, hydratedUserId]);

    // Writes only happen once the state belongs to the current user (never to another user's key).
    const canPersist = userId !== null && hydratedUserId === userId;

    useEffect(() => {
        if (canPersist) writeScoped(RULES_KEY, userId, rules);
    }, [canPersist, userId, rules]);

    useEffect(() => {
        if (canPersist) writeScoped(NOTIFICATION_SETTINGS_KEY, userId, notificationSettings);
    }, [canPersist, userId, notificationSettings]);

    useEffect(() => {
        if (canPersist) writeScoped(PRICE_ALERTS_KEY, userId, priceAlerts);
    }, [canPersist, userId, priceAlerts]);

    useEffect(() => {
        if (canPersist) writeScoped(SIGNAL_VIEW_KEY, userId, signalView);
    }, [canPersist, userId, signalView]);

    useEffect(() => {
        notificationManager.setSoundEnabled(notificationSettings.soundEnabled);
        notificationManager.setBrowserEnabled(notificationSettings.browserNotificationsEnabled);
    }, [notificationSettings.soundEnabled, notificationSettings.browserNotificationsEnabled]);

    // Helpers
    const addToast = useCallback((title: string, description: string, type: ToastMessage['type'] = 'info') => {
        setToasts(prev => [...prev, { id: Math.random().toString(36), title, description, type }]);
    }, []);

    const dismissToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    // Global engine settings: only an admin may change them (the server enforces it too). Values are
    // clamped into the allowed ranges; the server engine re-seeds silently on a threshold change.
    const updateSignalSettings = useCallback(async (newSettings: SignalSettings): Promise<boolean> => {
        const adminOnly = () => addToast(
            'Sinyal ayarlarını yalnızca yönetici değiştirebilir',
            'Bu ayarlar sunucudaki sinyal motoru içindir ve tüm kullanıcılar için ortaktır.',
            'alert'
        );
        if (!isAdmin) {
            adminOnly();
            return false;
        }
        try {
            const saved = await putEngineSettings(sanitizeSignalSettings({ ...newSettings, version: SIGNAL_SETTINGS_VERSION }));
            setSignalSettings(prev => (sameSettings(prev, saved) ? prev : saved));
            addToast('Ayarlar kaydedildi', 'Sunucudaki sinyal motoru yeni eşiklerle sessizce yeniden başladı; ayarlar tüm kullanıcılar için geçerli.', 'success');
            refreshEngineStatusRef.current?.();
            return true;
        } catch (err) {
            if (err instanceof ApiError && err.status === 403) {
                adminOnly();
            } else {
                addToast('Ayarlar kaydedilemedi', err instanceof Error ? err.message : 'Bilinmeyen hata', 'alert');
            }
            return false;
        }
    }, [isAdmin, addToast]);

    const updateNotificationSettings = useCallback((newSettings: Partial<NotificationSettings>) => {
        setNotificationSettings(prev => sanitizeNotificationSettings({ ...prev, ...newSettings }));
    }, []);

    const requestNotificationPermission = useCallback(async (): Promise<boolean> => {
        const granted = await notificationManager.requestPermission();
        if (granted) {
            updateNotificationSettings({ browserNotificationsEnabled: true });
            addToast('Bildirimler açıldı', 'Artık tarayıcı bildirimleri alacaksınız.', 'success');
        } else {
            addToast('Bildirim izni verilmedi', 'Tarayıcı bildirimleri için site ayarlarından izin vermeniz gerekiyor.', 'alert');
        }
        return granted;
    }, [addToast, updateNotificationSettings]);

    const sendTelegram = useCallback((signal: Signal) => {
        const settings = notificationSettingsRef.current;
        const botToken = settings.telegramBotToken?.trim();
        const chatId = settings.telegramChatId?.trim();
        if (!botToken || !chatId) return;

        const now = Date.now();
        telegramSentRef.current = telegramSentRef.current.filter(t => now - t < 60000);
        if (telegramSentRef.current.length >= TELEGRAM_MAX_PER_MINUTE) return;
        telegramSentRef.current.push(now);

        // The bot token only travels in the JSON body of an authenticated request to our backend.
        apiJson('/api/notify/telegram', {
            method: 'POST',
            body: JSON.stringify({ botToken, chatId, text: buildTelegramText(signal) })
        }).catch(err => {
            const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
            console.warn('Telegram bildirimi gönderilemedi:', message);
            if (!telegramErrorShownRef.current) {
                telegramErrorShownRef.current = true;
                addToast('Telegram bildirimi gönderilemedi', message, 'alert');
            }
        });
    }, [addToast]);

    // Single entry point for every signal notification; honours the user's preferences.
    const dispatchSignalNotifications = useCallback((signal: Signal) => {
        if (notifiedSignalIdsRef.current.has(signal.id)) return;
        notifiedSignalIdsRef.current.add(signal.id);
        if (notifiedSignalIdsRef.current.size > 2000) {
            notifiedSignalIdsRef.current = new Set(Array.from(notifiedSignalIdsRef.current).slice(-1000));
        }

        const settings = notificationSettingsRef.current;
        const label = signalSummary(signal);
        const priceText = formatSignalPrice(signal.price);

        // 1. User-defined rules (explicit per-rule channels)
        rulesRef.current.forEach(rule => {
            const symbolMatch = !rule.condition.symbol || rule.condition.symbol === signal.symbol;
            const sideMatch = rule.condition.side === 'ANY' || rule.condition.side === signal.side;
            if (!symbolMatch || !sideMatch) return;

            const title = `Alarm: ${signalHeadline(signal)}`;
            const body = signal.symbol === MARKET_SYMBOL ? label : `${label} · $${priceText}`;
            if (rule.channels.inApp) addToast(title, body, 'alert');
            if (rule.channels.browser) {
                // Shown only if browser notifications are enabled in settings and permitted by the browser
                notificationManager.notify({ title, body, priority: 'HIGH', playSound: false, tag: `signal-${signal.symbol}` });
            }
        });

        // 2. Global signal notifications (sound / browser / Telegram)
        if (!settings.notifyOnSignals) return;
        const priority = getSignalPriority(signal);
        if (!meetsMinPriority(priority, settings.minPriorityLevel)) return;

        if (signal.symbol === MARKET_SYMBOL) {
            // No coin, no price: notifySignal would show "MARKET sinyali · $0".
            notificationManager.notify({
                title: '🎯 Piyasa geneli hareket',
                body: label,
                priority,
                tag: `signal-${MARKET_SYMBOL}`
            });
        } else {
            notifySignal(signal.symbol, label, priority, signal.price);
        }
        // Engine records (engine field, or an ALGO_* source if the meta row is missing) are sent to
        // Telegram once by the server when it is configured for that. Until the first engine status
        // arrived it is unknown, and the browser rather skips one message than sends a duplicate.
        if (isAlgoRecord(signal) && serverTelegramRef.current !== false) return;
        sendTelegram(signal);
    }, [addToast, sendTelegram]);

    // --- Server engine status: settings, counters, health (polled while the tab is visible) ---
    const applyEngineStatus = useCallback((status: EngineStatus) => {
        setEngineStatus(status);
        setEngineStatusError(null);
        setEngineStatusAt(Date.now());
        setSignalSettings(prev => (sameSettings(prev, status.settings) ? prev : status.settings));
        setEngineStats(prev => (
            sameStat(prev.momentum, status.stats.momentum)
            && sameStat(prev.volume, status.stats.volume)
            && sameStat(prev.funding, status.stats.funding)
            && prev.updatedAt === status.stats.updatedAt
                ? prev
                : status.stats
        ));
        const active = toFundingRegimeEntries(status);
        setFundingRegimeActive(prev => (sameActiveFunding(prev, active) ? prev : active));
    }, []);

    useEffect(() => {
        if (!isAuthenticated || typeof document === 'undefined' || typeof window === 'undefined') return;
        let disposed = false;
        let timer: number | null = null;
        let inFlight: AbortController | null = null;

        const clearTimer = () => {
            if (timer !== null) window.clearTimeout(timer);
            timer = null;
        };

        const schedule = () => {
            clearTimer();
            if (!disposed && document.visibilityState === 'visible') timer = window.setTimeout(() => { poll(); }, ENGINE_STATUS_POLL_MS);
        };

        // `force`: fetch even in a hidden tab. Used for the first request, so that a tab opened in the
        // background still knows the settings and whether the server sends Telegram itself.
        const poll = async (force = false) => {
            clearTimer();
            if (disposed || (!force && document.visibilityState !== 'visible')) return;
            inFlight?.abort();
            const controller = new AbortController();
            inFlight = controller;
            try {
                const status = await getEngineStatus(controller.signal);
                if (disposed || controller.signal.aborted) return;
                applyEngineStatus(status);
            } catch (err) {
                if (disposed || controller.signal.aborted) return;
                const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
                setEngineStatusError(prev => (prev === message ? prev : message));
            } finally {
                if (inFlight === controller) {
                    inFlight = null;
                    schedule();
                }
            }
        };

        // Hidden tab: no requests. Back to visible: refresh at once, then every 15 s.
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                poll();
            } else {
                clearTimer();
                inFlight?.abort();
                inFlight = null;
            }
        };

        refreshEngineStatusRef.current = () => { poll(true); };
        poll(true);
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            disposed = true;
            refreshEngineStatusRef.current = null;
            clearTimer();
            inFlight?.abort();
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [isAuthenticated, applyEngineStatus]);

    // --- Patterns: one scanner loop while logged in ---
    useEffect(() => {
        if (!isAuthenticated) return;
        const unsubscribe = patternScanner.subscribe((pattern) => {
            setPatterns(prev => {
                if (prev.some(p => p.id === pattern.id)) return prev;
                return [pattern, ...prev].slice(0, 50);
            });
        });

        patternScanner.startScanning();

        return () => {
            unsubscribe();
            patternScanner.stopScanning();
        };
    }, [isAuthenticated]);

    // --- Socket connection: shared signals (webhook / admin manual) ---
    useEffect(() => {
        if (!isAuthenticated) return;

        let disposed = false;
        let announced = false;
        const socket = io(SOCKET_URL, {
            transports: ['websocket', 'polling']
        });

        // Socket events seen while a history request is in flight: the snapshot may predate them.
        let historySeq = 0;
        const live = { added: new Set<string>(), removed: new Set<string>(), cleared: false };

        let lastHistoryAt = 0;
        const fetchHistory = async () => {
            const seq = ++historySeq;
            lastHistoryAt = Date.now();
            live.added.clear();
            live.removed.clear();
            live.cleared = false;
            try {
                const history = await apiJson<unknown>('/api/signals?limit=200');
                // A newer request supersedes this one
                if (disposed || seq !== historySeq || !Array.isArray(history)) return;
                const valid = history.map(normalizeServerSignal).filter((s): s is Signal => s !== null);
                // History never triggers notifications
                valid.forEach(s => notifiedSignalIdsRef.current.add(s.id));
                const added = new Set(live.added);
                const serverList = live.cleared ? [] : valid.filter(s => !live.removed.has(s.id));
                // The server list is the source of truth (picks up deletes/clears missed while the
                // socket was down); browser-local entries and live arrivals during the request stay.
                // Outcome horizons already known here are kept (the snapshot may predate an event).
                setSignals(prev => mergeSignals(
                    prev.filter(s => isLocalSignal(s) || added.has(s.id)),
                    withKnownOutcomes(serverList, prev)
                ));
            } catch (err) {
                console.error('Sinyal geçmişi alınamadı:', err instanceof Error ? err.message : err);
            }
        };

        // Load history right away (it must not depend on the socket), and again after every (re)connect
        // to pick up signals that arrived while the socket was down.
        fetchHistory();

        socket.on('connect', () => {
            if (!announced) {
                announced = true;
                addToast('Sinyal merkezi bağlandı', 'Gerçek zamanlı sinyal akışı aktif.', 'success');
            }
            fetchHistory();
        });

        socket.on('connect_error', (error: Error) => {
            console.error('Sinyal sunucusuna bağlanılamadı:', error?.message);
        });

        socket.on('new_signal', (raw: unknown) => {
            const signal = normalizeServerSignal(raw);
            if (!signal) return;
            live.added.add(signal.id);
            live.removed.delete(signal.id);
            setSignals(prev => mergeSignals(prev, [signal]));
            dispatchSignalNotifications(signal);
        });

        socket.on('signal_deleted', (payload: unknown) => {
            const id = isRecord(payload) ? payload.id : payload;
            if (typeof id !== 'string' && typeof id !== 'number') return;
            const target = String(id);
            live.removed.add(target);
            live.added.delete(target);
            setSignals(prev => prev.filter(s => s.id !== target));
        });

        socket.on('signals_cleared', () => {
            live.cleared = true;
            live.added.clear();
            live.removed.clear();
            setSignals(prev => prev.filter(isLocalSignal));
        });

        // A horizon of a stored signal was measured (15 min / 1 h / 4 h / 24 h after it).
        socket.on('signal_outcome', (payload: unknown) => {
            if (!isRecord(payload)) return;
            const target = toClientSignalId(payload.id);
            const outcome = normalizeSignalOutcome(payload.outcome);
            if (!target || !outcome) return;
            setSignals(prev => {
                const index = prev.findIndex(s => s.id === target);
                if (index === -1 || prev[index].symbol === MARKET_SYMBOL) return prev;
                const merged = mergeSignalOutcome(prev[index].outcome, outcome);
                if (merged === prev[index].outcome) return prev;
                const next = prev.slice();
                next[index] = { ...prev[index], outcome: merged };
                return next;
            });
        });

        // Periodic history refresh while the tab is visible (outcomes resolved by another server
        // process, rows missed by the socket). A hidden tab catches up when it becomes visible.
        const refreshIfDue = () => {
            if (disposed || typeof document === 'undefined' || document.visibilityState !== 'visible') return;
            if (Date.now() - lastHistoryAt >= HISTORY_REFRESH_MS) fetchHistory();
        };
        const refreshTimer = typeof window !== 'undefined' ? window.setInterval(refreshIfDue, HISTORY_REFRESH_CHECK_MS) : null;
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', refreshIfDue);

        return () => {
            disposed = true;
            if (refreshTimer !== null) window.clearInterval(refreshTimer);
            if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', refreshIfDue);
            socket.disconnect();
        };
    }, [isAuthenticated, addToast, dispatchSignalNotifications]);

    // Signals visible to this user (non-admin "clear" only hides server signals for this user)
    const visibleSignals = useMemo(() => {
        if (signalView.clearedAt === 0 && signalView.hiddenIds.length === 0) return signals;
        const hidden = new Set(signalView.hiddenIds);
        return signals.filter(s => isLocalSignal(s) || (!hidden.has(s.id) && signalTime(s) > signalView.clearedAt));
    }, [signals, signalView]);

    // Handlers
    const handleDeleteSignal = useCallback((id: string) => {
        if (id.startsWith(LOCAL_ID_PREFIX)) {
            setSignals(prev => prev.filter(s => s.id !== id));
            return;
        }
        if (isAdmin) {
            apiJson(`/api/signals/${encodeURIComponent(id)}`, { method: 'DELETE' })
                .then(() => {
                    setSignals(prev => prev.filter(s => s.id !== id));
                })
                .catch(err => {
                    addToast('Sinyal silinemedi', err instanceof Error ? err.message : 'Bilinmeyen hata', 'alert');
                });
            return;
        }
        // Not allowed to delete shared data: hide it from this user's view only.
        setSignalView(prev => ({ ...prev, hiddenIds: [...prev.hiddenIds.filter(h => h !== id), id].slice(-500) }));
    }, [isAdmin, addToast]);

    const handleClearAllSignals = useCallback(() => {
        if (typeof window === 'undefined') return;
        if (isAdmin) {
            if (!window.confirm('Tüm sinyal geçmişi veritabanından kalıcı olarak silinecek ve tüm kullanıcılar için kaybolacak. Emin misiniz?')) return;
            apiJson('/api/signals', { method: 'DELETE' })
                .then(() => {
                    setSignals([]);
                    addToast('Sinyal geçmişi silindi', 'Tüm sinyaller veritabanından silindi.', 'success');
                })
                .catch(err => {
                    addToast('Sinyaller silinemedi', err instanceof Error ? err.message : 'Bilinmeyen hata', 'alert');
                });
            return;
        }
        if (!window.confirm('Sinyal listesi yalnızca sizin görünümünüzden temizlenecek; kayıtlar sunucuda kalır. Devam edilsin mi?')) return;
        setSignalView({ clearedAt: Date.now(), hiddenIds: [] });
        setSignals(prev => prev.filter(s => !isLocalSignal(s)));
        addToast('Görünüm temizlendi', 'Sinyaller yalnızca sizin görünümünüzden kaldırıldı.', 'info');
    }, [isAdmin, addToast]);

    // Admin manual injection: stored + broadcast by the server; the list updates via the socket echo.
    const handleManualSignal = useCallback((signal: Signal) => {
        apiJson('/api/signals', {
            method: 'POST',
            body: JSON.stringify({
                symbol: signal.symbol,
                side: signal.side,
                price: signal.price,
                strategy: signal.strategy,
                note: signal.note,
                source: signal.source ?? 'MANUAL',
                confidence: signal.confidence
            })
        })
            .then(() => addToast('Sinyal gönderildi', `${signal.symbol} ${signal.side} sinyali yayınlandı.`, 'success'))
            .catch(err => addToast('Sinyal gönderilemedi', err instanceof Error ? err.message : 'Bilinmeyen hata', 'alert'));
    }, [addToast]);

    const openAlertModal = useCallback((symbol: string) => {
        setAlertModal({ isOpen: true, symbol });
    }, []);

    const closeAlertModal = useCallback(() => {
        setAlertModal({ isOpen: false, symbol: null });
    }, []);

    const handleCreateAlert = useCallback((price: number, condition: 'ABOVE' | 'BELOW') => {
        const symbol = alertModal.symbol;
        if (!symbol) return;
        if (!Number.isFinite(price) || price <= 0) {
            addToast('Geçersiz fiyat', 'Alarm için sıfırdan büyük bir fiyat girin.', 'alert');
            return;
        }
        const newAlert: StoredPriceAlert = {
            id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            symbol,
            targetPrice: price,
            condition,
            isActive: true,
            createdAt: Date.now()
        };
        setPriceAlerts(prev => [...prev, newAlert].slice(-200));
        addToast(
            'Alarm kuruldu',
            `${symbol} fiyatı $${formatSignalPrice(price)} ${condition === 'ABOVE' ? 'üzerine çıktığında' : 'altına indiğinde'} bildirim alacaksınız.`,
            'success'
        );
        setAlertModal({ isOpen: false, symbol: null });
    }, [alertModal.symbol, addToast]);

    const removePriceAlert = useCallback((id: string) => {
        setPriceAlerts(prev => prev.filter(a => a.id !== id));
    }, []);

    // --- Logic: Price Alerts ---
    // Triggers are computed here; notifications are side effects of the effect body (never inside a
    // state updater), then the state is updated with a pure updater.
    useEffect(() => {
        if (!isAuthenticated) return;
        const triggered: { alert: StoredPriceAlert; price: number }[] = [];
        priceAlerts.forEach(alert => {
            if (!alert.isActive || firedAlertIdsRef.current.has(alert.id)) return;
            const ticker = marketData[alert.symbol];
            if (!ticker || !Number.isFinite(ticker.lastPrice)) return;
            const hit = alert.condition === 'ABOVE'
                ? ticker.lastPrice >= alert.targetPrice
                : ticker.lastPrice <= alert.targetPrice;
            if (hit) triggered.push({ alert, price: ticker.lastPrice });
        });
        if (triggered.length === 0) return;

        const now = Date.now();
        const settings = notificationSettingsRef.current;
        const pricesById = new Map<string, number>();
        triggered.forEach(({ alert, price }) => {
            firedAlertIdsRef.current.add(alert.id);
            pricesById.set(alert.id, price);
            // Always leave a visible trace in the app, regardless of sound/browser settings.
            addToast(
                `Fiyat alarmı: ${alert.symbol}`,
                `Hedef $${formatSignalPrice(alert.targetPrice)} ${alert.condition === 'ABOVE' ? 'aşıldı' : 'altına inildi'}. Güncel: $${formatSignalPrice(price)}`,
                'alert'
            );
            if (settings.notifyOnPriceAlerts) notifyPriceAlert(alert.symbol, alert.targetPrice, price);
        });

        setPriceAlerts(prev => prev.map(a => (
            a.isActive && pricesById.has(a.id)
                ? { ...a, isActive: false, triggeredAt: now, triggeredPrice: pricesById.get(a.id) }
                : a
        )));
    }, [marketData, priceAlerts, isAuthenticated, addToast]);

    // --- Futures metadata: crypto-perp universe (cached 1h in the service) ---
    // The futures big-move scanner skips its work until the list is loaded.
    useEffect(() => {
        if (!isAuthenticated) return;
        const load = () => {
            getCryptoPerpSymbols().catch(() => { /* logged by the service; retried on the next tick */ });
        };
        load();
        const timer = setInterval(load, FUTURES_META_POLL_MS);
        return () => clearInterval(timer);
    }, [isAuthenticated]);

    // --- Logic: Big Move Scanner (Spot) ---
    // Universe: the shared liquid spot universe (>= 1M USDT, no pegged pairs, 24h range >= 0.3%).
    // "New 24h high / low" is recorded on ENTRY only (after the price had moved away by a third of the
    // 24h range), at level MID. The fixed 1m / 5m percentage rules are unchanged for now.
    useEffect(() => {
        if (!isAuthenticated) return;
        let priceHistory: Record<string, Array<{ t: number; p: number }>> = {};
        const records: Record<string, MoveRecord> = {};
        let tracks: Record<string, ExtremeTrack> = {};
        const lastSeen: Record<string, number> = {};
        let lastScanAt = 0;
        let lastPruneAt = 0;

        const scanBigMoves = () => {
            if (!spotLiveRef.current) return;
            const now = Date.now();
            if (lastScanAt > 0 && now - lastScanAt > BIG_MOVE_MAX_GAP_MS) {
                // Sleeping tab / long disconnect: seed again instead of reporting everything that moved meanwhile.
                tracks = {};
                priceHistory = {};
            }
            lastScanAt = now;
            const entries: BigMoveSignal[] = [];
            const { universe } = selectSpotUniverse(Object.values(marketDataRef.current));

            universe.forEach((ticker: Ticker) => {
                const price = ticker.lastPrice;
                if (!Number.isFinite(price) || price <= 0) return;
                lastSeen[ticker.symbol] = now;

                const history = priceHistory[ticker.symbol] || (priceHistory[ticker.symbol] = []);
                history.push({ t: now, p: price });

                // Prune old history (> 15 mins)
                const pruneTime = now - 16 * 60 * 1000;
                if (history[0] && history[0].t < pruneTime) {
                    const cutoffIndex = history.findIndex(h => h.t >= pruneTime);
                    if (cutoffIndex > 0) history.splice(0, cutoffIndex);
                }

                const getPriceAgo = (msAgo: number) => {
                    const targetTime = now - msAgo;
                    if (history.length === 0 || history[0].t > targetTime + 2000) return null;
                    const point = history.find(h => h.t >= targetTime);
                    return point ? point.p : null;
                };

                // --- A. New 24h High/Low (entry only; the first observation seeds the state) ---
                const step = stepExtremeTrack(tracks[ticker.symbol], { price, high: ticker.highPrice, low: ticker.lowPrice }, false);
                if (step.track) tracks[ticker.symbol] = step.track;
                step.events.forEach(type => {
                    if (type === 'HIGH') {
                        entries.push({ id: `high_${now}_${ticker.symbol}`, symbol: ticker.symbol, type: 'HIGH', timeframe: '24h', price, description: 'Yeni 24s zirve', timestamp: now, level: 'MID' });
                    } else if (type === 'LOW') {
                        entries.push({ id: `low_${now}_${ticker.symbol}`, symbol: ticker.symbol, type: 'LOW', timeframe: '24h', price, description: 'Yeni 24s dip', timestamp: now, level: 'MID' });
                    }
                });

                // --- B. Price Rise/Fall (5m) ---
                const p5m = getPriceAgo(5 * 60 * 1000);
                if (p5m) {
                    const change5m = ((price - p5m) / p5m) * 100;
                    const absChange = Math.abs(change5m);

                    if (absChange >= 2) { // 2% move in 5m for Spot
                        let level: MoveLevel = 'SMALL';
                        if (absChange >= 8) level = 'HIGH';
                        else if (absChange >= 4) level = 'MID';

                        const type = change5m > 0 ? 'RISE' : 'FALL';
                        const id = claimMove(records, `${ticker.symbol}_5m_${type}`, now, 5 * 60 * 1000, level, `5m_${type}_${now}_${ticker.symbol}`);
                        if (id) {
                            entries.push({
                                id,
                                symbol: ticker.symbol,
                                type,
                                timeframe: '5m',
                                changePercent: absChange,
                                price,
                                description: `${level} 5 dk ${type === 'RISE' ? 'yükseliş' : 'düşüş'} (${change5m > 0 ? '+' : ''}${change5m.toFixed(2)}%)`,
                                timestamp: now,
                                level
                            });
                        }
                    }
                }

                // --- C. Flash Pump Detection (1m) ---
                const p1m = getPriceAgo(60 * 1000);
                if (p1m) {
                    const change1m = ((price - p1m) / p1m) * 100;
                    const absChange = Math.abs(change1m);

                    if (absChange >= 1.5) { // 1.5% in 1 minute is FLASH
                        const type = change1m > 0 ? 'RISE' : 'FALL';
                        const level: MoveLevel = absChange > 3 ? 'HIGH' : 'MID';
                        const id = claimMove(records, `${ticker.symbol}_1m_${type}`, now, 60 * 1000, level, `1m_${type}_${now}_${ticker.symbol}`);
                        if (id) {
                            entries.push({
                                id,
                                symbol: ticker.symbol,
                                type,
                                timeframe: '1m',
                                changePercent: absChange,
                                price,
                                description: `FLASH ${type === 'RISE' ? 'yükseliş' : 'düşüş'} (1 dk'da ${change1m > 0 ? '+' : ''}${change1m.toFixed(2)}%)`,
                                timestamp: now,
                                level
                            });
                        }
                    }
                }
            });

            pruneMoveRecords(records, now);
            if (now - lastPruneAt > SYMBOL_PRUNE_EVERY_MS) {
                lastPruneAt = now;
                pruneSymbolMaps(lastSeen, now, [priceHistory, tracks]);
            }
            if (entries.length > 0) {
                setBigMoves(prev => mergeMoves(prev, entries));
            }
        };

        const interval = setInterval(scanBigMoves, 10000);
        return () => clearInterval(interval);
    }, [isAuthenticated]);

    // --- Logic: Futures Big Move Scanner ---
    // Crypto perpetuals only (TRADING + PERPETUAL + USDT, from exchangeInfo); nothing runs until that
    // list is loaded. "New 24h high / low" and "pullback / rally" are recorded on ENTRY only (see
    // stepExtremeTrack) at level MID; the fixed 1m / 5m percentage rules are unchanged for now.
    useEffect(() => {
        if (!isAuthenticated) return;
        let priceHistory: Record<string, Array<{ t: number; p: number }>> = {};
        const records: Record<string, MoveRecord> = {};
        let tracks: Record<string, ExtremeTrack> = {};
        const lastSeen: Record<string, number> = {};
        let lastScanAt = 0;
        let lastPruneAt = 0;

        const scanFuturesBigMoves = () => {
            const perps = getCryptoPerpSymbolsSync();
            const now = Date.now();
            if (!futuresLiveRef.current || !perps || now - futuresDataAtRef.current > FUTURES_FRESH_MS) return;
            if (lastScanAt > 0 && now - lastScanAt > BIG_MOVE_MAX_GAP_MS) {
                tracks = {};
                priceHistory = {};
            }
            lastScanAt = now;
            const entries: BigMoveSignal[] = [];

            Object.values(futuresDataRef.current).forEach((fTicker: FuturesTicker) => {
                if (!fTicker?.symbol || !perps.has(fTicker.symbol)) return;
                const price = fTicker.markPrice;
                if (!Number.isFinite(price) || price <= 0) return;
                lastSeen[fTicker.symbol] = now;

                const history = priceHistory[fTicker.symbol] || (priceHistory[fTicker.symbol] = []);
                history.push({ t: now, p: price });

                // Prune old history (> 15 mins)
                const pruneTime = now - 16 * 60 * 1000;
                if (history[0] && history[0].t < pruneTime) {
                    const cutoffIndex = history.findIndex(h => h.t >= pruneTime);
                    if (cutoffIndex > 0) history.splice(0, cutoffIndex);
                }

                const getPriceAgo = (msAgo: number) => {
                    const targetTime = now - msAgo;
                    // Robust check: ensure we actually HAVE history from that long ago
                    if (history.length === 0 || history[0].t > targetTime + 2000) return null;
                    const point = history.find(h => h.t >= targetTime);
                    return point ? point.p : null;
                };

                // --- A + D. New 24h High/Low and Pullback/Rally (entry only) ---
                // The 24h high / low come from trades, so they are compared with the last traded price
                // (the mark price can sit on either side of them without a new trade).
                const traded = typeof fTicker.lastPrice === 'number' && fTicker.lastPrice > 0 ? fTicker.lastPrice : price;
                const step = stepExtremeTrack(
                    tracks[fTicker.symbol],
                    { price: traded, high: fTicker.highPrice ?? 0, low: fTicker.lowPrice ?? 0, open: fTicker.openPrice },
                    true
                );
                if (step.track) tracks[fTicker.symbol] = step.track;
                step.events.forEach(type => {
                    switch (type) {
                        case 'HIGH':
                            entries.push({ id: `perp_high_${now}_${fTicker.symbol}`, symbol: fTicker.symbol, type: 'HIGH', timeframe: '24h', price: traded, description: 'Perp yeni 24s zirve', timestamp: now, level: 'MID' });
                            break;
                        case 'LOW':
                            entries.push({ id: `perp_low_${now}_${fTicker.symbol}`, symbol: fTicker.symbol, type: 'LOW', timeframe: '24h', price: traded, description: 'Perp yeni 24s dip', timestamp: now, level: 'MID' });
                            break;
                        case 'PULLBACK':
                            entries.push({ id: `perp_pull_${now}_${fTicker.symbol}`, symbol: fTicker.symbol, type: 'PULLBACK', price: traded, description: `Perp 24s zirveden geri çekilme (−${step.pullbackPct.toFixed(1)}%)`, timestamp: now, level: 'MID' });
                            break;
                        case 'RALLY':
                            entries.push({ id: `perp_rally_${now}_${fTicker.symbol}`, symbol: fTicker.symbol, type: 'RALLY', price: traded, description: `Perp 24s dipten toparlanma (+${step.rallyPct.toFixed(1)}%)`, timestamp: now, level: 'MID' });
                            break;
                        default:
                            break;
                    }
                });

                // --- B. Price Rise/Fall (5m) ---
                const p5m = getPriceAgo(5 * 60 * 1000);
                if (p5m) {
                    const change5m = ((price - p5m) / p5m) * 100;
                    const absChange = Math.abs(change5m);

                    if (absChange >= 1) {
                        let level: MoveLevel = 'SMALL';
                        if (absChange >= 6) level = 'HIGH';
                        else if (absChange >= 3) level = 'MID';

                        const type = change5m > 0 ? 'RISE' : 'FALL';
                        const id = claimMove(records, `${fTicker.symbol}_perp_5m_${type}`, now, 5 * 60 * 1000, level, `perp_5m_${type}_${now}_${fTicker.symbol}`);
                        if (id) {
                            entries.push({
                                id,
                                symbol: fTicker.symbol,
                                type,
                                timeframe: '5m',
                                changePercent: absChange,
                                price,
                                description: `Perp ${level} 5 dk ${type === 'RISE' ? 'yükseliş' : 'düşüş'} (${change5m > 0 ? '+' : ''}${change5m.toFixed(2)}%)`,
                                timestamp: now,
                                level
                            });
                        }
                    }
                }

                // --- C. Flash Pump Detection (1m) ---
                const p1m = getPriceAgo(60 * 1000);
                if (p1m) {
                    const change1m = ((price - p1m) / p1m) * 100;
                    const absChange = Math.abs(change1m);

                    if (absChange >= 0.8) { // 0.8% in 1 minute is FLASH on perps
                        const type = change1m > 0 ? 'RISE' : 'FALL';
                        const level: MoveLevel = absChange > 2 ? 'HIGH' : 'MID';
                        const id = claimMove(records, `${fTicker.symbol}_perp_1m_${type}`, now, 60 * 1000, level, `perp_1m_${type}_${now}_${fTicker.symbol}`);
                        if (id) {
                            entries.push({
                                id,
                                symbol: fTicker.symbol,
                                type,
                                timeframe: '1m',
                                changePercent: absChange,
                                price,
                                description: `FLASH Perp ${type === 'RISE' ? 'yükseliş' : 'düşüş'} (1 dk'da ${change1m > 0 ? '+' : ''}${change1m.toFixed(2)}%)`,
                                timestamp: now,
                                level
                            });
                        }
                    }
                }
            });

            pruneMoveRecords(records, now);
            if (now - lastPruneAt > SYMBOL_PRUNE_EVERY_MS) {
                lastPruneAt = now;
                pruneSymbolMaps(lastSeen, now, [priceHistory, tracks]);
            }
            if (entries.length === 0) return;
            setFuturesBigMoves(prev => mergeMoves(prev, entries));

            const settings = notificationSettingsRef.current;
            if (settings.notifyOnBigMoves) {
                entries.forEach(move => {
                    const levelPriority: Priority = move.level === 'HIGH' ? 'HIGH' : move.level === 'MID' ? 'MEDIUM' : 'LOW';
                    if (meetsMinPriority(levelPriority, settings.minPriorityLevel)) {
                        notifyBigMove(move.symbol, move.type, move.changePercent || 0, move.level);
                    }
                });
            }
        };

        // 5s interval keeps responsiveness at a moderate CPU cost
        const interval = setInterval(scanFuturesBigMoves, 5000);
        return () => clearInterval(interval);
    }, [isAuthenticated]);

    const value = useMemo<SignalContextType>(() => ({
        signals: visibleSignals,
        setSignals,
        bigMoves,
        futuresBigMoves,
        rules, setRules,
        priceAlerts, setPriceAlerts, removePriceAlert,
        toasts, addToast, dismissToast,
        handleDeleteSignal, handleClearAllSignals, handleManualSignal,
        alertModal, openAlertModal, closeAlertModal, handleCreateAlert,
        signalSettings, updateSignalSettings,
        engineStats, fundingRegimeActive,
        engineStatus, engineStatusError, engineStatusAt,
        notificationSettings, updateNotificationSettings, requestNotificationPermission,
        patterns
    }), [
        visibleSignals, bigMoves, futuresBigMoves, rules, priceAlerts, removePriceAlert, toasts, addToast, dismissToast,
        handleDeleteSignal, handleClearAllSignals, handleManualSignal, alertModal, openAlertModal, closeAlertModal,
        handleCreateAlert, signalSettings, updateSignalSettings, engineStats, fundingRegimeActive,
        engineStatus, engineStatusError, engineStatusAt,
        notificationSettings, updateNotificationSettings, requestNotificationPermission, patterns
    ]);

    return (
        <SignalContext.Provider value={value}>
            {children}
        </SignalContext.Provider>
    );
};

export const useSignals = () => {
    const context = useContext(SignalContext);
    if (!context) {
        throw new Error('useSignals must be used within a SignalProvider');
    }
    return context;
};
