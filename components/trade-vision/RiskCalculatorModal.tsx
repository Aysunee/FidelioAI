
import React, { useState, useEffect, useMemo } from 'react';
import { X, DollarSign, AlertTriangle, ShieldCheck, Zap } from 'lucide-react';
import { cn } from '@/utils/cn';
import { formatQuantity, formatUsd, toFiniteNumber } from './tradeMath';
import { badge, badgeDanger, badgeSuccess, fieldLabel, iconBtn, inputBase, segIdle, segItem, segWrap } from './styles';

// Dense form row: label on the left, control on the right.
const FORM_ROW = 'grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-2';

interface RiskCalculatorModalProps {
    onClose: () => void;
}

type Side = 'LONG' | 'SHORT';

const parsePositive = (value: string): number | undefined => {
    const n = toFiniteNumber(value);
    return n !== undefined && n > 0 ? n : undefined;
};

// Rounds DOWN (never above the chosen risk) to 6 significant digits; large counts keep their integer part.
const floorPositionSize = (value: number): number => {
    if (!(value > 0) || !Number.isFinite(value)) return 0;
    if (value >= 1e5) return Math.floor(value);
    const magnitude = Math.floor(Math.log10(value));
    const factor = Math.pow(10, 5 - magnitude);
    return Math.floor(value * factor) / factor;
};

const RiskCalculatorModal: React.FC<RiskCalculatorModalProps> = ({ onClose }) => {
    // Inputs are kept as strings so fields can be cleared and decimals typed freely.
    const [accountBalance, setAccountBalance] = useState('10000');
    const [riskPercentage, setRiskPercentage] = useState(1.0);
    const [side, setSide] = useState<Side>('LONG');
    const [entryPrice, setEntryPrice] = useState('');
    const [stopLoss, setStopLoss] = useState('');
    const [targetPrice, setTargetPrice] = useState('');

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    const results = useMemo(() => {
        const empty = { positionSize: 0, riskAmount: 0, positionValue: 0, rewardAmount: 0, riskRewardRatio: 0, isValid: false, error: null as string | null };
        const balance = parsePositive(accountBalance);
        const entry = parsePositive(entryPrice);
        const stop = parsePositive(stopLoss);
        const hasTarget = targetPrice.trim() !== '';
        const target = parsePositive(targetPrice);

        if (accountBalance.trim() !== '' && balance === undefined) return { ...empty, error: 'Bakiye sıfırdan büyük olmalıdır.' };
        if (entryPrice.trim() !== '' && entry === undefined) return { ...empty, error: 'Giriş fiyatı sıfırdan büyük olmalıdır.' };
        if (stopLoss.trim() !== '' && stop === undefined) return { ...empty, error: 'Stop fiyatı sıfırdan büyük olmalıdır.' };
        if (hasTarget && target === undefined) return { ...empty, error: 'Hedef fiyatı sıfırdan büyük olmalıdır.' };
        if (balance === undefined || entry === undefined || stop === undefined) return empty;

        if (stop === entry) return { ...empty, error: 'Stop fiyatı giriş fiyatıyla aynı olamaz.' };
        if (side === 'LONG' && stop > entry) return { ...empty, error: 'LONG işlemde stop, giriş fiyatının altında olmalıdır.' };
        if (side === 'SHORT' && stop < entry) return { ...empty, error: 'SHORT işlemde stop, giriş fiyatının üstünde olmalıdır.' };
        if (target !== undefined) {
            if (side === 'LONG' && target <= entry) return { ...empty, error: 'LONG işlemde hedef, giriş fiyatının üstünde olmalıdır.' };
            if (side === 'SHORT' && target >= entry) return { ...empty, error: 'SHORT işlemde hedef, giriş fiyatının altında olmalıdır.' };
        }

        const riskAmount = (balance * riskPercentage) / 100;
        const riskPerUnit = Math.abs(entry - stop);
        // Fractional size: crypto positions are usually < 1 unit (e.g. 0.1 BTC).
        const positionSize = riskAmount / riskPerUnit;
        const positionValue = positionSize * entry;

        let rewardAmount = 0;
        let riskRewardRatio = 0;
        if (target !== undefined) {
            const rewardPerUnit = Math.abs(target - entry);
            rewardAmount = positionSize * rewardPerUnit;
            riskRewardRatio = rewardPerUnit / riskPerUnit;
        }

        return { positionSize, riskAmount, positionValue, rewardAmount, riskRewardRatio, isValid: true, error: null as string | null };
    }, [accountBalance, riskPercentage, side, entryPrice, stopLoss, targetPrice]);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-2 sm:p-4">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="risk-calculator-title"
                className="flex max-h-[92dvh] w-full max-w-2xl animate-overlay-in flex-col overflow-hidden rounded-sm border border-border-strong bg-surface shadow-overlay"
            >
                {/* Header */}
                <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border pl-3 pr-1">
                    <div className="flex min-w-0 items-baseline gap-2">
                        <h2 id="risk-calculator-title" className="truncate text-xs font-semibold text-text">Exposure Matrix</h2>
                        <p className="hidden truncate text-[10px] uppercase tracking-wider text-muted sm:block">Calculated risk mitigation engine</p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Kapat" className={iconBtn}>
                        <X size={14} />
                    </button>
                </div>

                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
                    {/* Input Section */}
                    <div className="shrink-0 space-y-2 border-b border-border p-3 md:w-1/2 md:overflow-y-auto md:border-b-0 md:border-r">
                        {/* Account Details */}
                        <div className={FORM_ROW}>
                            <div className="min-w-0">
                                <label htmlFor="risk-balance" className={cn(fieldLabel, 'block truncate')}>Hesap Bakiyesi</label>
                                <span className="block truncate font-mono text-[10px] text-primary">{formatUsd(toFiniteNumber(accountBalance) ?? 0)}</span>
                            </div>
                            <div className="relative">
                                <DollarSign size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
                                <input
                                    id="risk-balance"
                                    type="number"
                                    step="any"
                                    min="0"
                                    inputMode="decimal"
                                    value={accountBalance}
                                    onChange={(e) => setAccountBalance(e.target.value)}
                                    className={cn(inputBase, 'pl-6 font-mono')}
                                />
                            </div>
                        </div>

                        <div>
                            <div className="flex items-center justify-between gap-2">
                                <label htmlFor="risk-threshold" className={fieldLabel}>Risk Threshold</label>
                                <span className="font-mono text-[10px] font-semibold uppercase text-danger">{riskPercentage}% TOLERANCE</span>
                            </div>
                            <input
                                id="risk-threshold"
                                type="range"
                                min="0.1"
                                max="5"
                                step="0.1"
                                value={riskPercentage}
                                onChange={(e) => setRiskPercentage(Number(e.target.value))}
                                style={{ background: `linear-gradient(to right, var(--color-brand) ${((riskPercentage - 0.1) / 4.9) * 100}%, var(--bg-surface-highlight) ${((riskPercentage - 0.1) / 4.9) * 100}%)` }}
                                className="my-2 block h-1 w-full cursor-pointer appearance-none rounded-none outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-sm [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-sm [&::-webkit-slider-thumb]:bg-primary"
                            />
                            <div className="flex justify-between text-[10px] uppercase text-muted">
                                <span className="font-mono">0.1%</span>
                                <span>CONSERVATIVE</span>
                                <span className="font-mono">5.0%</span>
                            </div>
                        </div>

                        {/* Trade Setup */}
                        <div className="space-y-2 border-t border-border pt-2">
                            <div className={segWrap}>
                                <button
                                    type="button"
                                    aria-pressed={side === 'LONG'}
                                    onClick={() => setSide('LONG')}
                                    className={cn(segItem, side === 'LONG' ? 'bg-success-soft text-success' : segIdle)}
                                >Long</button>
                                <button
                                    type="button"
                                    aria-pressed={side === 'SHORT'}
                                    onClick={() => setSide('SHORT')}
                                    className={cn(segItem, side === 'SHORT' ? 'bg-danger-soft text-danger' : segIdle)}
                                >Short</button>
                            </div>
                            <div className={FORM_ROW}>
                                <label htmlFor="risk-entry" className={cn(fieldLabel, 'truncate')}>Giriş Fiyatı ($)</label>
                                <input
                                    id="risk-entry"
                                    type="number"
                                    step="any"
                                    min="0"
                                    inputMode="decimal"
                                    className={cn(inputBase, 'font-mono')}
                                    placeholder="0.00"
                                    value={entryPrice}
                                    onChange={(e) => setEntryPrice(e.target.value)}
                                />
                            </div>
                            <div className={FORM_ROW}>
                                <label htmlFor="risk-stop" className={cn(fieldLabel, 'truncate text-danger')}>Stop Fiyatı ($)</label>
                                <input
                                    id="risk-stop"
                                    type="number"
                                    step="any"
                                    min="0"
                                    inputMode="decimal"
                                    className={cn(inputBase, 'font-mono focus:border-danger')}
                                    placeholder="0.00"
                                    value={stopLoss}
                                    onChange={(e) => setStopLoss(e.target.value)}
                                />
                            </div>
                            <div className={FORM_ROW}>
                                <label htmlFor="risk-target" className={cn(fieldLabel, 'truncate text-success')}>Hedef Fiyat ($)</label>
                                <input
                                    id="risk-target"
                                    type="number"
                                    step="any"
                                    min="0"
                                    inputMode="decimal"
                                    className={cn(inputBase, 'font-mono focus:border-success')}
                                    placeholder="İSTEĞE BAĞLI"
                                    value={targetPrice}
                                    onChange={(e) => setTargetPrice(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Results Section */}
                    <div className="flex min-h-[160px] flex-col md:w-1/2 md:overflow-y-auto">
                        {results.error ? (
                            <div role="alert" className="flex flex-1 items-center justify-center gap-1.5 p-4 text-center text-xs text-danger">
                                <AlertTriangle size={14} className="shrink-0" />
                                <p>{results.error}</p>
                            </div>
                        ) : !results.isValid ? (
                            <div className="flex flex-1 items-center justify-center gap-1.5 p-4 text-center text-xs text-muted">
                                <Zap size={14} className="shrink-0" />
                                <p>Awaiting telemetry inputs<br />to generate matrix</p>
                            </div>
                        ) : (
                            <>
                                <div className="border-b border-border px-3 py-2.5">
                                    <span className={cn(fieldLabel, 'block')}>Pozisyon Büyüklüğü ({side})</span>
                                    <div className="break-all font-mono text-2xl font-semibold text-text">
                                        {formatQuantity(floorPositionSize(results.positionSize))} <span className="text-[10px] font-medium uppercase tracking-wider text-muted">Adet</span>
                                    </div>
                                    <span className="block font-mono text-[11px] text-secondary">Değer: {formatUsd(results.positionValue, 0)}</span>
                                </div>

                                <div className="grid grid-cols-2 divide-x divide-border border-b border-border">
                                    <div className="min-w-0 px-3 py-2">
                                        <span className={cn(fieldLabel, 'block truncate')}>Max Drawdown</span>
                                        <div className="truncate font-mono text-base font-semibold text-danger">
                                            {formatUsd(results.riskAmount)}
                                        </div>
                                    </div>
                                    {results.rewardAmount > 0 ? (
                                        <div className="min-w-0 px-3 py-2">
                                            <span className={cn(fieldLabel, 'block truncate')}>Yield Horizon</span>
                                            <div className="truncate font-mono text-base font-semibold text-success">
                                                {formatUsd(results.rewardAmount)}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex min-w-0 items-center px-3 py-2">
                                            <span className="text-[11px] text-muted">No target set</span>
                                        </div>
                                    )}
                                </div>

                                {results.riskRewardRatio > 0 && (
                                    <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                                        <div className="flex min-w-0 flex-col">
                                            <span className={cn(fieldLabel, 'truncate')}>Vector Efficiency (R:R)</span>
                                            <span className={cn(
                                                'font-mono text-base font-semibold',
                                                results.riskRewardRatio >= 2 ? 'text-success' : results.riskRewardRatio >= 1 ? 'text-warning' : 'text-danger'
                                            )}>
                                                1:{results.riskRewardRatio.toFixed(2)}
                                            </span>
                                        </div>
                                        {results.riskRewardRatio >= 2 ? (
                                            <div className={cn(badge, badgeSuccess)}>
                                                <ShieldCheck size={12} />
                                                Uygun R:R
                                            </div>
                                        ) : results.riskRewardRatio < 1.5 ? (
                                            <div className={cn(badge, badgeDanger)}>
                                                <AlertTriangle size={12} />
                                                Düşük R:R
                                            </div>
                                        ) : null}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RiskCalculatorModal;
