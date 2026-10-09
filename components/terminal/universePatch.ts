import type { FuturesRow } from './types';

// Applies the batched ticker patches of subscribeFuturesTickers to a universe snapshot (Terminal page,
// Türev Araçlar detail view).

/** Returns the same object when the patch changes nothing, so memoized rows skip re-rendering. */
export const mergeRow = (row: FuturesRow, patch: Partial<FuturesRow>): FuturesRow => {
    let next: FuturesRow | null = null;
    for (const key of Object.keys(patch) as Array<keyof FuturesRow>) {
        const value = patch[key];
        if (value === undefined || value === row[key]) continue;
        if (!next) next = { ...row };
        (next as unknown as Record<string, unknown>)[key] = value;
    }
    return next ?? row;
};

export const applyPatch = (
    prev: FuturesRow[],
    patch: Record<string, Partial<FuturesRow>>,
    index: Map<string, number>,
): FuturesRow[] => {
    if (!prev.length) return prev;
    let next: FuturesRow[] | null = null;
    for (const symbol of Object.keys(patch)) {
        const i = index.get(symbol);
        if (i === undefined) continue;
        const current = (next ?? prev)[i];
        if (!current || current.symbol !== symbol) continue; // index belongs to another universe snapshot
        const merged = mergeRow(current, patch[symbol]);
        if (merged === current) continue;
        if (!next) next = prev.slice();
        next[i] = merged;
    }
    return next ?? prev;
};
