import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { PostHogProvider } from 'posthog-js/react'
import posthog from 'posthog-js'
import { initializeTimelineStore } from '@/store/executionTimelineStore'
import { isAnalyticsEnabled } from '@/features/analytics/config'

const hasPostHog = isAnalyticsEnabled()

// Print analytics status
if (hasPostHog) {
  console.log('📊 Analytics enabled - PostHog is collecting usage data')
} else {
  console.log('📊 Analytics disabled - No usage data will be collected')
}

// Initialize the global PostHog singleton so helpers using `posthog.capture` work.
if (hasPostHog) {
  const apiKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY!
  const apiHost = import.meta.env.VITE_PUBLIC_POSTHOG_HOST!
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
  })
}

initializeTimelineStore()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {hasPostHog ? (
      <PostHogProvider client={posthog}>
        <App />
      </PostHogProvider>
    ) : (
      <App />
    )}
  </React.StrictMode>,
)
