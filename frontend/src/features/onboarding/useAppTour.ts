import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTourStore } from './store';

/**
 * Auto-starts the app navigation tour for first-time users.
 * Only triggers on non-workflow pages (homepage, landing, etc.).
 * Place this hook in the AppLayout component.
 */
export function useAppTour() {
  const shouldAutoStart = useTourStore((s) => s.shouldAutoStart);
  const startTour = useTourStore((s) => s.startTour);
  const location = useLocation();

  useEffect(() => {
    // Don't auto-start the app tour on workflow builder pages
    // The workflow builder has its own dedicated tour
    const isWorkflowRoute =
      location.pathname.startsWith('/workflows') || location.pathname.startsWith('/webhooks/');
    if (isWorkflowRoute) return;

    // Small delay to let the layout render and elements mount
    const timer = setTimeout(() => {
      if (shouldAutoStart('app-navigation')) {
        startTour('app-navigation');
      }
    }, 800);

    return () => clearTimeout(timer);
    // Only run once on mount or when route changes to non-workflow page
  }, [location.pathname]);
}
