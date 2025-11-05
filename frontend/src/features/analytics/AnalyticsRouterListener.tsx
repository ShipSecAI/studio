import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import posthog from 'posthog-js'
import { isAnalyticsEnabled } from './config'

/**
 * Captures SPA pageviews on route changes.
 * Requires PostHogProvider to be mounted in main.tsx.
 */
export function AnalyticsRouterListener() {
  const location = useLocation()

  useEffect(() => {
    if (!isAnalyticsEnabled()) return
    // PostHog may not be initialised if keys are missing
    try {
      posthog.capture('$pageview', {
        $current_url: window.location.href,
        $pathname: location.pathname,
        $search: location.search,
      })
    } catch (_) {
      // no-op
    }
  }, [location.pathname, location.search])

  return null
}
