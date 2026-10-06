import React, { memo } from 'react';
import { AlertTriangle, Check, Minus, X } from 'lucide-react';
import type { FuturesRow } from './types';
import type { ChecklistItem, SqueezeAssessment } from '../../utils/fundingSqueeze';
import {
    EASING_BADGE_CLASS,
    EASING_BADGE_LABEL,
    SQUEEZE_CLASS_BADGE,
    formatSignedFunding,
    formatSignedPct,
    percentSuffix,
    upperTr,
    useFundingCandidateSide,
    useSqueezeAssessment,
    wholePercent,
} from './fundingFlow';
import { FundingSparkline } from './FundingSparkline';

// ---------------------------------------------------------------------------
// Squeeze checklist of one symbol: which conditions of the "negative funding squeeze" setup hold
// right now. Descriptive only — the count is not a probability and never a buy/sell call.
// ---------------------------------------------------------------------------

const SKELETON_ROWS = 6;

const STATUS_TEXT: Record<ChecklistItem['status'], string> = {
    pass: 'Sağlanıyor',
    fail: 'Sağlanmıyor',
    warn: 'Sınırda / dikkat',
    unknown: 'Veri yok',
};

const StatusIcon = ({ status }: { status: ChecklistItem['status'] }) => {
    const common = { size: 13, strokeWidth: 2.5, 'aria-hidden': true } as const;
    if (status === 'pass') return <Check {...common} className="shrink-0 text-success" />;
    if (status === 'fail') return <X {...common} className="shrink-0 text-danger" />;
    if (status === 'warn') return <AlertTriangle {...common} className="shrink-0 text-warning" />;
    return <Minus {...common} className="shrink-0 text-muted" />;
};

/** 'Kendi 100 ödemesinin en alt %3'ü' */
const ownHistoryLine = (ownPercentile: number | null, count: number): string => {
    if (ownPercentile === null || count <= 0) return 'Kendi geçmişiyle karşılaştırmak için yeterli ödeme kaydı yok.';
    if (ownPercentile <= 0) return `Güncel oran, kendi son ${count} ödemesinin hepsinden düşük`;
    if (ownPercentile >= 1) return `Güncel oran, kendi son ${count} ödemesinin hepsinden yüksek veya eşit`;
    if (ownPercentile <= 0.5) {
        const pct = wholePercent(ownPercentile);
        return `Kendi ${count} ödemesinin en alt %${pct}'${percentSuffix(pct)}`;
    }
    const pct = wholePercent(1 - ownPercentile);
    return `Kendi ${count} ödemesinin en üst %${pct}'${percentSuffix(pct)}`;
};

const universeRank = (share: number): string =>
    share <= 0.5 ? `alt %${wholePercent(share)}` : `üst %${wholePercent(1 - share)}`;

const signClass = (n: number): string => (n < 0 ? 'text-danger' : n > 0 ? 'text-success' : 'text-text');

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

const ItemRow = memo(function ItemRow({
    item,
    pending,
    compact,
}: {
    item: ChecklistItem;
    pending: boolean;
    compact: boolean;
}) {
    const unknown = item.status === 'unknown';
    return (
        <li
            title={item.hint}
            // 'relative' keeps the absolutely positioned sr-only text inside the row, so the scrolling list
            // clips it instead of it stretching the page.
            className={`relative flex items-center gap-2 border-b border-border px-3 text-xs ${compact ? 'h-6' : 'h-7'}`}
        >
            <StatusIcon status={item.status} />
            <span className="sr-only">{STATUS_TEXT[item.status]}:</span>
            <span className={`min-w-0 flex-1 truncate ${unknown ? 'text-secondary' : 'text-text'}`}>{item.label}</span>
            {unknown && pending ? (
                <span className="h-2 w-10 shrink-0 bg-surface-highlight" aria-label="Yükleniyor" />
            ) : (
                <span className={`shrink-0 text-right font-mono ${unknown ? 'text-muted' : 'text-text'}`}>{item.value}</span>
            )}
        </li>
    );
});

const SkeletonList = ({ compact }: { compact: boolean }) => (
    <div aria-hidden="true">
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <div key={i} className={`flex items-center gap-2 border-b border-border px-3 ${compact ? 'h-6' : 'h-7'}`}>
                <span className="h-3 w-3 shrink-0 bg-surface-highlight" />
                <span className="h-2 w-32 bg-surface-highlight" />
                <span className="ml-auto h-2 w-12 bg-surface-highlight" />
            </div>
        ))}
    </div>
);

// `easing`: an active candidate whose rate went back above the gate but is still inside the hysteresis band.
// It is not "no setup" — the episode is still open — so it gets its own neutral badge.
const ClassBadge = ({ assessment, easing }: { assessment: SqueezeAssessment; easing: boolean }) => (
    <span
        className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold leading-4 ${
            easing ? EASING_BADGE_CLASS : SQUEEZE_CLASS_BADGE[assessment.cls]
        }`}
    >
        {upperTr(easing ? EASING_BADGE_LABEL : assessment.label)}
    </span>
);

const EASING_NOTE =
    'Gevşiyor: oran negatif uç eşiğinin üzerine geri çekildi, ancak −0.0300% bandının içinde olduğu için aday listesinde kalıyor.';
const TRADFI_NOTE =
    'TradFi sözleşmesi (hisse, döviz, emtia): aday listesine ve olay akışına alınmaz; karşılaştırma kripto perpetual evrenine göredir.';

const ConditionCount = ({ assessment }: { assessment: SqueezeAssessment }) => {
    const missing = assessment.items.length - assessment.known;
    return (
        <span
            className="shrink-0 font-mono text-[11px] text-text"
            title="Kurulumun o an sağlanan koşul sayısı. Olasılık ya da al/sat önerisi değildir."
        >
            {assessment.passed} / {assessment.known}
            <span className="font-sans text-muted"> koşul{missing > 0 ? ` · ${missing} veri yok` : ''}</span>
        </span>
    );
};

const Stat = ({ label, value, valueClass, title }: { label: string; value: string; valueClass?: string; title?: string }) => (
    <div className="min-w-0 bg-surface px-3 py-1.5" title={title}>
        <div className="truncate text-[10px] uppercase tracking-wider text-muted">{label}</div>
        <div className={`truncate font-mono text-xs ${valueClass ?? 'text-text'}`}>{value}</div>
    </div>
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface SqueezeChecklistProps {
    row: FuturesRow | null;
    compact?: boolean;
    /** Replaces the panel title in the header row (e.g. the tab strip of the terminal's bottom area). Full mode only. */
    titleSlot?: React.ReactNode;
}

export const SqueezeChecklist: React.FC<SqueezeChecklistProps> = ({ row, compact = false, titleSlot }) => {
    const { assessment, details, history, loading, error } = useSqueezeAssessment(row);
    const candidateSide = useFundingCandidateSide(row?.symbol ?? '');
    const easing = candidateSide === 'NEG' && assessment?.cls === 'NONE';

    const pending = loading && !details;                       // checklist values still on their way
    const historyPending = loading && history.length === 0;    // funding history still on its way
    const ownCount = details?.ownHistoryF8?.length ?? 0;
    const subHeader =
        'flex h-6 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-secondary px-3 text-[10px] uppercase tracking-wider text-muted';

    let body: React.ReactNode;
    if (!row) {
        body = (
            <div className="flex flex-1 items-center justify-center p-3 text-center text-xs text-muted">
                Kontrol listesi için bir sembol seçin.
            </div>
        );
    } else {
        body = (
            <>
                {error && (
                    <div
                        className="flex shrink-0 items-start gap-1.5 border-b border-border bg-warning-soft px-3 py-1 text-[10px] leading-snug text-warning"
                        role="status"
                    >
                        <AlertTriangle size={11} className="mt-px shrink-0" aria-hidden="true" />
                        <span>{error} Eksik koşullar “veri yok” olarak sayılır.</span>
                    </div>
                )}

                {assessment ? (
                    <>
                        <div className="border-b border-border px-3 py-2">
                            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                                <ClassBadge assessment={assessment} easing={easing} />
                                {compact && <ConditionCount assessment={assessment} />}
                            </div>
                            {!compact && (
                                <p className="mt-1.5 text-[11px] leading-snug text-secondary">
                                    {easing ? `${EASING_NOTE} ${assessment.description}` : assessment.description}
                                </p>
                            )}
                            {!compact && row.isTradFi && (
                                <p className="mt-1 text-[10px] leading-snug text-muted">{TRADFI_NOTE}</p>
                            )}
                        </div>

                        {!compact && (
                            <div className="grid grid-cols-3 gap-px border-b border-border bg-border">
                                <Stat
                                    label="FUNDING (8s)" // typed in capitals: CSS uppercase under lang="tr" would render 'FUNDİNG'
                                    value={formatSignedFunding(assessment.f8)}
                                    valueClass={signClass(assessment.f8)}
                                    title={`8 saate eşdeğer tahmini funding. Ham oran: ${formatSignedFunding(row.fundingRate)} / ${row.fundingIntervalHours}s`}
                                />
                                <Stat
                                    label="Yıllık (basit)"
                                    value={formatSignedPct(assessment.annualized * 100, 0)}
                                    valueClass={signClass(assessment.annualized)}
                                    title="8 saatlik eşdeğerin günde 3 ödeme × 365 gün ile yıllıklandırılmış hali (bileşiksiz)."
                                />
                                <Stat
                                    label="Evrende"
                                    value={universeRank(assessment.universePercentile)}
                                    title="Bu sembolün funding oranının kripto USDT perpetual'ler içindeki sırası (8s eşdeğerine göre)."
                                />
                            </div>
                        )}

                        <div className={subHeader}>
                            <span className="truncate">Kurulum koşulları — tahmin değildir</span>
                            {!compact && <ConditionCount assessment={assessment} />}
                        </div>
                        <ul role="list" aria-busy={pending}>
                            {assessment.items.map((item) => (
                                <ItemRow key={item.key} item={item} pending={pending} compact={compact} />
                            ))}
                        </ul>
                    </>
                ) : (
                    <>
                        <div className={subHeader}>
                            <span className="truncate">Kurulum koşulları — tahmin değildir</span>
                            <span className="normal-case tracking-normal">piyasa verisi bekleniyor…</span>
                        </div>
                        <SkeletonList compact={compact} />
                    </>
                )}

                <div className={subHeader}>
                    <span className="truncate">Fonlama geçmişi</span>
                    <span className="shrink-0 normal-case tracking-normal">
                        {history.length > 0 ? `son ${history.length} ödeme · 8s eşdeğeri` : historyPending ? 'yükleniyor…' : ''}
                    </span>
                </div>
                <div className="px-3 pb-1.5 pt-2">
                    {historyPending ? (
                        <div className="w-full bg-surface-secondary" style={{ height: compact ? 28 : 48 }} aria-hidden="true" />
                    ) : (
                        <FundingSparkline
                            history={history}
                            intervalHours={row.fundingIntervalHours}
                            current={row.fundingRate}
                            height={compact ? 28 : 48}
                        />
                    )}
                    <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[11px] leading-snug text-secondary">
                        <span>
                            {historyPending ? 'Geçmiş ödemeler yükleniyor…' : ownHistoryLine(assessment?.ownPercentile ?? null, ownCount)}
                        </span>
                        {!compact && history.length > 0 && (
                            <span className="text-[10px] text-muted">boş çubuk = güncel tahmin</span>
                        )}
                    </div>
                </div>
            </>
        );
    }

    if (compact) {
        return (
            <section lang="tr" className="flex min-w-0 flex-col bg-surface" aria-label="Short sıkışması kontrol listesi">
                {body}
            </section>
        );
    }

    return (
        <section
            lang="tr"
            className="flex h-full min-h-0 min-w-0 flex-col bg-surface"
            aria-label="Short sıkışması kontrol listesi"
        >
            <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
                {titleSlot ? (
                    <div className="flex h-8 min-w-0 flex-1 items-center">{titleSlot}</div>
                ) : (
                    <h2 className="truncate text-[11px] font-semibold uppercase tracking-wider text-secondary">
                        Sıkışma Kontrolü
                    </h2>
                )}
                <span className="shrink-0 rounded-sm bg-surface-secondary px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-secondary">
                    {row ? `${row.symbol}.P` : '—'}
                </span>
            </header>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{body}</div>
        </section>
    );
};
