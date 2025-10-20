import type { Node as ReactFlowNode, Edge as ReactFlowEdge } from 'reactflow'
import type { NodeData } from '@/schemas/node'
import type { Node, Edge } from '@/schemas'
import { NodeSchema, EdgeSchema } from '@/schemas'
import { CreateWorkflowSchema, UpdateWorkflowSchema } from '@/schemas/workflow'

/**
 * Serialize React Flow nodes to API format
 * Strips runtime execution state and React Flow metadata
 * Frontend: { id, type: 'workflow', position, data: { componentId, componentSlug, label, parameters, status, ... } }
 * Backend: { id, type: componentId, position, data: { label, config } }
 */
export function serializeNodes(reactFlowNodes: ReactFlowNode<NodeData>[]): Node[] {
  return reactFlowNodes.map((node) => {
    const componentId =
      (node.data as any).componentId ||
      (node.data as any).componentSlug ||
      node.type

    const cleanNode = {
      id: node.id,
      type: componentId,
      position: node.position,
      data: {
        label: node.data.label || '',
        config: (node.data as any).parameters || node.data.config || {},
      },
    }

    // Validate with schema
    return NodeSchema.parse(cleanNode)
  })
}

/**
 * Serialize React Flow edges to API format
 * Strips React Flow metadata
 */
export function serializeEdges(reactFlowEdges: ReactFlowEdge[]): Edge[] {
  return reactFlowEdges.map((edge) => {
    const cleanEdge = {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      type: edge.type || 'default',
      animated: edge.animated,
      label: edge.label,
    }

    // Validate with schema
    return EdgeSchema.parse(cleanEdge)
  })
}

/**
 * Serialize complete workflow for API
 * Use for creating new workflows
 */
export function serializeWorkflowForCreate(
  name: string,
  description: string | undefined,
  nodes: ReactFlowNode<NodeData>[],
  edges: ReactFlowEdge[]
) {
  const serializedNodes = serializeNodes(nodes)
  const serializedEdges = serializeEdges(edges)
  
  const payload = {
    name,
    description: description || '',
    nodes: serializedNodes,
    edges: serializedEdges,
  }

  // Validate with schema
  return CreateWorkflowSchema.parse(payload)
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
) {
  const payload = {
    id,
    name,
    description: description || '',
    nodes: serializeNodes(nodes),
    edges: serializeEdges(edges),
  }

  // Validate with schema
  return UpdateWorkflowSchema.parse(payload)
}

/**
 * Deserialize workflow nodes from API to React Flow format
 * Backend sends: { id, type: componentId, position, data: { label, config } }
 * Frontend needs: { id, type: 'workflow', position, data: { componentId, componentSlug, label, parameters, status, config } }
 */
export function deserializeNodes(nodes: Node[], edges?: Edge[]): ReactFlowNode<NodeData>[] {
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

  return nodes.map((node) => ({
    id: node.id,
    type: 'workflow', // All nodes use the same React Flow type
    position: node.position,
    data: {
      // Backend's data.label and data.config (required)
      label: node.data.label,
      config: node.data.config,
      // Frontend extensions
      componentId: node.type,
      componentSlug: node.type,
      componentVersion: '1.0.0', // Default version if not specified
      parameters: node.data.config || {}, // Map config to parameters for frontend
      status: 'idle', // Reset execution state
      inputs: inputMappingsByNode.get(node.id) ?? {},
    },
  }))
}

/**
 * Deserialize workflow edges from API to React Flow format
 */
export function deserializeEdges(edges: Edge[]): ReactFlowEdge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    type: edge.type || 'smoothstep',
    animated: edge.animated || false,
    label: edge.label,
  }))
}
