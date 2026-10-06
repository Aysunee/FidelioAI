import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  action?: React.ReactNode;
  noPadding?: boolean;
}

// Flat terminal panel with an optional thin header bar.
export const Card: React.FC<CardProps> = ({ children, className = '', title, action, noPadding = false }) => {
  return (
    <div className={`bg-surface border border-border flex flex-col overflow-hidden relative ${className}`}>
      {(title || action) && (
        <div className="h-8 px-3 flex justify-between items-center gap-2 border-b border-border shrink-0">
          {title && (
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-secondary">
              {title}
            </h3>
          )}
          {action && <div>{action}</div>}
        </div>
      )}
      <div className={`flex-1 min-h-0 overflow-auto relative ${noPadding ? '' : 'p-0'}`}>
        {children}
      </div>
    </div>
  );
};
