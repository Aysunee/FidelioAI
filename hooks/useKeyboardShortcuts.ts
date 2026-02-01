import { useEffect, useCallback } from 'react';

interface ShortcutConfig {
    setViewMode: (mode: string) => void;
    toggleSearch: () => void;
    togglePause: () => void;
    onHelp: () => void;
    closeModals: () => void;
}

export const useKeyboardShortcuts = ({ setViewMode, toggleSearch, togglePause, onHelp, closeModals }: ShortcutConfig) => {
    const handleKeyPress = useCallback((event: KeyboardEvent) => {
        // Ignore if typing in input
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
            if (event.key === 'Escape') {
                (event.target as HTMLElement).blur();
            }
            return;
        }

        switch (event.key) {
            case '1':
                setViewMode('dashboard');
                break;
            case '2':
                setViewMode('fidelio-ai');
                break;
            case '3':
                setViewMode('funding');
                break;

            case '5':
                setViewMode('portfolio');
                break;
            case 'f':
            case 'F':
                event.preventDefault(); // Prevent browser search if needed, though usually Ctrl+F
                toggleSearch();
                break;
            case ' ':
                event.preventDefault(); // Prevent page scroll
                togglePause();
                break;
            case '?':
                onHelp();
                break;
            case 'Escape':
                closeModals();
                break;
        }
    }, [setViewMode, toggleSearch, togglePause, onHelp, closeModals]);

    useEffect(() => {
        window.addEventListener('keydown', handleKeyPress);
        return () => window.removeEventListener('keydown', handleKeyPress);
    }, [handleKeyPress]);
};
