// Client side of the server signal engine (momentum, volume, funding run in the Node process).
// GET /api/engine/status (any logged-in user) and PUT /api/engine/settings (admin only).
import { apiJson } from './config';
import {
    EMPTY_ENGINE_STAT,
    sanitizeSignalSettings,
    type EngineStat,
    type EngineStats,
    type SignalSettings
} from './signalEngines';

export type EngineStreamState = 'connected' | 'connecting' | 'down';
export type EngineStreamKey = 'spotMini' | 'spotHour' | 'futuresMark' | 'futuresMini';
export type EngineScanKey = 'momentum' | 'volume' | 'funding';

/** A perpetual inside the negative funding gate. `f8` is the 8h-equivalent funding rate (fraction). */
export interface EngineActiveFunding {
    symbol: string;
    f8: number;
    since: number;
    peakF8?: number; // most negative level of the episode (fraction), when the server sends it
}

export type EngineProcessRole = 'leader' | 'standby' | 'off';

export interface EngineStatus {
    mode: 'server' | 'off';                 // env ENGINE_MODE; 'off' = engine disabled
    running: boolean;                       // the engine loop of the lock holder is active
    // 'leader' also when a standby process answered with the leader's fresh heartbeat (servedBy 'standby');
    // 'standby' = no running leader is known (see leaderStale)
    role: EngineProcessRole;
    startedAt: number | null;
    uptimeSec: number;
    processStartedAt: number;
    boots: number[];                        // last 50 process start timestamps (ms)
    streams: Record<EngineStreamKey, EngineStreamState>;
    lastScan: Record<EngineScanKey, number | null>;
    stats: EngineStats;
    settings: SignalSettings;               // global for everyone
    activeFunding: EngineActiveFunding[];
    telegram: { server: boolean };          // the server sends engine signals to Telegram itself
    signalsToday: number;                   // engine signals since 00:00 UTC
    // The host runs several Node processes; any of them may answer.
    servedBy: EngineProcessRole | null;     // role of the answering process (null: older server)
    leaderHeartbeatAt: number | null;       // last heartbeat of the leader process (ms)
    leaderStale: boolean;                   // standby answered and the leader's heartbeat is older than 20 s (or missing)
}

export const ENGINE_STREAM_KEYS: readonly EngineStreamKey[] = ['spotMini', 'spotHour', 'futuresMark', 'futuresMini'];
export const ENGINE_SCAN_KEYS: readonly EngineScanKey[] = ['momentum', 'volume', 'funding'];

// --- Defensive parsing: a partial or malformed response must never break the UI ---
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const finiteOr = <T>(value: unknown, fallback: T): number | T =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const toStreamState = (value: unknown): EngineStreamState =>
    value === 'connected' || value === 'connecting' ? value : 'down';

const toStat = (value: unknown): EngineStat => {
    const r = isRecord(value) ? value : {};
    const matching = finiteOr(r.matching, 0);
    const universe = finiteOr(r.universe, 0);
    return { matching: Math.max(0, matching), universe: Math.max(0, universe) };
};

const toActiveFunding = (value: unknown): EngineActiveFunding[] => {
    if (!Array.isArray(value)) return [];
    const list: EngineActiveFunding[] = [];
    value.forEach(item => {
        if (!isRecord(item) || typeof item.symbol !== 'string' || item.symbol === '') return;
        // `f8` (fraction) per contract; a percent field from the engine's own entry type is accepted too.
        const f8 = typeof item.f8 === 'number' && Number.isFinite(item.f8)
            ? item.f8
            : typeof item.f8Pct === 'number' && Number.isFinite(item.f8Pct) ? item.f8Pct / 100 : NaN;
        if (!Number.isFinite(f8)) return;
        const peakF8 = typeof item.peakF8 === 'number' && Number.isFinite(item.peakF8)
            ? item.peakF8
            : typeof item.peakF8Pct === 'number' && Number.isFinite(item.peakF8Pct) ? item.peakF8Pct / 100 : undefined;
        list.push({ symbol: item.symbol, f8, since: finiteOr(item.since, 0), ...(peakF8 !== undefined ? { peakF8 } : {}) });
    });
    return list.slice(0, 500);
};

/** Raw response -> a complete EngineStatus. Throws only when the body is not an object at all. */
export const normalizeEngineStatus = (raw: unknown): EngineStatus => {
    if (!isRecord(raw)) throw new Error('Motor durumu okunamadı.');
    const streams = isRecord(raw.streams) ? raw.streams : {};
    const lastScan = isRecord(raw.lastScan) ? raw.lastScan : {};
    const stats = isRecord(raw.stats) ? raw.stats : {};
    const telegram = isRecord(raw.telegram) ? raw.telegram : {};
    const mode = raw.mode === 'off' ? 'off' : 'server';
    const role = raw.role === 'leader' || raw.role === 'standby' ? raw.role : 'off';
    const boots = Array.isArray(raw.boots)
        ? raw.boots.filter((t): t is number => typeof t === 'number' && Number.isFinite(t) && t > 0).sort((a, b) => a - b).slice(-50)
        : [];
    return {
        mode,
        running: raw.running === true,
        role,
        startedAt: finiteOr(raw.startedAt, null),
        uptimeSec: Math.max(0, finiteOr(raw.uptimeSec, 0)),
        processStartedAt: finiteOr(raw.processStartedAt, 0),
        boots,
        streams: {
            spotMini: toStreamState(streams.spotMini),
            spotHour: toStreamState(streams.spotHour),
            futuresMark: toStreamState(streams.futuresMark),
            futuresMini: toStreamState(streams.futuresMini)
        },
        lastScan: {
            momentum: finiteOr(lastScan.momentum, null),
            volume: finiteOr(lastScan.volume, null),
            funding: finiteOr(lastScan.funding, null)
        },
        stats: {
            momentum: isRecord(stats.momentum) ? toStat(stats.momentum) : EMPTY_ENGINE_STAT,
            volume: isRecord(stats.volume) ? toStat(stats.volume) : EMPTY_ENGINE_STAT,
            funding: isRecord(stats.funding) ? toStat(stats.funding) : EMPTY_ENGINE_STAT,
            updatedAt: finiteOr(stats.updatedAt, 0)
        },
        settings: sanitizeSignalSettings(raw.settings),
        activeFunding: toActiveFunding(raw.activeFunding),
        telegram: { server: telegram.server === true },
        signalsToday: Math.max(0, finiteOr(raw.signalsToday, 0)),
        servedBy: raw.servedBy === 'leader' || raw.servedBy === 'standby' || raw.servedBy === 'off' ? raw.servedBy : null,
        leaderHeartbeatAt: finiteOr(raw.leaderHeartbeatAt, null),
        leaderStale: raw.leaderStale === true
    };
};

export const getEngineStatus = async (signal?: AbortSignal): Promise<EngineStatus> =>
    normalizeEngineStatus(await apiJson<unknown>('/api/engine/status', { signal }));

/** Saves the global engine settings (admin only; the server answers 403 otherwise). */
export const putEngineSettings = async (settings: SignalSettings): Promise<SignalSettings> => {
    const body = await apiJson<unknown>('/api/engine/settings', {
        method: 'PUT',
        body: JSON.stringify(settings)
    });
    return sanitizeSignalSettings(isRecord(body) ? body.settings : null);
};

// --- Presentation helpers shared by the header indicator and the settings dialog ---

export const ENGINE_STREAM_LABELS: Record<EngineStreamKey, string> = {
    spotMini: 'Spot fiyat',
    spotHour: 'Spot 1 saat',
    futuresMark: 'Vadeli fonlama',
    futuresMini: 'Vadeli fiyat'
};

export const ENGINE_STREAM_STATE_LABELS: Record<EngineStreamState, string> = {
    connected: 'bağlı',
    connecting: 'bağlanıyor',
    down: 'kopuk'
};

export const ENGINE_SCAN_LABELS: Record<EngineScanKey, string> = {
    momentum: 'Momentum',
    volume: 'Hacim',
    funding: 'Fonlama'
};

/** "3 sa 12 dk", "12 dk", "45 sn", "2 g 4 sa". */
export const formatEngineDuration = (seconds: number): string => {
    const s = Math.max(0, Math.floor(seconds));
    if (s < 60) return `${s} sn`;
    const minutes = Math.floor(s / 60);
    if (minutes < 60) return `${minutes} dk`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} sa ${minutes % 60} dk`;
    return `${Math.floor(hours / 24)} g ${hours % 24} sa`;
};

/** "4 sn önce"; '—' when there is no timestamp. */
export const formatEngineAgo = (at: number | null, now: number): string =>
    at === null || at <= 0 ? '—' : `${formatEngineDuration((now - at) / 1000)} önce`;

/** Uptime as reported by the server, advanced by the time since the status was received. */
export const engineUptimeSec = (status: EngineStatus, receivedAt: number, now: number): number =>
    status.uptimeSec + Math.max(0, now - receivedAt) / 1000;

/** Newest scan of the three engines (null before the first scan). */
export const latestEngineScan = (status: EngineStatus): number | null => {
    const values = ENGINE_SCAN_KEYS.map(key => status.lastScan[key]).filter((t): t is number => t !== null);
    return values.length > 0 ? Math.max(...values) : null;
};

/**
 * Process restarts in the last 24 h. Every boot inside the window counts, except the very first start
 * of the process history (the list is not full yet and its oldest entry is inside the window).
 */
export const engineRestarts24h = (boots: readonly number[], now: number): number => {
    const since = now - 24 * 60 * 60 * 1000;
    const inWindow = boots.filter(t => t >= since && t <= now + 60_000).length;
    const firstEver = boots.length > 0 && boots.length < 50 && boots[0] >= since ? 1 : 0;
    return Math.max(0, inWindow - firstEver);
};

/** Streams that are not connected, with their labels ("Vadeli fiyat kopuk"). */
export const engineStreamProblems = (status: EngineStatus): string[] =>
    ENGINE_STREAM_KEYS
        .filter(key => status.streams[key] !== 'connected')
        .map(key => `${ENGINE_STREAM_LABELS[key]} ${ENGINE_STREAM_STATE_LABELS[status.streams[key]]}`);

export type EngineHealthTone = 'success' | 'warning' | 'danger';

/** Dot colour + one-line Turkish description of the engine's state. */
export const describeEngineHealth = (
    status: EngineStatus | null,
    error: string | null,
    receivedAt: number,
    now: number
): { tone: EngineHealthTone; text: string } => {
    if (!status) {
        return { tone: 'danger', text: error ? `Sinyal motoru durumu alınamadı: ${error}` : 'Sinyal motoru durumu bekleniyor' };
    }
    if (error) {
        return { tone: 'danger', text: `Sinyal motoru durumu alınamadı (son bilgi ${formatEngineAgo(receivedAt, now)}): ${error}` };
    }
    if (status.mode === 'off') {
        return { tone: 'danger', text: 'Sinyal motoru kapalı (sunucuda ENGINE_MODE=off)' };
    }
    if (status.role === 'standby') {
        if (status.leaderStale) {
            const beat = status.leaderHeartbeatAt !== null
                ? `son kalp atışı ${formatEngineAgo(status.leaderHeartbeatAt, now)}`
                : 'kalp atışı hiç alınmadı';
            return { tone: 'warning', text: `Sinyal motorundan haber yok: motoru çalıştıran sunucu süreci yanıt vermiyor (${beat})` };
        }
        return { tone: 'warning', text: 'Sinyal motoru beklemede: motoru başka bir sunucu süreci çalıştırıyor' };
    }
    if (!status.running) {
        return { tone: 'danger', text: 'Sinyal motoru çalışmıyor' };
    }
    const uptime = formatEngineDuration(engineUptimeSec(status, receivedAt, now));
    const scan = formatEngineAgo(latestEngineScan(status), now);
    // Answered by another process from the leader's heartbeat: say how fresh that is.
    const beat = status.servedBy === 'standby' && status.leaderHeartbeatAt !== null
        ? ` · son kalp atışı ${formatEngineAgo(status.leaderHeartbeatAt, now)}`
        : '';
    const summary = `çalışma süresi ${uptime} · son tarama ${scan} · bugün ${status.signalsToday} sinyal${beat}`;
    const problems = engineStreamProblems(status);
    if (problems.length > 0) {
        return { tone: 'warning', text: `Sinyal motoru çalışıyor, veri akışında sorun var: ${problems.join(', ')} · ${summary}` };
    }
    return { tone: 'success', text: `Sinyal motoru sunucuda çalışıyor · ${summary}` };
};

export const ENGINE_TONE_DOT: Record<EngineHealthTone, string> = {
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger'
};
