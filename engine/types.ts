// Shared types of the engine host. Nothing in engine/ knows about Express, socket.io or MySQL: the
// caller (server/index.cjs today, possibly a worker on another machine later) wires the callbacks.

import type { EngineCooldowns, EngineKind, EngineSignal, EngineStats, FundingRegimeEntry, SignalSettings } from '../utils/signalEngines';
import type { ShadowSignal, ShadowStatus } from '../utils/shadowRules';

export interface EngineLogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

export const consoleLogger: EngineLogger = {
    info: (message) => console.log(message),
    warn: (message) => console.warn(message),
    error: (message) => console.error(message),
};

export type StreamState = 'connected' | 'connecting' | 'down';
export type StreamKey = 'spotMini' | 'spotHour' | 'futuresMark' | 'futuresMini';
export const STREAM_KEYS: readonly StreamKey[] = ['spotMini', 'spotHour', 'futuresMark', 'futuresMini'];

/** Minimal surface of a `ws` client socket (lets tests inject a fake). */
export interface SocketLike {
    on(event: 'open', listener: () => void): unknown;
    on(event: 'message', listener: (data: unknown) => void): unknown;
    on(event: 'error', listener: (err: Error) => void): unknown;
    on(event: 'close', listener: (code?: number) => void): unknown;
    removeAllListeners(): unknown;
    terminate(): void;
}

export type SocketFactory = (url: string) => SocketLike;

/** The part of a fetch Response the engine reads. */
export interface ResponseLike {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<ResponseLike>;

export type EngineUrls = Record<StreamKey, readonly string[]>;

export interface EngineTiming {
    momentumMs: number;      // momentum pass cadence
    volumeMs: number;        // volume pass cadence
    fundingMs: number;       // funding pass cadence
    staleMs: number;         // a stream without a message this long is reconnected
    watchdogMs: number;      // how often the stale check runs
    futuresFreshMs: number;  // funding is not evaluated on mark-price data older than this
    metaTtlMs: number;       // crypto-perp list + funding intervals refresh
    metaRetryMs: number;     // retry after a failed REST load
    settledTtlMs: number;    // latest settled funding rates refresh
    pruneMs: number;         // memory hygiene for symbols that disappeared
    autoScan: boolean;       // false: no pass timers (tests call scanNow)
}

export interface EngineDeps {
    now: () => number;
    fetch: FetchLike;
    createSocket: SocketFactory;
    urls: EngineUrls;
    timing: EngineTiming;
}

export interface CreateEngineOptions {
    settings?: unknown;   // sanitized with sanitizeSignalSettings
    cooldowns?: unknown;  // sanitized with sanitizeEngineCooldowns
    /** Called with the signals of one pass. A returned promise is awaited for error logging only. */
    onSignals: (signals: EngineSignal[], kind: EngineKind) => void | Promise<void>;
    /**
     * Fired shadow-rule events (utils/shadowRules.ts), measured only: never pass through onSignals, the burst
     * guard, Telegram or any feed. Without this callback the shadow rules stay off (no arming, no requests).
     */
    onShadowSignals?: (signals: ShadowSignal[]) => void | Promise<void>;
    /** Called whenever a cooldown stamp was added (the caller persists them, throttled). */
    onStateChange?: (cooldowns: EngineCooldowns) => void;
    log?: EngineLogger;
    deps?: Partial<Omit<EngineDeps, 'timing' | 'urls'>> & { timing?: Partial<EngineTiming>; urls?: Partial<EngineUrls> };
}

export type ScanKind = 'momentum' | 'volume' | 'funding';

export interface EngineStatusSnapshot {
    running: boolean;
    startedAt: number | null;
    streams: Record<StreamKey, StreamState>;
    streamUrls: Record<StreamKey, string | null>;
    lastScan: Record<ScanKind, number | null>;
    stats: EngineStats;
    settings: SignalSettings;
    activeFunding: FundingRegimeEntry[];
    emitted: Record<ScanKind, number>;
    meta: {
        perps: number | null;
        fundingIntervals: number | null;
        settledFunding: number | null;
        metaLoadedAt: number | null;
        settledLoadedAt: number | null;
    };
    /** Shadow rule Shadow_SqueezeFuel (in memory; absent while the shadow rules are off). */
    shadow?: ShadowStatus;
}

export interface Engine {
    start(): void;
    stop(): void;
    /** Applies new settings (sanitized). A changed threshold re-seeds that engine silently. */
    updateSettings(settings: unknown): SignalSettings;
    getStatus(): EngineStatusSnapshot;
    getCooldowns(): EngineCooldowns;
    /** Runs the given passes right away (all three when omitted). */
    scanNow(kinds?: readonly ScanKind[]): void;
    /** Runs the shadow-rule check right away (tests; it also runs every SQUEEZE_FUEL_RULES.checkEveryMs). */
    checkShadowNow(): Promise<void>;
}
