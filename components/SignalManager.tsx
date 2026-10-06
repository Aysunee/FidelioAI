
import React, { useState, useMemo, useEffect } from 'react';
import { Signal } from '../types';
import { Search, Trash2, Filter, AlertCircle, ArrowUpRight, ArrowDownRight, Zap, Download, Settings, Percent, Activity, Server, Info } from 'lucide-react';
import { useSignals } from '../context/SignalContext';
import { useUser } from '../context/UserContext';
import { Modal } from './ui/Modal';
import { formatPrice } from '../utils/formatters';
import { SIGNAL_SETTINGS_LIMITS } from '../utils/signalEngines';
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
import { getSideBadge, getSideKind, getSignalLabel, getMagnitude, SideKind } from './SignalFeed';

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
    if (status.role === 'standby') return 'Beklemede';
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
                s.price, getSignalLabel(s.strategy), s.strategy, s.note || ''
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
                            sınırın altına inip en az 60 saniye orada kalırsa ya da işareti pozitiften negatife dönerse kayıt açılır.
                            Kayıt yönsüzdür. Motor başladığında zaten sınırın altında olan kontratlar için kayıt açılmaz.
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

            {/* Header */}
            <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
                <div className="flex min-w-0 items-baseline gap-2">
                    <h2 className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-secondary">
                        <Zap size={12} className="self-center" />
                        Sinyal Yönetimi
                    </h2>
                    <p className="hidden truncate text-[11px] text-muted lg:block">
                        Kural kayıtları ile webhook ve manuel sinyaller: filtrele, dışa aktar, sil.
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
                </div>
            </header>

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
                                const symbolBase = sig.symbol.replace('USDT', '');
                                const iconUrl = `https://assets.coincap.io/assets/icons/${symbolBase.toLowerCase()}@2x.png`;

                                return (
                                    <tr key={sig.id} className="hover:bg-surface-secondary">
                                        <td className={`${TD_CLASS} font-mono text-[11px] text-secondary`}>
                                            {formatTime(sig.time)}
                                        </td>
                                        <td className={TD_CLASS}>
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
                                        </td>
                                        <td className={TD_CLASS}>
                                            <span
                                                className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-3 ${badge.tone}`}
                                                title={badge.title}
                                            >
                                                {badge.kind === 'UP' && <ArrowUpRight size={10} />}
                                                {badge.kind === 'DOWN' && <ArrowDownRight size={10} />}
                                                {badge.text}
                                            </span>
                                        </td>
                                        <td className={`${TD_CLASS} text-right font-mono font-semibold text-text`} title={magnitude?.caption || undefined}>
                                            {magnitude ? magnitude.text : <span className="font-normal text-muted">—</span>}
                                        </td>
                                        <td className={`${TD_CLASS} text-right font-mono text-text`}>
                                            {formatPrice(sig.price)}
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
        </section>
    );
};
