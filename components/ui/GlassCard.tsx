import React from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface GlassCardProps extends HTMLMotionProps<"div"> {
  className?: string;
  children: React.ReactNode;
  hoverEffect?: boolean;
}

export const GlassCard: React.FC<GlassCardProps> = ({ className, children, hoverEffect = false, ...props }) => {
  // We need to access the theme, but importing useUser here might cause circular dependencies if not careful.
  // Instead, let's use CSS variables or a class based approach if possible.
  // But since we are using Tailwind classes directly, we might need to check the theme class on document body or pass it as prop.
  // A safer way without context here is to use the 'corporate' class selector strategy in CSS or just use CSS variables.
  // However, for immediate fix, let's use the context as it's standard in this app.

  // Actually, let's use CSS variables defined in index.css for background and border to be safe and clean.
  // In index.css:
  // .corporate { --bg-surface: #FFFFFF; --color-border: #D1D5DB; }
  // .dark { --bg-surface: #1E1F24; --color-border: #2E323D; }

  // So we can change the className to use these variables via arbitrary values or standard classes if we mapped them.
  // But since we didn't map them to tailwind config yet, let's try to use the context.

  const [isCorporate, setIsCorporate] = React.useState(false);
  const [isLabs, setIsLabs] = React.useState(false);

  React.useEffect(() => {
    const checkTheme = () => {
      const root = document.documentElement;
      setIsCorporate(root.classList.contains('corporate'));
      setIsLabs(root.classList.contains('labs'));
    };
    checkTheme();
    // Observer for class changes on html element
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      className={cn(
        "relative overflow-hidden transition-all duration-500 backdrop-blur-md",
        isLabs
          ? "rounded-[32px] bg-[var(--bg-surface)] text-[var(--color-text)] border border-[var(--color-border-strong)] shadow-sm hover:shadow-md"
          : "rounded-2xl border shadow-xl",
        !isLabs && (isCorporate
          ? "bg-[var(--bg-surface)] border-[var(--color-border)] shadow-sm text-[var(--color-text)]"
          : "bg-white/5 border-white/10 text-gray-100"),
        hoverEffect && (isLabs ? "hover:translate-y-[-2px] hover:shadow-lg" : isCorporate ? "hover:bg-gray-50" : "hover:bg-white/10"),
        className
      )}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      {...props}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
      <div className="relative z-10 h-full">
        {children}
      </div>
    </motion.div>
  );
};
