// Single source of truth for "is this a light UI?".
// Components style themselves with the theme tokens (bg-surface, text-secondary ...) and should not
// need this; it exists for code that must hand concrete colours to a JS library (charts, widgets).
export type ThemeName = 'light' | 'dark' | 'corporate' | 'labs';

export const isLightTheme = (theme: string | null | undefined): boolean => theme !== 'dark';
