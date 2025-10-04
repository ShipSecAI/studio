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
      border: 'border-amber-500',
      bg: 'bg-amber-50',
      icon: 'Loader2',
      iconClass: 'animate-spin text-amber-600',
    },
    success: {
      border: 'border-green-500',
      bg: 'bg-green-50',
      icon: 'CheckCircle',
      iconClass: 'text-green-600',
    },
    error: {
      border: 'border-red-500',
      bg: 'bg-red-50',
      icon: 'XCircle',
      iconClass: 'text-red-600',
    },
    waiting: {
      border: 'border-gray-400',
      bg: 'bg-gray-50',
      icon: 'Clock',
      iconClass: 'text-gray-500',
    },
  }

  return styles[state]
}

/**
 * Get border color based on component type
 */
export function getTypeBorderColor(type: string): string {
  const colors: Record<string, string> = {
    input: 'border-blue-500',
    scan: 'border-purple-500',
    process: 'border-green-500',
    output: 'border-orange-500',
  }

  return colors[type] || 'border-gray-400'
}
