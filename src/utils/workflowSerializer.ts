import type { Node as ReactFlowNode, Edge as ReactFlowEdge } from 'reactflow'
import type { NodeData } from '@/schemas/node'
import type { Node, Edge } from '@/schemas'
import { NodeSchema, EdgeSchema } from '@/schemas'
import { CreateWorkflowSchema, UpdateWorkflowSchema } from '@/schemas/workflow'

/**
 * Serialize React Flow nodes to API format
 * Strips runtime execution state and React Flow metadata
 */
export function serializeNodes(reactFlowNodes: ReactFlowNode<NodeData>[]): Node[] {
  return reactFlowNodes.map((node) => {
    // Strip execution state from node data
    const { status, executionTime, error, config, ...cleanData } = node.data

    // Create clean node structure
    const cleanNode = {
      id: node.id,
      type: node.data.componentSlug.includes('file-loader')
        ? 'input'
        : node.data.componentSlug.includes('subfinder') ||
          node.data.componentSlug.includes('nuclei')
        ? 'scan'
        : node.data.componentSlug.includes('merge')
        ? 'process'
        : 'output', // Infer type from component slug
      position: node.position,
      data: cleanData,
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
  const payload = {
    name,
    description: description || '',
    nodes: serializeNodes(nodes),
    edges: serializeEdges(edges),
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
 */
export function deserializeNodes(nodes: Node[]): ReactFlowNode<NodeData>[] {
  return nodes.map((node) => ({
    id: node.id,
    type: 'workflow', // All nodes use the same React Flow type
    position: node.position,
    data: {
      ...node.data,
      status: 'idle', // Reset execution state
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
