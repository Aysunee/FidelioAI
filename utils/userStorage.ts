// Per-user localStorage helpers.
// User-specific data (journal, portfolio, alert rules, Telegram settings, watchlist...) is stored
// under `${base}:${userId}` so that two accounts on the same browser never see each other's data.
// Legacy unscoped keys are migrated to the first user that reads them, then removed.

const hasStorage = () => {
    if (typeof window === 'undefined') return false;
    try {
        return !!window.localStorage;
    } catch {
        return false;
    }
};

export const scopedKey = (base: string, userId?: string | number | null) =>
    userId !== undefined && userId !== null && userId !== '' ? `${base}:${userId}` : base;

export const readScoped = <T>(base: string, userId: string | number | null | undefined, fallback: T): T => {
    if (!hasStorage()) return fallback;
    const key = scopedKey(base, userId);
    try {
        let raw = localStorage.getItem(key);
        if (raw === null && key !== base) {
            const legacy = localStorage.getItem(base);
            if (legacy !== null) {
                localStorage.setItem(key, legacy);
                localStorage.removeItem(base);
                raw = legacy;
            }
        }
        if (raw === null) return fallback;
        const parsed = JSON.parse(raw);
        return (parsed ?? fallback) as T;
    } catch {
        return fallback;
    }
};

// Returns false when the write failed (e.g. QuotaExceededError) so callers can warn the user.
export const writeScoped = (base: string, userId: string | number | null | undefined, value: unknown): boolean => {
    if (!hasStorage()) return false;
    try {
        localStorage.setItem(scopedKey(base, userId), JSON.stringify(value));
        return true;
    } catch (err) {
        console.warn(`[userStorage] "${base}" kaydedilemedi:`, err);
        return false;
    }
};

export const removeScoped = (base: string, userId: string | number | null | undefined) => {
    if (!hasStorage()) return;
    try {
        localStorage.removeItem(scopedKey(base, userId));
    } catch { /* ignore */ }
};
