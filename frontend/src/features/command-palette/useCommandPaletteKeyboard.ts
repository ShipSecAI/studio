import { useEffect } from 'react';
import { useCommandPaletteStore } from '@/store/commandPaletteStore';

/**
 * Hook to register global keyboard shortcut for Command Palette
 * Should be used once at the app root level
 */
export function useCommandPaletteKeyboard() {
  const { toggle, isOpen, close } = useCommandPaletteStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+K (Mac) or Ctrl+K (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        e.stopPropagation();
        toggle();
        return;
      }

      // Escape to close (backup, also handled in component)
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        close();
        return;
      }
    };

    // Use capture phase to intercept before other handlers
    document.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [toggle, isOpen, close]);
}
