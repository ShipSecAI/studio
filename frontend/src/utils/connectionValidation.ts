import type { Node, Edge, Connection } from 'reactflow'

import type { ComponentMetadata } from '@/schemas/component'
import type { NodeData } from '@/schemas/node'

export interface ValidationResult {
  isValid: boolean
  error?: string
}

/**
 * Type hierarchy for enhanced compatibility checking
 */
const TYPE_HIERARCHY: Record<string, string[]> = {
  'any': ['string', 'array', 'object', 'file'],
  'array': ['any'],
  'string': ['any'],
  'object': ['any'],
  'file': ['string', 'any'],
}

/**
 * Check if two port types are compatible
 */
function areTypesCompatible(sourceType: string, targetType: string): boolean {
  // 'any' type accepts/provides anything
  if (sourceType === 'any' || targetType === 'any') return true

  // Exact match
  if (sourceType === targetType) return true

  // Check if source type can connect to target type via hierarchy
  if (TYPE_HIERARCHY[sourceType]?.includes(targetType)) return true

  // Check if target type can accept from source type via hierarchy
  if (TYPE_HIERARCHY[targetType]?.includes(sourceType)) return true

  // Special compatibility rules for common data flow patterns
  const compatibilityMatrix: Record<string, string[]> = {
    'file': ['string', 'array', 'object', 'any'], // File can provide text, parsed data, etc.
    'array': ['string', 'any'], // Array can be serialized to string
    'object': ['string', 'any'], // Object can be serialized to string
  }

  if (compatibilityMatrix[sourceType]?.includes(targetType)) return true

  return false
}

/**
 * Validate connection between two nodes
 */
export function validateConnection(
  connection: Connection,
  nodes: Node<NodeData>[],
  edges: Edge[],
  getComponent: (_componentRef: string) => ComponentMetadata | null
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
  const sourceComponent = getComponent(
    (sourceNode.data as any).componentId ?? (sourceNode.data as any).componentSlug
  )
  const targetComponent = getComponent(
    (targetNode.data as any).componentId ?? (targetNode.data as any).componentSlug
  )

  if (!sourceComponent || !targetComponent) {
    return { isValid: false, error: 'Component metadata not found' }
  }

  // Validate handles exist
  if (!sourceHandle || !targetHandle) {
    return { isValid: false, error: 'Connection handles not specified' }
  }

  // Get port metadata (with support for dynamic outputs)
  let sourceOutputs = sourceComponent.outputs ?? []
  
  // Special case: Manual Trigger has dynamic outputs based on runtimeInputs parameter
  if (sourceComponent.slug === 'manual-trigger') {
    const sourceNodeData = sourceNode.data as any
    const runtimeInputsParam = sourceNodeData.parameters?.runtimeInputs
    
    if (runtimeInputsParam) {
      try {
        const runtimeInputs = typeof runtimeInputsParam === 'string'
          ? JSON.parse(runtimeInputsParam)
          : runtimeInputsParam
        
        if (Array.isArray(runtimeInputs) && runtimeInputs.length > 0) {
          sourceOutputs = runtimeInputs.map((input: any) => ({
            id: input.id,
            label: input.label,
            type: input.type === 'file' ? 'string' : input.type,
            description: input.description || `Runtime input: ${input.label}`,
          }))
        }
      } catch (error) {
        console.error('Failed to parse runtimeInputs for validation:', error)
      }
    }
  }
  
  const sourcePort = sourceOutputs.find((p) => p.id === sourceHandle)
  const targetPort = (targetComponent.inputs ?? []).find((p) => p.id === targetHandle)

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
      const value = (node.data as any).parameters?.[param.id]
      if (value === undefined || value === null || value === '') {
        warnings.push(`Required parameter "${param.label}" is not set`)
      }
    }
  })

  return warnings
}
