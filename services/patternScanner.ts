import { detectPatterns, Candle, PatternResult } from '../utils/patternRecognition';

// Top 20 volatile coins to scan (can be expanded)
const SCAN_SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
    'ADAUSDT', 'AVAXUSDT', 'DOGEUSDT', 'DOTUSDT', 'LINKUSDT',
    'MATICUSDT', 'SHIBUSDT', 'LTCUSDT', 'TRXUSDT', 'UNIUSDT',
    'ATOMUSDT', 'ETCUSDT', 'FILUSDT', 'APTUSDT', 'ARBUSDT',
    'OPUSDT', 'SUIUSDT', 'PEPEUSDT', 'RNDRUSDT', 'INJUSDT'
];

export interface DetectedPattern extends PatternResult {
    id: string;
    symbol: string;
    timestamp: number;
    timeframe: '15m' | '1h' | '4h';
}

class PatternScanner {
    private isScanning: boolean = false;
    private listeners: ((pattern: DetectedPattern) => void)[] = [];

    constructor() { }

    subscribe(callback: (pattern: DetectedPattern) => void) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
        };
    }

    private notify(pattern: DetectedPattern) {
        this.listeners.forEach(cb => cb(pattern));
    }

    async fetchCandles(symbol: string, interval: string = '15m', limit: number = 30): Promise<Candle[]> {
        try {
            const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
            const data = await response.json();

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

    async scanSymbol(symbol: string) {
        // Scan 15m timeframe for now (best for day trading patterns)
        const candles = await this.fetchCandles(symbol, '15m', 30);
        if (candles.length < 20) return;

        const result = detectPatterns(candles);

        if (result.pattern !== 'NONE') {
            const pattern: DetectedPattern = {
                ...result,
                id: `pat_${symbol}_${Date.now()}`,
                symbol,
                timestamp: Date.now(),
                timeframe: '15m'
            };
            this.notify(pattern);
        }
    }

    async startScanning() {
        if (this.isScanning) return;
        this.isScanning = true;

        console.log('Starting Pattern Scanner...');

        const scanLoop = async () => {
            if (!this.isScanning) return;

            // Scan symbols in batches to avoid rate limits
            for (const symbol of SCAN_SYMBOLS) {
                if (!this.isScanning) break;
                await this.scanSymbol(symbol);
                // Small delay between requests
                await new Promise(resolve => setTimeout(resolve, 200));
            }

            // Wait 60 seconds before next full scan
            setTimeout(scanLoop, 60000);
        };

        scanLoop();
    }

    stopScanning() {
        this.isScanning = false;
    }
}

export const patternScanner = new PatternScanner();
