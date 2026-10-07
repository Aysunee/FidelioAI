import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { notificationManager } from './utils/notifications';
import { LiquidationsFeed } from './components/LiquidationsFeed';
import { MobileNav, MobileNavItem } from './components/MobileNav';
import { Settings, Moon, Sun, Palette, LogOut, Building2, FlaskConical, Languages, Loader2 } from 'lucide-react';

import { Modal } from './components/ui/Modal';
import { ToastContainer } from './components/ui/Toast';
import { Login } from './components/Login';
import ErrorBoundary from './components/ErrorBoundary';

import { UserProvider, useUser, isAdminOnlyView, ViewMode } from './context/UserContext';
import { MarketProvider, useMarketData } from './context/MarketContext';
import { SignalProvider, useSignals } from './context/SignalContext';
import { PortfolioProvider } from './context/PortfolioContext';

import { useKeyboardShortcuts, VIEW_SHORTCUTS } from './hooks/useKeyboardShortcuts';
import { translations } from './utils/translations';
import { describeEngineHealth, ENGINE_TONE_DOT } from './utils/engineApi';
import { DASHBOARD_CHART_ID } from './utils/clickIntent';

// ---------------------------------------------------------------------------
// Lazily loaded views and modal bodies (keeps the login screen and initial bundle small)
// ---------------------------------------------------------------------------
const FidelioRadar = lazy(() => import('./components/FidelioRadar').then(m => ({ default: m.FidelioRadar })));
const Watchlist = lazy(() => import('./components/Watchlist').then(m => ({ default: m.Watchlist })));
const SignalFeed = lazy(() => import('./components/SignalFeed').then(m => ({ default: m.SignalFeed })));
const SpotScanner = lazy(() => import('./components/SpotScanner').then(m => ({ default: m.SpotScanner })));
const FundingRates = lazy(() => import('./components/FundingRates').then(m => ({ default: m.FundingRates })));
const AnomalyRadar = lazy(() => import('./components/AnomalyRadar').then(m => ({ default: m.AnomalyRadar })));
const Portfolio = lazy(() => import('./components/Portfolio').then(m => ({ default: m.Portfolio })));
const SignalManager = lazy(() => import('./components/SignalManager').then(m => ({ default: m.SignalManager })));
const FidelioAI = lazy(() => import('./components/FidelioAI').then(m => ({ default: m.FidelioAI })));
const SystemDiagnostics = lazy(() => import('./components/SystemDiagnostics').then(m => ({ default: m.SystemDiagnostics })));
const DatabaseViewer = lazy(() => import('./components/DatabaseViewer').then(m => ({ default: m.DatabaseViewer })));
const NexusDashboard = lazy(() => import('./components/NexusDashboard').then(m => ({ default: m.NexusDashboard })));
const TradeVisionDashboard = lazy(() => import('./components/TradeVisionDashboard').then(m => ({ default: m.TradeVisionDashboard })));
const UserManagementDashboard = lazy(() => import('./components/UserManagementDashboard').then(m => ({ default: m.UserManagementDashboard })));
const WebhookManager = lazy(() => import('./components/WebhookManager').then(m => ({ default: m.WebhookManager })));
// Terminal chunk loader, shared by lazy() and the preload below (dynamic imports are cached by the browser).
const loadTerminalPage = () => import('./components/terminal/TerminalPage');
const TerminalPage = lazy(() => loadTerminalPage().then(m => ({ default: m.TerminalPage })));
const SetAlertModal = lazy(() => import('./components/SetAlertModal').then(m => ({ default: m.SetAlertModal })));
const NotificationSettings = lazy(() => import('./components/NotificationSettings').then(m => ({ default: m.NotificationSettings })));
const NotificationSettingsPanel = lazy(() => import('./components/NotificationSettingsPanel').then(m => ({ default: m.NotificationSettingsPanel })));

// Downloads the Terminal chunk ahead of time (nav hover/focus, or idle after login) so opening it doesn't wait for JS.
let terminalPreload: Promise<unknown> | null = null;
const preloadTerminalPage = (): void => {
    if (terminalPreload) return;
    terminalPreload = loadTerminalPage().catch(() => {
        terminalPreload = null; // allow a later retry; lazy() reports real failures when the view opens
    });
};
const TERMINAL_IDLE_PRELOAD_DELAY_MS = 3_000;

type Theme = ReturnType<typeof useUser>['theme'];

// Shared control styles of the shell (Fidelio Terminal design system).
const FOCUS_RING = 'focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary';
const ICON_BUTTON = `grid h-7 w-7 shrink-0 place-items-center rounded-sm text-secondary transition-colors hover:bg-surface-secondary hover:text-text ${FOCUS_RING}`;
const SEGMENT_BASE = `h-6 rounded-sm px-2 text-[11px] font-medium transition-colors ${FOCUS_RING}`;
const SEGMENT_ACTIVE = 'bg-surface-highlight text-text';
const SEGMENT_IDLE = 'text-secondary hover:text-text';
const KBD = 'rounded-sm border border-border bg-surface-secondary px-1.5 font-mono text-[11px] text-secondary';

const ViewLoading: React.FC = () => (
    <div role="status" className="flex min-h-[240px] flex-1 items-center justify-center gap-2 text-xs text-muted">
        <Loader2 size={14} className="animate-spin" />
        Yükleniyor…
    </div>
);

const ModalLoading: React.FC = () => (
    <div role="status" className="flex items-center justify-center gap-2 py-6 text-xs text-muted">
        <Loader2 size={14} className="animate-spin" />
        Yükleniyor…
    </div>
);

// ---------------------------------------------------------------------------
// Header pieces (module scope so they are never re-created/remounted on re-render)
// ---------------------------------------------------------------------------
interface NavLinkProps {
    mode: ViewMode;
    label: string;
    isActive: boolean;
    onSelect: (mode: ViewMode) => void;
    /** Called on hover/focus, e.g. to start downloading the view's code. */
    onPreload?: () => void;
}

// Flat text tab; the active tab carries a 2px accent line that sits on the header's bottom edge.
const NavLink: React.FC<NavLinkProps> = ({ mode, label, isActive, onSelect, onPreload }) => (
    <button
        type="button"
        onClick={() => onSelect(mode)}
        onPointerEnter={onPreload}
        onFocus={onPreload}
        aria-current={isActive ? 'page' : undefined}
        className={`flex h-full shrink-0 items-center whitespace-nowrap border-b-2 px-2.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-primary ${isActive
            ? 'border-primary text-text'
            : 'border-transparent text-secondary hover:text-text'
            }`}
    >
        {label}
    </button>
);

// Only this small badge re-renders on market ticks, not the whole header.
interface ConnectionBadgeProps {
    connectedLabel: string;
    connectingLabel: string;
    staleLabel: string;
    disconnectedLabel: string;
}

const ConnectionBadge: React.FC<ConnectionBadgeProps> = ({ connectedLabel, connectingLabel, staleLabel, disconnectedLabel }) => {
    const { connectionStatus, isStale } = useMarketData();
    const label = connectionStatus === 'connected'
        ? connectedLabel
        : connectionStatus === 'connecting'
            ? connectingLabel
            : isStale ? staleLabel : disconnectedLabel;
    const dotClass = connectionStatus === 'connected'
        ? 'bg-success'
        : connectionStatus === 'disconnected' && !isStale ? 'bg-danger' : 'bg-warning';
    return (
        <div role="status" aria-label={label} title={label} className="flex shrink-0 items-center gap-1.5 px-1.5 text-[11px] text-secondary">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
            <span className="hidden whitespace-nowrap lg:inline">{label}</span>
        </div>
    );
};

// Server signal engine: green = running leader, amber = standby or a data stream down,
// red = engine off / not running / status unreachable. The tooltip says why.
const EngineBadge: React.FC = () => {
    const { engineStatus, engineStatusError, engineStatusAt } = useSignals();
    const { tone, text } = describeEngineHealth(engineStatus, engineStatusError, engineStatusAt, Date.now());
    return (
        <div role="status" aria-label={text} title={text} className="flex shrink-0 items-center gap-1.5 px-1.5 text-[11px] text-secondary">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ENGINE_TONE_DOT[tone]}`} />
            <span className="whitespace-nowrap">Motor</span>
        </div>
    );
};

// The toggle shows the icon of the theme the next click switches to.
const THEME_ICONS: Record<Theme, React.ComponentType<{ size?: number }>> = {
    light: Moon,
    dark: Building2,
    labs: FlaskConical,
    corporate: Sun,
};

const ThemeIcon = ({ theme }: { theme: Theme }) => {
    const Icon = THEME_ICONS[theme] ?? Sun;
    return <Icon size={14} />;
};

// ---------------------------------------------------------------------------
// Context-bound leaf components: each subscribes only to the data it needs
// ---------------------------------------------------------------------------
const ToastLayer: React.FC = () => {
    const { toasts, dismissToast } = useSignals();
    return <ToastContainer toasts={toasts} onDismiss={dismissToast} />;
};

const NotificationRulesSection: React.FC = () => {
    const { rules, setRules } = useSignals();
    return <NotificationSettings rules={rules} setRules={setRules} />;
};

const AlertModalBody: React.FC<{ symbol: string }> = ({ symbol }) => {
    const { marketData } = useMarketData();
    const { handleCreateAlert, closeAlertModal } = useSignals();
    return (
        <Suspense fallback={<ModalLoading />}>
            <SetAlertModal symbol={symbol} currentPrice={marketData[symbol]?.lastPrice || 0} onSave={handleCreateAlert} onCancel={closeAlertModal} />
        </Suspense>
    );
};

const AlertModalLayer: React.FC = () => {
    const { alertModal, closeAlertModal } = useSignals();
    return (
        <Modal isOpen={alertModal.isOpen} onClose={closeAlertModal} title={`Set Alert: ${alertModal.symbol?.replace('USDT', '')}`}>
            {alertModal.symbol && <AlertModalBody symbol={alertModal.symbol} />}
        </Modal>
    );
};

const LiquidationsStrip: React.FC = () => {
    const { liquidations } = useMarketData();
    return <LiquidationsFeed liquidations={liquidations} />;
};

// ---------------------------------------------------------------------------
// Views: edge-to-edge panel grids. Children are placed directly in the cells; the 1px lines
// between panels are the grid's own background (gap-px + bg-border).
// ---------------------------------------------------------------------------
const DashboardView: React.FC = () => {
    const { watchlist, addToWatchlist, removeFromWatchlist } = useUser();
    const { marketData, futuresData, indicesData } = useMarketData();
    const { signals, priceAlerts, openAlertModal, removePriceAlert } = useSignals();
    // Symbol of the home page chart; a double click on a coin in any list on this page shows it there.
    const [chartSymbol, setChartSymbol] = useState('BTCUSDT');
    const openChart = useCallback((symbol: string) => {
        setChartSymbol(symbol);
        // Stacked layout (below lg): bring the chart into view when the double click came from further down.
        if (typeof window === 'undefined') return;
        const chart = document.getElementById(DASHBOARD_CHART_ID);
        if (!chart) return;
        const rect = chart.getBoundingClientRect();
        if (rect.top < 0 || rect.top > window.innerHeight - 80) chart.scrollIntoView({ block: 'start' });
    }, []);
    return (
        // lg+: chart + big-move radars on the left, watchlist over signal feed in a fixed right column.
        // Below lg everything stacks and <main> scrolls.
        <div className="grid w-full shrink-0 grid-cols-1 gap-px bg-border lg:h-full lg:min-h-0 lg:shrink lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[minmax(0,1fr)]">
            <div className="min-w-0 bg-surface lg:min-h-0 lg:overflow-y-auto lg:overflow-x-hidden">
                <FidelioRadar spotData={marketData} futuresData={futuresData} indicesData={indicesData} chartSymbol={chartSymbol} onChartSymbolChange={openChart} />
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-px bg-border md:grid-cols-2 lg:min-h-0 lg:grid-cols-1 lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="h-[420px] min-h-0 min-w-0 bg-surface lg:h-auto">
                    <Watchlist symbols={watchlist} data={marketData} activeAlerts={priceAlerts} onAdd={addToWatchlist} onRemove={removeFromWatchlist} onSetAlert={openAlertModal} onRemoveAlert={removePriceAlert} onOpenChart={openChart} />
                </div>
                <div className="h-[420px] min-h-0 min-w-0 bg-surface lg:h-auto">
                    <SignalFeed signals={signals} marketData={marketData} onOpenChart={openChart} />
                </div>
            </div>
        </div>
    );
};

const SpotScannerView: React.FC = () => {
    const { marketData } = useMarketData();
    return <SpotScanner data={marketData} />;
};

const FundingView: React.FC = () => {
    const { marketData, futuresData } = useMarketData();
    return <FundingRates data={futuresData} spotData={marketData} />;
};

const RadarView: React.FC = () => {
    const { marketData, futuresData, fundingHistory } = useMarketData();
    return <AnomalyRadar data={futuresData} spotData={marketData} fundingHistory={fundingHistory} />;
};

const PortfolioView: React.FC = () => {
    const { marketData } = useMarketData();
    return <Portfolio data={marketData} />;
};

const SignalsManagerView: React.FC = () => {
    const { signals, handleDeleteSignal, handleClearAllSignals } = useSignals();
    return <SignalManager signals={signals} onDelete={handleDeleteSignal} onClearAll={handleClearAllSignals} />;
};

const FidelioAIView: React.FC = () => {
    const { marketData, futuresData } = useMarketData();
    return <FidelioAI spotData={marketData} futuresData={futuresData} />;
};

const ActiveView: React.FC<{ view: ViewMode }> = ({ view }) => {
    switch (view) {
        case 'dashboard': return <DashboardView />;
        case 'spot-scanner': return <SpotScannerView />;
        case 'funding': return <FundingView />;
        case 'radar': return <RadarView />;
        case 'portfolio': return <PortfolioView />;
        case 'signals-manager': return <SignalsManagerView />;
        case 'fidelio-ai': return <FidelioAIView />;
        case 'nexus': return <NexusDashboard />;
        case 'journal': return <TradeVisionDashboard />;
        case 'terminal': return <TerminalPage />;
        // Admin-only views (AppContent never passes these for non-admins; the server enforces it too)
        case 'lab': return <SystemDiagnostics />;
        case 'database': return <DatabaseViewer />;
        case 'user-management': return <UserManagementDashboard />;
        case 'webhook': return <WebhookManager />;
        default: return null;
    }
};

// ---------------------------------------------------------------------------
// App shell (rendered only for authenticated users)
// ---------------------------------------------------------------------------
const AppContent: React.FC = () => {
    const { theme, toggleTheme, viewMode, setViewMode, isSettingsOpen, setIsSettingsOpen, visualMode, toggleVisualMode, logout, language, setLanguage, isAdmin, user } = useUser();

    const t = translations[language];

    // Render guard: a non-admin can never render an admin-only view, even for one frame.
    const activeView: ViewMode = !isAdmin && isAdminOnlyView(viewMode) ? 'dashboard' : viewMode;

    const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
    const openHelp = useCallback(() => setShowShortcutsHelp(true), []);
    const closeHelp = useCallback(() => setShowShortcutsHelp(false), []);
    const closeSettings = useCallback(() => setIsSettingsOpen(false), [setIsSettingsOpen]);

    // Preload the Terminal chunk once the browser is idle shortly after login.
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        let idleHandle: number | null = null;
        const timer = window.setTimeout(() => {
            if (typeof window.requestIdleCallback === 'function') {
                idleHandle = window.requestIdleCallback(() => {
                    idleHandle = null;
                    preloadTerminalPage();
                }, { timeout: 5_000 });
            } else {
                preloadTerminalPage();
            }
        }, TERMINAL_IDLE_PRELOAD_DELAY_MS);
        return () => {
            window.clearTimeout(timer);
            if (idleHandle !== null && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleHandle);
        };
    }, []);

    useKeyboardShortcuts({
        setViewMode,
        onHelp: openHelp,
        closeModals: () => {
            setIsSettingsOpen(false);
            setShowShortcutsHelp(false);
        }
    });

    const navItems = useMemo<MobileNavItem[]>(() => {
        const items: MobileNavItem[] = [
            { mode: 'dashboard', label: t.markets },
            { mode: 'terminal', label: 'Terminal' },
            { mode: 'spot-scanner', label: t.spotSniper },
            { mode: 'funding', label: t.derivatives },
            { mode: 'radar', label: t.radar },
            { mode: 'portfolio', label: t.portfolio },
            { mode: 'signals-manager', label: t.signals },
            { mode: 'nexus', label: t.nexus },
            { mode: 'fidelio-ai', label: t.fidelioAi },
            { mode: 'journal', label: t.journal },
            { mode: 'database', label: t.database },
            { mode: 'user-management', label: language === 'en' ? 'Users' : 'Kullanıcılar' },
            { mode: 'webhook', label: 'Webhook' },
            { mode: 'lab', label: t.lab },
        ];
        return items.filter(item => isAdmin || !isAdminOnlyView(item.mode));
    }, [t, language, isAdmin]);

    const labelForView = (mode: ViewMode) => navItems.find(item => item.mode === mode)?.label ?? mode;

    const userName = user?.name || user?.username || '';
    const userInitial = (userName.trim().charAt(0) || 'U').toUpperCase();

    return (
        // App shell: header (h-11) / main (fills the rest, no padding) / liquidation strip (h-8), all in flow.
        // Below md the fixed MobileNav sits under the column, so the column keeps that much room free.
        <div
            onClick={() => notificationManager.resumeAudioContext()}
            className={`flex h-dvh flex-col overflow-hidden bg-background pb-[calc(3rem+env(safe-area-inset-bottom))] font-sans text-text selection:bg-primary-soft md:pb-0 ${visualMode === 'minimal' ? 'minimal-mode' : ''}`}
        >
            <ToastLayer />

            <Modal isOpen={isSettingsOpen} onClose={closeSettings} title={t.preferences} maxWidth="max-w-2xl" flush>
                <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                        <Languages size={14} className="shrink-0 text-secondary" />
                        <div className="min-w-0">
                            <h3 className="text-xs font-medium text-text">{t.language}</h3>
                            <p className="text-[11px] text-muted">Uygulama dilini seçin</p>
                        </div>
                    </div>
                    <div className="inline-flex shrink-0 rounded-sm border border-border p-0.5">
                        <button
                            type="button"
                            onClick={() => setLanguage('tr')}
                            aria-pressed={language === 'tr'}
                            className={`${SEGMENT_BASE} ${language === 'tr' ? SEGMENT_ACTIVE : SEGMENT_IDLE}`}
                        >
                            TR
                        </button>
                        <button
                            type="button"
                            onClick={() => setLanguage('en')}
                            aria-pressed={language === 'en'}
                            className={`${SEGMENT_BASE} ${language === 'en' ? SEGMENT_ACTIVE : SEGMENT_IDLE}`}
                        >
                            EN
                        </button>
                    </div>
                </div>
                <ErrorBoundary>
                    <Suspense fallback={<ModalLoading />}>
                        <NotificationSettingsPanel />
                        <NotificationRulesSection />
                    </Suspense>
                </ErrorBoundary>
            </Modal>

            <AlertModalLayer />

            <Modal isOpen={showShortcutsHelp} onClose={closeHelp} title="Klavye Kısayolları" maxWidth="max-w-md" flush>
                <div className="grid grid-cols-2 gap-px border-b border-border bg-border text-xs text-text">
                    <section className="bg-surface">
                        <h3 className="flex h-7 items-center border-b border-border px-3 text-[10px] font-medium uppercase tracking-wider text-muted">Gezinme</h3>
                        {VIEW_SHORTCUTS.map(shortcut => (
                            <div key={shortcut.key} className="flex h-7 items-center justify-between gap-2 border-b border-border px-3 last:border-b-0">
                                <span className="truncate">{labelForView(shortcut.view)}</span>
                                <kbd className={KBD}>{shortcut.key}</kbd>
                            </div>
                        ))}
                    </section>
                    <section className="bg-surface">
                        <h3 className="flex h-7 items-center border-b border-border px-3 text-[10px] font-medium uppercase tracking-wider text-muted">Genel</h3>
                        <div className="flex h-7 items-center justify-between gap-2 border-b border-border px-3">
                            <span className="truncate">Pencereyi kapat</span>
                            <kbd className={KBD}>Esc</kbd>
                        </div>
                        <div className="flex h-7 items-center justify-between gap-2 border-b border-border px-3">
                            <span className="truncate">Kısayol yardımı</span>
                            <kbd className={KBD}>?</kbd>
                        </div>
                    </section>
                </div>
                <p className="px-3 py-2 text-[11px] text-muted">Kısayollar bir metin alanına yazarken ve Ctrl/Cmd/Alt tuşlarıyla birlikte çalışmaz.</p>
            </Modal>

            <header className="flex h-11 shrink-0 items-stretch border-b border-border bg-surface">
                <button
                    type="button"
                    onClick={() => setViewMode('dashboard')}
                    className={`flex shrink-0 items-center px-3 ${FOCUS_RING}`}
                >
                    <span className="text-gradient-violet text-sm font-bold uppercase tracking-wide">FIDELIO</span>
                </button>

                {/* Flat text tabs (md+; below md the bottom MobileNav is the navigation). Scrolls sideways without a
                    scrollbar when it overflows; -mb-px lets the active tab's accent line cover the header border. */}
                <nav className="-mb-px hidden min-w-0 flex-1 items-stretch overflow-x-auto scrollbar-hide md:flex">
                    {navItems.map(item => (
                        <NavLink
                            key={item.mode}
                            mode={item.mode}
                            label={item.label}
                            isActive={activeView === item.mode}
                            onSelect={setViewMode}
                            onPreload={item.mode === 'terminal' ? preloadTerminalPage : undefined}
                        />
                    ))}
                </nav>

                <div className="ml-auto flex shrink-0 items-center gap-0.5 px-2 md:border-l md:border-border">
                    <ConnectionBadge connectedLabel={t.connected} connectingLabel={t.connecting} staleLabel={t.dataStale} disconnectedLabel={t.disconnected} />
                    <EngineBadge />
                    <button
                        type="button"
                        onClick={toggleTheme}
                        className={ICON_BUTTON}
                        title={language === 'en' ? 'Theme' : 'Tema'}
                        aria-label={language === 'en' ? 'Theme' : 'Tema'}
                    >
                        <ThemeIcon theme={theme} />
                    </button>
                    <button
                        type="button"
                        onClick={toggleVisualMode}
                        className={ICON_BUTTON}
                        title={visualMode === 'vibrant' ? t.switchMinimal : t.switchVibrant}
                        aria-label={visualMode === 'vibrant' ? t.switchMinimal : t.switchVibrant}
                        aria-pressed={visualMode === 'vibrant'}
                    >
                        <Palette size={14} className={visualMode === 'vibrant' ? 'text-primary' : ''} />
                    </button>
                    <button
                        type="button"
                        onClick={() => setLanguage(language === 'tr' ? 'en' : 'tr')}
                        className={`${ICON_BUTTON} font-mono text-[11px] font-semibold uppercase`}
                        title={t.language}
                        aria-label={t.language}
                    >
                        {language}
                    </button>
                    <button
                        type="button"
                        onClick={() => setIsSettingsOpen(true)}
                        className={ICON_BUTTON}
                        title={t.preferences}
                        aria-label={t.preferences}
                    >
                        <Settings size={14} />
                    </button>
                    <button
                        type="button"
                        onClick={logout}
                        className={`grid h-7 w-7 shrink-0 place-items-center rounded-sm text-danger transition-colors hover:bg-danger-soft ${FOCUS_RING}`}
                        title={t.logout}
                        aria-label={t.logout}
                    >
                        <LogOut size={14} />
                    </button>
                    <div
                        title={userName || undefined}
                        className="ml-1 hidden h-6 w-6 shrink-0 place-items-center rounded-sm bg-primary-soft text-[11px] font-semibold text-primary sm:grid"
                    >
                        {userInitial}
                    </div>
                </div>
            </header>

            {/* No padding and no gap: every view fills <main> edge to edge. Below lg <main> scrolls and views are
                naturally tall; from lg up the view gets the exact height and scrolls inside its own panels. */}
            <main className="relative min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden lg:overflow-hidden">
                <div
                    key={activeView}
                    className="flex min-h-full w-full flex-col lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overflow-x-hidden"
                >
                    <ErrorBoundary>
                        <Suspense fallback={<ViewLoading />}>
                            <ActiveView view={activeView} />
                        </Suspense>
                    </ErrorBoundary>
                </div>
            </main>

            {/* Liquidation ticker: an in-flow strip under <main> (above the mobile nav on small screens). */}
            <div className="h-8 shrink-0 border-t border-border bg-surface">
                <LiquidationsStrip />
            </div>
            <MobileNav
                currentView={activeView}
                setView={setViewMode}
                menuItems={navItems}
            />
        </div>
    );
};

// Market data, signals and portfolio only exist for a logged-in session: nothing (WebSockets,
// scanners, socket.io) runs on the login screen, and everything is torn down on logout.
const AuthenticatedApp: React.FC = () => (
    <MarketProvider>
        <SignalProvider>
            <PortfolioProvider>
                <AppContent />
            </PortfolioProvider>
        </SignalProvider>
    </MarketProvider>
);

const AuthGate: React.FC = () => {
    const { isAuthenticated } = useUser();
    return isAuthenticated ? <AuthenticatedApp /> : <Login />;
};

const App: React.FC = () => {
    return (
        <ErrorBoundary fullScreen>
            <UserProvider>
                <AuthGate />
            </UserProvider>
        </ErrorBoundary>
    );
};

export default App;
