import React from 'react';
import { LayoutDashboard, Target, Zap, Wallet, Menu } from 'lucide-react';
import { useThemeClasses } from '../theme/utils';

interface MobileNavProps {
    currentView: string;
    setView: (view: any) => void;
    onMenuClick: () => void;
}

export const MobileNav: React.FC<MobileNavProps> = ({ currentView, setView, onMenuClick }) => {
    const theme = useThemeClasses();

    const NavItem = ({ view, icon: Icon, label }: { view: string, icon: any, label: string }) => {
        const isActive = currentView === view;
        return (
            <button
                onClick={() => setView(view)}
                className={`flex flex-col items-center justify-center w-full py-1 ${isActive ? 'text-violet-500' : theme.text.secondary}`}
            >
                <div className={`p-1.5 rounded-xl transition-all ${isActive ? 'bg-violet-500/10' : 'bg-transparent'}`}>
                    <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                </div>
                <span className={`text-[10px] font-medium mt-0.5 ${isActive ? 'text-violet-500' : theme.text.tertiary}`}>
                    {label}
                </span>
            </button>
        );
    };

    return (
        <div className={`fixed bottom-0 left-0 right-0 z-50 md:hidden pb-safe-area pt-2 px-2 backdrop-blur-xl border-t ${theme.bg.primary} ${theme.border.subtle} shadow-[0_-5px_20px_rgba(0,0,0,0.1)]`}>
            <div className="flex items-center justify-around h-14 mb-1">
                <NavItem view="dashboard" icon={LayoutDashboard} label="Dash" />
                <NavItem view="fidelio-ai" icon={Target} label="Radar" />
                <div onClick={onMenuClick} className="flex flex-col items-center justify-center w-full py-1 cursor-pointer">
                    <div className="p-3 bg-violet-600 rounded-full shadow-[0_0_15px_rgba(124,58,237,0.4)] mb-3 border-4 border-black">
                        <Zap size={20} className="text-white" fill="currentColor" />
                    </div>
                </div>
                <NavItem view="funding" icon={Target} label="Perps" />
                <NavItem view="portfolio" icon={Wallet} label="Wallet" />
            </div>
            {/* Safe area spacer for iPhone home bar */}
            <div className="h-[env(safe-area-inset-bottom)]" />
        </div>
    );
};
