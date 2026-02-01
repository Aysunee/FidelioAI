import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { GlassCard } from './components/ui/GlassCard';
import { Watchlist } from './components/Watchlist';
import { SignalFeed } from './components/SignalFeed';
import { notificationManager } from './utils/notifications';
import { LiquidationsFeed } from './components/LiquidationsFeed';
import { FundingRates } from './components/FundingRates';
import { FidelioRadar } from './components/FidelioRadar';
import { WebhookManager } from './components/WebhookManager';
import { DatabaseViewer } from './components/DatabaseViewer';
import { SignalManager } from './components/SignalManager';
import { MobileNav } from './components/MobileNav';
import { GlobalTicker } from './components/GlobalTicker';
import { SpotScanner } from './components/SpotScanner';
import { Portfolio } from './components/Portfolio';
import { Settings, Moon, Sun, Hexagon, Sparkles, LayoutGrid, Palette, LogOut, Building2, LayoutDashboard, Activity, Wallet, Radar, FlaskConical, Bitcoin, Database, FlaskRound, Users } from 'lucide-react';
import { AnomalyRadar } from './components/AnomalyRadar';
import { FidelioAI } from './components/FidelioAI';

import { Modal } from './components/ui/Modal';
import { SetAlertModal } from './components/SetAlertModal';
import { NotificationSettings } from './components/NotificationSettings';
import { NotificationSettingsPanel } from './components/NotificationSettingsPanel';
import { ToastContainer } from './components/ui/Toast';
import { SystemDiagnostics } from './components/SystemDiagnostics';
import { Login } from './components/Login';
import { LandingPage } from './components/LandingPage';
import { NexusDashboard } from './components/NexusDashboard';
import { TradeVisionDashboard } from './components/TradeVisionDashboard';
import { UserManagementDashboard } from './components/UserManagementDashboard';

import { UserProvider, useUser } from './context/UserContext';
import { MarketProvider, useMarketData } from './context/MarketContext';
import { SignalProvider, useSignals } from './context/SignalContext';
import { PortfolioProvider } from './context/PortfolioContext';

import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { Keyboard, Languages } from 'lucide-react';
import { translations } from './utils/translations';

const AppContent: React.FC = () => {
    const { theme, toggleTheme, viewMode, setViewMode, watchlist, addToWatchlist, removeFromWatchlist, isSettingsOpen, setIsSettingsOpen, visualMode, toggleVisualMode, isAuthenticated, logout, login, language, setLanguage } = useUser();
    const { marketData, futuresData, indicesData, liquidations, connectionStatus, fundingHistory } = useMarketData();
    const { signals, rules, setRules, priceAlerts, toasts, dismissToast, handleDeleteSignal, handleClearAllSignals, handleManualSignal, alertModal, openAlertModal, closeAlertModal, handleCreateAlert, addToast } = useSignals();

    const t = translations[language];

    // Scalper Mode State
    const [showShortcutsHelp, setShowShortcutsHelp] = React.useState(false);

    useKeyboardShortcuts({
        setViewMode: (mode) => {
            setViewMode(mode);
            addToast('View Switched', `Active View: ${mode.toUpperCase().replace('-', ' ')}`, 'info');
        },
        toggleSearch: () => {
            // Logic to focus search input if available, or toggle a search modal
            // For now just partial stub or focus existing search if we had one global
            addToast('Focus Search', 'Search feature active', 'info');
        },
        togglePause: () => {
            addToast('Stream Paused', 'Data stream paused (Visual only)', 'warning');
        },
        onHelp: () => setShowShortcutsHelp(true),
        closeModals: () => {
            setIsSettingsOpen(false);
            closeAlertModal();
            setShowShortcutsHelp(false);
        }
    });

    if (!isAuthenticated) {
        return <Login />;
    }

    const getGradientClasses = () => {
        if (theme === 'corporate') return 'from-violet-600 to-purple-600';
        if (theme === 'labs') return 'from-blue-500 via-indigo-500 to-cyan-400';
        return 'from-purple-400 to-amber-400';
    };

    const getActiveUnderlineClasses = () => {
        if (theme === 'corporate') return 'from-violet-600 to-purple-600';
        if (theme === 'labs') return 'from-blue-500 to-cyan-400';
        return 'from-purple-500 to-amber-500';
    };

    const NavLink = ({ mode, label, icon }: { mode: any, label: string, icon?: React.ReactNode }) => (
        <button
            onClick={() => setViewMode(mode)}
            className={`relative px-3 py-3 text-sm font-medium transition-all flex items-center gap-2 ${viewMode === mode
                ? `text-transparent bg-gradient-to-r ${getGradientClasses()} bg-clip-text font-bold`
                : (theme === 'corporate' || theme === 'labs') ? 'text-gray-600 hover:text-gray-900' : 'text-gray-500 hover:text-gray-300'
                }`}
        >
            {icon}
            {label}
            {viewMode === mode && (
                <span className={`absolute bottom-0 left-0 w-full h-[2px] bg-gradient-to-r ${getActiveUnderlineClasses()}`} />
            )}
        </button>
    );

    const getBackgroundClass = () => {
        if (theme === 'corporate') return 'bg-[#FAFBFC] text-gray-900';
        if (theme === 'labs') return 'bg-[#F0F2F5] text-[#1F2937]';
        return visualMode === 'vibrant' ? 'bg-black text-gray-200' : 'bg-gray-950 text-gray-200';
    };

    return (
        <div
            onClick={() => notificationManager.resumeAudioContext()}
            className={`min-h-screen ${getBackgroundClass()} font-sans selection:bg-purple-500/30 flex flex-col ${visualMode === 'minimal' ? 'minimal-mode' : ''} ${theme === 'labs' ? 'font-mono tracking-tight' : ''}`}
        >
            {/* ... existing ambience code ... */}
            {/* Labs Ambient */}
            {theme === 'labs' && (
                <div className="fixed inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-[#E8F0FE] rounded-full blur-[120px] opacity-70"></div>
                    <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-[#CEEAD6] rounded-full blur-[120px] opacity-50"></div>
                </div>
            )}

            {/* Ambient Background */}
            {visualMode === 'vibrant' && theme !== 'corporate' && (
                <div className="fixed inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-purple-600/10 rounded-full blur-[120px]"></div>
                    <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-amber-600/10 rounded-full blur-[120px]"></div>
                </div>
            )}
            {theme === 'corporate' && (
                <div className="fixed inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-violet-500/5 rounded-full blur-[120px]"></div>
                    <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-purple-500/5 rounded-full blur-[120px]"></div>
                </div>
            )}

            <ToastContainer toasts={toasts} onDismiss={dismissToast} />

            <Modal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} title={t.preferences} maxWidth="max-w-2xl">
                <div className="space-y-6">
                    <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-500/10 rounded-lg">
                                    <Languages size={20} className="text-blue-400" />
                                </div>
                                <div>
                                    <h3 className="font-bold">{t.language}</h3>
                                    <p className="text-xs text-gray-400">Uygulama dilini seçin</p>
                                </div>
                            </div>
                            <div className="flex bg-black/40 p-1 rounded-lg border border-white/10">
                                <button
                                    onClick={() => setLanguage('tr')}
                                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${language === 'tr' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                                >
                                    TR
                                </button>
                                <button
                                    onClick={() => setLanguage('en')}
                                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${language === 'en' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                                >
                                    EN
                                </button>
                            </div>
                        </div>
                    </div>
                    <NotificationSettingsPanel />
                    <div className="border-t border-white/10 pt-6">
                        <NotificationSettings rules={rules} setRules={setRules} />
                    </div>
                </div>
            </Modal>

            <Modal isOpen={alertModal.isOpen} onClose={closeAlertModal} title={`Set Alert: ${alertModal.symbol?.replace('USDT', '')}`}>
                {alertModal.symbol && <SetAlertModal symbol={alertModal.symbol} currentPrice={marketData[alertModal.symbol]?.lastPrice || 0} onSave={handleCreateAlert} onCancel={closeAlertModal} />}
            </Modal>

            <Modal isOpen={showShortcutsHelp} onClose={() => setShowShortcutsHelp(false)} title="Scalper Shortcuts" maxWidth="max-w-md">
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                            <div className="text-xs text-gray-500 mb-1">Navigation</div>
                            <div className="space-y-2">
                                <div className="flex justify-between"><span>Dashboard</span> <kbd className="bg-black/20 px-1.5 rounded text-xs font-mono">1</kbd></div>
                                <div className="flex justify-between"><span>Radar</span> <kbd className="bg-black/20 px-1.5 rounded text-xs font-mono">2</kbd></div>
                                <div className="flex justify-between"><span>Perps</span> <kbd className="bg-black/20 px-1.5 rounded text-xs font-mono">3</kbd></div>
                                <div className="flex justify-between"><span>Cmd Center</span> <kbd className="bg-black/20 px-1.5 rounded text-xs font-mono">4</kbd></div>
                                <div className="flex justify-between"><span>Portfolio</span> <kbd className="bg-black/20 px-1.5 rounded text-xs font-mono">5</kbd></div>
                            </div>
                        </div>
                        <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                            <div className="text-xs text-gray-500 mb-1">Actions</div>
                            <div className="space-y-2">
                                <div className="flex justify-between"><span>Search</span> <kbd className="bg-black/20 px-1.5 rounded text-xs font-mono">F</kbd></div>
                                <div className="flex justify-between"><span>Pause Stream</span> <kbd className="bg-black/20 px-1.5 rounded text-xs font-mono">Space</kbd></div>
                                <div className="flex justify-between"><span>Close Modal</span> <kbd className="bg-black/20 px-1.5 rounded text-xs font-mono">Esc</kbd></div>
                                <div className="flex justify-between"><span>Help</span> <kbd className="bg-black/20 px-1.5 rounded text-xs font-mono">?</kbd></div>
                            </div>
                        </div>
                    </div>
                </div>
            </Modal>

            <header className={`sticky top-0 z-30 shrink-0 h-14 transition-all border-b ${theme === 'labs'
                ? 'bg-[#F0F2F5]/95 border-transparent shadow-none'
                : theme === 'corporate'
                    ? 'bg-white/90 backdrop-blur-xl border-gray-200 shadow-sm'
                    : 'bg-black/80 backdrop-blur-xl border-white/10 shadow-[0_0_40px_rgba(168,85,247,0.1)]'
                }`}>
                <div className="w-full px-6 h-full flex items-center justify-between">
                    <div className="flex items-center gap-6 h-full overflow-x-auto scrollbar-hide">
                        <div className="flex items-center gap-2 group cursor-pointer shrink-0" onClick={() => setViewMode('dashboard')}>
                            <span className={`text-xl font-display font-black tracking-wider uppercase ${theme === 'labs'
                                ? 'text-gray-900'
                                : theme === 'corporate'
                                    ? 'text-violet-600'
                                    : 'bg-gradient-to-r from-purple-500 via-violet-500 to-amber-500 bg-clip-text text-transparent drop-shadow-[0_0_15px_rgba(168,85,247,0.3)]'
                                }`}>
                                FIDELIO
                            </span>
                        </div>
                        <nav className="flex gap-2 h-full shrink-0">
                            <NavLink mode="dashboard" label={t.markets} />
                            <NavLink mode="spot-scanner" label={t.spotSniper} />
                            <NavLink mode="funding" label={t.derivatives} />
                            <NavLink mode="radar" label={t.radar} icon={<Radar size={14} />} />
                            <NavLink mode="portfolio" label={t.portfolio} />
                            <NavLink mode="signals-manager" label={t.signals} />

                            <NavLink mode="nexus" label={t.nexus} icon={<Activity size={14} />} />
                            <NavLink mode="fidelio-ai" label={t.fidelioAi} icon={<Sparkles size={14} className={viewMode === 'fidelio-ai' ? 'animate-pulse' : ''} />} />
                            <NavLink mode="journal" label={t.journal} icon={<Database size={14} />} />
                            <NavLink mode="database" label={t.database} icon={<Database size={14} />} />
                            <NavLink mode="user-management" label="Users" icon={<Users size={14} />} />
                            <NavLink mode="lab" label={t.lab} />
                        </nav>
                    </div>



                    <div className="flex items-center gap-3 shrink-0">
                        <div className={`hidden lg:flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-md backdrop-blur-xl ${theme === 'corporate'
                            ? 'bg-gray-100 border border-gray-200'
                            : 'bg-white/5 border border-white/10'
                            }`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${connectionStatus === 'connected' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                            <span className={theme === 'corporate' ? 'text-gray-600' : 'text-gray-400'}>{connectionStatus === 'connected' ? t.connected : t.connecting}</span>
                        </div>
                        <button
                            onClick={toggleVisualMode}
                            className={`p-2 rounded-md transition-colors relative group ${theme === 'corporate'
                                ? 'hover:bg-gray-100 text-gray-500 hover:text-gray-900'
                                : 'hover:bg-white/5 text-gray-500 hover:text-gray-300'
                                }`}
                            title={visualMode === 'vibrant' ? t.switchMinimal : t.switchVibrant}
                        >
                            <Palette size={18} className={visualMode === 'vibrant' ? (theme === 'corporate' ? 'text-violet-600' : 'text-purple-400') : (theme === 'corporate' ? 'text-gray-400' : 'text-gray-500')} />
                            <span className={`absolute -bottom-8 right-0 text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap ${theme === 'corporate' ? 'bg-gray-800 text-white' : 'bg-black/90'}`}>
                                {visualMode === 'vibrant' ? t.minimal : t.vibrant}
                            </span>
                        </button>
                        <button onClick={toggleTheme} className={`p-2 rounded-md transition-colors ${theme === 'corporate' ? 'hover:bg-gray-100 text-gray-500 hover:text-gray-900' : 'hover:bg-white/5 text-gray-500 hover:text-gray-300'}`}>
                            <ThemeIcon theme={theme} />
                        </button>
                        <button onClick={() => setIsSettingsOpen(true)} className={`p-2 rounded-md transition-colors ${theme === 'corporate' ? 'hover:bg-gray-100 text-gray-500 hover:text-gray-900' : 'hover:bg-white/5 text-gray-500 hover:text-gray-300'}`}>
                            <Settings size={18} />
                        </button>
                        <button onClick={logout} className="p-2 rounded-md hover:bg-white/5 text-red-500 hover:text-red-400 transition-colors" title={t.logout}>
                            <LogOut size={18} />
                        </button>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs cursor-pointer hover:opacity-90 ${theme === 'corporate'
                            ? 'bg-gradient-to-br from-violet-600 to-purple-600 shadow-lg'
                            : 'bg-gradient-to-br from-purple-600 to-amber-600 shadow-[0_0_15px_rgba(168,85,247,0.3)]'
                            }`}>
                            U
                        </div>
                    </div>
                </div>
            </header>

            <main className="flex-1 w-full px-6 py-6 overflow-hidden flex flex-col relative z-10 pb-16">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={viewMode}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        transition={{ duration: 0.3 }}
                        className="h-full flex flex-col"
                    >
                        {viewMode === 'dashboard' && (
                            <div className="flex flex-col gap-4 h-full">
                                <div className="shrink-0">
                                    <div className="mb-4">
                                        <FidelioRadar spotData={marketData} futuresData={futuresData} indicesData={indicesData} />
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-0">
                                    <div className="lg:col-span-4 flex flex-col h-full min-h-[400px]">
                                        <Watchlist symbols={watchlist} data={marketData} activeAlerts={priceAlerts} onAdd={addToWatchlist} onRemove={removeFromWatchlist} onSetAlert={openAlertModal} />
                                    </div>
                                    <div className="lg:col-span-8 flex flex-col h-full min-h-[400px]">
                                        <SignalFeed signals={signals} marketData={marketData} />
                                    </div>
                                </div>
                            </div>
                        )}

                        {viewMode === 'spot-scanner' && <SpotScanner data={marketData} />}

                        {viewMode === 'funding' && (
                            <div className="h-full flex flex-col gap-4">
                                <div className="flex flex-col gap-1 px-1">
                                    <h2 className={`text-xl font-bold bg-gradient-to-r ${getGradientClasses()} bg-clip-text text-transparent`}>{t.derivativesOverview}</h2>
                                    <p className={theme === 'corporate' ? 'text-gray-500 text-sm' : 'text-gray-500 text-sm'}>{t.derivativesDesc}</p>
                                </div>
                                <GlassCard className="flex-1 overflow-hidden"><FundingRates data={futuresData} spotData={marketData} /></GlassCard>
                            </div>
                        )}

                        {viewMode === 'radar' && (
                            <div className="h-full flex flex-col gap-4">
                                <div className="flex flex-col gap-1 px-1">
                                    <h2 className={`text-xl font-bold bg-gradient-to-r ${getGradientClasses()} bg-clip-text text-transparent`}>{t.marketAnomalyRadar}</h2>
                                    <p className={theme === 'corporate' ? 'text-gray-500 text-sm' : 'text-gray-500 text-sm'}>{t.radarDesc}</p>
                                </div>
                                <GlassCard className="flex-1 overflow-hidden"><AnomalyRadar data={futuresData} spotData={marketData} fundingHistory={fundingHistory} /></GlassCard>
                            </div>
                        )}

                        {viewMode === 'portfolio' && (
                            <div className="h-full flex flex-col gap-4">
                                <div className="flex flex-col gap-1 px-1">
                                    <h2 className={`text-xl font-bold bg-gradient-to-r ${getGradientClasses()} bg-clip-text text-transparent`}>{t.portfolioTracker}</h2>
                                    <p className={theme === 'corporate' ? 'text-gray-500 text-sm' : 'text-gray-500 text-sm'}>{t.portfolioDesc}</p>
                                </div>
                                <GlassCard className="flex-1 overflow-hidden"><Portfolio data={marketData} /></GlassCard>
                            </div>
                        )}

                        {viewMode === 'signals-manager' && <SignalManager signals={signals} onDelete={handleDeleteSignal} onClearAll={handleClearAllSignals} />}
                        {viewMode === 'fidelio-ai' && <FidelioAI spotData={marketData} futuresData={futuresData} />}

                        {viewMode === 'lab' && <SystemDiagnostics />}
                        {viewMode === 'database' && <DatabaseViewer />}
                        {viewMode === 'nexus' && <NexusDashboard />}
                        {viewMode === 'journal' && <TradeVisionDashboard />}
                        {viewMode === 'user-management' && <UserManagementDashboard />}
                    </motion.div>
                </AnimatePresence>
            </main>

            <div className={`fixed bottom-0 left-0 right-0 h-10 backdrop-blur-xl z-40 ${(theme === 'corporate' || theme === 'labs')
                ? 'bg-white/90 border-t border-gray-200'
                : 'bg-black/80 border-t border-white/10'
                }`}>
                <LiquidationsFeed liquidations={liquidations} />
            </div>
            <MobileNav
                currentView={viewMode}
                setView={setViewMode}
                onMenuClick={() => setViewMode('dashboard')}
            />
        </div>
    );
};

const App: React.FC = () => {
    return (
        <MarketProvider>
            <UserProvider>
                <SignalProvider>
                    <PortfolioProvider>
                        <AppContent />
                    </PortfolioProvider>
                </SignalProvider>
            </UserProvider>
        </MarketProvider>
    );
};


const ThemeIcon = ({ theme }: { theme: 'light' | 'dark' | 'corporate' | 'labs' }) => {
    if (theme === 'light') return <Moon size={18} />;
    if (theme === 'dark') return <Building2 size={18} />;
    if (theme === 'labs') return <FlaskConical size={18} />;
    return <Sun size={18} />;
};


export default App;
