/**
 * Format duration in milliseconds to a human-readable string
 * @param ms Duration in milliseconds
 * @returns Formatted string like "21.0s" or "2m 30.5s"
 */
export function formatDuration(ms: number): string {
  // Convert milliseconds to seconds for display
  const seconds = ms / 1000
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`
  }
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = (seconds % 60).toFixed(1)
  return `${minutes}m ${remainingSeconds}s`
}

/**
 * Format start time as relative time (if recent) or exact time (if older)
 * @param timestamp ISO timestamp string
 * @returns Formatted string like "5m ago", "2h ago", or "Dec 9, 4:10 PM"
 */
export function formatStartTime(timestamp: string): string {
  const now = Date.now()
  const then = new Date(timestamp).getTime()
  const diffMs = now - then

  // Show relative time if within 24 hours
  if (diffMs < 86400000) {
    if (diffMs < 60000) return 'just now'
    if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`
    return `${Math.floor(diffMs / 3600000)}h ago`
  }

  // Show exact time if older than 24 hours
  const date = new Date(timestamp)
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

