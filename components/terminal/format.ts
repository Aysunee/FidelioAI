// Shared number / time formatters for the Terminal page.
// All numbers use en-US style (1,234.56 / 113.12M) to match the reference terminal UI.

const PLACEHOLDER = '—';

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

// Intl formatters are expensive to construct; cache one per fraction-digit count.
const fixedFormatters = new Map<string, Intl.NumberFormat>();
const fixedFormatter = (minDigits: number, maxDigits: number = minDigits): Intl.NumberFormat => {
    const key = `${minDigits}:${maxDigits}`;
    let f = fixedFormatters.get(key);
    if (!f) {
        f = new Intl.NumberFormat('en-US', {
            minimumFractionDigits: minDigits,
            maximumFractionDigits: maxDigits,
        });
        fixedFormatters.set(key, f);
    }
    return f;
};

/** Number of decimals used to display a price of this magnitude. */
export const priceDecimals = (price: number): number => {
    const abs = Math.abs(price);
    if (!isNum(abs) || abs === 0) return 2;
    if (abs >= 100) return 2;
    if (abs >= 10) return 3;
    if (abs >= 1) return 4;
    // < 1: keep 4 significant digits (0.3955, 0.04510, 0.006247, 0.00001234)
    const lead = -Math.floor(Math.log10(abs)); // 0.3955 -> 1, 0.006247 -> 3
    return Math.min(10, lead + 3);
};

/** 4,205.46 · 316.94 · 12.345 · 1.2345 · 0.3955 · 0.006247 */
export const formatPrice = (price: number | null | undefined): string => {
    if (!isNum(price)) return PLACEHOLDER;
    return fixedFormatter(priceDecimals(price)).format(price);
};

/** Fixed decimals with thousands separators: formatNumber(16138719.2, 0) -> '16,138,719' */
export const formatNumber = (n: number | null | undefined, digits = 2): string => {
    if (!isNum(n)) return PLACEHOLDER;
    return fixedFormatter(digits).format(n);
};

/** Quantity with adaptive decimals (open interest, sizes): 16,138,719 · 80,123.5 · 512.123 */
export const formatAmount = (n: number | null | undefined): string => {
    if (!isNum(n)) return PLACEHOLDER;
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return fixedFormatter(0).format(n);
    if (abs >= 1_000) return fixedFormatter(0, 1).format(n);
    return fixedFormatter(0, 3).format(n);
};

/** 113.12M · 1.54B · 858.23K · 523.10 */
export const formatCompact = (n: number | null | undefined, digits = 2): string => {
    if (!isNum(n)) return PLACEHOLDER;
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(digits)}T`;
    if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(digits)}B`;
    if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(digits)}M`;
    if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(digits)}K`;
    return `${sign}${abs.toFixed(digits)}`;
};

/** Value that is ALREADY a percent: formatPct(57.07) -> '+57.07%', formatPct(-0.1) -> '-0.10%' */
export const formatPct = (n: number | null | undefined, digits = 2, withSign = true): string => {
    if (!isNum(n)) return PLACEHOLDER;
    const body = Math.abs(n).toFixed(digits);
    if (Number(body) === 0) return `${body}%`;
    const sign = n < 0 ? '-' : withSign ? '+' : '';
    return `${sign}${body}%`;
};

/** A 0..1 fraction as a percent without sign: formatRatioPct(0.4907) -> '49.07%' */
export const formatRatioPct = (fraction: number | null | undefined, digits = 2): string => {
    if (!isNum(fraction)) return PLACEHOLDER;
    return `${(fraction * 100).toFixed(digits)}%`;
};

/**
 * Funding rate given as a fraction: formatFundingPct(-0.0013387) -> '-0.13387%'.
 * Pass withSymbol=false for table cells whose header already says '(%)' -> '-0.13387'.
 */
export const formatFundingPct = (
    fraction: number | null | undefined,
    digits = 5,
    withSymbol = true,
): string => {
    if (!isNum(fraction)) return PLACEHOLDER;
    let body = (fraction * 100).toFixed(digits);
    if (Number(body) === 0) body = (0).toFixed(digits); // avoid '-0.00000'
    return withSymbol ? `${body}%` : body;
};

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** Remaining milliseconds -> 'hh:mm:ss' (hours may exceed 24). Negative / invalid -> '00:00:00'. */
export const formatCountdown = (ms: number | null | undefined): string => {
    if (!isNum(ms) || ms <= 0) return '00:00:00';
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
};

/** ms epoch -> local 'HH:mm:ss' (e.g. "son güncelleme" labels). */
export const formatTime = (ms: number | null | undefined): string => {
    if (!isNum(ms) || ms <= 0) return PLACEHOLDER;
    const d = new Date(ms);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};

/** '4h' style label for a funding interval in hours. */
export const formatFundingInterval = (hours: number | null | undefined): string =>
    isNum(hours) && hours > 0 ? `${hours}h` : PLACEHOLDER;

/** Order book band label: 1 -> '±%1', 0.153 -> '±%0.15', 0.0421 -> '±%0.042'. */
export function formatBandPct(pct: number | undefined | null): string {
    if (typeof pct !== 'number' || !Number.isFinite(pct) || pct <= 0) return '';
    const digits = pct >= 1 ? 0 : pct >= 0.1 ? 2 : 3;
    const text = pct.toFixed(digits).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return `±%${text}`;
}
