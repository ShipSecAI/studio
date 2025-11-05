import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { PostHogProvider } from 'posthog-js/react'

const apiKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY as string | undefined
const apiHost = import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string | undefined
const hasPostHog = Boolean(apiKey && apiHost)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {hasPostHog ? (
      <PostHogProvider
        apiKey={apiKey!}
        options={{
          api_host: apiHost!,
          autocapture: true,
          capture_pageview: false, // we capture pageviews via a router listener
          capture_exceptions: true,
          session_recording: {
            maskAllText: false, // keep content visible for useful context
            maskAllInputs: true, // but mask form inputs for privacy
            // networkPayloadCapture: 'header', // enable later if needed
          },
          respect_dnt: true,
          debug: import.meta.env.DEV,
        }}
      >
        <App />
      </PostHogProvider>
    ) : (
      <App />
    )}
  </React.StrictMode>,
)
