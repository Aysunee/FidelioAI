
import React, { useState, useMemo, useEffect } from 'react';
import { Signal } from '../types';
import { Search, Trash2, Filter, AlertCircle, ArrowUpRight, ArrowDownRight, Zap, Download, Settings, Percent, Activity, Server, Info, Globe, RefreshCw, ClipboardList } from 'lucide-react';
import { useSignals } from '../context/SignalContext';
import { useUser } from '../context/UserContext';
import { Modal } from './ui/Modal';
import { formatPrice, formatTime as formatClockTime } from '../utils/formatters';
import { ApiError } from '../utils/config';
import {
    OUTCOME_HORIZONS,
    SCORECARD_MIN_EARLY,
    SCORECARD_MIN_VERDICT,
    VERDICT_BADGES,
    formatCostPct,
    formatHitRate,
    formatOutcomeAbsPct,
    formatOutcomePct,
    getScorecard,
    outcomeTone,
    type OutcomeHorizonInfo,
    type Scorecard,
    type ScorecardDays,
    type ScorecardRow,
    type ScorecardStats
} from '../utils/scorecardApi';
import { BURST_RULES, SIGNAL_SETTINGS_LIMITS } from '../utils/signalEngines';
import { FUNDING_THRESHOLDS } from '../utils/fundingSqueeze';
import {
    ENGINE_SCAN_KEYS,
    ENGINE_SCAN_LABELS,
    ENGINE_STREAM_KEYS,
    ENGINE_STREAM_LABELS,
    ENGINE_STREAM_STATE_LABELS,
    ENGINE_TONE_DOT,
    describeEngineHealth,
    engineRestarts24h,
    engineUptimeSec,
    formatEngineAgo,
    formatEngineDuration,
    type EngineStatus,
    type EngineStreamState
} from '../utils/engineApi';
import { getSideBadge, getSideKind, getSignalLabel, getMagnitude, isMarketSignal, MARKET_BADGE, SideKind } from './SignalFeed';

// Quote every CSV cell, escape embedded quotes and neutralise spreadsheet formulas
// (webhook-supplied strategy/note values may start with = + - @). A plain signed number such as
// "+9.1%" or "-0.0712%" is not a formula and is written as it is.
const toCsvCell = (value: unknown): string => {
    let text = value === null || value === undefined ? '' : String(value);
    if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(text) && !/^[+-]\d+(?:[.,]\d+)?[%x]?$/.test(text)) {
        text = `'${text}`;
    }
    return `"${text.replace(/"/g, '""')}"`;
};

type SignalsApi = ReturnType<typeof useSignals>;
type SignalSettings = SignalsApi['signalSettings'];
type EngineCount = SignalsApi['engineStats']['momentum'];

type SettingsField = 'momThreshold' | 'momCooldown' | 'volRatio' | 'volCooldown' | 'fundingThreshold' | 'fundingCooldown';
type SettingsDraft = Record<SettingsField, string>;

const toDraft = (settings: SignalSettings): SettingsDraft => ({
    momThreshold: String(settings?.momentum?.threshold ?? ''),
    momCooldown: String(settings?.momentum?.cooldownHours ?? ''),
    volRatio: String(settings?.volume?.ratio ?? ''),
    volCooldown: String(settings?.volume?.cooldownHours ?? ''),
    fundingThreshold: String(settings?.funding?.thresholdPct ?? ''),
    fundingCooldown: String(settings?.funding?.cooldownHours ?? '')
});

// Accepts both "3.5" and "3,5" and the typographic minus; returns null for empty / non-numeric input (never NaN).
const parseDecimal = (raw: string): number | null => {
    const normalized = raw.trim().replace(',', '.').replace('\u2212', '-');
    if (normalized === '') return null;
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
};

// Bounds and defaults come from the engine module, so the form can never accept a value the engine
// would clamp. Funding is an 8h-equivalent percent and must be negative.
const LIMITS = SIGNAL_SETTINGS_LIMITS;

const SETTING_RULES: Record<SettingsField, { min: number; max: number; default: number; message: string }> = {
    momThreshold: { ...LIMITS.momentum.threshold, message: `Eşik %${LIMITS.momentum.threshold.min} ile %${LIMITS.momentum.threshold.max} arasında olmalı.` },
    momCooldown: { ...LIMITS.momentum.cooldownHours, message: `Bekleme ${LIMITS.momentum.cooldownHours.min} ile ${LIMITS.momentum.cooldownHours.max} saat arasında olmalı.` },
    volRatio: { ...LIMITS.volume.ratio, message: `Oran ${LIMITS.volume.ratio.min} ile ${LIMITS.volume.ratio.max} kat arasında olmalı.` },
    volCooldown: { ...LIMITS.volume.cooldownHours, message: `Bekleme ${LIMITS.volume.cooldownHours.min} ile ${LIMITS.volume.cooldownHours.max} saat arasında olmalı.` },
    fundingThreshold: { ...LIMITS.funding.thresholdPct, message: `Eşik negatif olmalı: ${LIMITS.funding.thresholdPct.min} ile ${LIMITS.funding.thresholdPct.max} arasında (%).` },
    fundingCooldown: { ...LIMITS.funding.cooldownHours, message: `Bekleme ${LIMITS.funding.cooldownHours.min} ile ${LIMITS.funding.cooldownHours.max} saat arasında olmalı.` }
};

const rangeHint = (field: SettingsField): string => {
    const rule = SETTING_RULES[field];
    return `Varsayılan ${rule.default} · en az ${rule.min} · en çok ${rule.max}`;
};

// The detector never uses a negative gate looser than this fixed level (utils/fundingSqueeze.ts),
// so a threshold above it behaves like it.
const FUNDING_FLOOR_PCT = Number((-FUNDING_THRESHOLDS.extremeF8 * 100).toFixed(4));
const FUNDING_FLOOR_TEXT = `${FUNDING_FLOOR_PCT < 0 ? '−' : ''}%${Math.abs(FUNDING_FLOOR_PCT)}`;

const SETTING_FIELDS = Object.keys(SETTING_RULES) as SettingsField[];

// Market-wide burst guard (utils/signalEngines.ts applyBurstGuard), for the dialog text.
const BURST_WINDOW_MIN = BURST_RULES.windowMs / 60000;
const BURST_SHARE_PCT = BURST_RULES.universeShare * 100;

const validateField = (field: SettingsField, raw: string): { value: number | null; error: string | null } => {
    const rule = SETTING_RULES[field];
    const value = parseDecimal(raw);
    if (value === null) return { value: null, error: 'Bir sayı girin.' };
    if (value < rule.min || value > rule.max) return { value: null, error: rule.message };
    return { value, error: null };
};

const INPUT_CLASS = 'h-7 rounded-sm border border-border bg-surface-secondary px-2 text-xs text-text placeholder:text-muted outline-none focus:border-primary';
const LABEL_CLASS = 'mb-1 block text-[11px] text-secondary';
const HINT_CLASS = 'mt-1 text-[10px] leading-snug text-muted';
const SECTION_TITLE_CLASS = 'flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-secondary';
const RULE_TEXT_CLASS = 'text-[11px] leading-snug text-secondary';
const ICON_BUTTON_CLASS = 'grid h-6 w-6 place-items-center rounded-sm text-secondary transition-colors hover:bg-surface-secondary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary';
const TH_CLASS = 'sticky top-0 z-10 h-7 whitespace-nowrap border-b border-border bg-surface px-3 text-[10px] font-medium uppercase tracking-wider text-muted';
const TD_CLASS = 'h-7 whitespace-nowrap border-b border-border px-3';

// One numeric setting: label, input with its unit, allowed range and the inline validation message.
const SettingInput: React.FC<{
    id: string;
    label: string;
    unit: string;
    step: string;
    hint: string;
    value: string;
    error: string | null;
    onChange: (value: string) => void;
    // Non-admins see the global values without being able to change them.
    readOnly?: boolean;
    children?: React.ReactNode;
}> = ({ id, label, unit, step, hint, value, error, onChange, readOnly = false, children }) => (
    <div className="min-w-0">
        <label htmlFor={id} className={LABEL_CLASS}>{label}</label>
        <div className={`flex h-7 items-center rounded-sm border focus-within:border-primary ${readOnly ? 'bg-surface' : 'bg-surface-secondary'} ${error ? 'border-danger' : 'border-border'}`}>
            <input
                id={id}
                type="number"
                inputMode="decimal"
                step={step}
                value={value}
                readOnly={readOnly}
                onChange={e => { if (!readOnly) onChange(e.target.value); }}
                aria-invalid={error ? true : undefined}
                aria-describedby={`${id}-hint`}
                className={`h-full w-full min-w-0 bg-transparent px-2 font-mono text-xs outline-none ${readOnly ? 'cursor-default text-secondary' : 'text-text'}`}
            />
            <span className="shrink-0 pr-2 text-[11px] text-muted">{unit}</span>
        </div>
        {error ? (
            <p id={`${id}-hint`} role="alert" className="mt-1 flex items-start gap-1 text-[10px] leading-snug text-danger">
                <AlertCircle size={10} className="mt-px shrink-0" />
                <span>{error}</span>
            </p>
        ) : (
            <p id={`${id}-hint`} className={HINT_CLASS}>{hint}</p>
        )}
        {children}
    </div>
);

// "şu an N / M coin eşiğin ötesinde": how many symbols satisfy the SAVED threshold right now.
// The server engine reports these counts (status polled every 15 s); while a count is not available the
// line says so.
const LiveCount: React.FC<{ stat: EngineCount | undefined; savedLabel: string; isDraftChanged: boolean }> = ({ stat, savedLabel, isDraftChanged }) => {
    const ready = !!stat && Number.isFinite(stat.matching) && Number.isFinite(stat.universe) && stat.universe > 0;
    return (
        <p className="mt-1 text-[10px] leading-snug text-muted" aria-live="polite">
            {ready ? (
                <>
                    şu an <span className="font-mono text-[11px] font-semibold text-text">{stat!.matching} / {stat!.universe}</span> coin eşiğin ötesinde
                    {isDraftChanged && <> (kayıtlı eşik {savedLabel} için)</>}
                </>
            ) : (
                'canlı sayaç: veri bekleniyor'
            )}
        </p>
    );
};

const STREAM_DOT: Record<EngineStreamState, string> = {
    connected: 'bg-success',
    connecting: 'bg-warning',
    down: 'bg-danger'
};

const STATUS_CELL_CLASS = 'min-w-0 bg-surface px-2 py-1.5';
const STATUS_LABEL_CLASS = 'truncate text-[10px] font-medium uppercase tracking-wider text-muted';
const STATUS_VALUE_CLASS = 'mt-0.5 flex min-w-0 items-center gap-1.5 truncate font-mono text-xs text-text';

const StatusCell: React.FC<{ label: string; title?: string; className?: string; children: React.ReactNode }> = ({ label, title, className = '', children }) => (
    <div className={`${STATUS_CELL_CLASS} ${className}`} title={title}>
        <div className={STATUS_LABEL_CLASS}>{label}</div>
        <div className={STATUS_VALUE_CLASS}>{children}</div>
    </div>
);

const engineStateText = (status: EngineStatus | null, error: string | null): string => {
    if (!status) return error ? 'Alınamadı' : 'Bekleniyor';
    if (status.mode === 'off') return 'Kapalı';
    if (status.role === 'standby') return status.leaderStale ? 'Yanıt yok' : 'Beklemede';
    return status.running ? 'Çalışıyor' : 'Çalışmıyor';
};

const formatBootTime = (at: number) =>
    new Date(at).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// "Motor durumu": state, uptime, restarts, data streams and the last scan of every engine.
const EngineStatusBlock: React.FC<{ status: EngineStatus | null; error: string | null; receivedAt: number; now: number }> = ({ status, error, receivedAt, now: clock }) => {
    // The dialog clock ticks every 5 s; a status received after the last tick must not look "from the future".
    const now = Math.max(clock, receivedAt);
    const health = describeEngineHealth(status, error, receivedAt, now);
    const bootsInWindow = status ? status.boots.filter(t => t >= now - 24 * 60 * 60 * 1000) : [];
    const restarts = status ? engineRestarts24h(status.boots, now) : null;
    const lastBoot = status && status.boots.length > 0 ? status.boots[status.boots.length - 1] : null;
    const bootTitle = [
        lastBoot !== null ? `Son başlatma: ${formatBootTime(lastBoot)}` : '',
        bootsInWindow.length > 0 ? `Son 24 saatteki başlatmalar: ${bootsInWindow.map(formatBootTime).join(', ')}` : ''
    ].filter(Boolean).join(' · ') || undefined;
    return (
        <div className="space-y-2">
            <h3 className={SECTION_TITLE_CLASS}>
                <Server size={12} /> Motor durumu
            </h3>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-4">
                <StatusCell label="Durum" title={health.text}>
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ENGINE_TONE_DOT[health.tone]}`} />
                    <span className="truncate font-sans">{engineStateText(status, error)}</span>
                </StatusCell>
                <StatusCell label="Çalışma süresi">
                    {status ? formatEngineDuration(engineUptimeSec(status, receivedAt, now)) : '—'}
                </StatusCell>
                <StatusCell label="Yeniden başlama" title={bootTitle}>
                    {restarts === null ? '—' : <>{restarts} <span className="font-sans text-[11px] text-muted">son 24 sa</span></>}
                </StatusCell>
                <StatusCell label="Bugün (UTC)">
                    {status ? `${status.signalsToday} kayıt` : '—'}
                </StatusCell>
                {ENGINE_STREAM_KEYS.map(key => (
                    <StatusCell key={key} label={ENGINE_STREAM_LABELS[key]}>
                        {status ? (
                            <>
                                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STREAM_DOT[status.streams[key]]}`} />
                                <span className="truncate font-sans">{ENGINE_STREAM_STATE_LABELS[status.streams[key]]}</span>
                            </>
                        ) : '—'}
                    </StatusCell>
                ))}
                <div className={`${STATUS_CELL_CLASS} col-span-2 sm:col-span-3`}>
                    <div className={STATUS_LABEL_CLASS}>Son tarama</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-xs text-text">
                        {ENGINE_SCAN_KEYS.map(key => (
                            <span key={key} className="whitespace-nowrap">
                                <span className="font-sans text-secondary">{ENGINE_SCAN_LABELS[key]}</span>{' '}
                                {status ? formatEngineAgo(status.lastScan[key], now) : '—'}
                            </span>
                        ))}
                    </div>
                </div>
                <StatusCell label="Sunucu Telegram" className="col-span-2 sm:col-span-1" title="Açıkken motor kayıtlarını Telegram'a sunucu bir kez gönderir; tarayıcı ayrıca göndermez.">
                    <span className="font-sans">{status ? (status.telegram.server ? 'açık' : 'kapalı') : '—'}</span>
                </StatusCell>
            </div>
            {health.tone !== 'success' && (
                <p className={`flex items-start gap-1 text-[11px] leading-snug ${health.tone === 'danger' ? 'text-danger' : 'text-warning'}`}>
                    <AlertCircle size={11} className="mt-px shrink-0" />
                    <span>{health.text}</span>
                </p>
            )}
        </div>
    );
};

// ---------------------------------------------------------------------------
// Karne: per-rule scorecard of forward tracking (GET /api/scorecard). Descriptive, net of costs,
// against BTC, with minimum sample sizes before any verdict.
// ---------------------------------------------------------------------------

const SCORECARD_REFRESH_MS = 5 * 60 * 1000;
const SCORECARD_PERIODS: { days: ScorecardDays; label: string; title: string }[] = [
    { days: 7, label: '7g', title: 'Son 7 gün' },
    { days: 30, label: '30g', title: 'Son 30 gün' }
];

// Last response per period, kept while the app is open: switching tabs or periods shows it at once
// and refreshes in the background. The scorecard is the same for every user.
const scorecardCache = new Map<ScorecardDays, { data: Scorecard; at: number }>();

interface ScorecardState {
    data: Scorecard | null;
    loading: boolean;
    error: string | null;
}

const useScorecard = (days: ScorecardDays) => {
    const [state, setState] = useState<ScorecardState>(() => ({ data: scorecardCache.get(days)?.data ?? null, loading: true, error: null }));
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof document === 'undefined') return;
        let disposed = false;
        let inFlight: AbortController | null = null;
        setState({ data: scorecardCache.get(days)?.data ?? null, loading: true, error: null });

        const load = async () => {
            inFlight?.abort();
            const controller = new AbortController();
            inFlight = controller;
            setState(prev => (prev.loading ? prev : { ...prev, loading: true }));
            try {
                const data = await getScorecard(days, controller.signal);
                if (disposed || controller.signal.aborted) return;
                scorecardCache.set(days, { data, at: Date.now() });
                setState({ data, loading: false, error: null });
            } catch (err) {
                if (disposed || controller.signal.aborted) return;
                const message = err instanceof ApiError && err.status === 404
                    ? 'Karne bu sunucuda henüz yok (sunucu güncellenmeli).'
                    : err instanceof Error ? err.message : 'Bilinmeyen hata';
                setState(prev => ({ ...prev, loading: false, error: message }));
            } finally {
                if (inFlight === controller) inFlight = null;
            }
        };

        // Refresh while visible; a tab that comes back after a while catches up at once.
        const refreshIfDue = () => {
            if (disposed || document.visibilityState !== 'visible') return;
            const cached = scorecardCache.get(days);
            if (!cached || Date.now() - cached.at >= SCORECARD_REFRESH_MS) load();
        };

        load();
        const timer = window.setInterval(refreshIfDue, 60 * 1000);
        document.addEventListener('visibilitychange', refreshIfDue);
        return () => {
            disposed = true;
            inFlight?.abort();
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', refreshIfDue);
        };
    }, [days, reloadKey]);

    return { ...state, reload: () => setReloadKey(k => k + 1) };
};

const SCORE_LINE = 'flex min-w-0 items-baseline justify-between gap-2 leading-4';
const SCORE_LABEL = 'shrink-0 text-[10px] text-muted';
const SCORE_VALUE = 'truncate font-mono text-[11px]';

// Hit rate with its 95 % interval as a thin range bar; the vertical line marks 50 %.
const HitRangeBar: React.FC<{ stats: ScorecardStats; strong: boolean }> = ({ stats, strong }) => {
    const ci = stats.hitCi;
    const rate = stats.hitRate;
    const tone = !strong || !ci ? 'bg-muted' : ci[0] > 0.5 ? 'bg-success' : ci[1] < 0.5 ? 'bg-danger' : 'bg-secondary';
    return (
        <span className="relative mx-1 h-1 min-w-[32px] flex-1 self-center bg-surface-highlight" aria-hidden="true">
            {ci && (
                <span
                    className={`absolute inset-y-0 ${tone} opacity-60`}
                    style={{ left: `${ci[0] * 100}%`, width: `${Math.max(1, (ci[1] - ci[0]) * 100)}%` }}
                />
            )}
            <span className="absolute -top-0.5 left-1/2 h-2 w-px bg-border-strong" />
            {rate !== null && (
                <span className="absolute -top-0.5 h-2 w-0.5 -translate-x-1/2 bg-text" style={{ left: `${rate * 100}%` }} />
            )}
        </span>
    );
};


const statsTitle = (stats: ScorecardStats, neutral: boolean, horizon: OutcomeHorizonInfo): string => {
    const lines = [
        `${horizon.long} sonra · ${stats.verdictText}`,
        `n ${stats.n} kayıt · nEff ${stats.nEff} bağımsız saat`
    ];
    if (neutral) {
        lines.push(
            `Medyan |hareket| ${formatOutcomeAbsPct(stats.medianAbsRaw)} · medyan ham ${formatOutcomePct(stats.medianRaw)}`,
            `Medyan tepe ${formatOutcomePct(stats.medianMfe)} · medyan dip ${formatOutcomePct(stats.medianMae)}`
        );
    } else {
        const ci = stats.hitCi ? ` (%95 aralık ${formatHitRate(stats.hitCi[0])}–${formatHitRate(stats.hitCi[1])})` : '';
        lines.push(
            `İsabet ${formatHitRate(stats.hitRate)}${ci}`,
            `Net: medyan ${formatOutcomePct(stats.medianNet)} · ortalama ${formatOutcomePct(stats.meanNet)}`,
            `BTC'ye göre (ortalama) ${formatOutcomePct(stats.meanExcess)}`,
            `Medyan ham ${formatOutcomePct(stats.medianRaw)} · en iyi ${formatOutcomePct(stats.medianMfe)} · en kötü ${formatOutcomePct(stats.medianMae)}`
        );
        if (stats.tStat !== null) lines.push(`t ${stats.tStat.toFixed(2)}`);
    }
    return lines.join('\n');
};

// One horizon of one rule: verdict, sample size and the descriptive numbers.
const ScoreCell: React.FC<{ stats: ScorecardStats; neutral: boolean; horizon: OutcomeHorizonInfo }> = ({ stats, neutral, horizon }) => {
    // Below the minimum sample the numbers are shown, but never coloured as a gain or a loss.
    const strong = stats.nEff >= SCORECARD_MIN_EARLY;
    const tone = (value: number | null) => (strong ? outcomeTone(value) : value === null ? 'text-muted' : 'text-secondary');
    const badge = VERDICT_BADGES[stats.verdict];
    return (
        <div role="cell" className="min-w-0 bg-surface px-3 py-1.5 group-hover:bg-surface-secondary" title={statsTitle(stats, neutral, horizon)}>
            <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted lg:hidden">{horizon.long} sonra</div>
            <div className={SCORE_LINE}>
                <span className={`truncate rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-3 ${badge.tone}`}>
                    {badge.text}
                </span>
                {/* n (nEff); while collecting, nEff against the minimum of 30 */}
                <span className="shrink-0 font-mono text-[10px] text-muted">
                    n {stats.n}
                    {stats.n > 0 && (
                        <span className="text-secondary">
                            {' '}({stats.verdict === 'COLLECTING' ? `${stats.nEff}/${SCORECARD_MIN_EARLY}` : stats.nEff})
                        </span>
                    )}
                </span>
            </div>
            {stats.n === 0 ? (
                <p className="mt-1 text-[11px] text-muted">Henüz ölçüm yok</p>
            ) : neutral ? (
                <div className="mt-1">
                    <div className={SCORE_LINE}>
                        <span className={SCORE_LABEL}>medyan |hareket|</span>
                        <span className={`${SCORE_VALUE} text-text`}>{formatOutcomeAbsPct(stats.medianAbsRaw)}</span>
                    </div>
                    <div className={SCORE_LINE}>
                        <span className={SCORE_LABEL}>medyan tepe</span>
                        <span className={`${SCORE_VALUE} text-secondary`}>{formatOutcomePct(stats.medianMfe)}</span>
                    </div>
                    <div className={SCORE_LINE}>
                        <span className={SCORE_LABEL}>medyan dip</span>
                        <span className={`${SCORE_VALUE} text-secondary`}>{formatOutcomePct(stats.medianMae)}</span>
                    </div>
                </div>
            ) : (
                <div className="mt-1">
                    <div className={SCORE_LINE}>
                        <span className={SCORE_LABEL}>isabet</span>
                        <HitRangeBar stats={stats} strong={strong} />
                        <span className={`${SCORE_VALUE} ${strong ? 'text-text' : 'text-secondary'}`}>{formatHitRate(stats.hitRate)}</span>
                    </div>
                    <div className={SCORE_LINE}>
                        <span className={SCORE_LABEL}>medyan net</span>
                        <span className={`${SCORE_VALUE} ${tone(stats.medianNet)}`}>{formatOutcomePct(stats.medianNet)}</span>
                    </div>
                    <div className={SCORE_LINE}>
                        <span className={SCORE_LABEL}>BTC'ye göre</span>
                        <span className={`${SCORE_VALUE} ${tone(stats.meanExcess)}`}>{formatOutcomePct(stats.meanExcess)}</span>
                    </div>
                </div>
            )}
        </div>
    );
};

const isNeutralRow = (row: ScorecardRow) =>
    row.side === 'NEUTRAL' || OUTCOME_HORIZONS.some(h => row.byHorizon[h.scorecard].verdict === 'NEUTRAL');

// Shadow rule row: never sent or shown as a signal, only measured. Rendered last, set apart.
const SHADOW_BADGE = {
    text: 'GÖLGE',
    title: "Sinyal göndermez, sadece ölçülür. Bir yükseliş sinyalinden (24s momentum veya hacim) sonraki 12 saat içinde funding −%0,05'in (8s eşdeğeri) altına iner, vadeli açık pozisyon en az %15 büyür ve fiyat sinyal fiyatının altına düşmezse kaydedilir. ORCA rallisinden türetilmiş bir hipotez; kanıt yok."
} as const;

// Two horizons per line below lg (each rule gets a title line), one table line per rule from lg on.
const SCORE_GRID = 'grid grid-cols-2 gap-px lg:grid-cols-[minmax(150px,1fr)_repeat(4,minmax(0,1fr))]';

const ScorecardPanel: React.FC = () => {
    const [days, setDays] = useState<ScorecardDays>(7);
    const { data, loading, error, reload } = useScorecard(days);
    const costs = data?.costs;
    // Shadow rows last, in server order otherwise.
    const rows = useMemo(
        () => (data ? [...data.rows.filter(row => !row.shadow), ...data.rows.filter(row => row.shadow)] : []),
        [data]
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* Period, cost assumption, pending measurements */}
            <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1">
                <div className="inline-flex shrink-0 rounded-sm border border-border p-0.5" role="group" aria-label="Dönem">
                    {SCORECARD_PERIODS.map(period => (
                        <button
                            key={period.days}
                            type="button"
                            onClick={() => setDays(period.days)}
                            aria-pressed={days === period.days}
                            title={period.title}
                            className={`h-6 rounded-sm px-2 font-mono text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${days === period.days ? 'bg-surface-highlight text-text' : 'text-secondary hover:text-text'}`}
                        >
                            {period.label}
                        </button>
                    ))}
                </div>
                <p className="min-w-0 flex-1 text-[11px] leading-snug text-secondary">
                    Maliyet varsayımı: spot <span className="font-mono text-text">{costs ? formatCostPct(costs.spot) : '—'}</span>,
                    vadeli <span className="font-mono text-text">{costs ? formatCostPct(costs.perp) : '—'}</span>
                    <span className="text-muted"> · </span>
                    bekleyen ölçüm: <span className="font-mono text-text">{data ? data.pending : '—'}</span>
                </p>
                <div className="flex shrink-0 items-center gap-1.5">
                    {data && (
                        <span className="font-mono text-[10px] text-muted" title="Karnenin hesaplandığı an (sunucu 60 sn önbellekler)">
                            {formatClockTime(data.generatedAt, false)}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={reload}
                        disabled={loading}
                        className={`${ICON_BUTTON_CLASS} disabled:cursor-default disabled:opacity-50`}
                        title="Yenile"
                        aria-label="Karneyi yenile"
                    >
                        <RefreshCw size={12} className={loading ? 'animate-spin' : undefined} />
                    </button>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto" aria-busy={loading}>
                {error && (
                    <p role="alert" className="flex items-start gap-1.5 border-b border-border bg-danger-soft px-3 py-1.5 text-[11px] leading-snug text-danger">
                        <AlertCircle size={12} className="mt-px shrink-0" />
                        <span>Karne alınamadı{data ? ' (son alınan karne gösteriliyor)' : ''}: {error}</span>
                    </p>
                )}

                {!data ? (
                    !error && <p className="px-3 py-8 text-center text-xs text-muted">Karne yükleniyor…</p>
                ) : data.rows.length === 0 ? (
                    <div className="flex flex-col items-center gap-1 px-3 py-8 text-center text-xs text-muted">
                        <ClipboardList size={14} />
                        <p>Bu dönemde ölçülmüş sinyal yok.</p>
                        <p className="max-w-sm text-[11px]">İlk ölçüm, sinyal kaydedildikten 15 dakika sonra gelir.</p>
                    </div>
                ) : (
                    <div role="table" aria-label={`Sinyal karnesi, son ${days} gün`} className="bg-border">
                        <div role="row" className={`${SCORE_GRID} sticky top-0 z-10 hidden border-b border-border lg:grid`}>
                            <div role="columnheader" className="flex h-7 items-center bg-surface px-3 text-[10px] font-medium uppercase tracking-wider text-muted">Kural</div>
                            {OUTCOME_HORIZONS.map(h => (
                                <div key={h.key} role="columnheader" className="flex h-7 items-center bg-surface px-3 text-[10px] font-medium uppercase tracking-wider text-muted">
                                    {h.long} sonra
                                </div>
                            ))}
                        </div>
                        {rows.map((row, index) => {
                            const neutral = isNeutralRow(row);
                            // The first shadow row gets a thicker rule above it (gap-px shows bg-border).
                            const firstShadow = row.shadow && (index === 0 || !rows[index - 1].shadow);
                            return (
                                <div key={row.key} role="row" className={`${SCORE_GRID} group border-b border-border ${firstShadow ? 'border-t-4' : ''}`}>
                                    <div role="rowheader" className="col-span-2 flex min-w-0 items-baseline justify-between gap-2 bg-surface px-3 py-1.5 group-hover:bg-surface-secondary lg:col-span-1 lg:flex-col lg:justify-start lg:gap-0.5">
                                        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                                            {row.shadow && (
                                                <span
                                                    className="shrink-0 rounded-sm border border-border-strong px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-3 text-secondary"
                                                    title={SHADOW_BADGE.title}
                                                >
                                                    {SHADOW_BADGE.text}
                                                </span>
                                            )}
                                            <span className={`min-w-0 text-xs font-medium leading-snug ${row.shadow ? 'text-secondary' : 'text-text'}`}>{row.label}</span>
                                        </span>
                                        <span className="shrink-0 text-[10px] text-muted">
                                            <span className="font-mono">{row.total}</span> kayıt{neutral ? ' · yönsüz' : ''}
                                        </span>
                                    </div>
                                    {OUTCOME_HORIZONS.map(h => (
                                        <ScoreCell key={h.key} stats={row.byHorizon[h.scorecard]} neutral={neutral} horizon={h} />
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* How to read it */}
                <div className="space-y-1 px-3 py-2 text-[11px] leading-snug text-muted">
                    <p>
                        <span className="text-secondary">n</span> ölçülen kayıt, parantez içi <span className="text-secondary">nEff</span> bağımsız saat sayısı
                        (aynı saatte açılan kayıtlar tek örnek sayılır). <span className="text-secondary">İsabet</span> maliyet sonrası kaydın yönünde
                        sonuçlananların oranıdır; çubuk %95 güven aralığı, dikey çizgi %50. <span className="text-secondary">Medyan net</span> maliyet
                        düşülmüş getiri, <span className="text-secondary">BTC'ye göre</span> aynı aralıktaki BTC hareketine göre ortalama farktır.
                        Yönsüz kurallarda yalnızca hareketin büyüklüğü gösterilir.
                    </p>
                    <p>
                        Karar: nEff {SCORECARD_MIN_EARLY}'dan azsa veri toplanıyor; {SCORECARD_MIN_EARLY}–{SCORECARD_MIN_VERDICT - 1} arası ön sonuç;
                        en az {SCORECARD_MIN_VERDICT} olduğunda t ≥ 2 ve BTC'ye göre pozitifse kenar var, t ≤ −2 ise ters yön, diğer durumlarda kenar yok.
                    </p>
                    {rows.some(row => row.shadow) && (
                        <p>
                            {/* word joiner: "−%0,05" never breaks after the minus */}
                            <span className="text-secondary">{SHADOW_BADGE.text}</span>: {SHADOW_BADGE.title.replace('−%', '−\u2060%')}
                        </p>
                    )}
                    <p className="text-secondary">
                        Geçmiş sonuçlar gelecek için garanti değildir. Karar için en az 100 bağımsız saatlik örnek gerekir.
                    </p>
                </div>
            </div>
        </div>
    );
};

type ManagerView = 'records' | 'scorecard';

const VIEW_TABS: { key: ManagerView; label: string }[] = [
    { key: 'records', label: 'Kayıtlar' },
    { key: 'scorecard', label: 'Karne' }
];

interface SignalManagerProps {
    signals: Signal[];
    onDelete: (id: string) => void;
    onClearAll: () => void;
}

export const SignalManager: React.FC<SignalManagerProps> = ({ signals, onDelete, onClearAll }) => {
    const { signalSettings, updateSignalSettings, engineStats, engineStatus, engineStatusError, engineStatusAt } = useSignals();
    const { isAdmin } = useUser();
    // Settings are global (server engine): only an admin can edit them, everyone else reads them.
    const readOnly = !isAdmin;
    const [view, setView] = useState<ManagerView>('records');
    const [searchTerm, setSearchTerm] = useState('');
    const [sideFilter, setSideFilter] = useState<'ALL' | SideKind>('ALL');
    const [strategyFilter, setStrategyFilter] = useState<string>('ALL');

    // Settings Modal State (inputs are kept as raw strings and validated while typing)
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [draft, setDraft] = useState<SettingsDraft>(() => toDraft(signalSettings));
    const [isSaving, setIsSaving] = useState(false);
    // Clock for the "… önce" texts of the status block; ticks only while the dialog is open.
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (isSettingsOpen) setDraft(toDraft(signalSettings));
    }, [isSettingsOpen, signalSettings]);

    useEffect(() => {
        if (!isSettingsOpen) return;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 5000);
        return () => clearInterval(timer);
    }, [isSettingsOpen]);

    const updateDraft = (field: SettingsField, value: string) => {
        setDraft(prev => ({ ...prev, [field]: value }));
    };

    const checked = useMemo(() => {
        const result = {} as Record<SettingsField, { value: number | null; error: string | null }>;
        SETTING_FIELDS.forEach(field => { result[field] = validateField(field, draft[field]); });
        return result;
    }, [draft]);
    const hasSettingsError = SETTING_FIELDS.some(field => checked[field].error !== null);

    const handleSaveSettings = async () => {
        if (hasSettingsError || readOnly || isSaving) return;
        setIsSaving(true);
        const saved = await updateSignalSettings({
            version: 2,
            momentum: { threshold: checked.momThreshold.value!, cooldownHours: checked.momCooldown.value! },
            volume: { ratio: checked.volRatio.value!, cooldownHours: checked.volCooldown.value! },
            funding: { thresholdPct: checked.fundingThreshold.value!, cooldownHours: checked.fundingCooldown.value! }
        });
        setIsSaving(false);
        // On failure the dialog stays open with the draft (the context showed the reason as a toast).
        if (saved) setIsSettingsOpen(false);
    };

    // The live counters describe the saved thresholds; say so while the draft differs from them.
    const savedMomentum = signalSettings?.momentum?.threshold;
    const savedVolume = signalSettings?.volume?.ratio;
    const savedFunding = signalSettings?.funding?.thresholdPct;
    const draftDiffers = (field: SettingsField, saved: number | undefined) => !readOnly && parseDecimal(draft[field]) !== (saved ?? null);

    // Extract unique strategies for the filter dropdown
    const uniqueStrategies = useMemo(() => {
        const strats = new Set(signals.map(s => s.strategy));
        return ['ALL', ...Array.from(strats)];
    }, [signals]);

    const filteredSignals = useMemo(() => {
        const term = searchTerm.toLowerCase();
        return signals.filter(sig => {
            const matchesSearch = sig.symbol.toLowerCase().includes(term) ||
                sig.note?.toLowerCase().includes(term);

            const matchesSide = sideFilter === 'ALL' ? true : getSideKind(sig.side) === sideFilter;

            const matchesStrategy = strategyFilter === 'ALL' ? true : sig.strategy === strategyFilter;

            return matchesSearch && matchesSide && matchesStrategy;
        });
    }, [signals, searchTerm, sideFilter, strategyFilter]);

    const formatTime = (isoStr: string) => {
        return new Date(isoStr).toLocaleString('tr-TR', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
    };

    const exportCSV = () => {
        if (typeof document === 'undefined' || typeof window === 'undefined') return;
        const headers = ['Zaman', 'Sembol', 'Yön', 'Büyüklük', 'Büyüklük açıklaması', 'Fiyat', 'Kural', 'Strateji anahtarı', 'Not'];
        const rows = filteredSignals.map(s => {
            const magnitude = getMagnitude(s);
            return [
                s.time, s.symbol, getSideBadge(s).text, magnitude?.text ?? '', magnitude?.caption ?? '',
                // a market-wide record (MARKET) has no price
                isMarketSignal(s) ? '' : s.price, getSignalLabel(s.strategy), s.strategy, s.note || ''
            ];
        });
        const csvContent = [headers, ...rows].map(row => row.map(toCsvCell).join(',')).join('\r\n');
        // UTF-8 BOM so Excel detects the encoding (Turkish characters)
        const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `signals_export_${Date.now()}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        // Safari/iOS start the download asynchronously; revoking too early aborts it.
        setTimeout(() => URL.revokeObjectURL(url), 30000);
    };

    return (
        <section lang="tr" className="flex h-full min-h-0 w-full flex-1 flex-col bg-surface">
            {/* Settings Modal */}
            <Modal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} title="Sinyal kuralları" maxWidth="max-w-xl">
                <div className="space-y-3">
                    <p className="flex items-start gap-1.5 rounded-sm border border-border bg-surface-secondary px-2 py-1.5 text-[11px] leading-snug text-text">
                        <Info size={12} className="mt-px shrink-0 text-secondary" />
                        <span>
                            Bu ayarlar sunucudaki sinyal motoru içindir ve tüm kullanıcılar için ortaktır.
                            {readOnly && <span className="text-secondary"> Yalnızca yönetici değiştirebilir.</span>}
                        </span>
                    </p>
                    <p className={RULE_TEXT_CLASS}>
                        Üç kural sunucuda, günün her saati Binance'in herkese açık verisiyle çalışır; kayıtlar veritabanına yazılır
                        ve her cihazda aynı görünür. Kayıtlar yalnızca ölçülen durumu bildirir; tahmin ya da işlem önerisi değildir.
                        Bir eşik değiştiğinde o kural sessizce yeniden başlar: o an eşiğin ötesinde olan coinler için toplu kayıt açılmaz.
                    </p>
                    <p className={RULE_TEXT_CLASS}>
                        <Globe size={11} className="mr-1 inline-block align-[-1px] text-info" aria-hidden="true" />
                        Piyasa geneli koruma: aynı yönde son {BURST_WINDOW_MIN} dakikada momentumda {BURST_RULES.limits.MOMENTUM}'dan,
                        hacimde {BURST_RULES.limits.VOLUME}'den fazla coin koşulu sağlarsa (ya da en az {BURST_RULES.minShareCount} olup izlenen
                        coinlerin %{BURST_SHARE_PCT}'üne ulaşırsa) tek tek kayıt yerine tek bir "Piyasa" kaydı açılır, hareket durulunca
                        (30 dakika boyunca {BURST_WINDOW_MIN} dakikada 3'ten az yeni kayıt) bir "bitti" kaydı gelir; fonlamanın sıfırın
                        hemen altına dönmesi (ör. −%0.01) artık kayıt açmaz, yalnızca uç bölgeye giriş açar.
                    </p>

                    <div className="border-t border-border pt-3">
                        <EngineStatusBlock status={engineStatus} error={engineStatusError} receivedAt={engineStatusAt} now={now} />
                    </div>

                    {/* Momentum */}
                    <div className="space-y-2 border-t border-border pt-3">
                        <h3 className={SECTION_TITLE_CLASS}>
                            <Percent size={12} /> 24 saatlik momentum
                        </h3>
                        <p className={RULE_TEXT_CLASS}>
                            Spot USDT paritesinin 24 saatlik değişimi eşiğe ulaşmış (yukarı ya da aşağı) ve fiyat yeni 24 saatlik zirvede
                            (yükselişte) ya da dipte (düşüşte), yani o uca en çok %0.1 uzaklıkta ise kayıt açılır. Kayıt, iki koşulun
                            birlikte sağlandığı ana girişte bir kez açılır. Yön, hareketin yönüdür. Evren: 24 saatlik hacmi en az
                            1 milyon USDT olan pariteler; stabil ve wrapped coinler ile 24 saatlik aralığı %0.3'ten dar olanlar hariç.
                            Bir taramada en çok 5 kayıt açılır (en büyük değişim önce).
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                            <SettingInput
                                id="signal-mom-threshold"
                                readOnly={readOnly}
                                label="24s değişim eşiği"
                                unit="%"
                                step="0.5"
                                hint={rangeHint('momThreshold')}
                                value={draft.momThreshold}
                                error={checked.momThreshold.error}
                                onChange={v => updateDraft('momThreshold', v)}
                            >
                                <LiveCount
                                    stat={engineStats?.momentum}
                                    savedLabel={savedMomentum !== undefined ? `%${savedMomentum}` : ''}
                                    isDraftChanged={draftDiffers('momThreshold', savedMomentum)}
                                />
                            </SettingInput>
                            <SettingInput
                                id="signal-mom-cooldown"
                                readOnly={readOnly}
                                label="Bekleme (aynı coin ve yön)"
                                unit="saat"
                                step="1"
                                hint={rangeHint('momCooldown')}
                                value={draft.momCooldown}
                                error={checked.momCooldown.error}
                                onChange={v => updateDraft('momCooldown', v)}
                            />
                        </div>
                    </div>

                    {/* Volume */}
                    <div className="space-y-2 border-t border-border pt-3">
                        <h3 className={SECTION_TITLE_CLASS}>
                            <Zap size={12} /> Hacim artışı
                        </h3>
                        <p className={RULE_TEXT_CLASS}>
                            Oran = son 1 saatin hacmi ÷ (24 saatlik hacim ÷ 24). Oran eşiğin üstüne çıktığı anda bir kez kayıt açılır;
                            oran 3'ün altına inmeden (eşik 3.6'dan küçükse eşiğin 0.6 katının altına inmeden) aynı coin için kural
                            yeniden kurulmaz. Yön, son 1 saatlik fiyat değişimi en az %1 ise o değişimin işaretidir; değilse kayıt
                            yönsüzdür. Evren, momentum kuralıyla aynıdır.
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                            <SettingInput
                                id="signal-vol-ratio"
                                readOnly={readOnly}
                                label="Oran eşiği"
                                unit="kat"
                                step="0.5"
                                hint={rangeHint('volRatio')}
                                value={draft.volRatio}
                                error={checked.volRatio.error}
                                onChange={v => updateDraft('volRatio', v)}
                            >
                                <LiveCount
                                    stat={engineStats?.volume}
                                    savedLabel={savedVolume !== undefined ? `${savedVolume} kat` : ''}
                                    isDraftChanged={draftDiffers('volRatio', savedVolume)}
                                />
                            </SettingInput>
                            <SettingInput
                                id="signal-vol-cooldown"
                                readOnly={readOnly}
                                label="Bekleme (aynı coin)"
                                unit="saat"
                                step="1"
                                hint={rangeHint('volCooldown')}
                                value={draft.volCooldown}
                                error={checked.volCooldown.error}
                                onChange={v => updateDraft('volCooldown', v)}
                            />
                        </div>
                    </div>

                    {/* Funding */}
                    <div className="space-y-2 border-t border-border pt-3">
                        <h3 className={SECTION_TITLE_CLASS}>
                            <Activity size={12} /> Negatif fonlama rejimi
                        </h3>
                        <p className={RULE_TEXT_CLASS}>
                            Kripto perp kontratlarında tahmini fonlama oranı 8 saatlik eşdeğere çevrilir. Sınır, şu üçünden en negatif
                            olanıdır: girdiğiniz eşik, sabit {FUNDING_FLOOR_TEXT} ve tüm kontratların en negatif %2'lik dilim sınırı. Oran bu
                            sınırın altına inip en az 60 saniye orada kalırsa kayıt açılır; işaretin pozitiften negatife dönmesi tek başına
                            kayıt açmaz. Kayıt yönsüzdür. Motor başladığında zaten sınırın altında olan kontratlar için kayıt açılmaz.
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                            <SettingInput
                                id="signal-funding-threshold"
                                readOnly={readOnly}
                                label="Fonlama eşiği (8s eşdeğeri)"
                                unit="%"
                                step="0.01"
                                hint={`${rangeHint('fundingThreshold')} · ${FUNDING_FLOOR_TEXT}'ten yüksek değerler ${FUNDING_FLOOR_TEXT} gibi çalışır`}
                                value={draft.fundingThreshold}
                                error={checked.fundingThreshold.error}
                                onChange={v => updateDraft('fundingThreshold', v)}
                            >
                                <LiveCount
                                    stat={engineStats?.funding}
                                    savedLabel={savedFunding !== undefined ? `%${savedFunding}` : ''}
                                    isDraftChanged={draftDiffers('fundingThreshold', savedFunding)}
                                />
                            </SettingInput>
                            <SettingInput
                                id="signal-funding-cooldown"
                                readOnly={readOnly}
                                label="Bekleme (aynı coin)"
                                unit="saat"
                                step="1"
                                hint={rangeHint('fundingCooldown')}
                                value={draft.fundingCooldown}
                                error={checked.fundingCooldown.error}
                                onChange={v => updateDraft('fundingCooldown', v)}
                            />
                        </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
                        {!readOnly && hasSettingsError && (
                            <span className="mr-auto text-[11px] text-danger">Kaydetmek için işaretli alanları düzeltin.</span>
                        )}
                        {readOnly && (
                            <span className="mr-auto text-[11px] text-muted">Salt okunur: ayarları yalnızca yönetici değiştirebilir.</span>
                        )}
                        <button
                            onClick={() => setIsSettingsOpen(false)}
                            className="h-7 rounded-sm px-2.5 text-xs font-medium text-secondary transition-colors hover:bg-surface-secondary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                        >
                            {readOnly ? 'Kapat' : 'Vazgeç'}
                        </button>
                        {!readOnly && (
                            <button
                                onClick={handleSaveSettings}
                                disabled={hasSettingsError || isSaving}
                                className="h-7 rounded-sm bg-primary px-2.5 text-xs font-medium text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {isSaving ? 'Kaydediliyor…' : 'Kaydet'}
                            </button>
                        )}
                    </div>
                </div>
            </Modal>

            {/* Header: title, view tabs, actions */}
            <header className="flex h-8 shrink-0 items-stretch justify-between gap-2 border-b border-border px-3">
                <div className="flex min-w-0 items-stretch gap-3">
                    <h2 className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-secondary">
                        <Zap size={12} />
                        <span className="sr-only sm:not-sr-only">Sinyal Yönetimi</span>
                    </h2>
                    <div role="tablist" aria-label="Sinyal görünümü" className="flex items-stretch gap-3">
                        {VIEW_TABS.map(tab => (
                            <button
                                key={tab.key}
                                type="button"
                                role="tab"
                                aria-selected={view === tab.key}
                                onClick={() => setView(tab.key)}
                                className={`flex h-full shrink-0 items-center whitespace-nowrap border-b-2 text-[11px] font-semibold uppercase tracking-wider transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${view === tab.key ? 'border-primary text-text' : 'border-transparent text-secondary hover:text-text'}`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                    <p className="hidden min-w-0 self-center truncate text-[11px] text-muted xl:block">
                        {view === 'records'
                            ? 'Kural kayıtları ile webhook ve manuel sinyaller: filtrele, dışa aktar, sil.'
                            : 'Her kuralın sinyallerinden sonra ne olduğu: maliyet sonrası, BTC\'ye göre, yeterli örnek olmadan karar yok.'}
                    </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                    <button
                        onClick={() => setIsSettingsOpen(true)}
                        className={ICON_BUTTON_CLASS}
                        title="Sinyal kuralları"
                        aria-label="Sinyal kuralları"
                    >
                        <Settings size={14} />
                    </button>

                    {view === 'records' && (
                        <>
                            <button
                                onClick={exportCSV}
                                className={ICON_BUTTON_CLASS}
                                title="CSV olarak dışa aktar"
                                aria-label="CSV olarak dışa aktar"
                            >
                                <Download size={14} />
                            </button>

                            <button
                                onClick={onClearAll}
                                className="ml-1 flex h-6 items-center gap-1.5 rounded-sm bg-danger-soft px-2 text-[11px] font-medium text-danger transition-colors hover:opacity-80 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                            >
                                <Trash2 size={12} />
                                <span className="hidden sm:inline">Tümünü temizle</span>
                            </button>
                        </>
                    )}
                </div>
            </header>

            {view === 'scorecard' ? <ScorecardPanel /> : (
                <>
                    {/* Filters */}
                    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1">
                        <div className="relative min-w-[140px] flex-1 sm:max-w-[240px]">
                            <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" size={12} />
                            <input
                                type="text"
                                placeholder="Sembol ara..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                aria-label="Sembol ara"
                                className={`${INPUT_CLASS} w-full pl-7`}
                            />
                        </div>

                        <select
                            value={sideFilter}
                            onChange={(e) => setSideFilter(e.target.value as 'ALL' | SideKind)}
                            aria-label="Yön filtresi"
                            className={`${INPUT_CLASS} cursor-pointer`}
                        >
                            <option value="ALL">Tüm yönler</option>
                            <option value="UP">Yukarı (Buy / Long)</option>
                            <option value="DOWN">Aşağı (Sell / Short)</option>
                            <option value="NEUTRAL">Yönsüz</option>
                        </select>

                        <select
                            value={strategyFilter}
                            onChange={(e) => setStrategyFilter(e.target.value)}
                            aria-label="Kural filtresi"
                            className={`${INPUT_CLASS} max-w-[220px] cursor-pointer`}
                        >
                            {uniqueStrategies.map(s => (
                                <option key={s} value={s}>{s === 'ALL' ? 'Tüm kurallar' : getSignalLabel(s)}</option>
                            ))}
                        </select>
                    </div>

                    {/* Table */}
                    <div className="min-h-0 flex-1 overflow-auto">
                        <table className="w-full border-separate border-spacing-0 text-xs">
                            <thead>
                                <tr>
                                    <th className={`${TH_CLASS} text-left`}>Zaman</th>
                                    <th className={`${TH_CLASS} text-left`}>Sembol</th>
                                    <th className={`${TH_CLASS} text-left`}>Yön</th>
                                    <th className={`${TH_CLASS} text-right`}>Büyüklük</th>
                                    <th className={`${TH_CLASS} text-right`}>Fiyat</th>
                                    <th className={`${TH_CLASS} text-left`}>Kural</th>
                                    <th className={`${TH_CLASS} hidden w-full text-left md:table-cell`}>Not</th>
                                    <th className={`${TH_CLASS} text-right`}>İşlem</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredSignals.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="px-3 py-8 text-center text-xs text-muted">
                                            <div className="flex items-center justify-center gap-2">
                                                <Filter size={14} />
                                                <p>Filtreye uyan kayıt yok.</p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    filteredSignals.map((sig) => {
                                        const badge = getSideBadge(sig);
                                        const magnitude = getMagnitude(sig);
                                        const isMarket = isMarketSignal(sig);
                                        const symbolBase = sig.symbol.replace('USDT', '');
                                        const iconUrl = `https://assets.coincap.io/assets/icons/${symbolBase.toLowerCase()}@2x.png`;

                                        return (
                                            <tr key={sig.id} className="hover:bg-surface-secondary">
                                                <td className={`${TD_CLASS} font-mono text-[11px] text-secondary`}>
                                                    {formatTime(sig.time)}
                                                </td>
                                                <td className={TD_CLASS}>
                                                    {isMarket ? (
                                                        <div className="flex items-center gap-1.5">
                                                            <Globe size={14} className="shrink-0 text-info" aria-hidden="true" />
                                                            <span
                                                                className={`rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-3 ${MARKET_BADGE.tone}`}
                                                                title={MARKET_BADGE.title}
                                                            >
                                                                {MARKET_BADGE.text}
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center gap-1.5">
                                                            <div className="relative h-4 w-4 shrink-0 overflow-hidden rounded-full bg-surface-secondary">
                                                                <img
                                                                    src={iconUrl}
                                                                    className="absolute inset-0 h-full w-full object-cover"
                                                                    onError={(e) => e.currentTarget.style.display = 'none'}
                                                                />
                                                            </div>
                                                            <span className="font-medium text-text">{symbolBase}</span>
                                                        </div>
                                                    )}
                                                </td>
                                                <td className={TD_CLASS}>
                                                    <span
                                                        className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-3 ${badge.tone}`}
                                                        title={badge.title}
                                                    >
                                                        {/* a watch alert carries its arrow in the text */}
                                                        {badge.kind === 'UP' && !badge.watch && <ArrowUpRight size={10} />}
                                                        {badge.kind === 'DOWN' && !badge.watch && <ArrowDownRight size={10} />}
                                                        {badge.text}
                                                    </span>
                                                </td>
                                                <td className={`${TD_CLASS} text-right font-mono font-semibold text-text`} title={magnitude?.caption || undefined}>
                                                    {magnitude ? magnitude.text : <span className="font-normal text-muted">—</span>}
                                                </td>
                                                <td className={`${TD_CLASS} text-right font-mono text-text`}>
                                                    {isMarket ? <span className="text-muted" title="Piyasa geneli kayıt: fiyatı yok">—</span> : formatPrice(sig.price)}
                                                </td>
                                                <td className={`${TD_CLASS} text-secondary`}>
                                                    {getSignalLabel(sig.strategy)}
                                                </td>
                                                {/* w-full + max-w-0: the column takes the spare width and truncates instead of widening the table */}
                                                <td className={`${TD_CLASS} hidden w-full max-w-0 md:table-cell`}>
                                                    <div className="truncate text-muted" title={sig.note}>
                                                        {sig.note || '-'}
                                                    </div>
                                                </td>
                                                <td className={`${TD_CLASS} text-right`}>
                                                    <button
                                                        onClick={() => onDelete(sig.id)}
                                                        className="inline-grid h-6 w-6 place-items-center rounded-sm text-muted transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                                                        title="Kaydı sil"
                                                        aria-label="Kaydı sil"
                                                    >
                                                        <Trash2 size={12} />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </section>
    );
};
