import { detectPatterns, Candle, PatternResult } from '../utils/patternRecognition';

// 25 liquid spot pairs. MATIC and RNDR no longer trade on Binance spot (status BREAK); their
// successors POL and RENDER do (verified against GET /api/v3/exchangeInfo).
const SCAN_SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
    'ADAUSDT', 'AVAXUSDT', 'DOGEUSDT', 'DOTUSDT', 'LINKUSDT',
    'POLUSDT', 'SHIBUSDT', 'LTCUSDT', 'TRXUSDT', 'UNIUSDT',
    'ATOMUSDT', 'ETCUSDT', 'FILUSDT', 'APTUSDT', 'ARBUSDT',
    'OPUSDT', 'SUIUSDT', 'PEPEUSDT', 'RENDERUSDT', 'INJUSDT'
];

export interface DetectedPattern extends PatternResult {
    id: string;
    symbol: string;
    timestamp: number;
    timeframe: '15m' | '1h' | '4h';
}

const SCAN_INTERVAL = '15m';
const SCAN_INTERVAL_MS = 15 * 60 * 1000;
const LOOP_PAUSE_MS = 60 * 1000;
const REQUEST_GAP_MS = 200;
const REPORT_MEMORY_MS = 24 * 60 * 60 * 1000;

interface ReportedFormation {
    poleEndTime: number; // open time of the last pole candle of the formation reported last
    at: number;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

class PatternScanner {
    private running: boolean = false;
    // Every start gets a new generation; a loop from an older generation exits at its next check,
    // so stop() + start() can never leave two loops running in parallel.
    private generation: number = 0;
    private loopTimer: ReturnType<typeof setTimeout> | null = null;
    private listeners: ((pattern: DetectedPattern) => void)[] = [];
    // symbol+timeframe+pattern -> the formation reported last. The same formation (same pole, or a pole
    // overlapping it) is reported ONCE, not again on every new candle while it stays visible.
    private reported = new Map<string, ReportedFormation>();

    constructor() { }

    subscribe(callback: (pattern: DetectedPattern) => void) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }

    private notify(pattern: DetectedPattern) {
        this.listeners.forEach(cb => {
            try {
                cb(pattern);
            } catch (e) {
                console.error('Pattern listener failed', e);
            }
        });
    }

    private isCurrent(generation: number) {
        return this.running && generation === this.generation;
    }

    async fetchCandles(symbol: string, interval: string = SCAN_INTERVAL, limit: number = 30): Promise<Candle[]> {
        try {
            const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
            if (!response.ok) return [];
            const data = await response.json();
            if (!Array.isArray(data)) return [];

            // Binance kline format: [openTime, open, high, low, close, volume, ...]
            return data.map((d: any) => ({
                openTime: d[0],
                open: parseFloat(d[1]),
                high: parseFloat(d[2]),
                low: parseFloat(d[3]),
                close: parseFloat(d[4]),
                volume: parseFloat(d[5])
            }));
        } catch (error) {
            console.error(`Failed to fetch candles for ${symbol}:`, error);
            return [];
        }
    }

    async scanSymbol(symbol: string, generation: number = this.generation) {
        // Scan 15m timeframe for now (best for day trading patterns)
        const candles = await this.fetchCandles(symbol, SCAN_INTERVAL, 31);
        if (!this.isCurrent(generation)) return;

        // Only closed candles: the last kline is still forming and would change the result every minute.
        const now = Date.now();
        const closed = candles.filter(c => c.openTime + SCAN_INTERVAL_MS <= now);
        if (closed.length < 20) return;

        const result = detectPatterns(closed);
        if (result.pattern === 'NONE') return;

        const lastClosed = closed[closed.length - 1];
        const poleStart = result.poleStartTime ?? lastClosed.openTime;
        const poleEnd = result.poleEndTime ?? lastClosed.openTime;
        const key = `${symbol}_${SCAN_INTERVAL}_${result.pattern}`;
        const previous = this.reported.get(key);
        // A new formation needs a pole that starts after the previously reported pole ended. As the
        // 20-candle window slides, the "best pole" can shift by a candle or two inside the same move;
        // that overlap is still the same formation.
        if (previous && poleStart <= previous.poleEndTime) return;
        this.reported.set(key, { poleEndTime: poleEnd, at: now });

        const pattern: DetectedPattern = {
            ...result,
            id: `pat_${key}_${poleStart}`,
            symbol,
            timestamp: now,
            timeframe: SCAN_INTERVAL
        };
        this.notify(pattern);
    }

    private pruneReported() {
        const cutoff = Date.now() - REPORT_MEMORY_MS;
        this.reported.forEach((entry, key) => {
            if (entry.at < cutoff) this.reported.delete(key);
        });
    }

    startScanning() {
        if (this.running) return;
        this.running = true;
        const generation = ++this.generation;
        // Dedup is valid only within one run: a new subscriber (e.g. after re-login) must receive
        // the formations that are currently visible once.
        this.reported.clear();

        const scanLoop = async () => {
            this.loopTimer = null;
            if (!this.isCurrent(generation)) return;

            // Scan symbols one by one to stay well below Binance rate limits
            for (const symbol of SCAN_SYMBOLS) {
                if (!this.isCurrent(generation)) return;
                await this.scanSymbol(symbol, generation);
                if (!this.isCurrent(generation)) return;
                await sleep(REQUEST_GAP_MS);
            }

            this.pruneReported();
            if (!this.isCurrent(generation)) return;
            // Wait before next full scan
            this.loopTimer = setTimeout(scanLoop, LOOP_PAUSE_MS);
        };

        void scanLoop();
    }

    stopScanning() {
        this.running = false;
        this.generation++;
        if (this.loopTimer) {
            clearTimeout(this.loopTimer);
            this.loopTimer = null;
        }
    }
}

export const patternScanner = new PatternScanner();
