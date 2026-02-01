
import React from 'react';
import { LayoutDashboard, Calendar, BarChart2, MessageSquare, BookOpen, Settings, LogOut } from 'lucide-react';

interface SidebarProps {
  activeView: 'dashboard' | 'calendar' | 'analytics' | 'journal';
  onViewChange: (view: 'dashboard' | 'calendar' | 'analytics' | 'journal') => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeView, onViewChange }) => {
  const icons = [
    { id: 'dashboard', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
    { id: 'calendar', icon: <Calendar size={20} />, label: 'Calendar' },
    { id: 'analytics', icon: <BarChart2 size={20} />, label: 'Analytics' },
    { id: 'journal', icon: <BookOpen size={20} />, label: 'Journal' },
    { id: 'community', icon: <MessageSquare size={20} />, label: 'Community' },
  ];

  const bottomIcons = [
    { icon: <Settings size={20} /> },
    { icon: <LogOut size={20} /> },
  ];

  return (
    <div className="w-16 h-full bg-[#11141f] border-r border-gray-800 flex flex-col items-center py-6 gap-8 z-50">
      <div className="text-cyan-400 mb-4">
        <div className="w-8 h-8 bg-gradient-to-br from-cyan-400 to-purple-600 rounded-lg flex items-center justify-center font-bold text-white shadow-lg shadow-cyan-900/20 cursor-pointer hover:scale-105 transition-transform">T</div>
      </div>

      <div className="flex flex-col gap-6 flex-1 w-full px-2">
        {icons.map((item) => (
          <button
            key={item.id}
            onClick={() => onViewChange(item.id as any)}
            className={`p-2.5 rounded-xl transition-all w-full flex justify-center group relative ${activeView === item.id
                ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
              }`}
          >
            {item.icon}

            {/* Tooltip */}
            <div className="absolute left-full ml-4 top-1/2 -translate-y-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap border border-white/10 z-50 shadow-xl">
              {item.label}
            </div>

            {activeView === item.id && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-cyan-500 rounded-r-full shadow-[0_0_10px_rgba(6,182,212,0.5)]"></div>
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-6">
        {bottomIcons.map((item, idx) => (
          <button key={idx} className="text-gray-500 hover:text-gray-300 transition-colors p-2 hover:bg-white/5 rounded-lg">
            {item.icon}
          </button>
        ))}
      </div>
    </div>
  );
};

export default Sidebar;
