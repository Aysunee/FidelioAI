import React, { useMemo, useState } from 'react';
import { Activity, Zap, TrendingUp, Link2, Unlink, AlertTriangle, X } from 'lucide-react';
import {
    CorrelationMatrix as CorrelationMatrixType,
    CorrelationPair,
    getCorrelationDescription,
    formatCorrelationWindow
} from '../utils/correlationEngine';
import { cn } from '../utils/cn';

interface CorrelationMatrixProps {
    matrix: CorrelationMatrixType;
    maxDisplay?: number;
    className?: string;
}

// Shared class vocabulary of the panels below
const PANEL_HEADER = "flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-3";
const PANEL_TITLE = "flex min-w-0 items-center gap-1.5 truncate text-[11px] font-semibold uppercase tracking-wider text-secondary";
const LABEL = "text-[10px] uppercase tracking-wider text-muted";
const BADGE = "shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase";

const CorrelationMatrix: React.FC<CorrelationMatrixProps> = ({
    matrix,
    maxDisplay = 8,
    className
}) => {
    const [selectedPair, setSelectedPair] = useState<CorrelationPair | null>(null);
    const [hoveredCell, setHoveredCell] = useState<{i: number, j: number} | null>(null);

    // Limit displayed symbols
    const displaySymbols = matrix.symbols.slice(0, maxDisplay);
    const displayMatrix = matrix.matrix.slice(0, maxDisplay).map(row =>
        row.slice(0, maxDisplay)
    );

    // Get top opportunities
    const topOpportunities = useMemo(() => {
        return matrix.pairs
            .filter(p => p.opportunityScore > 20)
            .slice(0, 5);
    }, [matrix.pairs]);

    // Get strongest correlations
    const strongestCorrelations = useMemo(() => {
        return matrix.pairs
            .filter(p => Math.abs(p.correlation) > 0.7)
            .slice(0, 5);
    }, [matrix.pairs]);

    // Data colour of a cell: success/danger token mixed into the panel surface, stronger = more saturated
    const getBgColor = (value: number) => {
        if (!Number.isFinite(value)) return 'var(--bg-surface)'; // Not enough data
        if (value === 1) return 'var(--bg-surface-highlight)';
        const strength = Math.round(Math.min(Math.abs(value), 1) * 60);
        return value > 0
            ? `color-mix(in srgb, var(--color-success) ${strength}%, var(--bg-surface))`  // Green for positive
            : `color-mix(in srgb, var(--color-danger) ${strength}%, var(--bg-surface))`;  // Red for negative
    };

    // Window the values were computed over (a few minutes of ~1s returns, NOT 24h)
    const windowLabel = formatCorrelationWindow(matrix.windowMs);
    const sampleStepSec = matrix.sampleCount > 0 ? Math.max(1, Math.round(matrix.windowMs / matrix.sampleCount / 1000)) : 1;

    const symbolCount = displaySymbols.length;

    return (
        <div className={cn("flex min-h-full flex-col gap-px bg-border lg:h-full lg:min-h-0", className)}>
            {/* Correlation Stats: one strip of cells */}
            <div className="grid shrink-0 grid-cols-2 gap-px sm:grid-cols-4" role="group" aria-label="Correlation Stats">
                <div className="bg-surface px-3 py-1.5">
                    <div className={cn(LABEL, "truncate")}>Total Pairs</div>
                    <div className="font-mono text-sm font-semibold text-text">{matrix.pairs.length}</div>
                </div>
                <div className="bg-surface px-3 py-1.5">
                    <div className={cn(LABEL, "truncate")}>Strong Correlations</div>
                    <div className="font-mono text-sm font-semibold text-success">
                        {matrix.pairs.filter(p => Math.abs(p.correlation) > 0.7).length}
                    </div>
                </div>
                <div className="bg-surface px-3 py-1.5">
                    <div className={cn(LABEL, "truncate")}>Ayrışmalar</div>
                    <div className="font-mono text-sm font-semibold text-warning">
                        {matrix.pairs.filter(p => p.opportunityScore > 20).length}
                    </div>
                </div>
                <div className="bg-surface px-3 py-1.5">
                    <div className={cn(LABEL, "truncate")}>Diverging</div>
                    <div className="font-mono text-sm font-semibold text-danger">
                        {matrix.pairs.filter(p => p.trend === 'DIVERGING').length}
                    </div>
                </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-px lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[minmax(0,1fr)]">
                {/* Matrix panel */}
                <section className="flex min-h-0 min-w-0 flex-col bg-surface">
                    <header className={PANEL_HEADER}>
                        <h2 className={PANEL_TITLE}>
                            <span className="truncate">Live Correlation Matrix</span>
                        </h2>
                        <div className="flex shrink-0 items-center gap-2 text-[10px] text-secondary">
                            <span className="flex items-center gap-1">
                                <span className="h-2 w-2 rounded-sm bg-success" /> Positive
                            </span>
                            <span className="flex items-center gap-1">
                                <span className="h-2 w-2 rounded-sm bg-danger" /> Negative
                            </span>
                            <span className="flex items-center gap-1">
                                <span className="h-2 w-2 rounded-sm bg-surface-highlight" /> Neutral
                            </span>
                        </div>
                    </header>
                    <p className="shrink-0 truncate border-b border-border px-3 py-1 text-[10px] text-muted">
                        Kısa vadeli korelasyon · son {windowLabel} · ~{sampleStepSec} sn aralıklı getiriler
                    </p>

                    {/* Heat grid: 1px lines between the cells are the grid's own background */}
                    <div className="min-h-0 flex-1 overflow-auto">
                        <div
                            className="grid h-full gap-px bg-border"
                            style={{
                                gridTemplateColumns: `48px repeat(${symbolCount}, minmax(36px, 1fr))`,
                                gridTemplateRows: `24px repeat(${symbolCount}, minmax(28px, 1fr))`
                            }}
                        >
                            {/* Header row with symbols */}
                            <div className="bg-surface" />
                            {displaySymbols.map((sym) => (
                                <div
                                    key={sym}
                                    className="flex items-center justify-center truncate bg-surface font-mono text-[10px] font-medium uppercase text-muted"
                                >
                                    {sym.replace('USDT', '')}
                                </div>
                            ))}

                            {/* Matrix rows */}
                            {displaySymbols.map((rowSym, i) => (
                                <React.Fragment key={rowSym}>
                                    <div className="flex items-center truncate bg-surface px-2 font-mono text-[10px] font-medium uppercase text-muted">
                                        {rowSym.replace('USDT', '')}
                                    </div>
                                    {displaySymbols.map((colSym, j) => {
                                        const value = displayMatrix[i]?.[j] ?? NaN;
                                        const hasValue = Number.isFinite(value);
                                        const isDiagonal = i === j;
                                        const pair = matrix.pairs.find(p =>
                                            (p.symbolA === rowSym && p.symbolB === colSym) ||
                                            (p.symbolA === colSym && p.symbolB === rowSym)
                                        );

                                        return (
                                            <div
                                                key={`${i}-${j}`}
                                                className={cn(
                                                    "relative flex items-center justify-center",
                                                    isDiagonal
                                                        ? "cursor-default bg-surface-secondary"
                                                        : "cursor-pointer hover:outline hover:outline-1 hover:-outline-offset-1 hover:outline-primary"
                                                )}
                                                style={{
                                                    backgroundColor: isDiagonal ? undefined : getBgColor(value)
                                                }}
                                                onMouseEnter={() => !isDiagonal && setHoveredCell({i, j})}
                                                onMouseLeave={() => setHoveredCell(null)}
                                                onClick={() => pair && setSelectedPair(pair)}
                                            >
                                                {!isDiagonal && (
                                                    <span
                                                        className={cn(
                                                            "font-mono text-[11px]",
                                                            hasValue && Math.abs(value) > 0.5 ? 'font-semibold text-text' : 'text-secondary'
                                                        )}
                                                        title={hasValue ? undefined : 'Yetersiz veri'}
                                                    >
                                                        {hasValue ? value.toFixed(2) : '—'}
                                                    </span>
                                                )}

                                                {/* Hover tooltip: opens towards the centre of the grid so it is never clipped */}
                                                {hoveredCell?.i === i && hoveredCell?.j === j && pair && (
                                                    <div
                                                        className={cn(
                                                            "pointer-events-none absolute z-30 min-w-[160px] rounded-sm border border-border-strong bg-surface p-2 text-left shadow-overlay",
                                                            j >= symbolCount / 2 ? "right-full mr-1" : "left-full ml-1",
                                                            i >= symbolCount / 2 ? "bottom-0" : "top-0"
                                                        )}
                                                    >
                                                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-secondary">
                                                            {pair.symbolA.replace('USDT', '')} ↔ {pair.symbolB.replace('USDT', '')}
                                                        </div>
                                                        <div className="space-y-0.5">
                                                            <div className="flex items-center justify-between gap-3">
                                                                <span className="text-[10px] uppercase text-muted">Correlation:</span>
                                                                <span className={cn(
                                                                    "font-mono text-[11px] font-semibold",
                                                                    pair.correlation > 0 ? 'text-success' : 'text-danger'
                                                                )}>
                                                                    {pair.correlation.toFixed(3)}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center justify-between gap-3">
                                                                <span className="text-[10px] uppercase text-muted">Strength:</span>
                                                                <span className="text-[10px] font-semibold text-text">
                                                                    {pair.strength.replace('_', ' ')}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center justify-between gap-3">
                                                                <span className="text-[10px] uppercase text-muted">Trend:</span>
                                                                <span className={cn(
                                                                    "text-[10px] font-semibold",
                                                                    pair.trend === 'DIVERGING' ? 'text-warning' :
                                                                    pair.trend === 'CONVERGING' ? 'text-success' : 'text-secondary'
                                                                )}>
                                                                    {pair.trend}
                                                                </span>
                                                            </div>
                                                            {pair.opportunityScore > 0 && (
                                                                <div className="flex items-center justify-between gap-3 border-t border-border pt-1">
                                                                    <span className="text-[10px] uppercase text-warning">Ayrışma skoru:</span>
                                                                    <span className="font-mono text-[11px] font-semibold text-warning">
                                                                        {pair.opportunityScore.toFixed(0)}
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </React.Fragment>
                            ))}
                        </div>
                    </div>
                </section>

                {/* Side lists */}
                <div className="flex min-h-0 min-w-0 flex-col gap-px">
                    {/* Opportunities Section */}
                    {topOpportunities.length > 0 && (
                        <section className="flex shrink-0 flex-col bg-surface">
                            <header className={PANEL_HEADER}>
                                <h2 className={PANEL_TITLE}>
                                    <AlertTriangle size={12} className="shrink-0 text-warning" />
                                    <span className="truncate">Kısa Vadeli Ayrışmalar</span>
                                </h2>
                            </header>
                            <p className="truncate border-b border-border px-3 py-1 text-[10px] text-muted">
                                Korele çiftlerde son {windowLabel} içindeki fiyat ayrışması
                            </p>
                            <div className={cn("grid h-6 grid-cols-[minmax(0,1fr)_64px_48px] items-center gap-x-2 border-b border-border px-3", LABEL)}>
                                <span>Pair</span>
                                <span className="text-right">Gap</span>
                                <span className="text-right">Score</span>
                            </div>
                            {topOpportunities.map((opp) => (
                                <div
                                    key={`${opp.symbolA}-${opp.symbolB}`}
                                    className="grid h-7 cursor-pointer grid-cols-[minmax(0,1fr)_64px_48px] items-center gap-x-2 border-b border-border px-3 text-xs hover:bg-surface-secondary"
                                    onClick={() => setSelectedPair(opp)}
                                >
                                    <div className="flex min-w-0 items-center gap-1.5">
                                        <span className="truncate font-medium text-text">
                                            {opp.symbolA.replace('USDT', '')}
                                        </span>
                                        <Link2 size={12} className="shrink-0 text-muted" />
                                        <span className="truncate font-medium text-text">
                                            {opp.symbolB.replace('USDT', '')}
                                        </span>
                                        <span className={cn(
                                            BADGE,
                                            "font-mono",
                                            opp.correlation > 0 ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
                                        )}>
                                            r = {opp.correlation.toFixed(2)}
                                        </span>
                                    </div>
                                    <span className="text-right font-mono text-warning">
                                        {Math.abs(opp.priceChangeA - opp.priceChangeB).toFixed(2)}%
                                    </span>
                                    <span className="text-right font-mono text-text">
                                        {opp.opportunityScore.toFixed(0)}
                                    </span>
                                </div>
                            ))}
                        </section>
                    )}

                    {/* Strong Correlations */}
                    <section className="flex min-h-0 flex-1 flex-col bg-surface">
                        <header className={PANEL_HEADER}>
                            <h2 className={PANEL_TITLE}>
                                <TrendingUp size={12} className="shrink-0" />
                                <span className="truncate">Strongest Correlations</span>
                            </h2>
                        </header>
                        <div className="min-h-0 flex-1 overflow-auto">
                            {strongestCorrelations.slice(0, 4).map((corr, idx) => (
                                <div key={idx} className="flex h-7 items-center justify-between gap-2 border-b border-border px-3 text-xs">
                                    <div className="flex min-w-0 items-center gap-1.5">
                                        <span className="truncate font-medium text-text">{corr.symbolA.replace('USDT', '')}</span>
                                        <span className="text-muted">→</span>
                                        <span className="truncate font-medium text-text">{corr.symbolB.replace('USDT', '')}</span>
                                    </div>
                                    <span className={cn(
                                        "font-mono",
                                        corr.correlation > 0 ? "text-success" : "text-danger"
                                    )}>
                                        {corr.correlation > 0 ? '+' : ''}{corr.correlation.toFixed(2)}
                                    </span>
                                </div>
                            ))}
                            {strongestCorrelations.length === 0 && (
                                <div className="px-3 py-4 text-center text-xs text-muted">Collecting data...</div>
                            )}
                        </div>
                    </section>
                </div>
            </div>

            {/* Selected Pair Detail Modal */}
            {selectedPair && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
                    onClick={() => setSelectedPair(null)}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        className="w-full max-w-md rounded-sm border border-border-strong bg-surface shadow-overlay"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex h-9 items-center justify-between gap-2 border-b border-border pl-3 pr-1">
                            <div className="flex min-w-0 items-baseline gap-2">
                                <h3 className="shrink-0 text-xs font-semibold text-text">
                                    {selectedPair.symbolA.replace('USDT', '')}
                                    <span className="mx-1.5 text-muted">↔</span>
                                    {selectedPair.symbolB.replace('USDT', '')}
                                </h3>
                                <p className={cn(LABEL, "truncate")}>
                                    {getCorrelationDescription(selectedPair.correlation)}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedPair(null)}
                                aria-label="Kapat"
                                className="grid h-7 w-7 shrink-0 place-items-center rounded-sm text-secondary transition-colors hover:bg-surface-secondary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                            >
                                <X size={14} />
                            </button>
                        </div>

                        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
                            <span className={LABEL}>Correlation Coefficient</span>
                            <span className={cn(
                                "font-mono text-2xl font-semibold",
                                selectedPair.correlation > 0 ? 'text-success' : 'text-danger'
                            )}>
                                {selectedPair.correlation.toFixed(3)}
                            </span>
                        </div>

                        <div className="grid grid-cols-2 divide-x divide-border border-b border-border">
                            <div className="min-w-0 px-3 py-2">
                                <div className={cn(LABEL, "truncate")}>
                                    {selectedPair.symbolA.replace('USDT', '')} değişim (son {formatCorrelationWindow(selectedPair.windowMs)})
                                </div>
                                <div className={cn(
                                    "font-mono text-sm font-semibold",
                                    selectedPair.priceChangeA >= 0 ? 'text-success' : 'text-danger'
                                )}>
                                    {selectedPair.priceChangeA >= 0 ? '+' : ''}
                                    {selectedPair.priceChangeA.toFixed(2)}%
                                </div>
                            </div>
                            <div className="min-w-0 px-3 py-2">
                                <div className={cn(LABEL, "truncate")}>
                                    {selectedPair.symbolB.replace('USDT', '')} değişim (son {formatCorrelationWindow(selectedPair.windowMs)})
                                </div>
                                <div className={cn(
                                    "font-mono text-sm font-semibold",
                                    selectedPair.priceChangeB >= 0 ? 'text-success' : 'text-danger'
                                )}>
                                    {selectedPair.priceChangeB >= 0 ? '+' : ''}
                                    {selectedPair.priceChangeB.toFixed(2)}%
                                </div>
                            </div>
                        </div>

                        {selectedPair.opportunityScore > 0 && (
                            <div className="border-b border-border bg-warning-soft px-3 py-2">
                                <div className="mb-1 flex items-center gap-1.5">
                                    <Zap size={12} className="shrink-0 text-warning" />
                                    <span className="text-[11px] font-semibold uppercase tracking-wider text-warning">
                                        Kısa Vadeli Ayrışma
                                    </span>
                                </div>
                                <div className="text-[11px] leading-snug text-secondary">
                                    Son {formatCorrelationWindow(selectedPair.windowMs)} içinde{' '}
                                    <span className="font-mono font-semibold text-warning">
                                        %{Math.abs(selectedPair.priceChangeA - selectedPair.priceChangeB).toFixed(2)}
                                    </span>
                                    {' '}fiyat ayrışması; aynı pencerede korelasyon{' '}
                                    <span className="font-mono font-semibold text-success">
                                        r = {selectedPair.correlation.toFixed(2)}
                                    </span>
                                    {' '}({selectedPair.sampleCount} örnek). Arbitraj sinyali değildir.
                                </div>
                            </div>
                        )}

                        <div className="px-3 py-2">
                            <div className={cn(LABEL, "mb-1")}>
                                Trend Analysis
                            </div>
                            <div className="flex items-center gap-1.5 text-xs">
                                {selectedPair.trend === 'DIVERGING' ? (
                                    <>
                                        <Unlink size={14} className="shrink-0 text-danger" />
                                        <span className="text-danger">Correlation weakening - assets decoupling</span>
                                    </>
                                ) : selectedPair.trend === 'CONVERGING' ? (
                                    <>
                                        <Link2 size={14} className="shrink-0 text-success" />
                                        <span className="text-success">Correlation strengthening</span>
                                    </>
                                ) : (
                                    <>
                                        <Activity size={14} className="shrink-0 text-secondary" />
                                        <span className="text-secondary">Stable correlation pattern</span>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CorrelationMatrix;
