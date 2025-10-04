import type { Node, Edge, Connection } from 'reactflow'
import type { NodeData } from '@/schemas/node'
import type { ComponentMetadata } from '@/schemas/component'

export interface ValidationResult {
  isValid: boolean
  error?: string
}

/**
 * Check if two port types are compatible
 */
function areTypesCompatible(sourceType: string, targetType: string): boolean {
  // 'any' type accepts/provides anything
  if (sourceType === 'any' || targetType === 'any') return true

  // Exact match
  if (sourceType === targetType) return true

  // Additional compatibility rules can be added here
  // For example: array can connect to any, object can connect to any, etc.

  return false
}

/**
 * Validate connection between two nodes
 */
export function validateConnection(
  connection: Connection,
  nodes: Node<NodeData>[],
  edges: Edge[],
  getComponent: (slug: string) => ComponentMetadata | null
): ValidationResult {
  const { source, target, sourceHandle, targetHandle } = connection

  // Basic validation
  if (!source || !target) {
    return { isValid: false, error: 'Invalid connection' }
  }

  if (source === target) {
    return { isValid: false, error: 'Cannot connect node to itself' }
  }

  // Get source and target nodes
  const sourceNode = nodes.find((node) => node.id === source)
  const targetNode = nodes.find((node) => node.id === target)

  if (!sourceNode || !targetNode) {
    return { isValid: false, error: 'Source or target node not found' }
  }

  // Get component metadata
  const sourceComponent = getComponent(sourceNode.data.componentSlug)
  const targetComponent = getComponent(targetNode.data.componentSlug)

  if (!sourceComponent || !targetComponent) {
    return { isValid: false, error: 'Component metadata not found' }
  }

  // Validate handles exist
  if (!sourceHandle || !targetHandle) {
    return { isValid: false, error: 'Connection handles not specified' }
  }

  // Get port metadata
  const sourcePort = sourceComponent.outputs.find((p) => p.id === sourceHandle)
  const targetPort = targetComponent.inputs.find((p) => p.id === targetHandle)

  if (!sourcePort || !targetPort) {
    return { isValid: false, error: 'Invalid connection ports' }
  }

  // Check type compatibility
  if (!areTypesCompatible(sourcePort.type, targetPort.type)) {
    return {
      isValid: false,
      error: `Type mismatch: ${sourcePort.type} cannot connect to ${targetPort.type}`,
    }
  }

  // Check if target input already has a connection
  const existingConnection = edges.find(
    (edge) => edge.target === target && edge.targetHandle === targetHandle
  )
  if (existingConnection) {
    return {
      isValid: false,
      error: `Input "${targetPort.label}" already has a connection`,
    }
  }

  // Check for cycles
  if (wouldCreateCycle(connection, edges)) {
    return { isValid: false, error: 'Connection would create a cycle' }
  }

  return { isValid: true }
}

/**
 * Detect if a connection would create a cycle
 */
function wouldCreateCycle(newConnection: Connection, existingEdges: Edge[]): boolean {
  const { source, target } = newConnection

  if (!source || !target) return false

  const visited = new Set<string>()

  function hasPath(from: string, to: string): boolean {
    if (from === to) return true
    if (visited.has(from)) return false

    visited.add(from)

    const outgoingEdges = existingEdges.filter((edge) => edge.source === from)
    return outgoingEdges.some((edge) => hasPath(edge.target, to))
  }

  return hasPath(target, source)
}

/**
 * Get validation warnings for a node (e.g., required inputs not connected)
 */
export function getNodeValidationWarnings(
  node: Node<NodeData>,
  edges: Edge[],
  component: ComponentMetadata
): string[] {
  const warnings: string[] = []

  // Check for required inputs that are not connected
  component.inputs.forEach((input) => {
    if (input.required) {
      const hasConnection = edges.some(
        (edge) => edge.target === node.id && edge.targetHandle === input.id
      )
      if (!hasConnection) {
        warnings.push(`Required input "${input.label}" is not connected`)
      }
    }
  })

  // Check for required parameters that are not set
  component.parameters.forEach((param) => {
    if (param.required) {
      const value = node.data.parameters?.[param.id]
      if (value === undefined || value === null || value === '') {
        warnings.push(`Required parameter "${param.label}" is not set`)
      }
    }
  })

  return warnings
}
