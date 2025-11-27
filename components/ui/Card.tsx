import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  action?: React.ReactNode;
  noPadding?: boolean;
}

export const Card: React.FC<CardProps> = ({ children, className = '', title, action, noPadding = false }) => {
  return (
    <div className={`bg-surface border border-border rounded-card shadow-brand flex flex-col overflow-hidden relative ${className}`}>
      {(title || action) && (
        <div className="px-5 py-3 flex justify-between items-center border-b border-border min-h-[48px]">
          {title && (
            <h3 className="font-sans text-[15px] font-semibold text-text tracking-tight">
              {title}
            </h3>
          )}
          {action && <div>{action}</div>}
        </div>
      )}
      <div className={`flex-1 overflow-auto relative ${noPadding ? '' : 'p-0'}`}>
        {children}
      </div>
    </div>
  );
};