import React, { memo, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, ChevronDown, Eye, EyeOff, Info, Plus, RotateCcw, Settings2, Trash2, TriangleAlert, X } from 'lucide-react';
import { useUser } from '../../context/UserContext';
import { getChartPalette } from './chartTheme';
import {
    INDICATOR_LABELS,
    MAX_INDICATORS,
    MAX_MA_INSTANCES,
    MAX_VISIBLE_PANES,
    OVERLAY_TYPES,
    PANE_TYPES,
    SINGLE_INSTANCE_TYPES,
    countVisiblePanes,
    createIndicator,
    getChartSettings,
    indicatorShortLabel,
    isPaneIndicator,
    isValidColor,
    resetChartSettings,
    updateChartSettings,
    useChartSettings,
    type CandleType,
    type ChartSettings,
    type CrosshairSetting,
    type IndicatorConfig,
    type IndicatorType,
    type LineWidth,
} from './chartSettings';

// ---------------------------------------------------------------------------
// Shared open state: one settings dialog at a time across the three charts
// ---------------------------------------------------------------------------

let openOwner: string | null = null;
const openListeners = new Set<() => void>();

const subscribeOpen = (listener: () => void): (() => void) => {
    openListeners.add(listener);
    return () => {
        openListeners.delete(listener);
    };
};
const getOpenOwner = (): string | null => openOwner;
const getOpenOwnerServer = (): string | null => null;
const setOpenOwner = (owner: string | null): void => {
    if (openOwner === owner) return;
    openOwner = owner;
    for (const listener of Array.from(openListeners)) listener();
};

type TabKey = 'indicators' | 'appearance' | 'colors';
const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
    { key: 'indicators', label: 'İndikatörler' },
    { key: 'appearance', label: 'Görünüm' },
    { key: 'colors', label: 'Renkler' },
];
let lastTab: TabKey = 'indicators'; // reopening the dialog returns to the last used tab

// ---------------------------------------------------------------------------
// Indicator field descriptions (drive the parameter editor and the colour list)
// ---------------------------------------------------------------------------

type CfgRecord = Record<string, unknown>;
type Bound = number | ((cfg: CfgRecord) => number);

interface NumberFieldDesc {
    kind: 'number';
    key: string;
    label: string;
    min: Bound;
    max: Bound;
    step?: number;
    decimal?: boolean;
    hint?: string;
}
interface ColorFieldDesc {
    kind: 'color';
    key: string;
    label: string;
}
interface WidthFieldDesc {
    kind: 'width';
    key: 'lineWidth';
    label: string;
}
type FieldDesc = NumberFieldDesc | ColorFieldDesc | WidthFieldDesc;

const numOf = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const periodField = (key: string, label: string): NumberFieldDesc => ({ kind: 'number', key, label, min: 1, max: 500 });
const optionalPeriodField = (key: string, label: string): NumberFieldDesc => ({
    kind: 'number',
    key,
    label,
    min: 0,
    max: 500,
    hint: '0 = kapalı',
});
const colorField = (key: string, label: string): ColorFieldDesc => ({ kind: 'color', key, label });
const WIDTH_FIELD: WidthFieldDesc = { kind: 'width', key: 'lineWidth', label: 'Kalınlık' };
const LEVEL_FIELDS: NumberFieldDesc[] = [
    { kind: 'number', key: 'upper', label: 'Üst seviye', min: (c) => Math.min(100, Math.floor(numOf(c.lower)) + 1), max: 100 },
    { kind: 'number', key: 'lower', label: 'Alt seviye', min: 0, max: (c) => Math.max(0, Math.ceil(numOf(c.upper)) - 1) },
];

const FIELDS: Record<IndicatorType, FieldDesc[]> = {
    bb: [
        periodField('period', 'Periyot'),
        { kind: 'number', key: 'mult', label: 'Std. sapma çarpanı', min: 0.1, max: 10, step: 0.1, decimal: true },
        colorField('lineColor', 'Üst / alt bant'),
        colorField('middleColor', 'Orta çizgi'),
        colorField('fillColor', 'Bant dolgusu'),
    ],
    dema: [periodField('period', 'Periyot'), colorField('color', 'Çizgi'), WIDTH_FIELD],
    ema: [periodField('period', 'Periyot'), colorField('color', 'Çizgi'), WIDTH_FIELD],
    sma: [periodField('period', 'Periyot'), colorField('color', 'Çizgi'), WIDTH_FIELD],
    vwap: [colorField('color', 'Çizgi'), WIDTH_FIELD],
    rsi: [periodField('period', 'Periyot'), periodField('maPeriod', 'MA periyodu'), ...LEVEL_FIELDS, colorField('color', 'RSI'), colorField('maColor', 'MA')],
    stochRsi: [
        periodField('rsiPeriod', 'RSI periyodu'),
        periodField('stochPeriod', 'Stokastik periyot'),
        periodField('smoothK', '%K yumuşatma'),
        periodField('smoothD', '%D yumuşatma'),
        ...LEVEL_FIELDS,
        colorField('kColor', '%K'),
        colorField('dColor', '%D'),
    ],
    macd: [
        { kind: 'number', key: 'fast', label: 'Hızlı', min: 1, max: (c) => Math.max(1, numOf(c.slow) - 1) },
        { kind: 'number', key: 'slow', label: 'Yavaş', min: (c) => Math.min(500, numOf(c.fast) + 1), max: 500 },
        periodField('signal', 'Sinyal'),
        colorField('macdColor', 'MACD'),
        colorField('signalColor', 'Sinyal'),
        colorField('histUpColor', 'Histogram (+)'),
        colorField('histDownColor', 'Histogram (−)'),
    ],
    volume: [optionalPeriodField('maPeriod', 'MA periyodu'), colorField('maColor', 'MA')],
    atr: [periodField('period', 'Periyot'), colorField('color', 'Çizgi')],
    obv: [optionalPeriodField('maPeriod', 'MA periyodu'), colorField('color', 'OBV'), colorField('maColor', 'MA')],
};

const NOTES: Partial<Record<IndicatorType, string>> = {
    vwap: 'Günlük oturum: her gün 00:00 UTC’de sıfırlanır.',
    volume: 'Hacim çubukları mum renklerini kullanır.',
};

const ADD_HINTS: Record<IndicatorType, string> = {
    bb: 'Volatilite bantları',
    dema: 'Çift üstel ortalama',
    ema: 'Üstel ortalama',
    sma: 'Basit ortalama',
    vwap: 'Hacim ağırlıklı fiyat',
    rsi: 'Göreceli güç endeksi',
    stochRsi: 'RSI stokastiği',
    macd: 'Trend ve momentum',
    volume: 'Ayrı panelde hacim',
    atr: 'Ortalama gerçek aralık',
    obv: 'Denge hacmi',
};

const PANE_LIMIT_MESSAGE = `Aynı anda en fazla ${MAX_VISIBLE_PANES} alt panel gösterilebilir. Önce bir paneli gizleyin veya kaldırın.`;

const SINGLE_TYPE_SET: ReadonlySet<IndicatorType> = new Set(SINGLE_INSTANCE_TYPES);
const PANE_TYPE_SET: ReadonlySet<IndicatorType> = new Set<IndicatorType>(PANE_TYPES);

/** Why `type` cannot be added right now (Turkish), or null when it can. */
const addBlockReason = (type: IndicatorType, list: readonly IndicatorConfig[]): string | null => {
    if (list.length >= MAX_INDICATORS) return `En fazla ${MAX_INDICATORS} indikatör eklenebilir.`;
    if (SINGLE_TYPE_SET.has(type) && list.some((c) => c.type === type)) return `${INDICATOR_LABELS[type]} zaten ekli.`;
    if ((type === 'ema' || type === 'sma') && list.filter((c) => c.type === type).length >= MAX_MA_INSTANCES) {
        return `En fazla ${MAX_MA_INSTANCES} ${INDICATOR_LABELS[type]} eklenebilir.`;
    }
    if (PANE_TYPE_SET.has(type) && countVisiblePanes(list) >= MAX_VISIBLE_PANES) return PANE_LIMIT_MESSAGE;
    return null;
};

const resolveBound = (b: Bound, cfg: CfgRecord): number => (typeof b === 'function' ? b(cfg) : b);

const colorFieldsOf = (cfg: IndicatorConfig): ColorFieldDesc[] =>
    FIELDS[cfg.type].filter((f): f is ColorFieldDesc => f.kind === 'color');

const patchIndicator = (id: string, patch: CfgRecord): void => {
    updateChartSettings((prev) => ({
        ...prev,
        indicators: prev.indicators.map((c) => (c.id === id ? ({ ...c, ...patch } as IndicatorConfig) : c)),
    }));
};

const patchSettings = (patch: Partial<Omit<ChartSettings, 'version' | 'indicators'>>): void => {
    updateChartSettings((prev) => ({ ...prev, ...patch }));
};

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

interface Rgba {
    r: number;
    g: number;
    b: number;
    a: number;
}

const parseColor = (s: string | null | undefined): Rgba | null => {
    if (!s) return null;
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
    if (hex) {
        let h = hex[1];
        if (h.length === 3) h = h.split('').map((c) => c + c).join('');
        return {
            r: parseInt(h.slice(0, 2), 16),
            g: parseInt(h.slice(2, 4), 16),
            b: parseInt(h.slice(4, 6), 16),
            a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
        };
    }
    const m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/i.exec(s);
    if (m) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
    return null;
};

const toHex6 = ({ r, g, b }: Rgba): string =>
    `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/** The native picker only edits RGB: keep the original alpha (fills are translucent). */
const withAlpha = (hex6: string, alpha: number): string => {
    if (!(alpha < 1)) return hex6;
    const c = parseColor(hex6);
    if (!c) return hex6;
    return `rgba(${c.r}, ${c.g}, ${c.b}, ${Number(Math.max(0, alpha).toFixed(3))})`;
};

const CHECKER_STYLE: React.CSSProperties = {
    background: 'repeating-conic-gradient(rgba(128, 128, 128, 0.35) 0% 25%, transparent 0% 50%) 50% / 8px 8px',
};

// ---------------------------------------------------------------------------
// Small controls
// ---------------------------------------------------------------------------

const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

const getFocusable = (root: HTMLElement): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.tabIndex >= 0 && (el.offsetParent !== null || el === document.activeElement),
    );

/** Runs after React has committed the store update that was just made (timers also run in background tabs, unlike rAF). */
const afterCommit = (fn: () => void): void => {
    setTimeout(fn, 0);
};

const cssEscape = (s: string): string =>
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">{children}</h3>
);

const IconButton: React.FC<{
    label: string;
    onClick: () => void;
    disabled?: boolean;
    action?: string;
    danger?: boolean;
    children: React.ReactNode;
}> = ({ label, onClick, disabled, action, danger, children }) => (
    <button
        type="button"
        aria-label={label}
        title={label}
        disabled={disabled}
        data-action={action}
        onClick={onClick}
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-sm text-secondary outline-none transition-colors hover:bg-surface-secondary focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent sm:h-6 sm:w-6 ${
            danger ? 'hover:text-danger' : 'hover:text-text'
        }`}
    >
        {children}
    </button>
);

const Switch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }> = ({
    checked,
    onChange,
    label,
    description,
}) => (
    <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="flex min-h-7 w-full items-center justify-between gap-3 border-b border-border px-3 py-1.5 text-left outline-none transition-colors hover:bg-surface-secondary focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary focus-visible:-outline-offset-1"
    >
        <span className="min-w-0">
            <span className="block text-xs text-text">{label}</span>
            {description && <span className="block text-[10px] leading-snug text-muted">{description}</span>}
        </span>
        <span
            aria-hidden="true"
            className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors ${
                checked ? 'border-primary bg-primary' : 'border-border-strong bg-surface-highlight'
            }`}
        >
            <span
                className={`absolute left-[1px] h-3 w-3 rounded-full transition-transform ${
                    checked ? 'translate-x-3 bg-primary-contrast' : 'translate-x-0 bg-secondary'
                }`}
            />
        </span>
    </button>
);

interface SegmentOption<T extends string> {
    value: T;
    label: string;
    icon?: React.ReactNode;
}

function Segmented<T extends string>({
    value,
    options,
    onChange,
    label,
    className = '',
}: {
    value: T;
    options: ReadonlyArray<SegmentOption<T>>;
    onChange: (v: T) => void;
    label: string;
    className?: string;
}) {
    const refs = useRef<Array<HTMLButtonElement | null>>([]);
    const onKeyDown = (e: React.KeyboardEvent, index: number) => {
        let next = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % options.length;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
        if (next < 0) return;
        e.preventDefault();
        onChange(options[next].value);
        refs.current[next]?.focus();
    };
    return (
        <div
            role="radiogroup"
            aria-label={label}
            className={`grid gap-0.5 rounded-sm border border-border p-0.5 ${className}`}
            style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
        >
            {options.map((opt, i) => {
                const active = opt.value === value;
                return (
                    <button
                        key={opt.value}
                        ref={(el) => {
                            refs.current[i] = el;
                        }}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        tabIndex={active ? 0 : -1}
                        onClick={() => onChange(opt.value)}
                        onKeyDown={(e) => onKeyDown(e, i)}
                        className={`flex min-w-0 items-center justify-center gap-1 rounded-sm px-2 text-[11px] outline-none transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${
                            opt.icon ? 'flex-col py-1.5' : 'h-6'
                        } ${active ? 'bg-surface-highlight text-text' : 'text-secondary hover:text-text'}`}
                    >
                        {opt.icon}
                        <span className="truncate">{opt.label}</span>
                    </button>
                );
            })}
        </div>
    );
}

const NumberField = memo(function NumberField({
    label,
    value,
    min,
    max,
    step = 1,
    decimal = false,
    hint,
    onCommit,
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    decimal?: boolean;
    hint?: string;
    onCommit: (v: number) => void;
}) {
    const fmt = (v: number) => String(Number(v.toFixed(2)));
    const [draft, setDraft] = useState(() => fmt(value));
    const [focused, setFocused] = useState(false);
    const inputId = useId();

    useEffect(() => {
        if (!focused) setDraft(fmt(value));
    }, [value, focused]);

    const parse = (s: string): number | null => {
        const t = s.trim().replace(',', '.');
        if (t === '') return null;
        const n = Number(t);
        if (!Number.isFinite(n) || (!decimal && !Number.isInteger(n))) return null;
        if (n < min || n > max) return null;
        return n;
    };
    // The committed value already passed sanitizeChartSettings, so it is never flagged (e.g. a stored
    // fractional level such as 70.5 that the integer-only editor bounds would otherwise reject).
    const invalid = draft !== fmt(value) && parse(draft) === null;

    return (
        <div className="flex min-w-0 flex-col gap-0.5">
            <label htmlFor={inputId} className="truncate text-[10px] text-muted">
                {label}
            </label>
            <input
                id={inputId}
                type="number"
                inputMode={decimal ? 'decimal' : 'numeric'}
                min={min}
                max={max}
                step={step}
                value={draft}
                aria-invalid={invalid}
                onFocus={() => setFocused(true)}
                onChange={(e) => {
                    setDraft(e.target.value);
                    const n = parse(e.target.value);
                    if (n !== null && n !== value) onCommit(n);
                }}
                onBlur={() => {
                    setFocused(false);
                    setDraft(fmt(value));
                }}
                onKeyDown={(e) => {
                    // Edits are already live; Enter only normalises the field (an invalid draft reverts).
                    if (e.key === 'Enter') setDraft(fmt(value));
                }}
                // Chrome steps a focused number input on mouse wheel: scrolling the panel would silently
                // change the period. Move focus to the dialog itself (stays inside the focus trap) so the
                // wheel only scrolls.
                onWheel={(e) => {
                    const input = e.currentTarget;
                    if (document.activeElement !== input) return;
                    const dialog = input.closest<HTMLElement>('[role="dialog"]');
                    if (dialog) dialog.focus({ preventScroll: true });
                    else input.blur();
                }}
                className={`h-7 w-full min-w-0 rounded-sm border bg-surface-secondary px-2 font-mono text-xs text-text outline-none ${
                    invalid ? 'border-danger focus:border-danger' : 'border-border focus:border-primary'
                }`}
            />
            {invalid ? (
                <span className="text-[10px] leading-tight text-danger">
                    {fmt(min)}–{fmt(max)} arası{decimal ? '' : ' tam sayı'}
                </span>
            ) : (
                hint && <span className="text-[10px] leading-tight text-muted">{hint}</span>
            )}
        </div>
    );
});

const ColorInput = memo(function ColorInput({
    label,
    value,
    fallback,
    onChange,
}: {
    label: string;
    value: string | null;
    fallback: string;
    onChange: (v: string) => void;
}) {
    const shown = value ?? fallback;
    const parsed = parseColor(shown) ?? { r: 0, g: 0, b: 0, a: 1 };
    const [draft, setDraft] = useState(value ?? '');
    const [focused, setFocused] = useState(false);

    useEffect(() => {
        if (!focused) setDraft(value ?? '');
    }, [value, focused]);

    const trimmed = draft.trim();
    const invalid = trimmed !== '' && !isValidColor(trimmed);

    return (
        <div className="flex min-w-0 items-center gap-1.5">
            <span
                className="relative inline-flex h-7 w-7 shrink-0 overflow-hidden rounded-sm border border-border focus-within:border-primary"
                style={CHECKER_STYLE}
                title={`${label}: ${shown}`}
            >
                <span className="absolute inset-0" style={{ background: shown }} aria-hidden="true" />
                <input
                    type="color"
                    value={toHex6(parsed)}
                    onChange={(e) => onChange(withAlpha(e.target.value, parsed.a))}
                    aria-label={`${label} rengini seç`}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
            </span>
            <input
                type="text"
                value={draft}
                placeholder={fallback}
                spellCheck={false}
                autoComplete="off"
                aria-label={`${label} renk kodu`}
                aria-invalid={invalid}
                onFocus={() => setFocused(true)}
                onChange={(e) => {
                    setDraft(e.target.value);
                    const t = e.target.value.trim();
                    if (isValidColor(t) && t !== value) onChange(t);
                }}
                onBlur={() => {
                    setFocused(false);
                    setDraft(value ?? '');
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') setDraft(value ?? '');
                }}
                className={`h-7 w-full min-w-0 flex-1 rounded-sm border bg-surface-secondary px-2 font-mono text-[11px] text-text outline-none placeholder:text-muted ${
                    invalid ? 'border-danger focus:border-danger' : 'border-border focus:border-primary'
                }`}
            />
        </div>
    );
});

const LabeledColor: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => (
    <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[10px] text-muted">{label}</span>
        <ColorInput label={label} value={value} fallback={value} onChange={onChange} />
    </div>
);

const WidthPicker: React.FC<{ value: LineWidth; onChange: (v: LineWidth) => void }> = ({ value, onChange }) => (
    <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[10px] text-muted">Kalınlık</span>
        <Segmented<'1' | '2' | '3'>
            label="Çizgi kalınlığı"
            value={String(value) as '1' | '2' | '3'}
            onChange={(v) => onChange(Number(v) as LineWidth)}
            options={(['1', '2', '3'] as const).map((w) => ({
                value: w,
                label: `${w} px`,
                icon: <span aria-hidden="true" className="block w-5 bg-current" style={{ height: Number(w) }} />,
            }))}
        />
    </div>
);

const Swatches: React.FC<{ colors: string[]; dim: boolean }> = ({ colors, dim }) => (
    <span className={`flex shrink-0 gap-0.5 ${dim ? 'opacity-40' : ''}`} aria-hidden="true">
        {colors.map((c, i) => (
            <span key={i} className="h-2 w-2 shrink-0 rounded-full" style={{ background: c }} />
        ))}
    </span>
);

const CandleTypeIcon: React.FC<{ type: CandleType }> = ({ type }) => {
    const common = { viewBox: '0 0 16 16', className: 'h-4 w-4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, 'aria-hidden': true } as const;
    switch (type) {
        case 'candles':
            return (
                <svg {...common}>
                    <path d="M4.5 2.5v11M11.5 1.5v11" />
                    <rect x="3" y="5" width="3" height="5.5" fill="currentColor" />
                    <rect x="10" y="3.5" width="3" height="6" />
                </svg>
            );
        case 'heikinAshi':
            return (
                <svg {...common}>
                    <path d="M3 6v8M8 4v8M13 2v7.5" />
                    <rect x="1.8" y="8" width="2.4" height="4.5" fill="currentColor" />
                    <rect x="6.8" y="5.5" width="2.4" height="4.5" fill="currentColor" />
                    <rect x="11.8" y="3" width="2.4" height="4.5" fill="currentColor" />
                </svg>
            );
        case 'line':
            return (
                <svg {...common}>
                    <polyline points="1.5,12 5,8 8.5,9.5 14.5,3.5" strokeWidth={1.5} strokeLinejoin="round" />
                </svg>
            );
        case 'area':
        default:
            return (
                <svg {...common}>
                    <path d="M1.5 12 L5 8 L8.5 9.5 L14.5 3.5 V14.5 H1.5 Z" fill="currentColor" fillOpacity={0.25} stroke="none" />
                    <polyline points="1.5,12 5,8 8.5,9.5 14.5,3.5" strokeWidth={1.5} strokeLinejoin="round" />
                </svg>
            );
    }
};

// ---------------------------------------------------------------------------
// İndikatörler tab
// ---------------------------------------------------------------------------

const IndicatorEditor: React.FC<{ cfg: IndicatorConfig; editorId: string }> = ({ cfg, editorId }) => {
    const rec = cfg as unknown as CfgRecord;
    const fields = FIELDS[cfg.type];
    const numbers = fields.filter((f): f is NumberFieldDesc => f.kind === 'number');
    const colors = fields.filter((f): f is ColorFieldDesc => f.kind === 'color');
    const hasWidth = fields.some((f) => f.kind === 'width');
    const note = NOTES[cfg.type];

    return (
        <div id={editorId} className="space-y-2 border-t border-border bg-background px-3 py-2">
            {numbers.length > 0 && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {numbers.map((f) => (
                        <NumberField
                            key={f.key}
                            label={f.label}
                            value={numOf(rec[f.key])}
                            min={resolveBound(f.min, rec)}
                            max={resolveBound(f.max, rec)}
                            step={f.step}
                            decimal={f.decimal}
                            hint={f.hint}
                            onCommit={(v) => patchIndicator(cfg.id, { [f.key]: v })}
                        />
                    ))}
                </div>
            )}
            {(colors.length > 0 || hasWidth) && (
                <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
                    {colors.map((f) => (
                        <LabeledColor
                            key={f.key}
                            label={f.label}
                            value={String(rec[f.key] ?? '')}
                            onChange={(v) => patchIndicator(cfg.id, { [f.key]: v })}
                        />
                    ))}
                    {hasWidth && 'lineWidth' in cfg && (
                        <WidthPicker value={cfg.lineWidth} onChange={(v) => patchIndicator(cfg.id, { lineWidth: v })} />
                    )}
                </div>
            )}
            {note && (
                <p className="flex items-start gap-1 text-[10px] leading-snug text-muted">
                    <Info className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
                    {note}
                </p>
            )}
        </div>
    );
};

const IndicatorRow = memo(function IndicatorRow({
    cfg,
    index,
    count,
    expanded,
    onToggleExpand,
    onToggleVisible,
    onMove,
    onRemove,
}: {
    cfg: IndicatorConfig;
    index: number;
    count: number;
    expanded: boolean;
    onToggleExpand: (id: string) => void;
    onToggleVisible: (cfg: IndicatorConfig) => void;
    onMove: (id: string, dir: -1 | 1) => void;
    onRemove: (id: string, index: number) => void;
}) {
    const editorId = useId();
    const rec = cfg as unknown as CfgRecord;
    const swatches = colorFieldsOf(cfg)
        .slice(0, 2)
        .map((f) => String(rec[f.key] ?? ''));
    const short = indicatorShortLabel(cfg);
    const full = INDICATOR_LABELS[cfg.type];
    const pane = isPaneIndicator(cfg);

    return (
        <li data-ind-id={cfg.id} className="border-b border-border">
            <div className="flex min-h-9 items-center gap-0.5 px-2">
                <IconButton
                    label={cfg.visible ? `${short} gizle` : `${short} göster`}
                    action="visibility"
                    onClick={() => onToggleVisible(cfg)}
                >
                    {cfg.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                </IconButton>
                <button
                    type="button"
                    data-action="toggle"
                    aria-expanded={expanded}
                    aria-controls={expanded ? editorId : undefined}
                    title="Parametreleri düzenle"
                    onClick={() => onToggleExpand(cfg.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1 py-0.5 text-left outline-none transition-colors hover:bg-surface-secondary focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                >
                    <Swatches colors={swatches} dim={!cfg.visible} />
                    <span className="min-w-0 flex-1">
                        <span className={`block truncate text-xs font-medium ${cfg.visible ? 'text-text' : 'text-muted line-through'}`}>
                            {short}
                        </span>
                        <span className="block truncate text-[10px] text-muted">
                            {short.startsWith(full) ? '' : `${full} · `}
                            {pane ? 'Alt panel' : 'Fiyat üstü'}
                        </span>
                    </span>
                    <ChevronDown
                        className={`h-3.5 w-3.5 shrink-0 text-secondary transition-transform ${expanded ? 'rotate-180' : ''}`}
                        aria-hidden="true"
                    />
                </button>
                <IconButton label={`${short} yukarı taşı`} action="up" disabled={index === 0} onClick={() => onMove(cfg.id, -1)}>
                    <ArrowUp className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton label={`${short} aşağı taşı`} action="down" disabled={index === count - 1} onClick={() => onMove(cfg.id, 1)}>
                    <ArrowDown className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton label={`${short} kaldır`} action="remove" danger onClick={() => onRemove(cfg.id, index)}>
                    <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
            </div>
            {expanded && <IndicatorEditor cfg={cfg} editorId={editorId} />}
        </li>
    );
});

const AddOption: React.FC<{ type: IndicatorType; reason: string | null; added: boolean; onAdd: (type: IndicatorType) => void }> = ({
    type,
    reason,
    added,
    onAdd,
}) => (
    <button
        type="button"
        aria-disabled={reason ? true : undefined}
        title={reason ?? `${INDICATOR_LABELS[type]} ekle`}
        onClick={() => onAdd(type)}
        className={`flex min-w-0 flex-col items-start border-b border-r border-border bg-surface px-2 py-1.5 text-left outline-none transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary focus-visible:-outline-offset-1 ${
            reason ? 'cursor-not-allowed' : 'hover:bg-surface-highlight'
        }`}
    >
        <span className={`flex w-full items-center gap-1 text-xs font-medium ${reason ? 'text-muted' : 'text-text'}`}>
            <span className="truncate">{INDICATOR_LABELS[type]}</span>
            {!reason && <Plus className="ml-auto h-3 w-3 shrink-0 text-secondary" aria-hidden="true" />}
        </span>
        <span className="w-full truncate text-[10px] text-muted">{added ? 'Grafikte ekli' : ADD_HINTS[type]}</span>
    </button>
);

const IndicatorsTab: React.FC<{
    settings: ChartSettings;
    dialogRef: React.RefObject<HTMLDivElement | null>;
    addOpen: boolean;
    setAddOpen: (v: boolean | ((p: boolean) => boolean)) => void;
    expandedId: string | null;
    setExpandedId: (v: string | null | ((p: string | null) => string | null)) => void;
}> = ({ settings, dialogRef, addOpen, setAddOpen, expandedId, setExpandedId }) => {
    const { indicators } = settings;
    const [notice, setNotice] = useState<string | null>(null);
    const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const noticeRef = useRef<HTMLDivElement>(null);
    const addButtonRef = useRef<HTMLButtonElement>(null);
    const addPanelId = useId();
    const visiblePanes = countVisiblePanes(indicators);

    const showNotice = useCallback((msg: string) => {
        setNotice(msg);
        if (noticeTimer.current) clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => setNotice(null), 6000);
        // The notice sits above the list: bring it into view when the action came from a row further down.
        afterCommit(() => noticeRef.current?.scrollIntoView({ block: 'nearest' }));
    }, []);
    useEffect(
        () => () => {
            if (noticeTimer.current) clearTimeout(noticeTimer.current);
        },
        [],
    );

    const focusInRow = useCallback(
        (id: string, actions: string[]) => {
            afterCommit(() => {
                const row = dialogRef.current?.querySelector<HTMLElement>(`[data-ind-id="${cssEscape(id)}"]`);
                for (const a of actions) {
                    const el = row?.querySelector<HTMLButtonElement>(`[data-action="${a}"]`);
                    if (el && !el.disabled) {
                        el.focus();
                        return;
                    }
                }
            });
        },
        [dialogRef],
    );

    const onToggleExpand = useCallback((id: string) => setExpandedId((cur) => (cur === id ? null : id)), [setExpandedId]);

    const onToggleVisible = useCallback(
        (cfg: IndicatorConfig) => {
            const latest = getChartSettings().indicators;
            if (!cfg.visible && isPaneIndicator(cfg) && countVisiblePanes(latest) >= MAX_VISIBLE_PANES) {
                showNotice(PANE_LIMIT_MESSAGE);
                return;
            }
            patchIndicator(cfg.id, { visible: !cfg.visible });
        },
        [showNotice],
    );

    const onMove = useCallback(
        (id: string, dir: -1 | 1) => {
            updateChartSettings((prev) => {
                const i = prev.indicators.findIndex((c) => c.id === id);
                const j = i + dir;
                if (i < 0 || j < 0 || j >= prev.indicators.length) return prev;
                const list = prev.indicators.slice();
                [list[i], list[j]] = [list[j], list[i]];
                return { ...prev, indicators: list };
            });
            // Keyed reordering can move the focused node; keep focus on the same control.
            focusInRow(id, dir < 0 ? ['up', 'down', 'toggle'] : ['down', 'up', 'toggle']);
        },
        [focusInRow],
    );

    const onRemove = useCallback(
        (id: string, index: number) => {
            updateChartSettings((prev) => ({ ...prev, indicators: prev.indicators.filter((c) => c.id !== id) }));
            setExpandedId((cur) => (cur === id ? null : cur));
            afterCommit(() => {
                const rows = dialogRef.current?.querySelectorAll<HTMLElement>('[data-ind-id]');
                const target = rows && rows.length ? rows[Math.min(index, rows.length - 1)] : null;
                (target?.querySelector<HTMLElement>('[data-action="remove"]') ?? addButtonRef.current)?.focus();
            });
        },
        [dialogRef, setExpandedId],
    );

    const onAdd = useCallback(
        (type: IndicatorType) => {
            const latest = getChartSettings().indicators;
            const reason = addBlockReason(type, latest);
            if (reason) {
                showNotice(reason);
                return;
            }
            const cfg = createIndicator(type, latest);
            updateChartSettings((prev) => ({ ...prev, indicators: [...prev.indicators, cfg] }));
            setAddOpen(false);
            setExpandedId(cfg.id);
            setNotice(null);
            afterCommit(() => {
                const row = dialogRef.current?.querySelector<HTMLElement>(`[data-ind-id="${cssEscape(cfg.id)}"]`);
                row?.scrollIntoView({ block: 'nearest' });
                row?.querySelector<HTMLElement>('[data-action="toggle"]')?.focus();
            });
        },
        [dialogRef, setAddOpen, setExpandedId, showNotice],
    );

    const renderGroup = (title: string, types: readonly IndicatorType[]) => (
        <div>
            <SectionTitle>{title}</SectionTitle>
            <div className="grid grid-cols-2 border-l border-t border-border sm:grid-cols-3">
                {types.map((t) => (
                    <AddOption
                        key={t}
                        type={t}
                        reason={addBlockReason(t, indicators)}
                        added={SINGLE_TYPE_SET.has(t) && indicators.some((c) => c.type === t)}
                        onAdd={onAdd}
                    />
                ))}
            </div>
        </div>
    );

    return (
        <div>
            <div className="flex h-9 items-center gap-2 border-b border-border px-3">
                <span
                    className={`text-[11px] ${visiblePanes >= MAX_VISIBLE_PANES ? 'text-warning' : 'text-secondary'}`}
                    title="Aynı anda gösterilebilen alt panel sayısı"
                >
                    Alt panel{' '}
                    <span className="font-mono">
                        {visiblePanes}/{MAX_VISIBLE_PANES}
                    </span>
                </span>
                <button
                    ref={addButtonRef}
                    type="button"
                    aria-expanded={addOpen}
                    aria-controls={addOpen ? addPanelId : undefined}
                    onClick={() => setAddOpen((v) => !v)}
                    className={`ml-auto inline-flex h-7 items-center gap-1 rounded-sm border px-2.5 text-xs font-medium text-text outline-none transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary sm:h-6 ${
                        addOpen ? 'border-border-strong bg-surface-highlight' : 'border-border bg-surface-secondary hover:bg-surface-highlight'
                    }`}
                >
                    <Plus className={`h-3.5 w-3.5 transition-transform ${addOpen ? 'rotate-45' : ''}`} aria-hidden="true" />
                    İndikatör ekle
                </button>
            </div>

            <div ref={noticeRef} role="status" aria-live="polite">
                {notice && (
                    <p className="flex items-start gap-1.5 border-b border-border bg-warning-soft px-3 py-1.5 text-[11px] leading-snug text-warning">
                        <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>{notice}</span>
                    </p>
                )}
            </div>

            {addOpen && (
                <div id={addPanelId} className="space-y-2 border-b border-border bg-surface-secondary px-3 py-2">
                    {renderGroup('Fiyat üstü', OVERLAY_TYPES)}
                    {renderGroup('Alt panel', PANE_TYPES)}
                </div>
            )}

            {indicators.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted">
                    Grafikte indikatör yok. “İndikatör ekle” ile başlayın.
                </p>
            ) : (
                <ul aria-label="Eklenen indikatörler">
                    {indicators.map((cfg, i) => (
                        <IndicatorRow
                            key={cfg.id}
                            cfg={cfg}
                            index={i}
                            count={indicators.length}
                            expanded={expandedId === cfg.id}
                            onToggleExpand={onToggleExpand}
                            onToggleVisible={onToggleVisible}
                            onMove={onMove}
                            onRemove={onRemove}
                        />
                    ))}
                </ul>
            )}
        </div>
    );
};

// ---------------------------------------------------------------------------
// Görünüm tab
// ---------------------------------------------------------------------------

const CANDLE_OPTIONS: ReadonlyArray<SegmentOption<CandleType>> = [
    { value: 'candles', label: 'Mum', icon: <CandleTypeIcon type="candles" /> },
    { value: 'heikinAshi', label: 'Heikin Ashi', icon: <CandleTypeIcon type="heikinAshi" /> },
    { value: 'line', label: 'Çizgi', icon: <CandleTypeIcon type="line" /> },
    { value: 'area', label: 'Alan', icon: <CandleTypeIcon type="area" /> },
];

const CROSSHAIR_OPTIONS: ReadonlyArray<SegmentOption<CrosshairSetting>> = [
    { value: 'normal', label: 'Serbest' },
    { value: 'magnet', label: 'Mıknatıs' },
];

const AppearanceTab: React.FC<{ settings: ChartSettings }> = ({ settings }) => {
    const volumePaneOn = settings.indicators.some((c) => c.type === 'volume' && c.visible);
    return (
        <div>
            <section className="border-b border-border px-3 py-2.5">
                <SectionTitle>Grafik tipi</SectionTitle>
                <Segmented label="Grafik tipi" value={settings.candleType} options={CANDLE_OPTIONS} onChange={(v) => patchSettings({ candleType: v })} />
            </section>
            <section>
                <div className="border-b border-border px-3 pt-2.5">
                    <SectionTitle>Izgara</SectionTitle>
                </div>
                <div>
                    <Switch label="Dikey çizgiler" checked={settings.gridVertical} onChange={(v) => patchSettings({ gridVertical: v })} />
                    <Switch label="Yatay çizgiler" checked={settings.gridHorizontal} onChange={(v) => patchSettings({ gridHorizontal: v })} />
                </div>
            </section>
            <section className="border-b border-border px-3 py-2.5">
                <SectionTitle>İmleç</SectionTitle>
                <Segmented label="İmleç modu" value={settings.crosshair} options={CROSSHAIR_OPTIONS} onChange={(v) => patchSettings({ crosshair: v })} />
                <p className="mt-1.5 text-[10px] leading-snug text-muted">
                    {settings.crosshair === 'magnet' ? 'Yatay çizgi mumun kapanış fiyatına yapışır.' : 'İmleç fareyi serbestçe izler.'}
                </p>
            </section>
            <section>
                <div className="border-b border-border px-3 pt-2.5">
                    <SectionTitle>Hacim</SectionTitle>
                </div>
                <div>
                    <Switch
                        label="Fiyat panelinde hacim"
                        description={
                            volumePaneOn ? 'Mumların altındaki hacim çubukları. Ayrı Hacim paneli de açık.' : 'Mumların altındaki hacim çubukları.'
                        }
                        checked={settings.showVolumeOverlay}
                        onChange={(v) => patchSettings({ showVolumeOverlay: v })}
                    />
                </div>
            </section>
        </div>
    );
};

// ---------------------------------------------------------------------------
// Renkler tab
// ---------------------------------------------------------------------------

const CandleColorRow: React.FC<{ label: string; value: string | null; themeDefault: string; onChange: (v: string | null) => void }> = ({
    label,
    value,
    themeDefault,
    onChange,
}) => (
    <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-[10px] text-muted">
            {label}
            {value === null && (
                <span className="rounded-sm bg-surface-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none text-secondary">Tema</span>
            )}
        </span>
        <div className="flex min-w-0 items-center gap-1.5">
            <div className="min-w-0 flex-1">
                <ColorInput label={`${label} mum`} value={value} fallback={themeDefault} onChange={onChange} />
            </div>
            <button
                type="button"
                disabled={value === null}
                onClick={() => onChange(null)}
                title="Temanın varsayılan rengini kullan"
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-sm px-2 text-[11px] text-secondary outline-none transition-colors hover:bg-surface-secondary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-secondary"
            >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                Tema varsayılanı
            </button>
        </div>
    </div>
);

const ColorsTab: React.FC<{ settings: ChartSettings; theme: string }> = ({ settings, theme }) => {
    const palette = getChartPalette(theme);
    return (
        <div>
            <section className="border-b border-border px-3 py-2.5">
                <SectionTitle>Mum renkleri</SectionTitle>
                <div className="grid grid-cols-1 gap-2">
                    <CandleColorRow label="Yükselen" value={settings.upColor} themeDefault={palette.up} onChange={(v) => patchSettings({ upColor: v })} />
                    <CandleColorRow label="Düşen" value={settings.downColor} themeDefault={palette.down} onChange={(v) => patchSettings({ downColor: v })} />
                </div>
            </section>
            <section>
                <div className="border-b border-border px-3 pt-2.5">
                    <SectionTitle>İndikatör renkleri</SectionTitle>
                </div>
                {settings.indicators.length === 0 ? (
                    <p className="px-3 py-6 text-center text-xs text-muted">Henüz indikatör eklenmedi.</p>
                ) : (
                    <div>
                        {settings.indicators.map((cfg) => {
                            const rec = cfg as unknown as CfgRecord;
                            return (
                                <div key={cfg.id} className="border-b border-border px-3 py-2">
                                    <div className={`mb-1 text-xs font-medium ${cfg.visible ? 'text-text' : 'text-muted'}`}>
                                        {indicatorShortLabel(cfg)}
                                        {!cfg.visible && <span className="ml-1 text-[10px] font-normal text-muted">(gizli)</span>}
                                    </div>
                                    <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
                                        {colorFieldsOf(cfg).map((f) => (
                                            <LabeledColor
                                                key={f.key}
                                                label={f.label}
                                                value={String(rec[f.key] ?? '')}
                                                onChange={(v) => patchIndicator(cfg.id, { [f.key]: v })}
                                            />
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>
        </div>
    );
};

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

const ChartSettingsDialog: React.FC<{
    onClose: () => void;
    returnFocusRef: React.RefObject<HTMLButtonElement | null>;
}> = ({ onClose, returnFocusRef }) => {
    const settings = useChartSettings();
    const { theme } = useUser(); // only for the theme-default candle colours shown in the Renkler tab
    const [tab, setTab] = useState<TabKey>(lastTab);
    const [addOpen, setAddOpen] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const tabRefs = useRef<Partial<Record<TabKey, HTMLButtonElement | null>>>({});
    const baseId = useId();
    const titleId = `${baseId}-title`;
    const descId = `${baseId}-desc`;
    const panelId = `${baseId}-panel`;

    const onCloseRef = useRef(onClose);
    const addOpenRef = useRef(addOpen);
    useEffect(() => {
        onCloseRef.current = onClose;
        addOpenRef.current = addOpen;
    });

    useEffect(() => {
        lastTab = tab;
    }, [tab]);

    // Focus the active tab on open; give focus back to the ⚙ button on close.
    useEffect(() => {
        const opener = returnFocusRef.current;
        const first = tabRefs.current[lastTab] ?? (dialogRef.current ? getFocusable(dialogRef.current)[0] : null);
        (first ?? dialogRef.current)?.focus();
        return () => {
            const target = returnFocusRef.current ?? opener;
            if (target && document.contains(target)) target.focus();
        };
    }, [returnFocusRef]);

    // Escape closes the "add" list first, then the dialog. Captured on document so it also works when
    // focus fell back to <body> (e.g. after removing a row) and never reaches the app-level shortcuts.
    // Tab pressed while focus is outside the dialog is pulled back in, so the page behind is never reached.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const dialog = dialogRef.current;
            if (e.key === 'Tab' && dialog && !dialog.contains(document.activeElement)) {
                const focusable = getFocusable(dialog);
                e.preventDefault();
                e.stopPropagation();
                (e.shiftKey ? focusable[focusable.length - 1] : focusable[0])?.focus();
                return;
            }
            if (e.key !== 'Escape' || e.isComposing) return;
            e.preventDefault();
            e.stopPropagation();
            if (addOpenRef.current) {
                setAddOpen(false);
                return;
            }
            onCloseRef.current();
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, []);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        // Keys typed inside the dialog must not trigger the app's global (window) shortcuts.
        e.stopPropagation();
        if (e.key !== 'Tab' || !dialogRef.current) return;
        const focusable = getFocusable(dialogRef.current);
        if (!focusable.length) {
            e.preventDefault();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === dialogRef.current || !dialogRef.current.contains(active))) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && (active === last || !dialogRef.current.contains(active))) {
            e.preventDefault();
            first.focus();
        }
    };

    const selectTab = (key: TabKey, focus = false) => {
        setTab(key);
        if (focus) tabRefs.current[key]?.focus();
    };

    const onTabKeyDown = (e: React.KeyboardEvent, index: number) => {
        let next = -1;
        if (e.key === 'ArrowRight') next = (index + 1) % TABS.length;
        else if (e.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = TABS.length - 1;
        if (next < 0) return;
        e.preventDefault();
        selectTab(TABS[next].key, true);
    };

    const handleReset = () => {
        const ok =
            typeof window === 'undefined' ||
            window.confirm('Tüm grafik ayarları varsayılana döndürülsün mü? Eklediğiniz indikatörler ve renk değişiklikleri kaldırılacak.');
        if (!ok) return;
        resetChartSettings();
        setExpandedId(null);
        setAddOpen(false);
    };

    return (
        <div lang="tr" className="fixed inset-0 z-[100] flex items-end justify-center sm:items-start sm:px-4 sm:pb-4 sm:pt-[10vh]">
            <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={descId}
                tabIndex={-1}
                onKeyDown={handleKeyDown}
                className="relative flex h-[80vh] max-h-[80vh] w-full flex-col overflow-hidden border-t border-border-strong bg-surface text-text shadow-overlay outline-none sm:h-auto sm:max-w-[460px] sm:rounded-sm sm:border"
                style={{ animation: 'fadeIn 120ms ease-out both' }}
            >
                {/* Header */}
                <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border pl-3 pr-1.5">
                    <h2 id={titleId} className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-text">
                        Grafik Ayarları
                    </h2>
                    <p id={descId} className="min-w-0 flex-1 truncate text-[11px] text-muted">
                        Ayarlar üç grafiğe birden uygulanır
                    </p>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Kapat"
                        title="Kapat (Esc)"
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-secondary outline-none transition-colors hover:bg-surface-secondary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                    >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                </div>

                {/* Tabs */}
                <div role="tablist" aria-label="Ayar bölümleri" className="flex h-8 shrink-0 gap-3 border-b border-border px-3">
                    {TABS.map((t, i) => {
                        const active = t.key === tab;
                        return (
                            <button
                                key={t.key}
                                ref={(el) => {
                                    tabRefs.current[t.key] = el;
                                }}
                                type="button"
                                role="tab"
                                id={`${baseId}-tab-${t.key}`}
                                aria-selected={active}
                                aria-controls={panelId}
                                tabIndex={active ? 0 : -1}
                                onClick={() => selectTab(t.key)}
                                onKeyDown={(e) => onTabKeyDown(e, i)}
                                className={`-mb-px inline-flex h-8 items-center gap-1.5 border-b-2 text-[11px] font-medium uppercase tracking-wider outline-none transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${
                                    active ? 'border-primary text-text' : 'border-transparent text-secondary hover:text-text'
                                }`}
                            >
                                {t.label}
                                {t.key === 'indicators' && (
                                    <span className="rounded-sm bg-surface-secondary px-1 py-0.5 font-mono text-[10px] font-semibold leading-none text-secondary">
                                        {settings.indicators.length}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Body */}
                <div
                    role="tabpanel"
                    id={panelId}
                    aria-labelledby={`${baseId}-tab-${tab}`}
                    // -mb-px: the bottom line of the last row and the footer's top line share one pixel row.
                    className="-mb-px min-h-0 flex-1 overflow-y-auto overscroll-contain"
                >
                    {tab === 'indicators' && (
                        <IndicatorsTab
                            settings={settings}
                            dialogRef={dialogRef}
                            addOpen={addOpen}
                            setAddOpen={setAddOpen}
                            expandedId={expandedId}
                            setExpandedId={setExpandedId}
                        />
                    )}
                    {tab === 'appearance' && <AppearanceTab settings={settings} />}
                    {tab === 'colors' && <ColorsTab settings={settings} theme={theme} />}
                </div>

                {/* Footer */}
                <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
                    <button
                        type="button"
                        onClick={handleReset}
                        className="-ml-1.5 inline-flex h-7 items-center gap-1 rounded-sm px-2 text-xs font-medium text-secondary outline-none transition-colors hover:bg-surface-secondary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                    >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        Varsayılana dön
                    </button>
                    <span className="ml-auto hidden text-[10px] text-muted min-[400px]:inline">Değişiklikler otomatik kaydedilir</span>
                    <button
                        type="button"
                        onClick={onClose}
                        className="ml-auto inline-flex h-7 items-center rounded-sm bg-primary px-3 text-xs font-medium text-primary-contrast outline-none transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary focus-visible:outline-offset-1 min-[400px]:ml-0"
                    >
                        Tamam
                    </button>
                </div>
            </div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// ⚙ button (one per chart header)
// ---------------------------------------------------------------------------

export const ChartSettingsButton: React.FC<{ className?: string }> = ({ className = '' }) => {
    const ownerId = useId();
    const owner = useSyncExternalStore(subscribeOpen, getOpenOwner, getOpenOwnerServer);
    const isOpen = owner === ownerId;
    const buttonRef = useRef<HTMLButtonElement>(null);

    const close = useCallback(() => {
        if (openOwner === ownerId) setOpenOwner(null);
    }, [ownerId]);

    // A chart unmounting while its dialog is open releases the shared open state.
    useEffect(
        () => () => {
            if (openOwner === ownerId) setOpenOwner(null);
        },
        [ownerId],
    );

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                aria-label="Grafik ayarları"
                title="Grafik ayarları"
                aria-haspopup="dialog"
                aria-expanded={isOpen}
                onClick={() => setOpenOwner(isOpen ? null : ownerId)}
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-sm outline-none transition-colors hover:bg-surface-secondary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${
                    isOpen ? 'bg-surface-highlight text-text' : 'text-secondary'
                } ${className}`}
            >
                <Settings2 size={14} aria-hidden="true" />
            </button>
            {isOpen && typeof document !== 'undefined' && createPortal(<ChartSettingsDialog onClose={close} returnFocusRef={buttonRef} />, document.body)}
        </>
    );
};

