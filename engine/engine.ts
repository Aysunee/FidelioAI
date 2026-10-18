// The engine loop: feeds the pure evaluators of utils/signalEngines.ts with live Binance data and hands
// their output to the caller. Same cadence as the browser engine had (momentum 6 s, volume 15 s,
// funding 10 s); the per-pass caps live in the evaluators.
//
// Start-up never announces: every evaluator starts with a fresh state, so its first pass only seeds
// (records the current condition of every symbol). Cooldown stamps come from the caller (persisted
// across restarts) and go back through onStateChange whenever a signal fired.
//
// Momentum and volume results pass the market-wide burst guard (applyBurstGuard) before onSignals: when
// the whole market moves, one aggregate 'MARKET' record goes out instead of dozens of single records.
// The evaluators have already stamped the cooldowns of every candidate, including the held-back ones;
// momentum entries beyond the per-pass cap that the guard folds into an aggregate (or promotes into the
// slots that held-back candidates freed) are stamped here.
// The guard state lives in memory only (a restart starts fresh; the evaluators' seeding prevents
// re-announcing).
//
// Liquidity gate (settings.universe.minMedianVolume, default 2 M USDT): momentum and volume only see spot pairs
// whose median daily quote volume over the last 30 completed days reaches the minimum (daily klines, loaded
// once a day for every USDT pair of the stream; pairs younger than 30 days never pass). Until the first load
// the two engines do not scan at all, so a restart cannot announce on an unfiltered universe. Funding is not
// gated (it runs on the perpetual universe). The medians live in memory only.
//
// Shadow rule Shadow_SqueezeFuel (utils/shadowRules.ts, only while the caller passes onShadowSignals): every
// EMITTED Momentum_24h_Up / Volume_Spike BUY arms its spot symbol when it has a crypto perpetual; the baseline
// open interest is fetched right after arming, a check every 5 min gates funding + price and fetches the
// current open interest only when both hold. Fired events go to onShadowSignals only (never onSignals). The
// shadow state is in memory only: a restart or a leader change loses the armed entries and the cooldowns.

import type { FuturesTicker, Ticker } from '../types';
import {
    EMPTY_ENGINE_STAT,
    applyBurstGuard,
    buildFundingRows,
    createBurstGuardState,
    createFundingEngineState,
    createMomentumState,
    createVolumeState,
    evaluateFunding,
    evaluateMomentum,
    evaluateVolume,
    filterLiquid,
    isExcludedSpotBase,
    LIQUIDITY_MEDIAN_DAYS,
    SPOT_UNIVERSE,
    sanitizeEngineCooldowns,
    sanitizeSignalSettings,
    stampMomentumCooldowns,
    type BurstGuardState,
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
    loadMedianDailyVolumes,
    loadOpenInterest,
    settledExpiry,
    type SettledFunding,
} from './binance';
import {
    SQUEEZE_FUEL_RULES,
    armSqueezeFuel,
    createSqueezeFuelState,
    fireSqueezeFuel,
    planSqueezeFuelCheck,
    setSqueezeBaseline,
    squeezeFundingF8,
    squeezeFuelStatus,
    type ShadowSignal,
    type SqueezeArm,
    type SqueezeFuelState,
    type SqueezeMarket,
} from '../utils/shadowRules';
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
    liquidityTtlMs: 24 * 60 * 60 * 1000,
    liquidityRetryMs: 2 * 60 * 1000,
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
const DEFAULT_FUNDING_INTERVAL_HOURS = 8; // a contract missing from the LOADED interval map settles every 8 h

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const formatMillions = (usd: number): string => `${(usd / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} M USDT`;

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

    // Liquidity gate (REST daily klines): symbol -> 30-day median daily quote volume
    let medians: Map<string, number> | null = null;
    let mediansYoung = 0;
    let liquidityLoadedAt = 0;
    let liquidityFailedAt = 0;
    let liquidityInFlight = false;
    let liquidityWaitLogged = false;

    // Evaluator state
    let momentumState = createMomentumState();
    let volumeState = createVolumeState();
    let fundingState = createFundingEngineState();
    let burstState: BurstGuardState = createBurstGuardState();
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

    // Shadow rules (measured only; see the header)
    const shadowOn = typeof options.onShadowSignals === 'function';
    let shadowState: SqueezeFuelState = createSqueezeFuelState();
    let shadowGen = 0;          // bumped by start / stop: answers of an earlier run are dropped
    let shadowChecking = false;
    let shadowFetchErrors = 0;
    const baselineInFlight = new Set<string>();

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

    // --- shadow rules --------------------------------------------------------------------------
    const fetchOpenInterest = async (perp: string): Promise<number | null> => {
        try {
            return await loadOpenInterest(deps.fetch, perp);
        } catch (err) {
            shadowFetchErrors++;
            if (shadowFetchErrors === 1 || shadowFetchErrors % 100 === 0) {
                log.warn(`[engine] Gölge kural: açık pozisyon alınamadı (${perp}, ${shadowFetchErrors}. kez): ${errorText(err)}`);
            }
            return null;
        }
    };

    const fetchBaseline = (entry: SqueezeArm) => {
        const key = `${entry.spot}:${entry.armedAt}`;
        if (baselineInFlight.has(key)) return;
        baselineInFlight.add(key);
        const gen = shadowGen;
        void fetchOpenInterest(entry.perp)
            .then((oi) => {
                if (!running || gen !== shadowGen || oi === null) return;
                shadowState = setSqueezeBaseline(shadowState, entry.spot, entry.armedAt, oi);
            })
            .finally(() => baselineInFlight.delete(key));
    };

    const armShadow = (signals: readonly EngineSignal[]) => {
        if (!shadowOn) return;
        try {
            const result = armSqueezeFuel(shadowState, signals, perps, now());
            shadowState = result.state;
            for (const entry of result.armed) fetchBaseline(entry);
        } catch (err) {
            log.error(`[engine] Gölge kural kurulamadı: ${errorText(err)}`);
        }
    };

    // Same freshness rules as the funding pass: mark-price stream connected and recent, intervals loaded.
    const shadowMarket = (t: number): SqueezeMarket => {
        const fundingFresh = streamState('futuresMark') === 'connected' && !!intervals && t - futuresMarkAt <= timing.futuresFreshMs;
        const spotLive = streamState('spotMini') === 'connected';
        return {
            fundingF8: (perp) => {
                if (!fundingFresh || !intervals) return null;
                const row = futures.get(perp);
                const seen = futuresSeenAt.get(perp);
                if (!row || !(row.nextFundingTime > 0) || seen === undefined || t - seen > timing.futuresFreshMs) return null;
                const interval = intervals.get(perp);
                return squeezeFundingF8(row.fundingRate, typeof interval === 'number' && interval > 0 ? interval : DEFAULT_FUNDING_INTERVAL_HOURS);
            },
            spotPrice: (symbol) => {
                if (!spotLive) return null;
                const row = spot.get(symbol);
                return row && Number.isFinite(row.lastPrice) && row.lastPrice > 0 ? row.lastPrice : null;
            },
        };
    };

    const emitShadow = (signals: ShadowSignal[]) => {
        if (signals.length === 0 || !options.onShadowSignals) return;
        const deliver = options.onShadowSignals;
        Promise.resolve()
            .then(() => deliver(signals))
            .catch((err) => log.error(`[engine] Gölge kural kayıtları işlenemedi: ${errorText(err)}`));
    };

    const checkShadow = async () => {
        if (!shadowOn || !running || shadowChecking || shadowState.armed.length === 0) return;
        shadowChecking = true;
        const gen = shadowGen;
        try {
            const t = now();
            const plan = planSqueezeFuelCheck(shadowState, shadowMarket(t), t);
            shadowState = plan.state;
            for (const entry of plan.baseline) fetchBaseline(entry);
            const fired: ShadowSignal[] = [];
            for (const candidate of plan.candidates) {
                const oi = await fetchOpenInterest(candidate.perp);
                if (!running || gen !== shadowGen) return;
                if (oi === null) continue;
                const result = fireSqueezeFuel(shadowState, candidate, oi, now());
                shadowState = result.state;
                if (result.signal) fired.push(result.signal);
            }
            for (const signal of fired) log.info(`[engine] Gölge kural kaydı (ölçüm için): ${signal.symbol} ${signal.strategy}`);
            emitShadow(fired);
        } finally {
            shadowChecking = false;
        }
    };

    const emit = (signals: EngineSignal[], scan: ScanKind) => {
        if (signals.length === 0) return;
        emitted[scan] += signals.length;
        Promise.resolve()
            .then(() => options.onSignals(signals, KIND_OF_SCAN[scan]))
            .catch((err) => log.error(`[engine] Sinyaller işlenemedi (${scan}): ${errorText(err)}`));
        if (scan !== 'funding') armShadow(signals);
    };

    const liquidityOn = () => settings.universe.minMedianVolume > 0;

    /**
     * Spot tickers the momentum / volume engines may see, or null while the liquidity gate is on and the
     * medians have not been loaded yet (the engines then skip the pass instead of scanning unfiltered).
     */
    const gatedSpot = (): Ticker[] | null => {
        const all = Array.from(spot.values());
        if (!liquidityOn()) return all;
        if (!medians) {
            if (!liquidityWaitLogged) {
                liquidityWaitLogged = true;
                log.info('[engine] Likidite süzgeci: 30 günlük hacim medyanları yüklenene kadar momentum ve hacim motorları taramıyor');
            }
            return null;
        }
        return filterLiquid(all, medians, settings.universe.minMedianVolume);
    };

    const momentumPass = () => {
        if (!running) return;
        const tickers = streamState('spotMini') === 'connected' && spot.size > 0 ? gatedSpot() : null;
        if (!tickers) {
            stats.momentum = EMPTY_ENGINE_STAT;
            return;
        }
        const t = now();
        const result = evaluateMomentum(tickers, settings.momentum, momentumState, cooldowns.momentum, t);
        momentumState = result.state;
        stats.momentum = result.stat;
        stats.updatedAt = t;
        lastScan.momentum = t;
        // The evaluator stamped every emitted candidate (also the ones the burst guard holds back); entries
        // beyond its per-pass cap are stamped only when the guard folds them into a market-wide aggregate
        // or moves them into the slots that held-back candidates freed (promoted).
        const guarded = applyBurstGuard('MOMENTUM', result.signals, result.stat.universe, burstState, t, { overflow: result.overflow });
        burstState = guarded.state;
        const nextCooldowns = stampMomentumCooldowns(result.cooldowns, [...guarded.folded, ...guarded.promoted], t);
        if (nextCooldowns !== cooldowns.momentum) commitCooldowns({ ...cooldowns, momentum: nextCooldowns }, t);
        emit(guarded.signals, 'momentum');
    };

    const volumePass = () => {
        if (!running) return;
        const tickers = streamState('spotMini') === 'connected' && spot.size > 0 ? gatedSpot() : null;
        if (!tickers) {
            stats.volume = EMPTY_ENGINE_STAT;
            return;
        }
        const t = now();
        const result = evaluateVolume(tickers, hour, settings.volume, volumeState, cooldowns.volume, t);
        volumeState = result.state;
        stats.volume = result.stat;
        stats.updatedAt = t;
        lastScan.volume = t;
        if (result.cooldowns !== cooldowns.volume) commitCooldowns({ ...cooldowns, volume: result.cooldowns }, t);
        const guarded = applyBurstGuard('VOLUME', result.signals, result.stat.universe, burstState, t);
        burstState = guarded.state;
        emit(guarded.signals, 'volume');
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

    // Every USDT pair of the stream except the pegged bases (the 24h-volume / range checks of the spot universe
    // are per pass; the medians cover whatever the engines might look at over the day).
    const liquidityCandidates = (): string[] => {
        const out: string[] = [];
        for (const symbol of spot.keys()) {
            if (!symbol.endsWith(SPOT_UNIVERSE.quote)) continue;
            const base = symbol.slice(0, -SPOT_UNIVERSE.quote.length);
            if (!base || isExcludedSpotBase(base)) continue;
            out.push(symbol);
        }
        return out;
    };

    const refreshLiquidity = async () => {
        if (!running || liquidityInFlight || !liquidityOn()) return;
        const t = now();
        const due = !medians || t - liquidityLoadedAt >= timing.liquidityTtlMs;
        if (!due || t - liquidityFailedAt < timing.liquidityRetryMs) return;
        if (streamState('spotMini') !== 'connected' || spot.size === 0) return; // symbols come from the stream
        const symbols = liquidityCandidates();
        if (symbols.length === 0) return;
        liquidityInFlight = true;
        try {
            const load = await loadMedianDailyVolumes(deps.fetch, symbols, LIQUIDITY_MEDIAN_DAYS, now);
            if (!running) return;
            // A rate-limited or mostly failed load keeps the previous medians (or keeps the engines waiting).
            const usable = !load.aborted && load.failed <= Math.max(5, Math.ceil(symbols.length * 0.2));
            if (!usable) {
                liquidityFailedAt = now();
                log.warn(`[engine] Likidite süzgeci: hacim medyanları yüklenemedi (${load.failed} / ${symbols.length} istek başarısız${load.aborted ? ', Binance istek sınırı' : ''}); ${medians ? 'eski liste kullanılıyor' : 'motorlar bekliyor'}`);
                return;
            }
            const first = !medians;
            medians = load.medians;
            mediansYoung = load.young;
            liquidityLoadedAt = now();
            const passing = filterLiquid(Array.from(spot.values()), medians, settings.universe.minMedianVolume).length;
            log.info(`[engine] Likidite süzgeci ${first ? 'yüklendi' : 'yenilendi'}: ${symbols.length} parite, ${medians.size} medyan, ${load.young} genç (<${LIQUIDITY_MEDIAN_DAYS} gün), ${load.failed} hata; ${passing} parite ${formatMillions(settings.universe.minMedianVolume)} eşiğini geçiyor`);
        } catch (err) {
            liquidityFailedAt = now();
            log.warn(`[engine] Likidite süzgeci: hacim medyanları yüklenemedi: ${errorText(err)}`);
        } finally {
            liquidityInFlight = false;
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
        burstState = createBurstGuardState();
        shadowState = createSqueezeFuelState();
        shadowGen++;
        stats.momentum = EMPTY_ENGINE_STAT;
        stats.volume = EMPTY_ENGINE_STAT;
        stats.funding = EMPTY_ENGINE_STAT;
        stats.updatedAt = 0;
        active = [];
        openStreams();
        const meta = background(refreshMeta);
        const settledTask = background(refreshSettled);
        const liquidityTask = background(refreshLiquidity);
        meta();
        settledTask();
        timers = [
            setInterval(meta, Math.min(timing.metaRetryMs, timing.metaTtlMs)),
            setInterval(settledTask, Math.min(timing.metaRetryMs, timing.settledTtlMs)),
            // Checked often: the first load waits for the spot stream, later ones are due once a day.
            setInterval(liquidityTask, Math.min(timing.liquidityRetryMs, timing.liquidityTtlMs, 5000)),
            setInterval(prune, timing.pruneMs),
        ];
        if (timing.autoScan) {
            timers.push(
                setInterval(guarded('momentum'), timing.momentumMs),
                setInterval(guarded('volume'), timing.volumeMs),
                setInterval(guarded('funding'), timing.fundingMs),
            );
            if (shadowOn) timers.push(setInterval(background(checkShadow), SQUEEZE_FUEL_RULES.checkEveryMs));
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
        shadowState = createSqueezeFuelState();
        shadowGen++;
        baselineInFlight.clear();
        medians = null;
        mediansYoung = 0;
        liquidityLoadedAt = 0;
        liquidityFailedAt = 0;
        liquidityWaitLogged = false;
        stats.momentum = EMPTY_ENGINE_STAT;
        stats.volume = EMPTY_ENGINE_STAT;
        stats.funding = EMPTY_ENGINE_STAT;
        active = [];
        log.info('[engine] Sinyal motoru durduruldu');
    };

    const updateSettings = (raw: unknown): SignalSettings => {
        const before = settings.universe.minMedianVolume;
        settings = sanitizeSignalSettings(raw);
        // A changed liquidity minimum re-filters from the loaded medians: pairs that drop out stop being
        // evaluated, pairs that come in are seeded on their next sight (never announced on arrival). Switching
        // the gate on without medians makes the two engines wait for the load, which starts at the next tick.
        if (settings.universe.minMedianVolume !== before) liquidityFailedAt = 0;
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
            liquidity: {
                enabled: liquidityOn(),
                minMedianVolume: settings.universe.minMedianVolume,
                symbols: medians ? filterLiquid(Array.from(spot.values()), medians, settings.universe.minMedianVolume).length : null,
                known: medians ? medians.size : null,
                young: medians ? mediansYoung : null,
                loadedAt: liquidityLoadedAt || null,
            },
            ...(shadowOn ? { shadow: squeezeFuelStatus(shadowState, now()) } : {}),
        };
    };

    return {
        start,
        stop,
        updateSettings,
        getStatus,
        getCooldowns: () => cooldowns,
        scanNow,
        checkShadowNow: () => checkShadow().catch((err) => log.error(`[engine] Gölge kural kontrolü başarısız: ${errorText(err)}`)),
    };
}
