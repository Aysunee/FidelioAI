// Telegram for engine signals: priority rules, message text and a rate-limited sender.
// No Express / DB here; the caller passes the bot settings (server: TELEGRAM_* env variables).

import type { EngineLogger, ResponseLike } from './types';
import { MARKET_SYMBOL, MARKET_WIDE_STRATEGY_LABELS, isMarketWideEndStrategy, isMarketWideStrategy } from '../utils/signalEngines';

export type SignalPriority = 'LOW' | 'MEDIUM' | 'HIGH';

const PRIORITY_RANK: Record<SignalPriority, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };

export const parsePriority = (raw: unknown): SignalPriority | null => {
    const value = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    return value === 'LOW' || value === 'MEDIUM' || value === 'HIGH' ? value : null;
};

export const meetsMinPriority = (priority: SignalPriority, min: SignalPriority): boolean =>
    PRIORITY_RANK[priority] >= PRIORITY_RANK[min];

/** A market-wide aggregate of the burst guard (symbol MARKET) from the momentum or volume engine. */
const isMarketAggregate = (signal: { engine?: string; source?: string; symbol?: string; strategy?: string }): boolean =>
    signal.symbol === MARKET_SYMBOL
    && isMarketWideStrategy(signal.strategy)
    && (signal.engine === 'MOMENTUM' || signal.engine === 'VOLUME' || signal.source === 'ALGO_MOMENTUM' || signal.source === 'ALGO_VOLUME');

/**
 * Same rules as the app (getSignalPriority): momentum LOW, volume MEDIUM, funding LOW, shared HIGH.
 * A market-wide aggregate is MEDIUM (one notification per market event instead of dozens); its closing
 * ('bitti') record is LOW.
 */
export const signalPriority = (signal: { engine?: string; source?: string; symbol?: string; strategy?: string }): SignalPriority => {
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

export interface NotifiableSignal {
    symbol: string;
    side: string;
    strategy: string;
    price: number;
    time: string;
    note?: string;
    source?: string;
    engine?: string;
    magnitude?: { value: number; text: string; caption: string };
}

const STRATEGY_LABELS: Record<string, string> = {
    Momentum_24h_Up: '24s Momentum (yükseliş)',
    Momentum_24h_Down: '24s Momentum (düşüş)',
    Funding_Regime_Neg: 'Negatif Fonlama Rejimi',
    ...MARKET_WIDE_STRATEGY_LABELS,
};

export const strategyLabel = (strategy: string): string => {
    if (STRATEGY_LABELS[strategy]) return STRATEGY_LABELS[strategy];
    const volume = /^Volume_Spike_([\d.]+)x$/.exec(strategy);
    return volume ? `Hacim Sıçraması ${volume[1]}x` : strategy;
};

const directionText = (side: string): string =>
    side === 'BUY' || side === 'LONG' ? 'hareket yönü yukarı' : side === 'SELL' || side === 'SHORT' ? 'hareket yönü aşağı' : 'yönsüz';

const clean = (value: string, max: number): string => value.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').slice(0, max);

const formatPrice = (price: number): string => {
    if (!Number.isFinite(price)) return '—';
    if (Math.abs(price) >= 1) return price.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
    return price.toPrecision(4);
};

const formatTime = (iso: string, timeZone: string): string => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    try {
        return `${date.toLocaleString('tr-TR', {
            timeZone,
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        })}${timeZone === 'Europe/Istanbul' ? ' (TSİ)' : ''}`;
    } catch {
        return date.toISOString();
    }
};

/** Momentum / volume records are attention alerts (watch), not trade signals: no buy / sell colours. */
const isWatchAlert = (signal: { engine?: string; source?: string }): boolean =>
    signal.engine === 'MOMENTUM' || signal.engine === 'VOLUME' || signal.source === 'ALGO_MOMENTUM' || signal.source === 'ALGO_VOLUME';

/** Plain text (no parse_mode): strategy / note may contain '_' or '*'. Mirrors the app's Telegram text. */
export function buildEngineTelegramText(signal: NotifiableSignal, timeZone = 'Europe/Istanbul'): string {
    const up = signal.side === 'BUY' || signal.side === 'LONG';
    const watch = isWatchAlert(signal);
    const emoji = signal.side === 'NEUTRAL' ? '⚪' : watch ? (up ? '⬆️' : '⬇️') : up ? '🟢' : '🔴';
    // MARKET is not a pair: no price line.
    const market = signal.symbol === MARKET_SYMBOL;
    const lines = [`${emoji} ${market ? 'Piyasa geneli' : clean(signal.symbol, 30)} · ${directionText(signal.side)}`];
    if (watch) lines.push('İzleme uyarısı · alım/satım önerisi değil');
    lines.push(`Strateji: ${clean(strategyLabel(signal.strategy), 120)}`);
    if (signal.magnitude) lines.push(`Ölçüm: ${clean(`${signal.magnitude.text} (${signal.magnitude.caption})`, 160)}`);
    if (!market) lines.push(`Fiyat: $${formatPrice(signal.price)}`);
    lines.push(`Zaman: ${formatTime(signal.time, timeZone)}`);
    if (signal.note) lines.push(`Not: ${clean(signal.note, 500)}`);
    lines.push('(Sunucudaki sinyal motorunun kaydı; işlem önerisi değildir)');
    return lines.join('\n');
}

const TELEGRAM_TOKEN_RE = /^\d{3,20}:[A-Za-z0-9_-]{20,100}$/;
const TELEGRAM_CHAT_ID_RE = /^(-?\d{1,20}|@[A-Za-z0-9_]{4,64})$/;

export type TelegramResult = 'sent' | 'disabled' | 'below_priority' | 'rate_limited' | 'failed';

export interface TelegramNotifier {
    readonly enabled: boolean;
    readonly minPriority: SignalPriority;
    notify(signal: NotifiableSignal): Promise<TelegramResult>;
}

export interface TelegramNotifierOptions {
    botToken?: string;
    chatId?: string;
    minPriority?: unknown;   // 'LOW' | 'MEDIUM' | 'HIGH', default MEDIUM
    maxPerMinute?: number;   // default 20
    timeZone?: string;
    log: EngineLogger;
    fetch?: PostFetch;       // default: the global fetch, looked up at send time
    now?: () => number;
}

export type PostFetch = (
    url: string,
    init: { method: 'POST'; headers: Record<string, string>; body: string; redirect: 'error'; signal: AbortSignal },
) => Promise<ResponseLike>;

const globalPostFetch: PostFetch = (url, init) => {
    if (typeof globalThis.fetch !== 'function') return Promise.reject(new Error('fetch yok'));
    return globalThis.fetch(url, init) as unknown as Promise<ResponseLike>;
};

/** Engine signals at or above `minPriority` go to one chat, at most `maxPerMinute` per minute. Never logs the token. */
export function createTelegramNotifier(options: TelegramNotifierOptions): TelegramNotifier {
    const log = options.log;
    const now = options.now ?? (() => Date.now());
    const token = typeof options.botToken === 'string' ? options.botToken.trim() : '';
    const chatId = typeof options.chatId === 'string' ? options.chatId.trim() : '';
    const maxPerMinute = Number.isFinite(options.maxPerMinute) && (options.maxPerMinute as number) > 0 ? Math.floor(options.maxPerMinute as number) : 20;

    let minPriority: SignalPriority = 'MEDIUM';
    if (options.minPriority !== undefined && options.minPriority !== null && options.minPriority !== '') {
        const parsed = parsePriority(options.minPriority);
        if (parsed) minPriority = parsed;
        else log.warn('[telegram] TELEGRAM_MIN_PRIORITY geçersiz (LOW, MEDIUM veya HIGH olmalı); MEDIUM kullanılıyor.');
    }

    let enabled = false;
    if (token || chatId) {
        if (!token || !chatId) {
            log.warn('[telegram] Sunucu Telegram bildirimi kapalı: TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_ID birlikte tanımlanmalı.');
        } else if (!TELEGRAM_TOKEN_RE.test(token)) {
            log.warn('[telegram] Sunucu Telegram bildirimi kapalı: TELEGRAM_BOT_TOKEN biçimi geçersiz.');
        } else if (!TELEGRAM_CHAT_ID_RE.test(chatId)) {
            log.warn('[telegram] Sunucu Telegram bildirimi kapalı: TELEGRAM_CHAT_ID biçimi geçersiz.');
        } else {
            enabled = true;
        }
    }

    const sentAt: number[] = [];
    let droppedSinceWarning = 0;
    let droppedLoggedAt = 0;

    const notify = async (signal: NotifiableSignal): Promise<TelegramResult> => {
        if (!enabled) return 'disabled';
        if (!meetsMinPriority(signalPriority(signal), minPriority)) return 'below_priority';

        const t = now();
        while (sentAt.length > 0 && t - sentAt[0] >= 60_000) sentAt.shift();
        if (sentAt.length >= maxPerMinute) {
            droppedSinceWarning++;
            if (t - droppedLoggedAt >= 60_000) {
                const skipped = droppedSinceWarning > 1 ? ` (önceki uyarıdan bu yana ${droppedSinceWarning} mesaj atlandı)` : '';
                log.warn(`[telegram] Dakikalık sınır (${maxPerMinute}) doldu; motor sinyalleri bir süre Telegram'a gönderilmiyor${skipped}.`);
                droppedLoggedAt = t;
                droppedSinceWarning = 0;
            }
            return 'rate_limited';
        }
        sentAt.push(t);

        const fetchImpl = options.fetch ?? globalPostFetch;
        let response: ResponseLike;
        try {
            response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: buildEngineTelegramText(signal, options.timeZone), disable_web_page_preview: true }),
                redirect: 'error',
                signal: AbortSignal.timeout(10_000),
            });
        } catch (err) {
            // Never log the URL (it contains the bot token).
            log.warn(`[telegram] Motor sinyali gönderilemedi: Telegram'a ulaşılamadı (${err instanceof Error ? err.name : 'hata'})`);
            return 'failed';
        }
        let data: unknown = null;
        try {
            data = await response.json();
        } catch { /* not JSON */ }
        if (response.ok && data && typeof data === 'object' && (data as { ok?: unknown }).ok === true) return 'sent';
        const description = data && typeof data === 'object' && typeof (data as { description?: unknown }).description === 'string'
            ? `: ${clean((data as { description: string }).description, 120)}`
            : '';
        log.warn(`[telegram] Motor sinyali gönderilemedi (HTTP ${response.status}${description})`);
        return 'failed';
    };

    return { enabled, minPriority, notify };
}
