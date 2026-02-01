/**
 * FidelioAI Design System - Color Tokens
 * Complete color palette with semantic meanings and theme variations
 */

// ============================================
// BRAND COLORS - Core Identity
// ============================================

export const brand = {
    // Primary: Refined Purple-Violet spectrum
    violet: {
        50: '#FAF5FF',
        100: '#F3E8FF',
        200: '#E9D5FF',
        300: '#D8B4FE',
        400: '#C084FC',
        500: '#A855F7',
        600: '#9333EA',  // Main brand color
        700: '#7E22CE',
        800: '#6B21A8',
        900: '#581C87',
    },

    // Accent: Sophisticated Gold-Amber
    gold: {
        50: '#FFFBEB',
        100: '#FEF3C7',
        200: '#FDE68A',
        300: '#FCD34D',
        400: '#FBBF24',
        500: '#F59E0B',
        600: '#D97706',  // Main accent
        700: '#B45309',
        800: '#92400E',
        900: '#78350F',
    }
} as const;

// ============================================
// SEMANTIC COLORS - Meaning-based
// ============================================

export const semantic = {
    // Success: Teal-Emerald blend
    success: {
        light: '#6EE7B7',
        main: '#10B981',
        dark: '#059669',
        darker: '#047857',
        glow: 'rgba(16, 185, 129, 0.15)',
    },

    // Danger: Refined Rose-Red
    danger: {
        light: '#FCA5A5',
        main: '#EF4444',
        dark: '#DC2626',
        darker: '#B91C1C',
        glow: 'rgba(239, 68, 68, 0.15)',
    },

    // Warning: Warm Amber-Orange
    warning: {
        light: '#FCD34D',
        main: '#F59E0B',
        dark: '#D97706',
        darker: '#B45309',
        glow: 'rgba(245, 158, 11, 0.15)',
    },

    // Info: Sky-Cyan blend
    info: {
        light: '#7DD3FC',
        main: '#0EA5E9',
        dark: '#0284C7',
        darker: '#0369A1',
        glow: 'rgba(14, 165, 233, 0.15)',
    }
} as const;

// ============================================
// GRADIENTS - Bespoke Combinations
// ============================================

export const gradients = {
    // Hero & Primary
    hero: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    heroSubtle: 'linear-gradient(135deg, rgba(102, 126, 234, 0.08) 0%, rgba(118, 75, 162, 0.08) 100%)',

    // Brand gradients
    violet: 'linear-gradient(135deg, #9333EA 0%, #7E22CE 100%)',
    violetSubtle: 'linear-gradient(135deg, rgba(147, 51, 234, 0.1) 0%, rgba(126, 34, 206, 0.1) 100%)',

    // Feature-specific
    ai: 'linear-gradient(135deg, #A855F7 0%, #EC4899 100%)',
    aiGlow: 'linear-gradient(135deg, rgba(168, 85, 247, 0.2) 0%, rgba(236, 72, 153, 0.2) 100%)',

    derivatives: 'linear-gradient(135deg, #F59E0B 0%, #EF4444 100%)',
    derivativesGlow: 'linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, rgba(239, 68, 68, 0.2) 100%)',

    market: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
    marketGlow: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(5, 150, 105, 0.2) 100%)',

    // Glass effects
    glassLight: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 100%)',
    glassDark: 'linear-gradient(135deg, rgba(0, 0, 0, 0.2) 0%, rgba(0, 0, 0, 0.1) 100%)',

    // Ambient backgrounds
    ambientViolet: 'radial-gradient(circle at 50% 0%, rgba(147, 51, 234, 0.12) 0%, transparent 50%)',
    ambientGold: 'radial-gradient(circle at 100% 100%, rgba(217, 119, 6, 0.08) 0%, transparent 50%)',
    ambientEmerald: 'radial-gradient(circle at 0% 50%, rgba(16, 185, 129, 0.08) 0%, transparent 50%)',
} as const;

// ============================================
// THEME PALETTES
// ============================================

export const themes = {
    dark: {
        background: {
            primary: '#0A0E14',
            secondary: '#161A23',
            tertiary: '#1E2329',
            elevated: '#252A33',
        },
        text: {
            primary: '#F7FAFC',
            secondary: '#A0AEC0',
            tertiary: '#718096',
            muted: '#4A5568',
        },
        border: {
            subtle: 'rgba(255, 255, 255, 0.06)',
            default: 'rgba(255, 255, 255, 0.08)',
            strong: 'rgba(255, 255, 255, 0.12)',
        },
        overlay: {
            light: 'rgba(0, 0, 0, 0.4)',
            medium: 'rgba(0, 0, 0, 0.6)',
            heavy: 'rgba(0, 0, 0, 0.8)',
        }
    },

    corporate: {
        background: {
            primary: '#FAFBFC',
            secondary: '#F7F9FA',
            tertiary: '#EDF2F7',
            elevated: '#FFFFFF',
        },
        text: {
            primary: '#1A202C',
            secondary: '#4A5568',
            tertiary: '#718096',
            muted: '#A0AEC0',
        },
        border: {
            subtle: 'rgba(0, 0, 0, 0.04)',
            default: 'rgba(0, 0, 0, 0.08)',
            strong: 'rgba(0, 0, 0, 0.12)',
        },
        accent: '#6366F1', // Indigo
    },

    labs: {
        background: {
            primary: '#FFFFFF',
            secondary: '#F9FAFB',
            tertiary: '#F3F4F6',
            elevated: '#FFFFFF',
        },
        text: {
            primary: '#111827',
            secondary: '#6B7280',
            tertiary: '#9CA3AF',
            muted: '#D1D5DB',
        },
        border: {
            subtle: 'rgba(0, 0, 0, 0.03)',
            default: 'rgba(0, 0, 0, 0.06)',
            strong: 'rgba(0, 0, 0, 0.10)',
        },
        accent: '#4F46E5', // Google-style indigo
    }
} as const;

// ============================================
// UTILITY FUNCTIONS
// ============================================

export const withOpacity = (color: string, opacity: number): string => {
    return `${color}${Math.round(opacity * 255).toString(16).padStart(2, '0')}`;
};

export const getGradientWithOpacity = (gradient: string, opacity: number): string => {
    return gradient.replace(/rgba?\([^)]+\)/g, (match) => {
        return match.replace(/[\d.]+\)$/, `${opacity})`);
    });
};

// ============================================
// COMPONENT-SPECIFIC COLORS
// ============================================

export const components = {
    button: {
        primary: {
            bg: gradients.violet,
            hover: 'linear-gradient(135deg, #7E22CE 0%, #6B21A8 100%)',
            shadow: 'rgba(147, 51, 234, 0.3)',
        },
        secondary: {
            bg: 'rgba(147, 51, 234, 0.1)',
            hover: 'rgba(147, 51, 234, 0.15)',
            border: 'rgba(147, 51, 234, 0.3)',
        }
    },

    card: {
        dark: {
            bg: 'rgba(255, 255, 255, 0.02)',
            border: 'rgba(255, 255, 255, 0.08)',
            hover: 'rgba(255, 255, 255, 0.04)',
        },
        light: {
            bg: '#FFFFFF',
            border: 'rgba(0, 0, 0, 0.08)',
            hover: 'rgba(0, 0, 0, 0.02)',
        }
    },

    badge: {
        violet: {
            bg: 'rgba(147, 51, 234, 0.1)',
            text: '#C084FC',
            border: 'rgba(147, 51, 234, 0.3)',
        },
        gold: {
            bg: 'rgba(217, 119, 6, 0.1)',
            text: '#FBBF24',
            border: 'rgba(217, 119, 6, 0.3)',
        },
        emerald: {
            bg: 'rgba(16, 185, 129, 0.1)',
            text: '#6EE7B7',
            border: 'rgba(16, 185, 129, 0.3)',
        },
        rose: {
            bg: 'rgba(239, 68, 68, 0.1)',
            text: '#FCA5A5',
            border: 'rgba(239, 68, 68, 0.3)',
        }
    }
} as const;

// ============================================
// EXPORT ALL
// ============================================

export const colors = {
    brand,
    semantic,
    gradients,
    themes,
    components,
    withOpacity,
    getGradientWithOpacity,
} as const;

export default colors;
