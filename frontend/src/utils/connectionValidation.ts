import type { Node, Edge, Connection } from 'reactflow'
import type { FrontendNodeData } from '@/schemas/node'
import type { ComponentMetadata } from '@/schemas/component'
import {
  arePortDataTypesCompatible,
  describePortDataType,
  inputSupportsManualValue,
  runtimeInputTypeToPortDataType,
} from '@/utils/portUtils'

export interface ValidationResult {
  isValid: boolean
  error?: string
}

export function validateConnection(
  connection: Connection,
  nodes: Node<FrontendNodeData>[],
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

  const sourceComponentSlug = sourceNode.data.componentId ?? sourceNode.data.componentSlug;
  if (!sourceComponentSlug) {
    return { isValid: false, error: 'Source component not found' };
  }
  const targetComponentSlug = targetNode.data.componentId ?? targetNode.data.componentSlug;
  if (!targetComponentSlug) {
    return { isValid: false, error: 'Target component not found' };
  }

  // Get component metadata
  const sourceComponent = getComponent(sourceComponentSlug);
  const targetComponent = getComponent(targetComponentSlug);

  if (!sourceComponent || !targetComponent) {
    return { isValid: false, error: 'Component metadata not found' }
  }

  // Validate handles exist
  if (!sourceHandle || !targetHandle) {
    return { isValid: false, error: 'Connection handles not specified' }
  }

  // Get port metadata (with support for dynamic outputs)
  let sourceOutputs = sourceComponent.outputs ?? []
  
  // Special case: Entry Point has dynamic outputs based on runtimeInputs parameter
  if (sourceComponent.id === 'core.workflow.entrypoint') {
    const sourceNodeData = sourceNode.data
    const runtimeInputsParam = sourceNodeData.parameters?.runtimeInputs
    
    if (runtimeInputsParam) {
      try {
        const runtimeInputs = typeof runtimeInputsParam === 'string'
          ? JSON.parse(runtimeInputsParam)
          : runtimeInputsParam
        
        if (Array.isArray(runtimeInputs) && runtimeInputs.length > 0) {
          sourceOutputs = runtimeInputs.map((input: any) => {
            const runtimeType = (input.type || 'text') as string
            const dataType = runtimeInputTypeToPortDataType(runtimeType)
            return {
              id: input.id,
              label: input.label,
              dataType,
              description: input.description || `Runtime input: ${input.label}`,
            }
          })
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

  if (!sourcePort.dataType || !targetPort.dataType) {
    return { isValid: false, error: 'Port type metadata unavailable' }
  }

  // Check type compatibility
  if (!arePortDataTypesCompatible(sourcePort.dataType, targetPort.dataType)) {
    const targetTypeLabel = describePortDataType(targetPort.dataType)
    return {
      isValid: false,
      error: `Type mismatch: ${describePortDataType(sourcePort.dataType)} cannot connect to ${targetTypeLabel}`,
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
  node: Node<FrontendNodeData>,
  edges: Edge[],
  component: ComponentMetadata
): string[] {
  const warnings: string[] = []

  // Check for required inputs that are not connected
  const manualParameters = (node.data.parameters ?? {}) as Record<string, unknown>

  component.inputs.forEach((input) => {
    if (input.required) {
      const hasConnection = edges.some(
        (edge) => edge.target === node.id && edge.targetHandle === input.id
      )

      const manualOverridesPort = input.valuePriority === 'manual-first'
      const allowsManualInput = inputSupportsManualValue(input) || manualOverridesPort
      const manualCandidate = manualParameters[input.id]
      const manualValueProvided = allowsManualInput && (!hasConnection || manualOverridesPort) && manualCandidate !== undefined && manualCandidate !== null && (
        typeof manualCandidate === 'string' ? manualCandidate.trim().length > 0 : true
      )

      if (!hasConnection && !manualValueProvided) {
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
