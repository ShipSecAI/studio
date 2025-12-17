import type { Node as ReactFlowNode, Edge as ReactFlowEdge } from 'reactflow'
import { MarkerType } from 'reactflow'
import type { NodeData } from '@/schemas/node'
import type { components } from '@shipsec/backend-client'

// Backend types
type BackendNode = components['schemas']['WorkflowResponseDto']['graph']['nodes'][number]
type BackendEdge = components['schemas']['WorkflowResponseDto']['graph']['edges'][number]
type CreateWorkflowRequestDto = components['schemas']['CreateWorkflowRequestDto']
type UpdateWorkflowRequestDto = components['schemas']['UpdateWorkflowRequestDto']

/**
 * Serialize React Flow nodes to API format
 * Strips runtime execution state and React Flow metadata
 * Frontend: { id, type: 'workflow', position, data: { componentId, componentSlug, label, parameters, status, ... } }
 * Backend: { id, type: componentId, position, data: { label, config } }
 */
import type { FrontendNodeData } from '@/schemas/node';

export function serializeNodes(reactFlowNodes: ReactFlowNode<FrontendNodeData>[]): BackendNode[] {
  return reactFlowNodes.map((node) => {
    const componentId =
      node.data.componentId ||
      node.data.componentSlug ||
      node.type ||
      'unknown'

    // Get base config from parameters or config
    const baseConfig = node.data.parameters || node.data.config || {}

    // Include UI metadata (like size for text blocks) in config
    // This preserves UI state across saves without requiring backend schema changes
    const ui = (node.data as any).ui
    const configWithUi = ui ? { ...baseConfig, __ui: ui } : baseConfig

    return {
      id: node.id,
      type: componentId,
      position: node.position,
      data: {
        label: node.data.label || '',
        config: configWithUi,
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
 * Frontend needs: { id, type: 'workflow', position, data: { componentId, componentSlug, label, parameters, status, config } }
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
    // Extract UI metadata from config if present
    const configWithPossibleUi = node.data.config || {}
    const { __ui, ...cleanConfig } = configWithPossibleUi as { __ui?: any; [key: string]: any }

    return {
      id: node.id,
      type: 'workflow', // All nodes use the same React Flow type
      position: node.position,
      data: {
        // Backend's data.label and data.config (required)
        label: node.data.label,
        config: cleanConfig,
        // Frontend extensions
        componentId: node.type,
        componentSlug: node.type,
        componentVersion: '1.0.0', // Default version if not specified
        parameters: cleanConfig, // Map config to parameters for frontend (without __ui)
        status: 'idle', // Reset execution state
        inputs: inputMappingsByNode.get(node.id) ?? {},
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
        width: 30,
        height: 30,
      },
    }
  })
}
