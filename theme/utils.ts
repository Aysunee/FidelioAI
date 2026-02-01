/**
 * FidelioAI Design System - Theme Utilities
 * Helper functions and hooks for theme-aware styling
 */

import { useMemo } from 'react';
import { useUser } from '../context/UserContext';
import { colors } from './colors';

export type Theme = 'dark' | 'corporate' | 'labs';

// ============================================
// THEME CLASS GENERATORS
// ============================================

export const useThemeClasses = () => {
    const { theme } = useUser();
    const isLight = theme === 'corporate' || theme === 'labs';

    return useMemo(() => ({
        // Card styles
        card: {
            base: isLight
                ? 'bg-white border border-gray-200 shadow-sm'
                : 'bg-white/[0.02] border border-white/[0.08] backdrop-blur-xl',
            hover: isLight ? 'hover:bg-gray-50' : 'hover:bg-white/[0.04]',
            elevated: isLight
                ? 'bg-white border border-gray-200 shadow-lg'
                : 'bg-white/[0.03] border border-white/10 backdrop-blur-xl shadow-2xl shadow-black/20',
        },

        // Text colors
        text: {
            primary: isLight ? 'text-gray-900' : 'text-gray-100',
            secondary: isLight ? 'text-gray-600' : 'text-gray-400',
            tertiary: isLight ? 'text-gray-500' : 'text-gray-500',
            muted: isLight ? 'text-gray-400' : 'text-gray-600',
        },

        // Background colors
        bg: {
            primary: isLight
                ? theme === 'labs' ? 'bg-white' : 'bg-[#FAFBFC]'
                : 'bg-[#0A0E14]',
            secondary: isLight
                ? theme === 'labs' ? 'bg-gray-50' : 'bg-[#F7F9FA]'
                : 'bg-[#161A23]',
            tertiary: isLight ? 'bg-gray-100' : 'bg-[#1E2329]',
        },

        // Border colors
        border: {
            subtle: isLight ? 'border-gray-100' : 'border-white/[0.06]',
            default: isLight ? 'border-gray-200' : 'border-white/[0.08]',
            strong: isLight ? 'border-gray-300' : 'border-white/[0.12]',
        },

        // Brand colors (theme-aware)
        brand: {
            primary: isLight
                ? theme === 'labs' ? 'text-indigo-600' : 'text-violet-700'
                : 'text-violet-400',
            bg: isLight
                ? theme === 'labs' ? 'bg-indigo-100' : 'bg-violet-100'
                : 'bg-violet-500/10',
            border: isLight
                ? theme === 'labs' ? 'border-indigo-300' : 'border-violet-300'
                : 'border-violet-500/30',
        },

        // Semantic colors
        success: {
            text: isLight ? 'text-emerald-700' : 'text-emerald-400',
            bg: isLight ? 'bg-emerald-100' : 'bg-emerald-500/10',
            border: isLight ? 'border-emerald-300' : 'border-emerald-500/30',
        },
        danger: {
            text: isLight ? 'text-red-700' : 'text-red-400',
            bg: isLight ? 'bg-red-100' : 'bg-red-500/10',
            border: isLight ? 'border-red-300' : 'border-red-500/30',
        },
        warning: {
            text: isLight ? 'text-amber-700' : 'text-amber-400',
            bg: isLight ? 'bg-amber-100' : 'bg-amber-500/10',
            border: isLight ? 'border-amber-300' : 'border-amber-500/30',
        },
        info: {
            text: isLight ? 'text-sky-700' : 'text-sky-400',
            bg: isLight ? 'bg-sky-100' : 'bg-sky-500/10',
            border: isLight ? 'border-sky-300' : 'border-sky-500/30',
        },

        // Button styles
        button: {
            primary: isLight
                ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-700 hover:to-purple-700 shadow-lg shadow-violet-500/30'
                : 'bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-500 hover:to-purple-500 shadow-lg shadow-violet-500/30',
            secondary: isLight
                ? 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-violet-300'
                : 'bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 hover:border-violet-500/30',
            ghost: isLight
                ? 'text-gray-700 hover:bg-gray-100'
                : 'text-gray-300 hover:bg-white/5',
        },

        // Input styles
        input: {
            base: isLight
                ? 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-violet-500 focus:ring-violet-500/20'
                : 'bg-black/40 border-white/10 text-white placeholder:text-gray-600 focus:border-violet-500/50 focus:ring-violet-500/20',
        },

        // Badge styles
        badge: {
            violet: isLight
                ? 'bg-violet-100 text-violet-700 border-violet-200'
                : 'bg-violet-500/10 text-violet-400 border-violet-500/30',
            gold: isLight
                ? 'bg-amber-100 text-amber-700 border-amber-200'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/30',
            emerald: isLight
                ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
        },

        // Icon backgrounds
        iconBg: {
            violet: isLight ? 'bg-violet-100' : 'bg-gradient-to-br from-violet-500/20 to-purple-500/20',
            gold: isLight ? 'bg-amber-100' : 'bg-gradient-to-br from-amber-500/20 to-orange-500/20',
            emerald: isLight ? 'bg-emerald-100' : 'bg-gradient-to-br from-emerald-500/20 to-teal-500/20',
            sky: isLight ? 'bg-sky-100' : 'bg-gradient-to-br from-sky-500/20 to-cyan-500/20',
        },

        // Icon colors
        icon: {
            violet: isLight ? 'text-violet-600' : 'text-violet-400',
            gold: isLight ? 'text-amber-600' : 'text-amber-400',
            emerald: isLight ? 'text-emerald-600' : 'text-emerald-400',
            sky: isLight ? 'text-sky-600' : 'text-sky-400',
        },
    }), [theme, isLight]);
};

// ============================================
// GRADIENT UTILITIES
// ============================================

export const useGradients = () => {
    const { theme } = useUser();
    const isLight = theme === 'corporate' || theme === 'labs';

    return useMemo(() => ({
        // Primary gradients
        primary: 'bg-gradient-to-r from-violet-600 to-purple-600',
        primaryHover: 'hover:from-violet-700 hover:to-purple-700',
        primaryGlow: 'shadow-lg shadow-violet-500/30',

        // Feature-specific
        ai: 'bg-gradient-to-r from-violet-500 to-pink-500',
        aiGlow: 'shadow-lg shadow-violet-500/20',

        derivatives: 'bg-gradient-to-r from-amber-500 to-orange-500',
        derivativesGlow: 'shadow-lg shadow-amber-500/20',

        market: 'bg-gradient-to-r from-emerald-500 to-teal-500',
        marketGlow: 'shadow-lg shadow-emerald-500/20',

        // Subtle backgrounds
        violetSubtle: isLight
            ? 'bg-gradient-to-br from-violet-50 to-purple-50'
            : 'bg-gradient-to-br from-violet-500/5 to-purple-500/5',

        goldSubtle: isLight
            ? 'bg-gradient-to-br from-amber-50 to-orange-50'
            : 'bg-gradient-to-br from-amber-500/5 to-orange-500/5',
    }), [theme, isLight]);
};

// ============================================
// SHADOW UTILITIES
// ============================================

export const useShadows = () => {
    const { theme } = useUser();
    const isLight = theme === 'corporate' || theme === 'labs';

    return useMemo(() => ({
        sm: isLight ? 'shadow-sm' : 'shadow-sm shadow-black/20',
        md: isLight ? 'shadow-md' : 'shadow-md shadow-black/30',
        lg: isLight ? 'shadow-lg' : 'shadow-lg shadow-black/40',
        xl: isLight ? 'shadow-xl' : 'shadow-xl shadow-black/50',

        // Colored shadows
        violet: 'shadow-lg shadow-violet-500/30',
        gold: 'shadow-lg shadow-amber-500/30',
        emerald: 'shadow-lg shadow-emerald-500/30',

        // Glow effects
        glow: isLight
            ? 'shadow-[0_0_20px_rgba(147,51,234,0.2)]'
            : 'shadow-[0_0_30px_rgba(147,51,234,0.3)]',
    }), [theme, isLight]);
};

// ============================================
// ANIMATION UTILITIES
// ============================================

export const animations = {
    fadeIn: {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
    },

    slideUp: {
        initial: { opacity: 0, y: 20 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: 20 },
    },

    slideDown: {
        initial: { opacity: 0, y: -20 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -20 },
    },

    scaleIn: {
        initial: { opacity: 0, scale: 0.95 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.95 },
    },

    staggerChildren: {
        animate: {
            transition: {
                staggerChildren: 0.05,
            },
        },
    },
} as const;

// ============================================
// EXPORT ALL
// ============================================

export const theme = {
    useThemeClasses,
    useGradients,
    useShadows,
    animations,
    colors,
} as const;

export default theme;
