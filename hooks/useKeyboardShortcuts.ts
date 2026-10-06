import { useEffect, useRef } from 'react';
import type { ViewMode } from '../context/UserContext';

// Single source of truth for the navigation shortcuts. The help modal in App.tsx renders this list,
// so the keys shown to the user always match what the handler does.
export const VIEW_SHORTCUTS: ReadonlyArray<{ key: string; view: ViewMode }> = [
    { key: '1', view: 'dashboard' },
    { key: '2', view: 'radar' },
    { key: '3', view: 'funding' },
    { key: '5', view: 'portfolio' },
];

interface ShortcutConfig {
    setViewMode: (mode: ViewMode) => void;
    onHelp: () => void;
    closeModals: () => void;
}

// Typing targets never trigger shortcuts.
const isEditableTarget = (target: EventTarget | null): target is HTMLElement => {
    if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

export const useKeyboardShortcuts = (config: ShortcutConfig) => {
    // Keep the latest callbacks in a ref so the window listener is attached exactly once
    // (inline callbacks from the caller would otherwise re-attach it on every render).
    const configRef = useRef(config);
    useEffect(() => {
        configRef.current = config;
    });

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.isComposing) return;

            if (isEditableTarget(event.target)) {
                if (event.key === 'Escape') event.target.blur();
                return;
            }

            if (event.key === 'Escape') {
                configRef.current.closeModals();
                return;
            }

            // Shortcuts are plain keys only: never hijack browser/OS combos such as Cmd/Ctrl+F.
            // (Shift is allowed because '?' needs it on most layouts.)
            if (event.ctrlKey || event.metaKey || event.altKey) return;

            if (event.key === '?') {
                configRef.current.onHelp();
                return;
            }

            const shortcut = VIEW_SHORTCUTS.find(s => s.key === event.key);
            if (shortcut) {
                configRef.current.setViewMode(shortcut.view);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);
};
