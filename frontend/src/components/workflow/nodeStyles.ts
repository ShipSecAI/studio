import type { NodeStatus } from '@/schemas/node'

/**
 * Node state styling configuration
 */
export interface NodeStateStyle {
  border: string
  bg: string
  icon: string | null
  iconClass?: string
}

/**
 * Get styling for a node based on its execution state
 */
export function getNodeStyle(state: NodeStatus): NodeStateStyle {
  const styles: Record<NodeStatus, NodeStateStyle> = {
    idle: {
      border: 'border-border',
      bg: 'bg-background',
      icon: null,
    },
    running: {
      border: 'border-blue-500',
      bg: 'bg-blue-50 dark:bg-blue-950/30',
      icon: 'Activity',
      iconClass: 'text-blue-600 dark:text-blue-400',
    },
    success: {
      border: 'border-green-500',
      bg: 'bg-green-50 dark:bg-green-950/30',
      icon: 'CheckCircle',
      iconClass: 'text-green-600 dark:text-green-400',
    },
    error: {
      border: 'border-red-500',
      bg: 'bg-red-50 dark:bg-red-950/30',
      icon: 'XCircle',
      iconClass: 'text-red-600 dark:text-red-400',
    },
    waiting: {
      border: 'border-gray-400 dark:border-gray-600',
      bg: 'bg-gray-50 dark:bg-gray-900/30',
      icon: 'Clock',
      iconClass: 'text-gray-500 dark:text-gray-400',
    },
  }

  return styles[state]
}
