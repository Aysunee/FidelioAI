import React, { memo, useMemo } from 'react';
import { fundingTo8h } from '../../utils/fundingSqueeze';
import { formatSignedFunding } from './fundingFlow';

// ---------------------------------------------------------------------------
// Funding history mini chart: one bar per settled payment (8h-equivalent) around a zero line.
// Negative = danger, positive = success; the current PREDICTED rate is the hollow last bar.
// Plain inline SVG (no chart library); the drawing stretches to the container width.
// ---------------------------------------------------------------------------

export interface FundingSparklineProps {
    history: Array<{ time: number; rate: number }>; // oldest → newest, rate per the symbol's own interval
    intervalHours: number;                          // the symbol's current funding interval
    current?: number;                               // current predicted rate (same unit as history rates)
    height?: number;
}

const SLOT = 10;      // viewBox units per bar slot
const BAR = 8;        // bar width inside a slot
const MIN_SLOTS = 40; // a young symbol's few bars stay slim and sit at the right edge (newest last)
const PAD = 1.5;      // vertical padding in px
const HOUR_MS = 3_600_000;
const FUNDING_INTERVALS: readonly number[] = [1, 2, 4, 8];

let dateFormatter: Intl.DateTimeFormat | null = null;
const formatWhen = (ms: number): string => {
    try {
        if (!dateFormatter) {
            dateFormatter = new Intl.DateTimeFormat('tr-TR', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
            });
        }
        return dateFormatter.format(new Date(ms));
    } catch {
        return '';
    }
};

/**
 * Interval (hours) a settlement actually closed: the gap to the previous record when that is a real
 * funding interval (Binance shortens it for volatile symbols), otherwise the symbol's current interval.
 */
const settledInterval = (history: Array<{ time: number }>, i: number, fallback: number): number => {
    const a = i > 0 ? history[i - 1] : history[0];
    const b = i > 0 ? history[i] : history[1];
    if (!a || !b) return fallback;
    const hours = (b.time - a.time) / HOUR_MS;
    const rounded = Math.round(hours);
    return Math.abs(hours - rounded) < 0.05 && FUNDING_INTERVALS.includes(rounded) ? rounded : fallback;
};

interface Bar {
    key: string;
    x: number;
    y: number;
    h: number;
    negative: boolean;
    hollow: boolean;
    title: string;
}

interface Model {
    width: number;
    zeroY: number;
    bars: Bar[];
    label: string;
}

function buildModel(
    history: Array<{ time: number; rate: number }>,
    intervalHours: number,
    current: number | undefined,
    height: number,
): Model | null {
    const fallback = Number.isFinite(intervalHours) && intervalHours > 0 ? intervalHours : 8;
    const points: Array<{ value: number; time: number | null }> = [];
    for (let i = 0; i < history.length; i += 1) {
        const p = history[i];
        if (!p || !Number.isFinite(p.rate) || !Number.isFinite(p.time)) continue;
        points.push({ value: fundingTo8h(p.rate, settledInterval(history, i, fallback)), time: p.time });
    }
    const settledCount = points.length;
    const hasCurrent = typeof current === 'number' && Number.isFinite(current);
    if (hasCurrent) points.push({ value: fundingTo8h(current as number, fallback), time: null });
    if (points.length === 0) return null;

    let lo = 0;
    let hi = 0;
    for (const p of points) {
        if (p.value < lo) lo = p.value;
        if (p.value > hi) hi = p.value;
    }
    if (hi - lo < 1e-9) {
        lo -= 0.0001;
        hi += 0.0001;
    }
    const inner = Math.max(1, height - PAD * 2);
    const yOf = (v: number): number => PAD + ((hi - v) / (hi - lo)) * inner;
    const zeroY = yOf(0);

    const slots = Math.max(points.length, MIN_SLOTS);
    const firstSlot = slots - points.length;
    const bars: Bar[] = points.map((p, i) => {
        // Bars hang from / stand on the zero line; anything non-zero stays at least 1px tall.
        const h = p.value === 0 ? 0 : Math.max(1, Math.abs(yOf(p.value) - zeroY));
        const negative = p.value < 0;
        const hollow = p.time === null;
        return {
            key: hollow ? 'current' : `${p.time}`,
            x: (firstSlot + i) * SLOT + (SLOT - BAR) / 2,
            y: negative ? zeroY : zeroY - h,
            h,
            negative,
            hollow,
            title: hollow
                ? `Güncel tahmin · ${formatSignedFunding(p.value)} (8s eşdeğeri)`
                : `${formatWhen(p.time as number)} · ${formatSignedFunding(p.value)} (8s eşdeğeri)`,
        };
    });

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < settledCount; i += 1) {
        if (points[i].value < min) min = points[i].value;
        if (points[i].value > max) max = points[i].value;
    }
    const parts: string[] = [];
    if (settledCount > 0) {
        parts.push(
            `Son ${settledCount} fonlama ödemesi (8 saatlik eşdeğer): en düşük ${formatSignedFunding(min)}, en yüksek ${formatSignedFunding(max)}, son ${formatSignedFunding(points[settledCount - 1].value)}`,
        );
    }
    if (hasCurrent) parts.push(`güncel tahmin ${formatSignedFunding(points[points.length - 1].value)}`);

    return { width: slots * SLOT, zeroY, bars, label: parts.join('; ') };
}

export const FundingSparkline: React.FC<FundingSparklineProps> = memo(function FundingSparkline({
    history,
    intervalHours,
    current,
    height = 48,
}) {
    const model = useMemo(
        () => buildModel(history, intervalHours, current, height),
        [history, intervalHours, current, height],
    );

    if (!model) {
        return (
            <div className="flex w-full items-center justify-center text-[10px] text-muted" style={{ height }}>
                Fonlama geçmişi yok
            </div>
        );
    }

    return (
        <svg
            viewBox={`0 0 ${model.width} ${height}`}
            preserveAspectRatio="none"
            className="block w-full"
            style={{ height }}
            shapeRendering="crispEdges"
            role="img"
            aria-label={model.label}
        >
            <line
                x1={0}
                x2={model.width}
                y1={model.zeroY}
                y2={model.zeroY}
                stroke="var(--color-border-strong)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
            />
            {model.bars.map((bar) => {
                const color = bar.negative ? 'var(--color-danger)' : 'var(--color-success)';
                return (
                    <rect
                        key={bar.key}
                        x={bar.x}
                        y={bar.y}
                        width={BAR}
                        height={bar.h}
                        fill={bar.hollow ? 'none' : color}
                        stroke={bar.hollow ? color : 'none'}
                        strokeWidth={bar.hollow ? 1 : 0}
                        vectorEffect="non-scaling-stroke"
                    >
                        <title>{bar.title}</title>
                    </rect>
                );
            })}
        </svg>
    );
});
