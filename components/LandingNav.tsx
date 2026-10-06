import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Menu, X, ChevronRight } from 'lucide-react';

interface LandingNavProps {
    onLogin: () => void;
    logoLayoutId?: string;
}

export const LandingNav: React.FC<LandingNavProps> = ({ onLogin, logoLayoutId }) => {
    const [scrolled, setScrolled] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const handleScroll = () => setScrolled(window.scrollY > 20);
        handleScroll();
        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    return (
        <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'bg-black/80 backdrop-blur-md border-b border-white/10 py-4' : 'bg-transparent py-6'
            }`}>
            <div className="container mx-auto px-6 flex items-center justify-between">
                {/* Logo */}
                <div className="flex items-center gap-2 group cursor-pointer">
                    {logoLayoutId ? (
                        <motion.span
                            layoutId={logoLayoutId}
                            className="font-display font-black text-3xl bg-gradient-to-r from-purple-600 via-violet-500 to-amber-500 bg-clip-text text-transparent tracking-wider uppercase drop-shadow-[0_0_25px_rgba(168,85,247,0.4)] animate-gradient-x"
                        >
                            FIDELIO
                        </motion.span>
                    ) : (
                        <span className="font-display font-black text-3xl bg-gradient-to-r from-purple-600 via-violet-500 to-amber-500 bg-clip-text text-transparent tracking-wider uppercase drop-shadow-[0_0_25px_rgba(168,85,247,0.4)] animate-gradient-x">
                            FIDELIO
                        </span>
                    )}
                </div>

                {/* Desktop Links */}
                <div className="hidden md:flex items-center gap-8">
                    <a href="#features" className="text-sm font-medium text-gray-300 hover:text-white transition-colors">Özellikler</a>
                </div>

                {/* Auth Buttons */}
                <div className="hidden md:flex items-center gap-4">
                    <button
                        onClick={onLogin}
                        className="group flex items-center gap-2 px-5 py-2.5 bg-white text-black rounded-full text-sm font-bold hover:bg-gray-200 transition-all transform hover:scale-105"
                    >
                        Giriş Yap
                        <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" />
                    </button>
                </div>

                {/* Mobile Menu Button */}
                <button
                    className="md:hidden p-2 text-gray-300"
                    onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                    aria-label={mobileMenuOpen ? 'Menüyü kapat' : 'Menüyü aç'}
                    aria-expanded={mobileMenuOpen}
                >
                    {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
                </button>
            </div>

            {/* Mobile Menu */}
            {mobileMenuOpen && (
                <div className="absolute top-full left-0 right-0 bg-black/95 backdrop-blur-xl border-b border-white/10 p-6 md:hidden flex flex-col gap-4">
                    <a href="#features" className="text-lg font-medium text-gray-300" onClick={() => setMobileMenuOpen(false)}>Özellikler</a>
                    <div className="h-px bg-white/10 my-2"></div>
                    <button
                        onClick={() => { onLogin(); setMobileMenuOpen(false); }}
                        className="flex items-center justify-center gap-2 px-5 py-3 bg-white text-black rounded-full text-sm font-bold hover:bg-gray-200"
                    >
                        Giriş Yap
                    </button>
                </div>
            )}
        </nav>
    );
};
