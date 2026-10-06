// Shared chart colours for the Terminal page (lightweight-charts v5).
//
// The Terminal is styled only with the theme tokens (bg-surface, border-border, text-secondary ...).
// lightweight-charts draws on a canvas and needs concrete colours, so the neutral / up / down colours
// below mirror the token values of index.css: DARK_PALETTE = `.dark`, LIGHT_PALETTE = `:root` (the
// 'light', 'corporate' and 'labs' themes share the same neutrals and only differ in the accent).
// The chart canvas itself is transparent, so it always blends with the `bg-surface` panel it sits in.

import { isLightTheme } from '../../utils/themeMode';

export interface ChartPalette {
    isLight: boolean;
    background: string;        // chart canvas background (transparent -> container shows through)
    text: string;              // axis labels
    grid: string;              // grid lines
    border: string;            // price/time scale borders
    separator: string;         // pane separators
    separatorHover: string;
    crosshair: string;         // crosshair lines
    crosshairLabel: string;    // crosshair axis label background
    up: string;                // bullish candle
    down: string;              // bearish candle
    upVolume: string;          // bullish volume bar
    downVolume: string;        // bearish volume bar
    bbLine: string;            // Bollinger upper / lower
    bbMiddle: string;          // Bollinger basis
    bbFill: string;            // translucent fill between upper and lower band
    dema: string;              // DEMA line
    rsi: string;               // RSI line
    rsiMa: string;             // RSI-based moving average
    rsiFill: string;           // 30..70 zone fill
    stochK: string;            // Stoch RSI %K
    stochD: string;            // Stoch RSI %D
    stochFill: string;         // 20..80 zone fill
    guide: string;             // dashed 70/30 and 80/20 guide lines
}

export const TERMINAL_UP = '#0ECB81'; // --color-success (.dark)
export const TERMINAL_DOWN = '#F6465D'; // --color-danger (.dark)

// The indicator colours (bb*, dema, rsi*, stoch*) are the chartSettings defaults and must stay in sync
// with them: DARK_TO_LIGHT below maps exactly these values to their light equivalents.
const DARK_PALETTE: ChartPalette = {
    isLight: false,
    background: 'transparent',
    text: '#8A94A6', // --color-text-secondary
    grid: 'rgba(138, 148, 166, 0.08)',
    border: '#222832', // --color-border
    separator: '#222832',
    separatorHover: 'rgba(138, 148, 166, 0.16)',
    crosshair: 'rgba(138, 148, 166, 0.55)',
    crosshairLabel: '#323A47', // --color-border-strong
    up: TERMINAL_UP,
    down: TERMINAL_DOWN,
    upVolume: 'rgba(14, 203, 129, 0.45)',
    downVolume: 'rgba(246, 70, 93, 0.45)',
    bbLine: 'rgba(59, 130, 246, 0.75)',
    bbMiddle: '#3b82f6',
    bbFill: 'rgba(59, 130, 246, 0.10)',
    dema: '#ec4899',
    rsi: '#a78bfa',
    rsiMa: '#facc15',
    rsiFill: 'rgba(139, 92, 246, 0.10)',
    stochK: '#3b82f6',
    stochD: '#f97316',
    stochFill: 'rgba(59, 130, 246, 0.08)',
    guide: 'rgba(138, 148, 166, 0.45)',
};

const LIGHT_PALETTE: ChartPalette = {
    isLight: true,
    background: 'transparent',
    text: '#5A6472', // --color-text-secondary
    grid: 'rgba(18, 22, 28, 0.06)',
    border: '#DFE3E8', // --color-border
    separator: '#DFE3E8',
    separatorHover: 'rgba(18, 22, 28, 0.10)',
    crosshair: 'rgba(90, 100, 114, 0.55)',
    crosshairLabel: '#5A6472',
    up: '#0A9F68', // --color-success
    down: '#D9304A', // --color-danger
    upVolume: 'rgba(10, 159, 104, 0.35)',
    downVolume: 'rgba(217, 48, 74, 0.35)',
    bbLine: 'rgba(37, 99, 235, 0.70)',
    bbMiddle: '#2563eb',
    bbFill: 'rgba(37, 99, 235, 0.08)',
    dema: '#db2777',
    rsi: '#7c3aed',
    rsiMa: '#ca8a04',
    rsiFill: 'rgba(124, 58, 237, 0.07)',
    stochK: '#2563eb',
    stochD: '#ea580c',
    stochFill: 'rgba(37, 99, 235, 0.06)',
    guide: 'rgba(90, 100, 114, 0.5)',
};

export const getChartPalette = (theme: string | null | undefined): ChartPalette =>
    isLightTheme(theme) ? LIGHT_PALETTE : DARK_PALETTE;

// The indicator defaults in chartSettings are the dark palette colours. On light themes they are drawn
// with the light palette's equivalents (as before settings existed), so e.g. the yellow RSI MA stays readable.
const INDICATOR_COLOR_KEYS = ['bbLine', 'bbMiddle', 'bbFill', 'dema', 'rsi', 'rsiMa', 'stochK', 'stochD'] as const;
const DARK_TO_LIGHT: ReadonlyMap<string, string> = new Map(
    INDICATOR_COLOR_KEYS.map((k) => [DARK_PALETTE[k].toLowerCase(), LIGHT_PALETTE[k]] as const),
);

/** An indicator colour as drawn with palette `p` (dark default colours -> light equivalents on light themes). */
export const themedIndicatorColor = (color: string, p: ChartPalette): string =>
    p.isLight ? (DARK_TO_LIGHT.get(color.trim().toLowerCase()) ?? color) : color;
