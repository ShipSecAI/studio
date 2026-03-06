import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useOnboardingPreferences } from '@/hooks/queries/useOnboardingQueries';
import { useTourStore } from './store';

/**
 * Auto-starts the app navigation tour for first-time users.
 * Only triggers on non-workflow pages (homepage, landing, etc.).
 * Place this hook in the AppLayout component.
 */
export function useAppTour() {
  const shouldAutoStart = useTourStore((s) => s.shouldAutoStart);
  const startTour = useTourStore((s) => s.startTour);
  const requestedTour = useTourStore((s) => s.requestedTour);
  const syncCompletedTours = useTourStore((s) => s.syncCompletedTours);
  const location = useLocation();
  const { data, isLoading } = useOnboardingPreferences();

  useEffect(() => {
    if (!data) return;
    syncCompletedTours({
      'app-navigation': data.appNavigationTourCompleted,
      'workflow-builder': data.workflowBuilderTourCompleted,
    });
  }, [data, syncCompletedTours]);

  useEffect(() => {
    if (isLoading) return;

    // Don't auto-start the app tour on workflow builder pages
    // The workflow builder has its own dedicated tour
    const isWorkflowRoute =
      location.pathname.startsWith('/workflows') || location.pathname.startsWith('/webhooks/');
    if (isWorkflowRoute) return;

    // Small delay to let the layout render and elements mount
    const timer = setTimeout(() => {
      if (requestedTour === 'app-navigation' || shouldAutoStart('app-navigation')) {
        startTour('app-navigation');
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [isLoading, location.pathname, requestedTour, shouldAutoStart, startTour]);
}
