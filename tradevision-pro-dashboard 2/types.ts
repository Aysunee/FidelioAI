
export interface Trade {
  id: string;
  status: 'WIN' | 'LOSS';
  date: string;
  time?: string;
  symbol: string;
  entry: number;
  exit: number;
  size: number;
  side: 'LONG' | 'SHORT';
  returnVal: number;
  returnPct: number;
  setups: string[];
  efficiency: number;
  notes?: string;
  images?: string[];
}

export interface ChartData {
  name: string;
  value: number;
}
