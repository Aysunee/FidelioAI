import React from 'react';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Accessible name (the visible label usually sits next to the switch). */
  label?: string;
}

// Compact on/off switch of the terminal design system (28x16, accent colour when on).
export const Switch: React.FC<SwitchProps> = ({ checked, onChange, disabled = false, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => !disabled && onChange(!checked)}
    className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-primary ${checked ? 'border-primary bg-primary' : 'border-border-strong bg-surface-highlight'} ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
  >
    <span
      className={`pointer-events-none inline-block h-2.5 w-2.5 rounded-full transition-transform ${checked ? 'translate-x-[14px] bg-primary-contrast' : 'translate-x-0.5 bg-secondary'}`}
    />
  </button>
);
