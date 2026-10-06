import { Trade } from './types';

// Single source of truth for journal P&L.
// Convention: `returnVal` is ALWAYS the signed P&L of a closed trade (negative = loss).
// OPEN trades contribute 0 and are excluded from win-rate / equity / calendar / analytics.

export type TradeSide = Trade['side'];
export type TradeStatus = Trade['status'];

const LOCALE = 'tr-TR';

export const toFiniteNumber = (value: unknown): number | undefined => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value.trim().replace(',', '.'));
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
};

const roundTo = (value: number, digits: number) => {
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
};

// LONG: (exit - entry) * size, SHORT: (entry - exit) * size
export const computePnl = (entry: number, exit: number, size: number, side: TradeSide): number => {
    const raw = side === 'SHORT' ? (entry - exit) * size : (exit - entry) * size;
    return Number.isFinite(raw) ? roundTo(raw, 8) : 0;
};

// Signed return on notional (entry * size), in percent with 2 decimals. Never Infinity/NaN.
export const computeReturnPct = (pnl: number, entry: number, size: number): number => {
    const notional = entry * size;
    if (!Number.isFinite(notional) || notional <= 0 || !Number.isFinite(pnl)) return 0;
    return roundTo((pnl / notional) * 100, 2);
};

export const isClosedTrade = (t: Trade) => t.status !== 'OPEN';

export const getClosedTrades = (trades: Trade[]) => trades.filter(isClosedTrade);

export const getSignedPnl = (t: Trade): number => {
    if (t.status === 'OPEN') return 0;
    return typeof t.returnVal === 'number' && Number.isFinite(t.returnVal) ? t.returnVal : 0;
};

export const getSignedPct = (t: Trade): number => {
    if (t.status === 'OPEN') return 0;
    return typeof t.returnPct === 'number' && Number.isFinite(t.returnPct) ? t.returnPct : 0;
};

export const statusFromPnl = (pnl: number, fallback: 'WIN' | 'LOSS'): 'WIN' | 'LOSS' =>
    pnl > 0 ? 'WIN' : pnl < 0 ? 'LOSS' : fallback;

// Returns a Turkish error message when the chosen outcome contradicts the computed P&L.
export const validateOutcome = (status: TradeStatus, pnl: number): string | null => {
    if (status === 'WIN' && pnl < 0) {
        return `Sonuç "Kazanç" seçildi ancak giriş/çıkış fiyatlarına göre hesaplanan K/Z ${formatSignedUsd(pnl)}. Lütfen yönü, fiyatları veya sonucu kontrol edin.`;
    }
    if (status === 'LOSS' && pnl > 0) {
        return `Sonuç "Kayıp" seçildi ancak giriş/çıkış fiyatlarına göre hesaplanan K/Z ${formatSignedUsd(pnl)}. Lütfen yönü, fiyatları veya sonucu kontrol edin.`;
    }
    return null;
};

// --- Dates -----------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, '0');

// Local calendar date as YYYY-MM-DD (no UTC shift).
export const toLocalDateInput = (d: Date = new Date()) =>
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Local time as HH:MM (00-23, never "24:xx").
export const toLocalTimeInput = (d: Date = new Date()) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

export const normalizeTimeInput = (time?: string): string | undefined => {
    if (!time) return undefined;
    const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
    if (!match) return undefined;
    const hours = Number(match[1]) % 24;
    const minutes = Number(match[2]);
    if (minutes > 59) return undefined;
    return `${pad2(hours)}:${pad2(minutes)}`;
};

// Parses 'YYYY-MM-DD' as a LOCAL date (new Date('YYYY-MM-DD') would be UTC midnight).
export const parseTradeDate = (date: string, time?: string): Date => {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec((date || '').trim());
    let hours = 0;
    let minutes = 0;
    const normalizedTime = normalizeTimeInput(time);
    if (normalizedTime) {
        hours = Number(normalizedTime.slice(0, 2));
        minutes = Number(normalizedTime.slice(3, 5));
    }
    if (iso) {
        return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), hours, minutes);
    }
    const parsed = new Date(date);
    if (!Number.isNaN(parsed.getTime()) && normalizedTime) parsed.setHours(hours, minutes, 0, 0);
    return parsed;
};

export const getTradeTimestamp = (t: Trade): number => {
    const ts = parseTradeDate(t.date, t.time).getTime();
    return Number.isFinite(ts) ? ts : 0;
};

// --- Formatting (tr-TR) ------------------------------------------------------

// "$200" for whole amounts, "$1.234,50" otherwise (trailingZeroDisplay is ignored by older engines).
const moneyDigits = (maximumFractionDigits: number) => ({
    minimumFractionDigits: Math.min(2, maximumFractionDigits),
    maximumFractionDigits,
    trailingZeroDisplay: 'stripIfInteger'
});

export const formatUsd = (value: number, maximumFractionDigits = 2): string => {
    if (!Number.isFinite(value)) return '—';
    return new Intl.NumberFormat(LOCALE, {
        style: 'currency',
        currency: 'USD',
        ...moneyDigits(maximumFractionDigits)
    } as Intl.NumberFormatOptions).format(value);
};

export const formatSignedUsd = (value: number, maximumFractionDigits = 2): string => {
    if (!Number.isFinite(value)) return '—';
    return new Intl.NumberFormat(LOCALE, {
        style: 'currency',
        currency: 'USD',
        ...moneyDigits(maximumFractionDigits),
        signDisplay: 'exceptZero'
    } as Intl.NumberFormatOptions).format(value);
};

export const formatSignedPct = (value: number): string => {
    if (!Number.isFinite(value)) return '—';
    return new Intl.NumberFormat(LOCALE, {
        style: 'percent',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
        signDisplay: 'exceptZero'
    } as Intl.NumberFormatOptions).format(value / 100);
};

export const formatPrice = (value?: number): string => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    if (Math.abs(value) >= 1) return formatUsd(value, 2);
    return new Intl.NumberFormat(LOCALE, {
        style: 'currency',
        currency: 'USD',
        maximumSignificantDigits: 6
    }).format(value);
};

export const formatQuantity = (value: number): string => {
    if (!Number.isFinite(value)) return '—';
    return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 8 }).format(value);
};

// --- Stored data normalisation ---------------------------------------------

const asStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];

const EMOTIONS = ['confident', 'fearful', 'greedy', 'fomo', 'disciplined'];

const generateId = () => {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    } catch { /* ignore */ }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const createTradeId = generateId;

// The recorded outcome decides the sign; the magnitude is kept as entered (no -0).
const signByStatus = (value: number, status: 'WIN' | 'LOSS'): number => {
    const magnitude = Math.abs(value);
    return status === 'WIN' || magnitude === 0 ? magnitude : -magnitude;
};

// Migrates legacy records (positive-magnitude returnVal + status sign, '24:xx' times,
// WIN/LOSS without settlement data...) to the signed-P&L model. Idempotent.
// A stored P&L is never recomputed from prices: older forms let users type it by hand
// (fees, leverage, notional sizes...), so only its sign is aligned with the recorded outcome.
export const normalizeTrade = (raw: any): Trade | null => {
    if (!raw || typeof raw !== 'object') return null;
    const symbol = typeof raw.symbol === 'string' ? raw.symbol.trim().toUpperCase() : '';
    if (!symbol) return null;

    const entry = toFiniteNumber(raw.entry) ?? 0;
    const size = toFiniteNumber(raw.size) ?? 0;
    const side: TradeSide = raw.side === 'SHORT' ? 'SHORT' : 'LONG';
    const exitRaw = toFiniteNumber(raw.exit);
    const exit = exitRaw !== undefined && exitRaw > 0 ? exitRaw : undefined;

    let status: TradeStatus = raw.status === 'WIN' || raw.status === 'LOSS' ? raw.status : 'OPEN';
    let returnVal: number | undefined;
    let returnPct: number | undefined;

    if (status !== 'OPEN') {
        const stored = toFiniteNumber(raw.returnVal);
        if (stored !== undefined) {
            returnVal = signByStatus(stored, status);
        } else if (exit !== undefined && entry > 0 && size > 0) {
            // No recorded P&L: derive it from prices, keeping the recorded outcome (status is never flipped).
            returnVal = signByStatus(computePnl(entry, exit, size, side), status);
        } else {
            // Closed without any settlement data -> treat as still open so it can be settled properly.
            status = 'OPEN';
        }
        if (status !== 'OPEN') returnPct = computeReturnPct(returnVal ?? 0, entry, size);
    }

    const efficiency = toFiniteNumber(raw.efficiency) ?? 0;

    return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : String(raw.id ?? '') || generateId(),
        status,
        date: typeof raw.date === 'string' && raw.date ? raw.date : toLocalDateInput(),
        time: normalizeTimeInput(typeof raw.time === 'string' ? raw.time : undefined),
        symbol,
        entry,
        exit: status === 'OPEN' ? undefined : exit,
        size,
        side,
        returnVal: status === 'OPEN' ? undefined : returnVal,
        returnPct: status === 'OPEN' ? undefined : returnPct,
        setups: asStringArray(raw.setups),
        efficiency: Math.max(0, Math.min(100, Math.round(efficiency))),
        notes: typeof raw.notes === 'string' ? raw.notes : undefined,
        images: asStringArray(raw.images),
        tags: asStringArray(raw.tags),
        emotion: EMOTIONS.includes(raw.emotion) ? raw.emotion : undefined
    };
};

// Demo rows that older builds seeded into every new journal (see git history of constants.ts).
export const isLegacyDemoTrade = (t: Trade): boolean =>
    (t.id === '1' && t.symbol === 'BTC' && t.date === 'Sep 12, 2019') ||
    (t.id === '2' && t.symbol === 'ETH' && t.date === 'Sep 11, 2019') ||
    (t.id === '3' && t.symbol === 'SOL' && t.entry === 150 && t.size === 10 && t.setups.includes('Trend Follow'));

// True when loading this stored record drops it or changes a value the user entered,
// i.e. when the raw data should be backed up before it is rewritten in the new format.
export const isMigrationChange = (raw: any, normalized: Trade | null): boolean => {
    if (!normalized || isLegacyDemoTrade(normalized) || !raw || typeof raw !== 'object') return true;
    return raw.id !== normalized.id
        || raw.symbol !== normalized.symbol
        || raw.side !== normalized.side
        || raw.status !== normalized.status
        || (raw.time ?? undefined) !== normalized.time
        || toFiniteNumber(raw.entry) !== normalized.entry
        || toFiniteNumber(raw.size) !== normalized.size
        || toFiniteNumber(raw.exit) !== normalized.exit
        || toFiniteNumber(raw.returnVal) !== normalized.returnVal
        || toFiniteNumber(raw.returnPct) !== normalized.returnPct;
};
