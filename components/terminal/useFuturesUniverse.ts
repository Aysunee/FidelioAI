import { useEffect, useRef, useState } from 'react';
import type { FuturesRow } from './types';
import { fetchFuturesUniverse, subscribeFuturesTickers } from './terminalData';
import { applyPatch } from './universePatch';

const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;

/**
 * USDT-M perpetual universe (REST snapshot, retried with backoff) kept live by the batched ticker stream.
 * `index` maps symbol -> position in `rows`; patches only replace elements, so it stays valid until the
 * next snapshot. Nothing is fetched or subscribed while `enabled` is false.
 */
export function useFuturesUniverse(enabled = true): { rows: FuturesRow[]; index: Map<string, number> } {
    const [rows, setRows] = useState<FuturesRow[]>([]);
    const indexRef = useRef<Map<string, number>>(new Map());

    useEffect(() => {
        if (!enabled || typeof window === 'undefined') return undefined;
        let cancelled = false;
        let attempt = 0;
        let retryTimer: number | null = null;

        const load = () => {
            retryTimer = null;
            Promise.resolve()
                .then(fetchFuturesUniverse)
                .then((list) => {
                    if (cancelled) return;
                    indexRef.current = new Map(list.map((row, i) => [row.symbol, i]));
                    setRows(list);
                })
                .catch(() => {
                    if (cancelled) return;
                    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
                    attempt += 1;
                    retryTimer = window.setTimeout(load, delay);
                });
        };
        load();

        let unsubscribe: (() => void) | null = null;
        try {
            unsubscribe = subscribeFuturesTickers((patch) => {
                if (!cancelled) setRows((prev) => applyPatch(prev, patch, indexRef.current));
            });
        } catch {
            unsubscribe = null; // the REST snapshot still renders, just without live updates
        }

        return () => {
            cancelled = true;
            if (retryTimer !== null) window.clearTimeout(retryTimer);
            try {
                unsubscribe?.();
            } catch {
                /* ignore */
            }
        };
    }, [enabled]);

    return { rows, index: indexRef.current };
}
