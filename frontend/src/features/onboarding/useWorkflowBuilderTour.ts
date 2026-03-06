import { useEffect } from 'react';
import { useTourStore } from './store';

/**
 * Auto-starts the workflow builder tour for first-time visitors.
 * Independent of the app navigation tour — starts directly when the
 * user enters the workflow builder for the first time.
 * Place this hook in the WorkflowBuilder component.
 */
export function useWorkflowBuilderTour() {
  const shouldAutoStart = useTourStore((s) => s.shouldAutoStart);
  const startTour = useTourStore((s) => s.startTour);
  const activeTour = useTourStore((s) => s.activeTour);
  const requestedTour = useTourStore((s) => s.requestedTour);
  const serverStateLoaded = useTourStore((s) => s.serverStateLoaded);

  useEffect(() => {
    // Don't start if another tour is already active
    if (activeTour) return;
    if (!serverStateLoaded && requestedTour !== 'workflow-builder') return;

    const timer = setTimeout(() => {
      if (requestedTour === 'workflow-builder' || shouldAutoStart('workflow-builder')) {
        startTour('workflow-builder');
      }
    }, 1200);

    return () => clearTimeout(timer);
  }, [activeTour, requestedTour, serverStateLoaded, shouldAutoStart, startTour]);
}
