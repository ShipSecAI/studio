import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useThemeStore } from '@/store/themeStore';
import { Sun, Moon } from 'lucide-react';
import { cn } from '@/lib/utils';

type Theme = 'light' | 'dark';

export const ThemeTransition = () => {
  const { isTransitioning, theme, toggleTheme, endTransition } = useThemeStore();
  const [stage, setStage] = useState<'idle' | 'in' | 'switching' | 'out'>('idle');
  const [displayTheme, setDisplayTheme] = useState<Theme>(theme);
  const [transitionTarget, setTransitionTarget] = useState<Theme | null>(null);
  const themeRef = useRef<Theme>(theme);
  const animationSetupRef = useRef(false);
  const safetyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Safety timeout: automatically clear stuck transition state after 2 seconds
  useEffect(() => {
    if (isTransitioning) {
      // Clear any existing safety timeout
      if (safetyTimeoutRef.current) {
        clearTimeout(safetyTimeoutRef.current);
      }

      // Set a safety timeout to force-clear stuck transitions
      safetyTimeoutRef.current = setTimeout(() => {
        console.warn('Theme transition stuck, forcing cleanup');
        endTransition();
        setStage('idle');
        setTransitionTarget(null);
        animationSetupRef.current = false;
      }, 2000); // 2 second safety timeout
    } else {
      // Clear safety timeout when transition ends normally
      if (safetyTimeoutRef.current) {
        clearTimeout(safetyTimeoutRef.current);
        safetyTimeoutRef.current = null;
      }
    }

    return () => {
      if (safetyTimeoutRef.current) {
        clearTimeout(safetyTimeoutRef.current);
      }
    };
  }, [isTransitioning, endTransition]);

  useEffect(() => {
    themeRef.current = theme;

    if (!isTransitioning) {
      setDisplayTheme(theme);
      setTransitionTarget(null);
      setStage('idle'); // Reset stage when transition ends
    }
  }, [theme, isTransitioning]);

  // Clear any stuck state on mount
  useEffect(() => {
    // If we mount with a stuck transition state, clear it after a brief check
    const checkStuck = setTimeout(() => {
      // If still transitioning after mount and stage is idle, it's likely stuck
      if (isTransitioning && stage === 'idle') {
        console.warn('Detected stuck transition state on mount, clearing');
        endTransition();
        setStage('idle');
        setTransitionTarget(null);
        animationSetupRef.current = false;
      }
    }, 100);
    return () => clearTimeout(checkStuck);
  }, []);

  // Use useLayoutEffect for synchronous setup before paint - ensures overlay appears instantly
  useLayoutEffect(() => {
    if (!isTransitioning) return;

    const currentTheme = themeRef.current;
    const nextTheme = currentTheme === 'light' ? 'dark' : 'light';

    // Set up overlay immediately with target theme colors (so it covers the old background)
    // Do this synchronously to avoid any delay - useLayoutEffect runs before paint
    setTransitionTarget(nextTheme);
    setDisplayTheme(currentTheme); // Start animation from current theme
    setStage('in');
  }, [isTransitioning]);

  // Reset animation setup flag when transition ends
  useEffect(() => {
    if (!isTransitioning) {
      animationSetupRef.current = false;
    }
  }, [isTransitioning]);

  // Effect to handle theme switch and animation after overlay is visible
  useEffect(() => {
    if (!isTransitioning || animationSetupRef.current) return;

    const currentTheme = themeRef.current;
    const nextTheme = currentTheme === 'light' ? 'dark' : 'light';

    // Mark that we've set up the animation to prevent re-running
    animationSetupRef.current = true;

    // Small delay to ensure overlay is rendered, then switch theme
    const frame1 = requestAnimationFrame(() => {
      toggleTheme(); // Switch theme in the background (behind the overlay)

      // Start the animation immediately after theme switch
      requestAnimationFrame(() => {
        setDisplayTheme(nextTheme); // Animate to new theme
      });
    });

    // 1. Mark as switching stage
    const t1 = setTimeout(() => {
      setStage('switching');
    }, 300);

    // 2. Wait for animation to complete, then Fade Out
    const t2 = setTimeout(() => {
      setStage('out');
    }, 800);

    // 3. Cleanup
    const t3 = setTimeout(() => {
      setStage('idle');
      endTransition();
      setTransitionTarget(null);
    }, 1100);

    return () => {
      cancelAnimationFrame(frame1);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      // If component unmounts during transition, force cleanup
      if (isTransitioning) {
        endTransition();
        setStage('idle');
        setTransitionTarget(null);
        animationSetupRef.current = false;
      }
    };
  }, [isTransitioning, toggleTheme, endTransition]);

  // overlayTheme controls the background/text color of the overlay.
  // Always use the target theme so overlay matches the new document background.
  // The background switches first, then animation plays on top.
  const overlayTheme: Theme = transitionTarget ?? displayTheme;

  // Determine if overlay should be visible
  const isVisible = isTransitioning && (stage === 'in' || stage === 'switching');
  const isFadingOut = isTransitioning && stage === 'out';

  // Always render overlay (but hidden when not transitioning) for instant appearance
  return createPortal(
    <div
      className={cn(
        'theme-transition-overlay fixed inset-0 z-[10000] pointer-events-none flex items-center justify-center',
        // Overlay appears instantly (opacity-100 immediately) when transitioning starts
        // Hidden when not transitioning (no transition on hide to avoid lag)
        isVisible
          ? 'opacity-100'
          : isFadingOut
            ? 'opacity-0 transition-opacity duration-300 ease-in-out'
            : 'opacity-0',
        overlayTheme === 'dark' ? 'bg-[#1C1C1C] text-white' : 'bg-white text-slate-950',
      )}
      style={!isTransitioning ? { display: 'none' } : undefined}
    >
      <div className="relative flex flex-col items-center justify-center gap-4">
        <div className="relative w-24 h-24 flex items-center justify-center">
          <Sun
            className={cn(
              'absolute w-16 h-16 transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
              displayTheme === 'light' ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
            )}
            strokeWidth={1.5}
          />

          <Moon
            className={cn(
              'absolute w-16 h-16 transition-all duration-500 ease-out',
              displayTheme === 'dark'
                ? 'scale-100 rotate-0 opacity-100'
                : 'scale-50 -rotate-90 opacity-0',
            )}
            strokeWidth={1.5}
          />
        </div>

        <div className="h-8 relative overflow-hidden flex flex-col items-center min-w-[200px]">
          <span
            className={cn(
              'text-xl font-medium tracking-widest uppercase transition-all duration-500 transform absolute whitespace-nowrap',
              displayTheme === 'light'
                ? 'translate-y-0 opacity-100 text-slate-950'
                : '-translate-y-8 opacity-0',
            )}
          >
            Light Mode
          </span>
          <span
            className={cn(
              'text-xl font-medium tracking-widest uppercase transition-all duration-500 transform absolute whitespace-nowrap',
              displayTheme === 'dark'
                ? 'translate-y-0 opacity-100 text-white'
                : 'translate-y-8 opacity-0',
            )}
          >
            Dark Mode
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
};
