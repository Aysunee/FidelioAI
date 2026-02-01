
import { Trade } from './types';

// Default tag categories for trade classification
export const DEFAULT_TAGS = [
    'scalp',
    'swing',
    'breakout',
    'reversal',
    'trend',
    'range',
    'news',
    'pattern',
];

export const DEFAULT_EMOTIONS = [
    { id: 'confident', label: 'Confident', color: 'emerald' },
    { id: 'fearful', label: 'Fearful', color: 'amber' },
    { id: 'greedy', label: 'Greedy', color: 'rose' },
    { id: 'fomo', label: 'FOMO', color: 'orange' },
    { id: 'disciplined', label: 'Disciplined', color: 'purple' },
];

export const MOCK_TRADES: Trade[] = [
    { id: '1', status: 'WIN', date: 'Sep 12, 2019', time: '09:45', symbol: 'BTC', entry: 50000, exit: 52000, size: 0.1, side: 'LONG', returnVal: 200, returnPct: 4, setups: ['Breakout'], efficiency: 85, tags: ['scalp', 'trend'], emotion: 'confident' },
    { id: '2', status: 'LOSS', date: 'Sep 11, 2019', time: '10:15', symbol: 'ETH', entry: 3000, exit: 2900, size: 2, side: 'LONG', returnVal: 200, returnPct: 3.3, setups: ['Pullback'], efficiency: 40, tags: ['swing', 'reversal'], emotion: 'fomo' },
    { id: '3', status: 'OPEN', date: new Date().toISOString().split('T')[0], time: '21:40', symbol: 'SOL', entry: 150, size: 10, side: 'LONG', setups: ['Trend Follow'], efficiency: 0, tags: ['swing'], emotion: 'confident' },
];

export const AREA_CHART_DATA = [
    { name: 'Jan', value: 1200 },
    { name: 'Feb', value: 1800 },
    { name: 'Mar', value: 1500 },
    { name: 'Apr', value: 2400 },
    { name: 'May', value: 2200 },
    { name: 'Jun', value: 3000 },
];
