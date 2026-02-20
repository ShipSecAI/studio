import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { PostHogProvider } from 'posthog-js/react';
import posthog from 'posthog-js';
import { initializeTheme } from '@/store/themeStore';
import { isAnalyticsEnabled } from '@/features/analytics/config';
import { ErrorBoundary } from '@/components/ErrorBoundary';

const hasPostHog = isAnalyticsEnabled();

// Print analytics status
if (hasPostHog) {
  console.log('📊 Analytics enabled - PostHog is collecting usage data');
} else {
  console.log('📊 Analytics disabled - No usage data will be collected');
}

// Initialize the global PostHog singleton so helpers using `posthog.capture` work.
if (hasPostHog) {
  const apiKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY!;
  const apiHost = import.meta.env.VITE_PUBLIC_POSTHOG_HOST!;
  posthog.init(apiKey, {
    api_host: apiHost,
    autocapture: true,
    capture_pageview: false, // we capture pageviews via a router listener
    capture_exceptions: true,
    session_recording: {
      maskAllText: false,
      maskAllInputs: true,
    },
    respect_dnt: true,
    debug: import.meta.env.DEV,
  });
}

initializeTheme();

// Defer timeline store initialization — it's ~1000 lines and only needed for workflow executions.
// setTimeout(0) defers past the synchronous render cycle but fires before user interaction.
setTimeout(() => {
  import('@/store/executionTimelineStore').then(({ initializeTimelineStore }) => {
    initializeTimelineStore();
  });
}, 0);

// Global error listeners
function handleUnhandledRejection(event: PromiseRejectionEvent) {
  const reason = event.reason;
  if (reason?.name === 'AbortError' || reason?.name === 'CanceledError') return;
  console.error('[UnhandledRejection]', {
    name: reason?.name,
    message: reason?.message ?? String(reason),
  });
}

function handleGlobalError(event: ErrorEvent) {
  console.error('[GlobalError]', {
    message: event.message,
    source: event.filename,
    line: event.lineno,
  });
}

window.addEventListener('unhandledrejection', handleUnhandledRejection);
window.addEventListener('error', handleGlobalError);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    window.removeEventListener('error', handleGlobalError);
  });
}

const appContent = hasPostHog ? (
  <PostHogProvider client={posthog}>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </PostHogProvider>
) : (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  import.meta.env.DEV ? <React.StrictMode>{appContent}</React.StrictMode> : appContent,
);
