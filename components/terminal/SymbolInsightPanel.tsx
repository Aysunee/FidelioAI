import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FuturesRow } from './types';
import { TerminalSentimentPanel } from './TerminalSentimentPanel';
import { FundingFlowPanel } from './FundingFlowPanel';
import { SqueezeChecklist } from './SqueezeChecklist';
import { feedFundingRows } from './fundingFlow';
import { useFuturesUniverse } from './useFuturesUniverse';
import { BottomTabStrip, PanelBoundary, readStoredTab, tabId, tabPanelId, writeStoredTab, type BottomTab } from './bottomTabs';

// The Terminal's bottom area (Funding akışı / Kurulum / Duyarlılık) for any page that has a selected
// perpetual symbol. Brings its own live futures universe, so the funding flow store is fed while it is open.

const TAB_STORAGE_KEY = 'fidelio_funding_detail_tab';
const ID_PREFIX = 'funding-detail';

// Re-renders once per second with ticker patches; the sentiment panel only depends on the symbol.
const SentimentPanel = memo(TerminalSentimentPanel);

export interface SymbolInsightPanelProps {
    symbol: string;
    onSelect: (symbol: string) => void;
}

export const SymbolInsightPanel: React.FC<SymbolInsightPanelProps> = ({ symbol, onSelect }) => {
    const { rows, index } = useFuturesUniverse();
    const [tab, setTab] = useState<BottomTab>(() => readStoredTab(TAB_STORAGE_KEY));

    useEffect(() => {
        if (!rows.length) return;
        try {
            feedFundingRows(rows);
        } catch (err) {
            console.warn('[Türev Araçlar] funding akışı beslenemedi', err);
        }
    }, [rows]);

    // The strip lives inside the active panel, so after a switch (which remounts it) focus is put back
    // on the newly active tab for keyboard users.
    const refocusTabRef = useRef(false);
    const selectTab = useCallback((next: BottomTab) => {
        refocusTabRef.current = typeof document !== 'undefined' && document.activeElement?.getAttribute('role') === 'tab';
        setTab(next);
    }, []);

    useEffect(() => {
        writeStoredTab(TAB_STORAGE_KEY, tab);
        if (!refocusTabRef.current || typeof document === 'undefined') return;
        refocusTabRef.current = false;
        document.getElementById(tabId(tab, ID_PREFIX))?.focus();
    }, [tab]);

    const row = useMemo<FuturesRow | null>(() => {
        const i = index.get(symbol);
        const found = i === undefined ? undefined : rows[i];
        return found && found.symbol === symbol ? found : null;
    }, [rows, index, symbol]);

    const tabStrip = useMemo(() => <BottomTabStrip active={tab} onChange={selectTab} idPrefix={ID_PREFIX} />, [tab, selectTab]);

    // Only the active tab's panel is mounted (a hidden panel must not poll).
    let panel: React.ReactNode;
    switch (tab) {
        case 'checklist':
            panel = (
                <PanelBoundary name="Kurulum kontrolü" fallbackHeader={tabStrip}>
                    <SqueezeChecklist row={row} titleSlot={tabStrip} />
                </PanelBoundary>
            );
            break;
        case 'sentiment':
            panel = (
                <PanelBoundary name="Piyasa duyarlılığı" fallbackHeader={tabStrip}>
                    <SentimentPanel symbol={symbol} titleSlot={tabStrip} />
                </PanelBoundary>
            );
            break;
        default:
            panel = (
                <PanelBoundary name="Funding akışı" fallbackHeader={tabStrip}>
                    <FundingFlowPanel selectedSymbol={symbol} onSelect={onSelect} titleSlot={tabStrip} />
                </PanelBoundary>
            );
    }

    return (
        <div
            role="tabpanel"
            id={tabPanelId(tab, ID_PREFIX)}
            aria-labelledby={tabId(tab, ID_PREFIX)}
            className="h-full min-h-0 min-w-0 bg-surface"
        >
            {panel}
        </div>
    );
};
