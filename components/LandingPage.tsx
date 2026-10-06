import React, { useState, useEffect } from 'react';
import { LandingNav } from './LandingNav';
import { ArrowRight, Zap, TrendingUp, Lock, X, AlertCircle, Sparkles, Target, Activity, BarChart3, Brain, Gauge } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUser } from '../context/UserContext';
import { translations } from '../utils/translations';

// NOTE: This page is currently not rendered by App.tsx (unauthenticated users go straight to <Login />).
// It uses the same username/password login as <Login /> so it can be wired in safely later.
export const LandingPage: React.FC = () => {
    const { language, login } = useUser();
    const t = translations[language];

    const [showLoginModal, setShowLoginModal] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [shake, setShake] = useState(0);

    // Keyboard navigation for modal
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && showLoginModal) {
                setShowLoginModal(false);
            }
        };

        if (typeof document === 'undefined') return;
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [showLoginModal]);

    // Lock page scroll while the modal is open
    useEffect(() => {
        if (typeof document === 'undefined') return;
        document.body.style.overflow = showLoginModal ? 'hidden' : 'unset';
        return () => { document.body.style.overflow = 'unset'; };
    }, [showLoginModal]);

    const handleLogin = () => {
        setShowLoginModal(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (loading) return;
        setError('');
        if (!username.trim() || !password) {
            setError('Kullanıcı adı ve şifre gereklidir.');
            setShake(prev => prev + 1);
            return;
        }
        setLoading(true);
        try {
            const result = await login(username.trim(), password);
            if (!result.success) {
                setError(result.error || 'Kullanıcı adı veya şifre hatalı.');
                setShake(prev => prev + 1);
            }
        } catch {
            setError('Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.');
        } finally {
            setLoading(false);
        }
    };

    const features = [
        {
            icon: <Brain size={28} />,
            title: t.featAiTitle,
            description: t.featAiDesc,
            gradient: "from-violet-500 to-purple-600"
        },
        {
            icon: <Activity size={28} />,
            title: t.featAnomalyTitle,
            description: t.featAnomalyDesc,
            gradient: "from-emerald-500 to-teal-600"
        },
        {
            icon: <Gauge size={28} />,
            title: t.featFundingTitle,
            description: t.featFundingDesc,
            gradient: "from-amber-500 to-orange-600"
        },
        {
            icon: <BarChart3 size={28} />,
            title: t.featChartTitle,
            description: t.featChartDesc,
            gradient: "from-cyan-500 to-blue-600"
        },
        {
            icon: <Zap size={28} />,
            title: t.featVolumeTitle,
            description: t.featVolumeDesc,
            gradient: "from-pink-500 to-rose-600"
        },
        {
            icon: <Target size={28} />,
            title: t.featSignalTitle,
            description: t.featSignalDesc,
            gradient: "from-indigo-500 to-violet-600"
        }
    ];

    const [showIntro, setShowIntro] = useState(true);

    useEffect(() => {
        const timer = setTimeout(() => {
            setShowIntro(false);
        }, 2000);
        return () => clearTimeout(timer);
    }, []);

    return (
        <div className="min-h-screen bg-black text-white selection:bg-purple-500/30 overflow-x-hidden">
            <AnimatePresence>
                {showIntro ? (
                    <motion.div
                        initial={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black overflow-hidden"
                    >
                        {/* Background Glow */}
                        <motion.div
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: [1, 1.2, 1], opacity: 0.3 }}
                            transition={{ duration: 2, ease: "easeInOut" }}
                            className="absolute z-0 w-[500px] h-[500px] bg-gradient-to-r from-purple-600/30 to-amber-600/30 rounded-full blur-[100px]"
                        />

                        {/* Logo */}
                        <motion.span
                            layoutId="intro-logo"
                            initial={{ scale: 0.8, opacity: 0, filter: 'blur(20px)' }}
                            animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
                            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
                            className="relative z-10 font-display font-black text-6xl md:text-9xl bg-gradient-to-r from-purple-600 via-violet-500 to-amber-500 bg-clip-text text-transparent tracking-wider uppercase drop-shadow-[0_0_60px_rgba(168,85,247,0.5)] animate-gradient-x"
                        >
                            FIDELIO
                        </motion.span>
                    </motion.div>
                ) : (
                    <>
                        <LandingNav onLogin={handleLogin} logoLayoutId="intro-logo" />

                        {/* Accessible Login Modal */}
                        <AnimatePresence>
                            {showLoginModal && (
                                <motion.div
                                    role="dialog"
                                    aria-modal="true"
                                    aria-labelledby="login-title"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="fixed inset-0 bg-black/90 backdrop-blur-xl z-50 flex items-center justify-center p-4"
                                    onClick={() => setShowLoginModal(false)}
                                >
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                                        transition={{ type: "spring", damping: 25, stiffness: 300 }}
                                        className="relative w-full max-w-md"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <button
                                            onClick={() => setShowLoginModal(false)}
                                            aria-label="Close login modal"
                                            className="absolute -top-12 right-0 p-2 text-gray-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 rounded-lg"
                                        >
                                            <X size={24} />
                                        </button>

                                        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-zinc-900 to-black p-8 shadow-2xl shadow-purple-900/30">
                                            {/* Ambient glow */}
                                            <div className="absolute -top-24 -right-24 w-48 h-48 bg-purple-500/20 rounded-full blur-3xl" />
                                            <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-amber-500/10 rounded-full blur-3xl" />

                                            <div className="relative z-10">
                                                <div className="text-center mb-8">
                                                    <div className="w-20 h-20 mx-auto bg-gradient-to-br from-purple-600 via-violet-600 to-amber-600 rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-purple-500/40 animate-pulse">
                                                        <Lock className="text-white" size={36} />
                                                    </div>
                                                    <h1 id="login-title" className="text-4xl font-bold bg-gradient-to-r from-purple-400 via-violet-400 to-amber-400 bg-clip-text text-transparent mb-3">
                                                        {t.welcomeBack}
                                                    </h1>
                                                    <p className="text-gray-400">Devam etmek için kullanıcı adınızı ve şifrenizi girin</p>
                                                </div>

                                                <form onSubmit={handleSubmit} className="space-y-6">
                                                    <div className="space-y-3">
                                                        <motion.div
                                                            animate={{ x: error ? [0, -10, 10, -10, 10, 0] : 0 }}
                                                            key={shake}
                                                            transition={{ duration: 0.4 }}
                                                            className="space-y-3"
                                                        >
                                                            <label htmlFor="landing-username-input" className="sr-only">
                                                                Kullanıcı adı
                                                            </label>
                                                            <input
                                                                id="landing-username-input"
                                                                name="username"
                                                                type="text"
                                                                autoComplete="username"
                                                                autoCapitalize="none"
                                                                spellCheck={false}
                                                                value={username}
                                                                onChange={(e) => {
                                                                    setUsername(e.target.value);
                                                                    setError('');
                                                                }}
                                                                placeholder="Kullanıcı adı"
                                                                aria-invalid={!!error}
                                                                aria-describedby={error ? "password-error" : undefined}
                                                                disabled={loading}
                                                                className={`w-full bg-black/60 border ${error ? 'border-red-500/50 text-red-200' : 'border-white/20 text-white'
                                                                    } rounded-2xl px-6 py-4 outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all placeholder:text-gray-600 text-center text-lg font-medium`}
                                                                autoFocus
                                                            />
                                                            <label htmlFor="password-input" className="sr-only">
                                                                Şifre
                                                            </label>
                                                            <input
                                                                id="password-input"
                                                                name="password"
                                                                type="password"
                                                                autoComplete="current-password"
                                                                value={password}
                                                                onChange={(e) => {
                                                                    setPassword(e.target.value);
                                                                    setError('');
                                                                }}
                                                                placeholder="Şifre"
                                                                aria-invalid={!!error}
                                                                aria-describedby={error ? "password-error" : undefined}
                                                                disabled={loading}
                                                                className={`w-full bg-black/60 border ${error ? 'border-red-500/50 text-red-200' : 'border-white/20 text-white'
                                                                    } rounded-2xl px-6 py-4 outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all placeholder:text-gray-600 text-center tracking-widest text-lg font-medium`}
                                                            />
                                                        </motion.div>
                                                        {error && (
                                                            <div id="password-error" role="alert" className="flex items-center justify-center gap-2 text-red-400 text-sm">
                                                                <AlertCircle size={14} />
                                                                <span>{error}</span>
                                                            </div>
                                                        )}
                                                    </div>

                                                    <button
                                                        type="submit"
                                                        disabled={loading}
                                                        className="w-full disabled:opacity-50 disabled:cursor-not-allowed bg-gradient-to-r from-purple-600 to-violet-600 text-white font-bold py-4 rounded-2xl hover:from-purple-500 hover:to-violet-500 transition-all shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50 flex items-center justify-center gap-2 group focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-black"
                                                    >
                                                        <span>{loading ? 'Giriş yapılıyor…' : t.enterSystem}</span>
                                                        <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                                                    </button>
                                                </form>
                                            </div>
                                        </div>
                                    </motion.div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Hero Section - Asymmetric Layout */}
                        <section className="relative min-h-screen flex items-center pt-20 overflow-hidden">
                            {/* Sophisticated Background */}
                            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                                <div className="absolute top-1/4 left-0 w-[600px] h-[600px] bg-purple-600/10 rounded-full blur-[140px]" />
                                <div className="absolute bottom-0 right-0 w-[800px] h-[800px] bg-amber-600/5 rounded-full blur-[140px]" />
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-px bg-gradient-to-r from-transparent via-white/5 to-transparent" />
                            </div>

                            <div className="container mx-auto px-6 lg:px-12 relative z-10">
                                <div className="grid lg:grid-cols-2 gap-16 items-center">
                                    {/* Left: Content */}
                                    <motion.div
                                        initial={{ opacity: 0, x: -30 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                                    >
                                        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 mb-8 backdrop-blur-sm">
                                            <span className="relative flex h-2 w-2">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                                            </span>
                                            <span className="text-sm font-medium text-gray-300">{t.liveIntelligence}</span>
                                        </div>

                                        <h1 className="text-6xl lg:text-7xl xl:text-8xl font-bold tracking-tight mb-8 leading-[0.95]">
                                            <span className="block text-white mb-2">{language === 'tr' ? `${t.precision} ${t.tradeWith}` : `${t.tradeWith} ${t.precision}`}</span>
                                            <span className="block bg-gradient-to-r from-purple-400 via-violet-400 to-amber-400 bg-clip-text text-transparent">
                                                {t.precision}
                                            </span>
                                        </h1>

                                        <p className="text-xl text-gray-400 mb-10 leading-relaxed max-w-xl">
                                            {t.heroDesc}
                                        </p>

                                        <div className="flex flex-col sm:flex-row gap-4">
                                            <button
                                                onClick={handleLogin}
                                                className="group px-8 py-4 bg-white text-black rounded-2xl font-bold text-lg hover:bg-gray-100 transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black"
                                            >
                                                <span>{t.startTrading}</span>
                                                <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                                            </button>
                                            <button
                                                onClick={() => {
                                                    document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' });
                                                }}
                                                className="px-8 py-4 bg-white/5 border border-white/10 text-white rounded-2xl font-bold text-lg hover:bg-white/10 transition-all backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                            >
                                                {t.exploreFeatures}
                                            </button>
                                        </div>
                                    </motion.div>

                                    {/* Right: Visual Element */}
                                    <motion.div
                                        initial={{ opacity: 0, x: 30 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
                                        className="relative hidden lg:block"
                                    >
                                        <div className="relative">
                                            {/* Floating Cards - Bespoke Design */}
                                            <motion.div
                                                animate={{ y: [0, -10, 0] }}
                                                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                                                className="absolute top-0 right-0 bg-gradient-to-br from-emerald-500/10 to-teal-600/10 backdrop-blur-xl border border-emerald-500/20 rounded-3xl p-6 shadow-2xl shadow-emerald-500/10"
                                            >
                                                <div className="flex items-center gap-4 mb-3">
                                                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 flex items-center justify-center">
                                                        <TrendingUp size={24} className="text-emerald-400" />
                                                    </div>
                                                    <div>
                                                        <div className="text-xs text-gray-400 uppercase tracking-wider">Örnek Sinyal</div>
                                                        <div className="text-lg font-bold text-white">BTC/USDT</div>
                                                    </div>
                                                </div>
                                                <div className="text-3xl font-bold text-emerald-400 font-mono">LONG</div>
                                                <div className="text-xs text-gray-500 mt-2">Formasyon: Boğa Bayrağı (temsili)</div>
                                            </motion.div>

                                            <motion.div
                                                animate={{ y: [0, 10, 0] }}
                                                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
                                                className="absolute bottom-0 left-0 bg-gradient-to-br from-purple-500/10 to-violet-600/10 backdrop-blur-xl border border-purple-500/20 rounded-3xl p-6 shadow-2xl shadow-purple-500/10"
                                            >
                                                <div className="flex items-center gap-4 mb-3">
                                                    <div className="w-12 h-12 rounded-2xl bg-purple-500/20 flex items-center justify-center">
                                                        <Activity size={24} className="text-purple-400" />
                                                    </div>
                                                    <div>
                                                        <div className="text-xs text-gray-400 uppercase tracking-wider">Örnek Funding Uyarısı</div>
                                                        <div className="text-lg font-bold text-white">ETH Perp</div>
                                                    </div>
                                                </div>
                                                <div className="text-3xl font-bold text-purple-400 font-mono">-0.045%</div>
                                                <div className="text-xs text-gray-500 mt-2">Temsili veri</div>
                                            </motion.div>

                                            {/* Center Glow */}
                                            <div className="w-96 h-96 bg-gradient-to-br from-purple-600/20 to-amber-600/20 rounded-full blur-3xl" />
                                        </div>
                                    </motion.div>
                                </div>
                            </div>
                        </section>

                        {/* Features Grid - Bespoke Cards */}
                        <section id="features" className="py-32 relative">
                            <div className="container mx-auto px-6 lg:px-12">
                                <motion.div
                                    initial={{ opacity: 0, y: 20 }}
                                    whileInView={{ opacity: 1, y: 0 }}
                                    viewport={{ once: true }}
                                    className="text-center mb-20"
                                >
                                    <h2 className="text-5xl lg:text-6xl font-bold mb-6">
                                        {t.builtFor} <span className="bg-gradient-to-r from-purple-400 to-amber-400 bg-clip-text text-transparent">{t.professionals}</span>
                                    </h2>
                                    <p className="text-xl text-gray-400 max-w-2xl mx-auto">
                                        {t.featuresDesc}
                                    </p>
                                </motion.div>

                                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {features.map((feature, idx) => (
                                        <motion.div
                                            key={idx}
                                            initial={{ opacity: 0, y: 30 }}
                                            whileInView={{ opacity: 1, y: 0 }}
                                            viewport={{ once: true }}
                                            transition={{ delay: idx * 0.1 }}
                                            className="group relative"
                                        >
                                            <div className="relative h-full p-8 rounded-3xl bg-white/[0.02] border border-white/10 hover:bg-white/[0.04] transition-all duration-500 hover:-translate-y-2">
                                                {/* Gradient accent */}
                                                <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${feature.gradient} rounded-t-3xl opacity-0 group-hover:opacity-100 transition-opacity`} />

                                                <div className={`mb-6 p-4 rounded-2xl bg-gradient-to-br ${feature.gradient} bg-opacity-10 w-fit group-hover:scale-110 transition-transform`}>
                                                    <div className="text-white">
                                                        {feature.icon}
                                                    </div>
                                                </div>

                                                <h3 className="text-2xl font-bold mb-4 text-white">
                                                    {feature.title}
                                                </h3>

                                                <p className="text-gray-400 leading-relaxed">
                                                    {feature.description}
                                                </p>
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            </div>
                        </section>

                        {/* CTA Section - Bold & Simple */}
                        <section className="py-32 relative overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-b from-purple-900/10 via-transparent to-black pointer-events-none" />

                            <div className="container mx-auto px-6 lg:px-12 relative z-10 text-center">
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    whileInView={{ opacity: 1, scale: 1 }}
                                    viewport={{ once: true }}
                                >
                                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/20 mb-8">
                                        <Sparkles size={16} className="text-purple-400" />
                                        <span className="text-sm font-medium text-purple-300">Yetkili kullanıcılar için</span>
                                    </div>

                                    <h2 className="text-6xl lg:text-7xl font-bold mb-8 leading-tight">
                                        {t.readyToDominate}<br />
                                        <span className="bg-gradient-to-r from-purple-400 via-violet-400 to-amber-400 bg-clip-text text-transparent">
                                            {t.theMarkets}
                                        </span>
                                    </h2>

                                    <p className="text-xl text-gray-400 mb-12 max-w-2xl mx-auto">
                                        {t.experienceIntelligence}
                                    </p>

                                    <button
                                        onClick={handleLogin}
                                        className="px-12 py-5 bg-gradient-to-r from-purple-600 to-violet-600 text-white rounded-2xl font-bold text-xl hover:from-purple-500 hover:to-violet-500 transition-all shadow-2xl shadow-purple-500/30 hover:shadow-purple-500/50 inline-flex items-center gap-3 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-black"
                                    >
                                        <span>{t.enterSystem}</span>
                                        <ArrowRight size={24} />
                                    </button>
                                </motion.div>
                            </div>
                        </section>

                        {/* Footer - Minimal */}
                        <footer className="py-16 border-t border-white/5 bg-black">
                            <div className="container mx-auto px-6 lg:px-12">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-12">
                                    <div>
                                        <div className="flex items-center gap-2 mb-6">
                                            <span className="font-black text-2xl uppercase tracking-wider text-white">FIDELIO</span>
                                        </div>
                                        <p className="text-gray-500 text-sm leading-relaxed">
                                            {t.featSignalDesc}
                                        </p>
                                    </div>

                                    <div>
                                        <h4 className="font-bold mb-4 text-white">{t.platform}</h4>
                                        <ul className="space-y-3 text-sm text-gray-500">
                                            <li><a href="#features" className="hover:text-white transition-colors focus:outline-none focus:text-white">{t.exploreFeatures}</a></li>
                                        </ul>
                                    </div>

                                    <div>
                                        <h4 className="font-bold mb-4 text-white">{t.legal}</h4>
                                        <p className="text-sm text-gray-500 leading-relaxed">
                                            Risk bildirimi: Fidelio bir piyasa analiz aracıdır. Sunulan veriler, sinyaller ve yapay zeka yorumları yatırım tavsiyesi değildir; kripto varlık işlemleri yüksek risk içerir ve sermaye kaybına yol açabilir.
                                        </p>
                                    </div>
                                </div>

                                <div className="border-t border-white/5 pt-8 text-center">
                                    <p className="text-gray-600 text-sm">
                                        © 2026 FidelioAI. {t.allRightsReserved}
                                    </p>
                                </div>
                            </div>
                        </footer>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
};
