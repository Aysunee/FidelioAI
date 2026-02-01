import React from 'react';
import { LayoutDashboard, Calendar, BarChart2, BookOpen, MessageSquare, Settings, LogOut } from 'lucide-react';
import { cn } from '@/utils/cn';

interface SidebarProps {
  activeView: 'dashboard' | 'calendar' | 'analytics' | 'journal';
  onViewChange: (view: 'dashboard' | 'calendar' | 'analytics' | 'journal') => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeView, onViewChange }) => {
  const icons = [
    { id: 'dashboard', icon: <LayoutDashboard size={18} />, label: 'Overview' },
    { id: 'calendar', icon: <Calendar size={18} />, label: 'History' },
    { id: 'analytics', icon: <BarChart2 size={18} />, label: 'Analytics' },
    { id: 'journal', icon: <BookOpen size={18} />, label: 'Journal' },
  ];

  return (
    <div className="w-16 h-full bg-white/[0.02] border-r border-white/5 flex flex-col items-center py-6 gap-8 z-20 backdrop-blur-xl">
      <div className="flex flex-col gap-4 flex-1 w-full px-2">
        {icons.map((item) => (
          <button
            key={item.id}
            onClick={() => onViewChange(item.id as any)}
            className={cn(
              "p-3 rounded-xl transition-all duration-500 w-full flex justify-center group relative",
              activeView === item.id
                ? 'bg-gradient-to-br from-purple-500/20 to-indigo-500/20 text-purple-400 border border-purple-500/20 shadow-lg shadow-purple-500/5'
                : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
            )}
          >
            {item.icon}

            {/* Tooltip */}
            <div className="absolute left-full ml-4 top-1/2 -translate-y-1/2 bg-gray-950/90 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-300 whitespace-nowrap border border-white/5 z-50 shadow-2xl backdrop-blur-xl translate-x-[-10px] group-hover:translate-x-0">
              {item.label}
            </div>

            {activeView === item.id && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-purple-500 rounded-r-full shadow-[0_0_15px_rgba(168,85,247,0.5)]"></div>
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4 border-t border-white/5 pt-6 w-full px-2">
        <button className="text-gray-600 hover:text-gray-400 transition-colors p-3 hover:bg-white/5 rounded-xl flex justify-center">
          <Settings size={18} />
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
