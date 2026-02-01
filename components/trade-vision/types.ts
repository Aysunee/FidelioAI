
export interface Trade {
    id: string;
    status: 'WIN' | 'LOSS' | 'OPEN';
    date: string;
    time?: string;
    symbol: string;
    entry: number;
    exit?: number;
    size: number;
    side: 'LONG' | 'SHORT';
    returnVal?: number;
    returnPct?: number;
    setups: string[];
    efficiency: number;
    notes?: string;
    images?: string[];
    tags?: string[]; // NEW: Custom tags for categorization
    emotion?: 'confident' | 'fearful' | 'greedy' | 'fomo' | 'disciplined'; // NEW: Emotional state
}

export interface ChartData {
    name: string;
    value: number;
}
