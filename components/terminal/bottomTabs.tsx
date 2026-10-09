import React from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';

// Shared by the Terminal page and the Türev Araçlar detail view: the bottom-area tab strip
// (Funding akışı / Kurulum / Duyarlılık) and the per-panel error boundary.

// ---------------------------------------------------------------------------
// Bottom area tabs (right column, under the symbol header)
// ---------------------------------------------------------------------------

export type BottomTab = 'funding' | 'checklist' | 'sentiment';

// Labels are typed in capitals: CSS `uppercase` under lang="tr" would render 'Funding' as 'FUNDİNG'.
export const BOTTOM_TABS: ReadonlyArray<{ key: BottomTab; label: string; title: string }> = [
    { key: 'funding', label: 'FUNDING AKIŞI', title: 'Uç funding adayları ve funding olayları (durum tespiti, tahmin değildir)' },
    { key: 'checklist', label: 'KURULUM', title: 'Seçili sembol için short sıkışması kurulum koşulları ve fonlama geçmişi' },
    { key: 'sentiment', label: 'DUYARLILIK', title: 'Seçili sembolün piyasa duyarlılığı (emir defteri, long/short oranları)' },
];
export const DEFAULT_TAB: BottomTab = 'funding';

export const isBottomTab = (value: unknown): value is BottomTab =>
    value === 'funding' || value === 'checklist' || value === 'sentiment';

// Element ids are prefixed per page, so two tab strips never share an id.
export const DEFAULT_TAB_ID_PREFIX = 'terminal-bottom';
export const tabId = (tab: BottomTab, prefix: string = DEFAULT_TAB_ID_PREFIX): string => `${prefix}-tab-${tab}`;
export const tabPanelId = (tab: BottomTab, prefix: string = DEFAULT_TAB_ID_PREFIX): string => `${prefix}-panel-${tab}`;

export const readStoredTab = (storageKey: string): BottomTab => {
    if (typeof window === 'undefined') return DEFAULT_TAB;
    try {
        const stored = window.localStorage.getItem(storageKey);
        if (isBottomTab(stored)) return stored;
    } catch {
        /* storage blocked */
    }
    return DEFAULT_TAB;
};

export const writeStoredTab = (storageKey: string, tab: BottomTab): void => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(storageKey, tab);
    } catch {
        /* storage blocked or full: the tab simply is not remembered */
    }
};

export interface BottomTabStripProps {
    active: BottomTab;
    onChange: (tab: BottomTab) => void;
    /** Prefix of the tab / tab panel element ids (see tabId, tabPanelId). */
    idPrefix?: string;
}

/**
 * Tab strip of the bottom area. It is rendered INSIDE the active panel's header row (in place of the panel
 * title), so the panel keeps its own controls on the right and there is no second header.
 */
export const BottomTabStrip: React.FC<BottomTabStripProps> = ({ active, onChange, idPrefix = DEFAULT_TAB_ID_PREFIX }) => {
    const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
        e.preventDefault();
        const index = BOTTOM_TABS.findIndex((t) => t.key === active);
        const last = BOTTOM_TABS.length - 1;
        const next =
            e.key === 'Home' ? 0 : e.key === 'End' ? last : e.key === 'ArrowLeft' ? (index <= 0 ? last : index - 1) : index >= last ? 0 : index + 1;
        onChange(BOTTOM_TABS[next].key);
    };

    return (
        <div role="tablist" aria-label="Alt panel" className="-ml-2 flex h-8 min-w-0 items-stretch">
            {BOTTOM_TABS.map((tab) => {
                const selected = tab.key === active;
                return (
                    <button
                        key={tab.key}
                        type="button"
                        role="tab"
                        id={tabId(tab.key, idPrefix)}
                        aria-selected={selected}
                        aria-controls={tabPanelId(tab.key, idPrefix)}
                        tabIndex={selected ? 0 : -1}
                        title={tab.title}
                        onClick={() => onChange(tab.key)}
                        onKeyDown={onKeyDown}
                        className={`flex h-8 shrink-0 items-center whitespace-nowrap px-2 text-[11px] font-semibold uppercase tracking-wider outline-none transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-primary ${
                            selected ? 'text-text shadow-[inset_0_-2px_0_var(--color-brand)]' : 'text-secondary hover:text-text'
                        }`}
                    >
                        {tab.label}
                    </button>
                );
            })}
        </div>
    );
};

// ---------------------------------------------------------------------------
// Panel error boundary: one failing panel must not take the whole page down.
// ---------------------------------------------------------------------------

export interface PanelBoundaryProps {
    name: string;
    /** Rendered in a header row above the fallback, so e.g. a tab strip stays usable when its panel fails. */
    fallbackHeader?: React.ReactNode;
    children?: React.ReactNode;
}

interface PanelBoundaryState {
    failed: boolean;
}

export class PanelBoundary extends React.Component<PanelBoundaryProps, PanelBoundaryState> {
    state: PanelBoundaryState = { failed: false };

    static getDerivedStateFromError(): PanelBoundaryState {
        return { failed: true };
    }

    componentDidCatch(error: unknown): void {
        console.error(`[Terminal] ${this.props.name} hatası`, error);
    }

    private retry = (): void => {
        this.setState({ failed: false });
    };

    render(): React.ReactNode {
        if (!this.state.failed) return this.props.children;
        const alert = (
            <div
                role="alert"
                className="flex h-full min-h-[120px] w-full flex-col items-center justify-center gap-2 bg-surface p-3 text-center"
            >
                <p className="flex items-center gap-1.5 text-xs text-muted">
                    <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
                    <span>{this.props.name} gösterilirken bir hata oluştu.</span>
                </p>
                <button
                    type="button"
                    onClick={this.retry}
                    className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-surface-secondary px-2.5 text-xs font-medium text-text outline-none transition-colors hover:bg-surface-highlight focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                >
                    <RefreshCw className="h-3 w-3" aria-hidden="true" />
                    Tekrar dene
                </button>
            </div>
        );
        if (!this.props.fallbackHeader) return alert;
        return (
            <div className="flex h-full min-h-0 w-full flex-col bg-surface">
                <header className="flex h-8 shrink-0 items-center border-b border-border px-3">
                    <div className="flex h-8 min-w-0 flex-1 items-center">{this.props.fallbackHeader}</div>
                </header>
                <div className="min-h-0 flex-1">{alert}</div>
            </div>
        );
    }
}
