import React, { useEffect, useState } from 'react';
import { LayoutDashboard, Menu, Radar, Target, Wallet, X } from 'lucide-react';
import type { ViewMode } from '../context/UserContext';

export interface MobileNavItem {
    mode: ViewMode;
    label: string;
}

interface MobileNavProps {
    currentView: ViewMode;
    setView: (view: ViewMode) => void;
    /** Every view the current user may open (already filtered by role), shown in the menu sheet. */
    menuItems: MobileNavItem[];
}

interface NavItemProps {
    view: ViewMode;
    icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
    label: string;
    isActive: boolean;
    onSelect: (view: ViewMode) => void;
}

const CELL = 'flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-0.5 border-t-2 px-1 transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-primary';
const CELL_ACTIVE = 'border-primary text-text';
const CELL_IDLE = 'border-transparent text-secondary';

// Defined at module scope so it is not re-created (and remounted) on every parent render.
const NavItem: React.FC<NavItemProps> = ({ view, icon: Icon, label, isActive, onSelect }) => (
    <button
        type="button"
        onClick={() => onSelect(view)}
        aria-current={isActive ? 'page' : undefined}
        className={`${CELL} ${isActive ? CELL_ACTIVE : CELL_IDLE}`}
    >
        <Icon size={16} strokeWidth={isActive ? 2.25 : 2} />
        <span className="max-w-full truncate text-[10px] font-medium leading-none">{label}</span>
    </button>
);

// Flat bottom tab bar (below md only). Its height, 3rem + the iPhone home-bar inset, is reserved by the
// app shell (App.tsx root padding), so it never covers the content or the liquidation strip.
export const MobileNav: React.FC<MobileNavProps> = ({ currentView, setView, menuItems }) => {
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    const labelFor = (mode: ViewMode, fallback: string) => menuItems.find(item => item.mode === mode)?.label ?? fallback;

    const select = (view: ViewMode) => {
        setView(view);
        setIsMenuOpen(false);
    };

    useEffect(() => {
        if (!isMenuOpen || typeof window === 'undefined') return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsMenuOpen(false);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isMenuOpen]);

    return (
        <>
            {isMenuOpen && (
                <div className="fixed inset-0 z-[60] md:hidden" role="dialog" aria-modal="true" aria-label="Menü">
                    <div className="absolute inset-0 bg-black/60" onClick={() => setIsMenuOpen(false)} />
                    <div className="absolute bottom-0 left-0 right-0 border-t border-border-strong bg-surface pb-[env(safe-area-inset-bottom)] shadow-overlay">
                        <div className="flex h-9 items-center justify-between border-b border-border pl-3 pr-1">
                            <span lang="tr" className="text-[11px] font-semibold uppercase tracking-wider text-secondary">Menü</span>
                            <button
                                type="button"
                                onClick={() => setIsMenuOpen(false)}
                                aria-label="Menüyü kapat"
                                className="grid h-7 w-7 place-items-center rounded-sm text-secondary transition-colors hover:bg-surface-secondary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                            >
                                <X size={14} />
                            </button>
                        </div>
                        {/* Cells touch; the 1px lines between them are the grid's background. */}
                        <div className="grid max-h-[60vh] grid-cols-3 gap-px overflow-y-auto bg-border">
                            {menuItems.map(item => {
                                const isActive = currentView === item.mode;
                                return (
                                    <button
                                        key={item.mode}
                                        type="button"
                                        onClick={() => select(item.mode)}
                                        aria-current={isActive ? 'page' : undefined}
                                        style={isActive ? { boxShadow: 'inset 2px 0 0 var(--color-brand)' } : undefined}
                                        className={`flex h-11 items-center justify-center px-2 text-center text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-primary ${isActive
                                            ? 'bg-surface-highlight text-text'
                                            : 'bg-surface text-secondary'
                                            }`}
                                    >
                                        <span className="truncate">{item.label}</span>
                                    </button>
                                );
                            })}
                            {/* Fill the last row so no gutter colour shows through. */}
                            {Array.from({ length: (3 - (menuItems.length % 3)) % 3 }, (_, i) => (
                                <div key={`filler-${i}`} className="bg-surface" aria-hidden="true" />
                            ))}
                        </div>
                    </div>
                </div>
            )}

            <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
                <div className="flex h-[calc(3rem-1px)] items-stretch">
                    <NavItem view="dashboard" icon={LayoutDashboard} label={labelFor('dashboard', 'Piyasalar')} isActive={currentView === 'dashboard'} onSelect={select} />
                    <NavItem view="radar" icon={Radar} label={labelFor('radar', 'Radar')} isActive={currentView === 'radar'} onSelect={select} />
                    <button
                        type="button"
                        onClick={() => setIsMenuOpen(open => !open)}
                        aria-label="Tüm menüyü aç"
                        aria-expanded={isMenuOpen}
                        className={`${CELL} ${isMenuOpen ? 'border-transparent text-text' : 'border-transparent text-primary'}`}
                    >
                        <Menu size={16} />
                        <span className="max-w-full truncate text-[10px] font-medium leading-none">Menü</span>
                    </button>
                    <NavItem view="funding" icon={Target} label={labelFor('funding', 'Türev')} isActive={currentView === 'funding'} onSelect={select} />
                    <NavItem view="portfolio" icon={Wallet} label={labelFor('portfolio', 'Portföy')} isActive={currentView === 'portfolio'} onSelect={select} />
                </div>
            </div>
        </>
    );
};
