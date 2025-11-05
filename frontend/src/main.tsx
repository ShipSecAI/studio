import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { PostHogProvider } from 'posthog-js/react'
import posthog from 'posthog-js'

const apiKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY as string | undefined
const apiHost = import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string | undefined
const hasPostHog = Boolean(apiKey && apiHost)

// Initialize the global PostHog singleton so helpers using `posthog.capture` work.
if (hasPostHog) {
  posthog.init(apiKey!, {
    api_host: apiHost!,
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
