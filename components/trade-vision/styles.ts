// Shared class vocabulary of the journal workspace (Fidelio Terminal design system).
// Only theme tokens are used, so every theme renders correctly without branching.

const focusRing = 'focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary';

// Panels
export const panel = 'flex min-h-0 flex-col bg-surface';
export const panelHeader = 'flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-3';
export const panelTitle = 'text-[11px] font-semibold uppercase tracking-wider text-secondary';
export const fieldLabel = 'text-[10px] font-medium uppercase tracking-wider text-muted';
export const emptyLine = 'flex h-full min-h-[64px] items-center justify-center gap-1.5 px-3 text-center text-xs text-muted';

// Buttons
const btnBase = `inline-flex h-7 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
export const btnPrimary = `${btnBase} bg-primary text-primary-contrast hover:opacity-90`;
export const btnDefault = `${btnBase} border border-border bg-surface-secondary text-text hover:bg-surface-highlight`;
export const btnGhost = `${btnBase} text-secondary hover:bg-surface-secondary hover:text-text`;
export const btnDanger = `${btnBase} bg-danger-soft text-danger hover:opacity-80`;
/** Compact size for buttons that sit inside an h-8 panel header / toolbar. */
export const btnCompact = 'h-6 px-2 text-[11px]';
export const iconBtn = `grid h-7 w-7 shrink-0 place-items-center rounded-sm text-secondary transition-colors hover:bg-surface-secondary hover:text-text ${focusRing}`;

// Form controls
export const inputBase = 'h-7 w-full min-w-0 rounded-sm border border-border bg-surface-secondary px-2 text-xs text-text placeholder:text-muted outline-none focus:border-primary disabled:opacity-40';
export const segWrap = 'flex rounded-sm border border-border p-0.5';
export const segItem = `h-6 min-w-0 flex-1 rounded-sm px-2 text-[11px] font-medium transition-colors ${focusRing}`;
export const segIdle = 'text-secondary hover:text-text';

// Badges
export const badge = 'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-3';
export const badgeSuccess = 'bg-success-soft text-success';
export const badgeDanger = 'bg-danger-soft text-danger';
export const badgeNeutral = 'bg-surface-secondary text-secondary';
export const badgeAccent = 'bg-primary-soft text-primary';
export const badgeInfo = 'bg-info-soft text-info';
export const badgeWarning = 'bg-warning-soft text-warning';

// Floating layers (menus, chart tooltips)
export const menuSurface = 'rounded-sm border border-border-strong bg-surface shadow-overlay';

// Recharts takes plain SVG attribute values; CSS variables keep the charts in sync with the active theme.
export const chartColors = {
    grid: 'var(--color-border)',
    axis: 'var(--color-text-muted)',
    cursor: 'var(--bg-surface-secondary)',
    cursorLine: 'var(--color-border-strong)',
    brand: 'var(--color-brand)',
    success: 'var(--color-success)',
    danger: 'var(--color-danger)',
    track: 'var(--bg-surface-highlight)',
} as const;
