
import { Trade } from './types';

export const MOCK_TRADES: Trade[] = [
  { id: '1', status: 'WIN', date: 'Sep 12, 2019', time: '09:45', symbol: 'ANY', entry: 3.7, exit: 2.3, size: 1500, side: 'LONG', returnVal: 2909, returnPct: 26, setups: ['EARNINGS WINN...'], efficiency: 85 },
  { id: '2', status: 'LOSS', date: 'Sep 11, 2019', time: '10:15', symbol: 'ANY', entry: 3.11, exit: 2.93, size: 1500, side: 'LONG', returnVal: 750, returnPct: 11, setups: ['CONTRACT WINN...'], efficiency: 40 },
  { id: '3', status: 'WIN', date: 'Sep 07, 2019', time: '11:00', symbol: 'ADBE', entry: 290, exit: 298, size: 700, side: 'LONG', returnVal: 5600, returnPct: 6, setups: ['GAP UP'], efficiency: 95 },
  { id: '4', status: 'WIN', date: 'Sep 06, 2019', time: '09:30', symbol: 'FNF', entry: 3.7, exit: 2.3, size: 1500, side: 'LONG', returnVal: 2909, returnPct: 4, setups: ['REVERSAL'], efficiency: 70 },
  { id: '5', status: 'LOSS', date: 'Sep 05, 2019', time: '14:20', symbol: 'AMZN', entry: 1920, exit: 1910, size: 300, side: 'LONG', returnVal: 400, returnPct: 12, setups: ['52 HIGH'], efficiency: 30 },
  { id: '6', status: 'LOSS', date: 'Sep 05, 2019', time: '13:00', symbol: 'BYND', entry: 3.7, exit: 2.3, size: 400, side: 'LONG', returnVal: 2909, returnPct: 3, setups: ['GAP DOWN'], efficiency: 20 },
  { id: '7', status: 'WIN', date: 'Sep 03, 2019', time: '10:45', symbol: 'AMZN', entry: 1912, exit: 1920, size: 1340, side: 'LONG', returnVal: 567, returnPct: 5, setups: ['DOUBLE TOP'], efficiency: 88 },
  { id: '8', status: 'WIN', date: 'Aug 25, 2019', time: '15:30', symbol: 'FB', entry: 188, exit: 190, size: 346, side: 'SHORT', returnVal: 890, returnPct: 7, setups: ['EARNINGS WINNER'], efficiency: 75 },
  { id: '9', status: 'WIN', date: 'Aug 23, 2019', time: '09:50', symbol: 'CMG', entry: 734, exit: 736, size: 570, side: 'LONG', returnVal: 234, returnPct: 1, setups: ['EARNINGS WINNER'], efficiency: 60 },
  { id: '10', status: 'WIN', date: 'Aug 22, 2019', time: '12:15', symbol: 'TTCM', entry: 3.7, exit: 2.3, size: 566, side: 'SHORT', returnVal: 2909, returnPct: 3, setups: ['TRIPPLE TOP'], efficiency: 92 },
];

export const AREA_CHART_DATA = [
  { name: 'Jan', value: 1200 },
  { name: 'Feb', value: 1800 },
  { name: 'Mar', value: 1500 },
  { name: 'Apr', value: 2400 },
  { name: 'May', value: 2200 },
  { name: 'Jun', value: 3000 },
];


