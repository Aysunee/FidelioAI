import React, { useCallback, useEffect, useRef, useState } from 'react';

// Lightweight resizable split layout (no dependency). Children are laid out in a row or column with a
// draggable 1px divider between each pair. Sizes are fractions of the container, persisted per storageKey.
// Double-click a divider to restore the default sizes; arrow keys move a focused divider.

type Direction = 'horizontal' | 'vertical';

interface SplitPaneProps {
    direction: Direction;
    storageKey: string;
    defaultSizes: number[]; // relative weights, one per child
    minSizesPx?: number[];  // minimum pixel size per child (default 120)
    className?: string;
    children: React.ReactNode;
}

const DEFAULT_MIN_PX = 120;
const KEY_STEP = 0.02;

const normalize = (sizes: number[]) => {
    const total = sizes.reduce((a, b) => a + b, 0) || 1;
    return sizes.map((s) => s / total);
};

const readSizes = (key: string, count: number, fallback: number[]): number[] => {
    if (typeof window === 'undefined') return normalize(fallback);
    try {
        const raw = window.localStorage.getItem(key);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (
                Array.isArray(parsed) &&
                parsed.length === count &&
                parsed.every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)
            ) {
                return normalize(parsed);
            }
        }
    } catch {
        /* ignore corrupt storage */
    }
    return normalize(fallback);
};

const writeSizes = (key: string, sizes: number[]) => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(key, JSON.stringify(sizes.map((s) => Number(s.toFixed(4)))));
    } catch {
        /* storage unavailable */
    }
};

export const SplitPane: React.FC<SplitPaneProps> = ({ direction, storageKey, defaultSizes, minSizesPx, className = '', children }) => {
    const items = React.Children.toArray(children).filter(Boolean);
    const count = items.length;
    const horizontal = direction === 'horizontal';

    const containerRef = useRef<HTMLDivElement>(null);
    const [sizes, setSizes] = useState<number[]>(() => readSizes(storageKey, count, defaultSizes));
    const sizesRef = useRef(sizes);
    sizesRef.current = sizes;
    const [dragging, setDragging] = useState<number | null>(null);

    // Child count changed (should not happen in practice): fall back to defaults.
    useEffect(() => {
        if (sizes.length !== count) setSizes(normalize(defaultSizes.slice(0, count)));
    }, [count, sizes.length, defaultSizes]);

    const minFraction = useCallback(
        (index: number) => {
            const el = containerRef.current;
            const total = el ? (horizontal ? el.clientWidth : el.clientHeight) : 0;
            const px = minSizesPx?.[index] ?? DEFAULT_MIN_PX;
            return total > 0 ? Math.min(px / total, 0.45) : 0.05;
        },
        [horizontal, minSizesPx],
    );

    // Moves divider `index` (between child index and index+1) by `delta` (fraction of the container).
    const moveDivider = useCallback(
        (base: number[], index: number, delta: number): number[] => {
            const next = base.slice();
            const pair = base[index] + base[index + 1];
            const minA = minFraction(index);
            const minB = minFraction(index + 1);
            let a = base[index] + delta;
            a = Math.max(minA, Math.min(pair - minB, a));
            next[index] = a;
            next[index + 1] = pair - a;
            return next;
        },
        [minFraction],
    );

    const onPointerDown = (index: number) => (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        const el = containerRef.current;
        if (!el) return;
        e.preventDefault();
        const handle = e.currentTarget;
        try {
            handle.setPointerCapture(e.pointerId);
        } catch {
            /* pointer already released */
        }
        const total = horizontal ? el.clientWidth : el.clientHeight;
        const start = horizontal ? e.clientX : e.clientY;
        const base = sizesRef.current.slice();
        let latest = base;
        setDragging(index);

        const prevCursor = document.body.style.cursor;
        const prevSelect = document.body.style.userSelect;
        document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';

        const onMove = (ev: PointerEvent) => {
            if (total <= 0) return;
            const pos = horizontal ? ev.clientX : ev.clientY;
            latest = moveDivider(base, index, (pos - start) / total);
            setSizes(latest);
        };
        const onUp = () => {
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
            handle.removeEventListener('pointercancel', onUp);
            document.body.style.cursor = prevCursor;
            document.body.style.userSelect = prevSelect;
            setDragging(null);
            writeSizes(storageKey, latest);
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
    };

    const onKeyDown = (index: number) => (e: React.KeyboardEvent<HTMLDivElement>) => {
        const back = horizontal ? 'ArrowLeft' : 'ArrowUp';
        const fwd = horizontal ? 'ArrowRight' : 'ArrowDown';
        if (e.key !== back && e.key !== fwd) return;
        e.preventDefault();
        const next = moveDivider(sizesRef.current, index, e.key === fwd ? KEY_STEP : -KEY_STEP);
        setSizes(next);
        writeSizes(storageKey, next);
    };

    const reset = () => {
        const next = normalize(defaultSizes.slice(0, count));
        setSizes(next);
        writeSizes(storageKey, next);
    };

    return (
        <div ref={containerRef} className={`flex min-h-0 min-w-0 ${horizontal ? 'flex-row' : 'flex-col'} ${className}`}>
            {items.map((child, i) => (
                <React.Fragment key={i}>
                    <div
                        className="relative min-h-0 min-w-0 overflow-hidden"
                        style={{ flex: `${sizes[i] ?? 1} 1 0px` }}
                    >
                        {child}
                    </div>
                    {i < count - 1 && (
                        <div
                            role="separator"
                            aria-orientation={horizontal ? 'vertical' : 'horizontal'}
                            aria-label="Panel boyutunu ayarla (çift tıkla: varsayılana dön)"
                            title="Sürükleyerek boyutlandır · çift tıkla: sıfırla"
                            tabIndex={0}
                            onPointerDown={onPointerDown(i)}
                            onKeyDown={onKeyDown(i)}
                            onDoubleClick={reset}
                            className={`relative z-20 shrink-0 touch-none outline-none transition-colors hover:bg-primary focus-visible:bg-primary ${
                                dragging === i ? 'bg-primary' : 'bg-border'
                            } ${horizontal ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize'}`}
                        >
                            {/* Wider invisible hit area; the 1px line itself turns primary while hovered/dragged/focused */}
                            <span
                                aria-hidden="true"
                                className={`absolute ${horizontal ? 'inset-y-0 -left-[3px] w-[7px]' : 'inset-x-0 -top-[3px] h-[7px]'}`}
                            />
                        </div>
                    )}
                </React.Fragment>
            ))}
        </div>
    );
};
