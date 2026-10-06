// The engine loop: feeds the pure evaluators of utils/signalEngines.ts with live Binance data and hands
// their output to the caller. Same cadence as the browser engine had (momentum 6 s, volume 15 s,
// funding 10 s); the per-pass caps live in the evaluators.
//
// Start-up never announces: every evaluator starts with a fresh state, so its first pass only seeds
// (records the current condition of every symbol). Cooldown stamps come from the caller (persisted
// across restarts) and go back through onStateChange whenever a signal fired.

import type { FuturesTicker, Ticker } from '../types';
import {
    EMPTY_ENGINE_STAT,
    buildFundingRows,
    createFundingEngineState,
    createMomentumState,
    createVolumeState,
    evaluateFunding,
    evaluateMomentum,
    evaluateVolume,
    sanitizeEngineCooldowns,
    sanitizeSignalSettings,
    type EngineCooldowns,
    type EngineKind,
    type EngineSignal,
    type EngineStat,
    type FundingRegimeEntry,
    type HourTicker,
    type SignalSettings,
} from '../utils/signalEngines';
import {
    DEFAULT_STREAM_URLS,
    applyFuturesMark,
    applyFuturesMini,
    applySpotHour,
    applySpotMini,
    loadCryptoPerps,
    loadFundingIntervals,
    loadLatestSettled,
    settledExpiry,
    type SettledFunding,
} from './binance';
import { defaultSocketFactory, openStream, type StreamHandle } from './stream';
import {
    STREAM_KEYS,
    consoleLogger,
    type CreateEngineOptions,
    type Engine,
    type EngineDeps,
    type EngineStatusSnapshot,
    type EngineTiming,
    type FetchLike,
    type ScanKind,
    type StreamKey,
    type StreamState,
} from './types';

export const DEFAULT_TIMING: EngineTiming = {
    momentumMs: 6000,
    volumeMs: 15000,
    fundingMs: 10000,
    staleMs: 60_000,
    watchdogMs: 5000,
    futuresFreshMs: 90_000,
    metaTtlMs: 60 * 60 * 1000,
    metaRetryMs: 60 * 1000,
    settledTtlMs: 10 * 60 * 1000,
    pruneMs: 60 * 60 * 1000,
    autoScan: true,
};

const SYMBOL_MEMORY_MS = 24 * 60 * 60 * 1000; // forget symbols not seen for a day (delisted)
const HOUR_ROW_MEMORY_MS = 60 * 60 * 1000;

const STREAM_NAMES: Record<StreamKey, string> = {
    spotMini: 'Spot miniTicker',
    spotHour: 'Spot 1s ticker',
    futuresMark: 'Vadeli markPrice',
    futuresMini: 'Vadeli miniTicker',
};

const KIND_OF_SCAN: Record<ScanKind, EngineKind> = { momentum: 'MOMENTUM', volume: 'VOLUME', funding: 'FUNDING' };

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const lazyGlobalFetch: FetchLike = (url, init) => {
    if (typeof globalThis.fetch !== 'function') return Promise.reject(new Error('fetch yok (Node 18+ gerekir)'));
    return globalThis.fetch(url, init) as unknown as ReturnType<FetchLike>;
};

export function createEngine(options: CreateEngineOptions): Engine {
    if (!options || typeof options.onSignals !== 'function') throw new Error('createEngine: onSignals gerekli');
    const log = options.log ?? consoleLogger;
    const deps: EngineDeps = {
        now: options.deps?.now ?? (() => Date.now()),
        fetch: options.deps?.fetch ?? lazyGlobalFetch,
        createSocket: options.deps?.createSocket ?? defaultSocketFactory,
        urls: { ...DEFAULT_STREAM_URLS, ...(options.deps?.urls ?? {}) },
        timing: { ...DEFAULT_TIMING, ...(options.deps?.timing ?? {}) },
    };
    const { now, timing } = deps;

    let settings: SignalSettings = sanitizeSignalSettings(options.settings);
    let cooldowns: EngineCooldowns = sanitizeEngineCooldowns(options.cooldowns, now());

    // Live data
    const spot = new Map<string, Ticker>();
    const hour = new Map<string, HourTicker>();
    const futures = new Map<string, FuturesTicker>();
    const futuresSeenAt = new Map<string, number>();
    let futuresMarkAt = 0;

    // Futures metadata (REST)
    let perps: Set<string> | null = null;
    let intervals: Map<string, number> | null = null;
    let metaLoadedAt = 0;
    let metaFailedAt = 0;
    let metaInFlight = false;
    // Loaded every 10 min like the Terminal's. evaluateFunding does not take settled rates (its settled-rate
    // FLIPs are start-up events, which it never emits), so they are only kept and reported for now.
    let settled: Map<string, SettledFunding> | null = null;
    let settledLoadedAt = 0;
    let settledExpires = 0;
    let settledInFlight = false;

    // Evaluator state
    let momentumState = createMomentumState();
    let volumeState = createVolumeState();
    let fundingState = createFundingEngineState();
    const stats: { momentum: EngineStat; volume: EngineStat; funding: EngineStat; updatedAt: number } = {
        momentum: EMPTY_ENGINE_STAT,
        volume: EMPTY_ENGINE_STAT,
        funding: EMPTY_ENGINE_STAT,
        updatedAt: 0,
    };
    const lastScan: Record<ScanKind, number | null> = { momentum: null, volume: null, funding: null };
    const emitted: Record<ScanKind, number> = { momentum: 0, volume: 0, funding: 0 };
    let active: FundingRegimeEntry[] = [];

    let running = false;
    let startedAt: number | null = null;
    let streams: Partial<Record<StreamKey, StreamHandle>> = {};
    let timers: ReturnType<typeof setInterval>[] = [];
    const passErrors: Record<ScanKind, number> = { momentum: 0, volume: 0, funding: 0 };

    const streamState = (key: StreamKey): StreamState => streams[key]?.state() ?? 'down';

    const commitCooldowns = (next: EngineCooldowns, at: number) => {
        cooldowns = sanitizeEngineCooldowns(next, at);
        if (!options.onStateChange) return;
        try {
            options.onStateChange(cooldowns);
        } catch (err) {
            log.error(`[engine] Bekleme süreleri iletilemedi: ${errorText(err)}`);
        }
    };

    const emit = (signals: EngineSignal[], scan: ScanKind) => {
        if (signals.length === 0) return;
        emitted[scan] += signals.length;
        Promise.resolve()
            .then(() => options.onSignals(signals, KIND_OF_SCAN[scan]))
            .catch((err) => log.error(`[engine] Sinyaller işlenemedi (${scan}): ${errorText(err)}`));
    };

    const momentumPass = () => {
        if (!running) return;
        if (streamState('spotMini') !== 'connected' || spot.size === 0) {
            stats.momentum = EMPTY_ENGINE_STAT;
            return;
        }
        const t = now();
        const result = evaluateMomentum(Array.from(spot.values()), settings.momentum, momentumState, cooldowns.momentum, t);
        momentumState = result.state;
        stats.momentum = result.stat;
        stats.updatedAt = t;
        lastScan.momentum = t;
        if (result.cooldowns !== cooldowns.momentum) commitCooldowns({ ...cooldowns, momentum: result.cooldowns }, t);
        emit(result.signals, 'momentum');
    };

    const volumePass = () => {
        if (!running) return;
        if (streamState('spotMini') !== 'connected' || spot.size === 0) {
            stats.volume = EMPTY_ENGINE_STAT;
            return;
        }
        const t = now();
        const result = evaluateVolume(Array.from(spot.values()), hour, settings.volume, volumeState, cooldowns.volume, t);
        volumeState = result.state;
        stats.volume = result.stat;
        stats.updatedAt = t;
        lastScan.volume = t;
        if (result.cooldowns !== cooldowns.volume) commitCooldowns({ ...cooldowns, volume: result.cooldowns }, t);
        emit(result.signals, 'volume');
    };

    const fundingPass = () => {
        if (!running) return;
        const t = now();
        // Unknown intervals would make the 8h-equivalent rate of most (4h) contracts twice too small.
        if (streamState('futuresMark') !== 'connected' || !perps || !intervals || t - futuresMarkAt > timing.futuresFreshMs) {
            stats.funding = EMPTY_ENGINE_STAT;
            active = [];
            return;
        }
        const rows = buildFundingRows(Array.from(futures.values()), perps, intervals);
        const result = evaluateFunding(rows, settings.funding, fundingState, cooldowns.funding, t);
        fundingState = result.state;
        stats.funding = result.stat;
        stats.updatedAt = t;
        lastScan.funding = t;
        active = result.active;
        if (result.cooldowns !== cooldowns.funding) commitCooldowns({ ...cooldowns, funding: result.cooldowns }, t);
        emit(result.signals, 'funding');
    };

    const PASSES: Record<ScanKind, () => void> = { momentum: momentumPass, volume: volumePass, funding: fundingPass };

    const guarded = (scan: ScanKind) => () => {
        try {
            PASSES[scan]();
        } catch (err) {
            passErrors[scan]++;
            if (passErrors[scan] === 1 || passErrors[scan] % 100 === 0) {
                log.error(`[engine] ${scan} taraması başarısız (${passErrors[scan]}. kez): ${errorText(err)}`);
            }
        }
    };

    // --- REST metadata -----------------------------------------------------------------------
    const refreshMeta = async () => {
        if (!running || metaInFlight) return;
        const t = now();
        const due = !perps || !intervals || t - metaLoadedAt >= timing.metaTtlMs;
        if (!due || t - metaFailedAt < timing.metaRetryMs) return;
        metaInFlight = true;
        try {
            const [p, i] = await Promise.all([loadCryptoPerps(deps.fetch), loadFundingIntervals(deps.fetch)]);
            if (!running) return;
            const first = !perps;
            perps = p;
            intervals = i;
            metaLoadedAt = now();
            if (first) log.info(`[engine] Vadeli meta verisi yüklendi: ${p.size} kripto perp, ${i.size} fonlama aralığı`);
        } catch (err) {
            metaFailedAt = now();
            // A failed refresh keeps the last good lists.
            log.warn(`[engine] Vadeli meta verisi yüklenemedi (${perps ? 'eski liste kullanılıyor' : 'fonlama motoru bekliyor'}): ${errorText(err)}`);
        } finally {
            metaInFlight = false;
        }
    };

    const refreshSettled = async () => {
        if (!running || settledInFlight || now() < settledExpires) return;
        settledInFlight = true;
        try {
            const { map, complete } = await loadLatestSettled(deps.fetch);
            if (!running) return;
            settled = map;
            settledLoadedAt = now();
            settledExpires = settledExpiry(settledLoadedAt, complete, timing.settledTtlMs);
        } catch (err) {
            settledExpires = now() + timing.metaRetryMs;
            log.warn(`[engine] Son fonlama ödemeleri alınamadı: ${errorText(err)}`);
        } finally {
            settledInFlight = false;
        }
    };

    const prune = () => {
        const t = now();
        let newestSpot = 0;
        for (const row of spot.values()) if (Number.isFinite(row.updatedAt) && row.updatedAt > newestSpot) newestSpot = row.updatedAt;
        for (const [symbol, row] of spot) {
            if (!(newestSpot - row.updatedAt <= SYMBOL_MEMORY_MS)) spot.delete(symbol);
        }
        for (const [symbol, row] of hour) if (t - row.receivedAt > HOUR_ROW_MEMORY_MS) hour.delete(symbol);
        for (const [symbol, at] of futuresSeenAt) {
            if (t - at > SYMBOL_MEMORY_MS) {
                futuresSeenAt.delete(symbol);
                futures.delete(symbol);
            }
        }
        cooldowns = sanitizeEngineCooldowns(cooldowns, t);
    };

    const openStreams = () => {
        const handlers: Record<StreamKey, (payload: unknown, at: number) => void> = {
            spotMini: (payload) => { applySpotMini(payload, spot); },
            spotHour: (payload, at) => { applySpotHour(payload, at, hour); },
            futuresMark: (payload, at) => {
                if (applyFuturesMark(payload, futures, futuresSeenAt, at) > 0) futuresMarkAt = at;
            },
            futuresMini: (payload, at) => { applyFuturesMini(payload, futures, futuresSeenAt, at); },
        };
        streams = {};
        for (const key of STREAM_KEYS) {
            streams[key] = openStream({
                name: STREAM_NAMES[key],
                urls: deps.urls[key],
                onData: handlers[key],
                createSocket: deps.createSocket,
                now,
                log,
                staleMs: timing.staleMs,
                watchdogMs: timing.watchdogMs,
            });
        }
    };

    const background = (task: () => Promise<void>) => () => {
        task().catch((err) => log.error(`[engine] Arka plan görevi başarısız: ${errorText(err)}`));
    };

    const start = () => {
        if (running) return;
        running = true;
        startedAt = now();
        momentumState = createMomentumState();
        volumeState = createVolumeState();
        fundingState = createFundingEngineState();
        stats.momentum = EMPTY_ENGINE_STAT;
        stats.volume = EMPTY_ENGINE_STAT;
        stats.funding = EMPTY_ENGINE_STAT;
        stats.updatedAt = 0;
        active = [];
        openStreams();
        const meta = background(refreshMeta);
        const settledTask = background(refreshSettled);
        meta();
        settledTask();
        timers = [
            setInterval(meta, Math.min(timing.metaRetryMs, timing.metaTtlMs)),
            setInterval(settledTask, Math.min(timing.metaRetryMs, timing.settledTtlMs)),
            setInterval(prune, timing.pruneMs),
        ];
        if (timing.autoScan) {
            timers.push(
                setInterval(guarded('momentum'), timing.momentumMs),
                setInterval(guarded('volume'), timing.volumeMs),
                setInterval(guarded('funding'), timing.fundingMs),
            );
        }
        log.info(`[engine] Sinyal motoru başladı (momentum ${timing.momentumMs / 1000} sn, hacim ${timing.volumeMs / 1000} sn, fonlama ${timing.fundingMs / 1000} sn)`);
    };

    const stop = () => {
        if (!running) return;
        running = false;
        startedAt = null;
        timers.forEach((timer) => clearInterval(timer));
        timers = [];
        for (const key of STREAM_KEYS) streams[key]?.close();
        streams = {};
        spot.clear();
        hour.clear();
        futures.clear();
        futuresSeenAt.clear();
        futuresMarkAt = 0;
        stats.momentum = EMPTY_ENGINE_STAT;
        stats.volume = EMPTY_ENGINE_STAT;
        stats.funding = EMPTY_ENGINE_STAT;
        active = [];
        log.info('[engine] Sinyal motoru durduruldu');
    };

    const updateSettings = (raw: unknown): SignalSettings => {
        settings = sanitizeSignalSettings(raw);
        // The evaluators compare the threshold with the one they seeded with: a change re-seeds silently.
        // Run the passes at once so the counters follow the new thresholds immediately.
        if (running) setImmediate(() => scanNow());
        return settings;
    };

    const scanNow = (kinds: readonly ScanKind[] = ['momentum', 'volume', 'funding']) => {
        for (const kind of kinds) guarded(kind)();
    };

    const getStatus = (): EngineStatusSnapshot => {
        const streamStates = {} as Record<StreamKey, StreamState>;
        const streamUrls = {} as Record<StreamKey, string | null>;
        for (const key of STREAM_KEYS) {
            streamStates[key] = streamState(key);
            streamUrls[key] = streams[key]?.url() ?? null;
        }
        return {
            running,
            startedAt,
            streams: streamStates,
            streamUrls,
            lastScan: { ...lastScan },
            stats: { momentum: stats.momentum, volume: stats.volume, funding: stats.funding, updatedAt: stats.updatedAt },
            settings,
            activeFunding: active.slice(),
            emitted: { ...emitted },
            meta: {
                perps: perps ? perps.size : null,
                fundingIntervals: intervals ? intervals.size : null,
                settledFunding: settled ? settled.size : null,
                metaLoadedAt: metaLoadedAt || null,
                settledLoadedAt: settledLoadedAt || null,
            },
        };
    };

    return {
        start,
        stop,
        updateSettings,
        getStatus,
        getCooldowns: () => cooldowns,
        scanNow,
    };
}
