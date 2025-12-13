export function isAnalyticsEnabled(): boolean {
  const key = import.meta.env.VITE_PUBLIC_POSTHOG_KEY as string | undefined
  const host = import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string | undefined
  const disabled = import.meta.env.VITE_DISABLE_ANALYTICS === 'true'
  return Boolean(key && host && !disabled)
}

