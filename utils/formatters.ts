export const formatPrice = (price: number | string | null | undefined): string => {
    const numericPrice = Number(price);

    // Missing / invalid price: show a dash instead of a misleading 0.00
    if (price === null || price === undefined || price === '' || !Number.isFinite(numericPrice)) return '—';

    const absPrice = Math.abs(numericPrice);
    if (absPrice === 0) return '0.00';

    // Low-priced coins (PEPE, SHIB...): keep ~4 significant digits instead of a fixed decimal count,
    // so 0.00001234 is not rendered as 0.000012 or 0.0000.
    if (absPrice < 1) {
        const decimals = Math.min(12, Math.max(4, 3 - Math.floor(Math.log10(absPrice))));
        return numericPrice.toFixed(decimals);
    }
    if (absPrice < 10) return numericPrice.toFixed(3);
    return numericPrice.toFixed(2);
};

// Clock time in the app locale (tr-TR, 24h). Non-date strings (e.g. an already formatted "HH:mm:ss") are returned as-is.
export const formatTime = (value: string | number | Date | null | undefined, withSeconds = true): string => {
    if (value === null || value === undefined || value === '') return '--:--';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : '--:--';
    return date.toLocaleTimeString('tr-TR', {
        hour: '2-digit',
        minute: '2-digit',
        ...(withSeconds ? { second: '2-digit' as const } : {}),
        hour12: false
    });
};

// --- Funding rate normalization ---
// Binance perpetuals settle funding every 1h, 4h or 8h. The raw rate is per interval, so it must be
// converted to a common base before sorting / comparing against thresholds.
export const DEFAULT_FUNDING_INTERVAL_HOURS = 8;

const safeIntervalHours = (intervalHours?: number | null) =>
    intervalHours && Number.isFinite(intervalHours) && intervalHours > 0 ? intervalHours : DEFAULT_FUNDING_INTERVAL_HOURS;

// Raw per-interval rate -> 8-hour equivalent rate (same unit as the input, e.g. 0.0001 = 0.01%)
export const toEightHourFundingRate = (rate: number, intervalHours?: number | null): number =>
    rate * (8 / safeIntervalHours(intervalHours));

// Raw per-interval rate -> simple (non-compounded) annual rate (same unit as the input)
export const annualizeFundingRate = (rate: number, intervalHours?: number | null): number =>
    rate * (24 / safeIntervalHours(intervalHours)) * 365;
