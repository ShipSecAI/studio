import type { Node as ReactFlowNode, Edge as ReactFlowEdge } from 'reactflow'
import { MarkerType } from 'reactflow'
import type { NodeData, NodeConfig } from '@/schemas/node'
import type { components } from '@shipsec/backend-client'

// Backend types
type BackendNode = components['schemas']['WorkflowResponseDto']['graph']['nodes'][number]
type BackendEdge = components['schemas']['WorkflowResponseDto']['graph']['edges'][number]
type CreateWorkflowRequestDto = components['schemas']['CreateWorkflowRequestDto']
type UpdateWorkflowRequestDto = components['schemas']['UpdateWorkflowRequestDto']

/**
 * Serialize React Flow nodes to API format
 * Strips runtime execution state and React Flow metadata
 * Frontend: { id, type: 'workflow', position, data: { componentId, componentSlug, label, status, ... } }
 * Backend: { id, type: componentId, position, data: { label, config: { params, inputOverrides } } }
 */
import type { FrontendNodeData } from '@/schemas/node';

const ENTRY_POINT_COMPONENT_IDS = [
  'core.workflow.entrypoint',
  'entry-point',
] as const;

function isEntryPointComponent(componentId: string): boolean {
  return ENTRY_POINT_COMPONENT_IDS.includes(componentId as any);
}

export function serializeNodes(reactFlowNodes: ReactFlowNode<FrontendNodeData>[]): BackendNode[] {
  return reactFlowNodes.map((node) => {
    const componentId =
      node.data.componentId ||
      node.data.componentSlug ||
      node.type ||
      'unknown'

    // Use config.params and config.inputOverrides
    const existingConfig = node.data.config || { params: {}, inputOverrides: {} }
    let params = { ...(existingConfig.params || {}) }
    let inputOverrides = { ...(existingConfig.inputOverrides || {}) }

    // For Entry Point components, extract runtimeInputs and populate inputOverrides
    if (isEntryPointComponent(componentId)) {
      const runtimeInputs = params.runtimeInputs as Array<{ id: string; type: string; label: string; required?: boolean; description?: string; defaultValue?: unknown }> | undefined

      if (runtimeInputs && Array.isArray(runtimeInputs)) {
        // Build inputOverrides with default values if they don't exist yet
        runtimeInputs.forEach(input => {
          if (input.defaultValue !== undefined && inputOverrides[input.id] === undefined) {
            inputOverrides[input.id] = input.defaultValue
          }
        })
      }
    }

    // Include UI metadata
    const ui = (node.data as any).ui

    // Build the new config structure
    const config: Record<string, unknown> = {
      ...existingConfig,
      params,
      inputOverrides,
    }

    // Add UI metadata
    if (ui) config.__ui = ui

    return {
      id: node.id,
      type: componentId,
      position: node.position,
      data: {
        label: node.data.label || '',
        config,
      },
    }
  })
}

/**
 * Serialize React Flow edges to API format
 * Strips React Flow metadata
 */
export function serializeEdges(reactFlowEdges: ReactFlowEdge[]): BackendEdge[] {
  return reactFlowEdges.map((edge) => {
    // Preserve edge type to maintain curved arrow appearance
    // ReactFlow's 'default' type uses bezier curves (curved arrows)
    // ReactFlow can return null, but backend expects undefined or string
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
      type: (edge.type || 'default') as 'default' | 'smoothstep' | 'step' | 'straight' | 'bezier' | undefined,
    }
  })
}

/**
 * Serialize complete workflow for API
 * Use for creating new workflows
 */
export function serializeWorkflowForCreate(
  name: string,
  description: string | undefined,
  nodes: ReactFlowNode<FrontendNodeData>[],
  edges: ReactFlowEdge[]
): CreateWorkflowRequestDto {
  const serializedNodes = serializeNodes(nodes)
  const serializedEdges = serializeEdges(edges)

  return {
    name,
    description: description || '',
    nodes: serializedNodes,
    edges: serializedEdges,
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}

/**
 * Serialize workflow for update
 * Use when updating existing workflows
 */
export function serializeWorkflowForUpdate(
  id: string,
  name: string,
  description: string | undefined,
  nodes: ReactFlowNode<NodeData>[],
  edges: ReactFlowEdge[]
): UpdateWorkflowRequestDto {
  return {
    id,
    name,
    description: description || '',
    nodes: serializeNodes(nodes),
    edges: serializeEdges(edges),
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}

/**
 * Deserialize workflow nodes from API to React Flow format
 * Backend sends: { graph: { nodes: [...], edges: [...] } }
 * Frontend needs: { id, type: 'workflow', position, data: { componentId, componentSlug, label, status, config } }
 */
export function deserializeNodes(workflow: { graph: { nodes: BackendNode[], edges?: BackendEdge[] } }): ReactFlowNode<NodeData>[] {
  const nodes = workflow.graph.nodes
  const edges = workflow.graph.edges || []

  const inputMappingsByNode = new Map<string, Record<string, { source: string; output: string }>>()

  if (Array.isArray(edges)) {
    for (const edge of edges) {
      if (!edge.targetHandle) continue

      const targetNodeId = edge.target
      const existing = inputMappingsByNode.get(targetNodeId) ?? {}

      existing[edge.targetHandle] = {
        source: edge.source,
        output: edge.sourceHandle ?? '',
      }

      inputMappingsByNode.set(targetNodeId, existing)
    }
  }

  return nodes.map((node) => {
    // Extract config from backend node data
    const backendConfig = node.data.config || {}
    const { __ui, params, inputOverrides, ...restOfConfig } = backendConfig as {
      __ui?: any
      params?: Record<string, unknown>
      inputOverrides?: Record<string, unknown>
      [key: string]: any
    }

    // Ensure config has the required structure
    const config: NodeConfig = {
      params: params || {},
      inputOverrides: inputOverrides || {},
      ...restOfConfig,
    } as NodeConfig

    // Extract dynamic ports from backend node data (if present)
    const backendNodeData = node.data as any
    const dynamicInputs = backendNodeData.dynamicInputs
    const dynamicOutputs = backendNodeData.dynamicOutputs

    return {
      id: node.id,
      type: 'workflow', // All nodes use the same React Flow type
      position: node.position,
      data: {
        // Backend's data.label and data.config (required)
        label: node.data.label,
        config,
        // Frontend extensions
        componentId: node.type,
        componentSlug: node.type,
        componentVersion: '1.0.0', // Default version if not specified
        status: 'idle', // Reset execution state
        inputs: inputMappingsByNode.get(node.id) ?? {},
        // Dynamic ports resolved by backend
        ...(dynamicInputs ? { dynamicInputs } : {}),
        ...(dynamicOutputs ? { dynamicOutputs } : {}),
        // Restore UI metadata (like size for text blocks)
        ...__ui ? { ui: __ui } : {},
      },
    }
  })
}

/**
 * Deserialize workflow edges from API to React Flow format
 * Preserves edge type to maintain curved arrow appearance
 */
export function deserializeEdges(workflow: { graph: { edges: BackendEdge[] } }): ReactFlowEdge[] {
  const edges = workflow.graph.edges
  return edges.map((edge) => {
    // Use saved type if available, otherwise default to 'default' for bezier curves (curved arrows)
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      type: (edge.type || 'default') as 'default' | 'smoothstep' | 'step' | 'straight' | 'bezier',
      animated: false, // Default for ReactFlow, backend doesn't store this
      markerEnd: {
        type: MarkerType.Arrow,
        width: 22,
        height: 22,
      },
    }
  })
}
