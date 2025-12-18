import { cn } from '@/lib/utils'

/**
 * Status colors available for badges
 */
export type StatusColor = 'blue' | 'green' | 'red' | 'amber' | 'gray' | 'purple'

/**
 * Map execution statuses to colors
 */
export const STATUS_COLOR_MAP: Record<string, StatusColor> = {
  RUNNING: 'blue',
  QUEUED: 'blue',
  COMPLETED: 'green',
  FAILED: 'red',
  CANCELLED: 'gray',
  TERMINATED: 'gray',
  TIMED_OUT: 'amber',
}

/**
 * Get the color for a given status string
 */
export function getStatusColor(status: string): StatusColor {
  return STATUS_COLOR_MAP[status.toUpperCase()] ?? 'gray'
}

/**
 * Color configurations for muted outline badges
 * Each color has light mode and dark mode styles
 * Using ! prefix for important to override Badge component defaults
 */
const BADGE_COLOR_STYLES: Record<StatusColor, string> = {
  blue: '!bg-blue-500/10 !text-blue-700 !border-blue-200 dark:!bg-blue-500/20 dark:!text-blue-300 dark:!border-blue-700/50',
  green: '!bg-emerald-50 !text-emerald-800 !border-emerald-200 dark:!bg-emerald-900/20 dark:!text-emerald-400 dark:!border-emerald-700',
  red: '!bg-red-500/10 !text-red-700 !border-red-200 dark:!bg-red-500/20 dark:!text-red-300 dark:!border-red-700/50',
  amber: '!bg-amber-500/10 !text-amber-700 !border-amber-200 dark:!bg-amber-500/10 dark:!text-amber-500 dark:!border-amber-900/30',
  gray: '!bg-muted/40 !text-muted-foreground !border-border/60',
  purple: '!bg-purple-500/10 !text-purple-700 !border-purple-200 dark:!bg-purple-500/20 dark:!text-purple-300 dark:!border-purple-700/50',
}

/**
 * Get className for a muted outline badge with the given color
 * 
 * @example
 * // Using with a color directly
 * <Badge variant="outline" className={getStatusBadgeClass('blue')}>
 *   RUNNING
 * </Badge>
 * 
 * @example
 * // Using with a status string
 * <Badge variant="outline" className={getStatusBadgeClass(getStatusColor('COMPLETED'))}>
 *   COMPLETED
 * </Badge>
 * 
 * @example
 * // Convenience function for status strings
 * <Badge variant="outline" className={getStatusBadgeClassFromStatus('FAILED')}>
 *   FAILED
 * </Badge>
 */
export function getStatusBadgeClass(color: StatusColor, additionalClasses?: string): string {
  return cn(BADGE_COLOR_STYLES[color], additionalClasses)
}

/**
 * Convenience function to get badge class directly from a status string
 */
export function getStatusBadgeClassFromStatus(status: string, additionalClasses?: string): string {
  return getStatusBadgeClass(getStatusColor(status), additionalClasses)
}
