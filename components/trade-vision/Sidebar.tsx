import React from 'react';
import { LayoutDashboard, Calendar, BarChart2, BookOpen, Settings } from 'lucide-react';
import { cn } from '@/utils/cn';

interface SidebarProps {
  activeView: 'dashboard' | 'calendar' | 'analytics' | 'journal';
  onViewChange: (view: 'dashboard' | 'calendar' | 'analytics' | 'journal') => void;
}

const focusRing = 'focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-primary';

const Sidebar: React.FC<SidebarProps> = ({ activeView, onViewChange }) => {
  const icons = [
    { id: 'dashboard', icon: <LayoutDashboard size={14} />, label: 'Overview' },
    { id: 'calendar', icon: <Calendar size={14} />, label: 'History' },
    { id: 'analytics', icon: <BarChart2 size={14} />, label: 'Analytics' },
    { id: 'journal', icon: <BookOpen size={14} />, label: 'Journal' },
  ];

  // Below lg: a thin horizontal tab strip. From lg: a w-44 nav panel with text rows.
  return (
    <nav className="flex h-8 shrink-0 items-stretch bg-surface lg:h-full lg:w-44 lg:flex-col">
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto scrollbar-hide lg:flex-col lg:overflow-visible">
        {icons.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={activeView === item.id ? 'page' : undefined}
            onClick={() => onViewChange(item.id as any)}
            className={cn(
              'flex min-w-0 flex-1 items-center justify-center gap-2 px-1 text-[11px] font-medium uppercase tracking-wider transition-colors sm:flex-none sm:shrink-0 sm:justify-start sm:px-3 lg:h-8 lg:w-full lg:text-xs lg:normal-case lg:tracking-normal',
              focusRing,
              activeView === item.id
                ? 'bg-surface-highlight text-text shadow-[inset_0_-2px_0_var(--color-brand)] lg:shadow-[inset_2px_0_0_var(--color-brand)]'
                : 'text-secondary hover:bg-surface-secondary hover:text-text'
            )}
          >
            <span className="hidden shrink-0 sm:inline-flex">{item.icon}</span>
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        aria-label="Settings"
        className={cn(
          'flex w-8 shrink-0 items-center justify-center border-l border-border text-secondary transition-colors hover:bg-surface-secondary hover:text-text lg:h-8 lg:w-full lg:justify-start lg:border-l-0 lg:border-t lg:px-3',
          focusRing
        )}
      >
        <Settings size={14} />
      </button>
    </nav>
  );
};

export default Sidebar;
