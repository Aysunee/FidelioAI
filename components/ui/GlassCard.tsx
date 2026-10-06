import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children: React.ReactNode;
  hoverEffect?: boolean;
}

// Flat terminal panel. The name is historical: there is no glass, blur, shadow or animation any more
// (it is a plain div). Colours come from the theme tokens, so it needs no theme checks.
export const GlassCard: React.FC<GlassCardProps> = ({ className, children, hoverEffect = false, ...props }) => {
  return (
    <div
      className={cn(
        "relative overflow-hidden bg-surface text-text border border-border",
        hoverEffect && "transition-colors hover:bg-surface-secondary",
        className
      )}
      {...props}
    >
      <div className="relative h-full">
        {children}
      </div>
    </div>
  );
};
