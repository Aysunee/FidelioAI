// Engine host bundle entry (built by `npm run build:engine` into server/build/engine.cjs).
//
// Everything a host process needs to run the three signal engines (momentum, volume, funding) 24/7:
// the engine factory, the settings / cooldown sanitizers and the Telegram helper. Free of Express,
// socket.io and MySQL, so the same core can later run as a worker on another machine.

export { createEngine, DEFAULT_TIMING } from './engine';
export { DEFAULT_STREAM_URLS } from './binance';
export {
    buildEngineTelegramText,
    createTelegramNotifier,
    meetsMinPriority,
    parsePriority,
    signalPriority,
    strategyLabel,
} from './notify';
export type { NotifiableSignal, SignalPriority, TelegramNotifier, TelegramResult } from './notify';
export { STREAM_KEYS, consoleLogger } from './types';
export type {
    CreateEngineOptions,
    Engine,
    EngineDeps,
    EngineLogger,
    EngineStatusSnapshot,
    EngineTiming,
    ScanKind,
    SocketFactory,
    SocketLike,
    StreamKey,
    StreamState,
} from './types';
export {
    DEFAULT_SIGNAL_SETTINGS,
    SIGNAL_SETTINGS_LIMITS,
    SIGNAL_SETTINGS_VERSION,
    createEngineCooldowns,
    sanitizeEngineCooldowns,
    sanitizeSignalSettings,
} from '../utils/signalEngines';
export type { EngineCooldowns, EngineKind, EngineSignal, EngineStats, SignalSettings } from '../utils/signalEngines';
