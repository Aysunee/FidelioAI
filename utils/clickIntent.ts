import type React from 'react';

// Rows that do something on a single click (open a tab, a modal) AND on a double click (show the coin in
// the home page chart): the single-click action waits a moment so a double click can cancel it.

export const DOUBLE_CLICK_WINDOW_MS = 250;

let pendingSingle: ReturnType<typeof setTimeout> | null = null;

/** Runs `action` unless a second click follows within DOUBLE_CLICK_WINDOW_MS. */
export const deferSingleClick = (e: React.MouseEvent, action: () => void): void => {
    if (e.detail > 1) return; // second click of a double click
    if (pendingSingle) clearTimeout(pendingSingle);
    pendingSingle = setTimeout(() => {
        pendingSingle = null;
        action();
    }, DOUBLE_CLICK_WINDOW_MS);
};

/** Cancels a pending single-click action (call from onDoubleClick). */
export const cancelSingleClick = (): void => {
    if (pendingSingle) clearTimeout(pendingSingle);
    pendingSingle = null;
};

/** True when the double click landed on a control inside the row (link, button, input). */
export const isOnControl = (e: React.MouseEvent): boolean =>
    e.target instanceof Element && e.target.closest('a, button, input, select, textarea') !== null;

/** TradingView symbol of a Binance pair: perpetuals carry the ".P" suffix. */
export const toChartSymbol = (symbol: string, perp: boolean): string => {
    const pair = symbol.replace(/\.P$/, '').replace(/PERP$/, '');
    return perp ? `${pair}.P` : pair;
};

export const OPEN_CHART_HINT = 'Çift tıkla: grafikte aç';

/** Element id of the home page chart panel (scrolled into view on small screens after a double click). */
export const DASHBOARD_CHART_ID = 'fidelio-dashboard-chart';
