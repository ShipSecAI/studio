import { WorkflowGraph } from '../workflows/dto/workflow-graph.dto';
// Import component registry from worker package
import { componentRegistry } from '@shipsec/component-sdk';
import { WorkflowAction, WorkflowDefinition, WorkflowDefinitionSchema } from './types';

function topoSort(nodes: string[], edges: Array<{ source: string; target: string }>): string[] {
  const incoming = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  nodes.forEach((id) => {
    incoming.set(id, 0);
    adjacency.set(id, []);
  });

  for (const edge of edges) {
    if (!incoming.has(edge.target)) {
      throw new Error(`Edge references unknown node ${edge.target}`);
    }
    if (!incoming.has(edge.source)) {
      throw new Error(`Edge references unknown node ${edge.source}`);
    }
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    adjacency.get(edge.source)?.push(edge.target);
  }

  const queue: string[] = nodes.filter((id) => (incoming.get(id) ?? 0) === 0);
  const result: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    for (const neighbor of adjacency.get(current) ?? []) {
      incoming.set(neighbor, (incoming.get(neighbor) ?? 1) - 1);
      if ((incoming.get(neighbor) ?? 0) === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (result.length !== nodes.length) {
    throw new Error('Workflow graph contains a cycle');
  }

  return result;
}

export function compileWorkflowGraph(graph: WorkflowGraph): WorkflowDefinition {
  const nodeIds = graph.nodes.map((node) => node.id);

  // Ensure all nodes reference registered components.
  for (const node of graph.nodes) {
    if (!componentRegistry.get(node.type)) {
      throw new Error(`Component not registered: ${node.type}`);
    }
  }

  const orderedIds = topoSort(nodeIds, graph.edges);
  const incomingEdges = new Map<string, Set<string>>();
  type GraphEdge = typeof graph.edges[number];
  const edgesByTarget = new Map<string, GraphEdge[]>();
  for (const nodeId of nodeIds) {
    incomingEdges.set(nodeId, new Set());
    edgesByTarget.set(nodeId, []);
  }
  for (const edge of graph.edges) {
    incomingEdges.get(edge.target)?.add(edge.source);
    edgesByTarget.get(edge.target)?.push(edge);
  }

  const actions: WorkflowAction[] = orderedIds.map((id) => {
    const node = graph.nodes.find((n) => n.id === id)!;
    const params = node.data?.config ?? {};
    const inputMappings: WorkflowAction['inputMappings'] = {};

    for (const edge of edgesByTarget.get(id) ?? []) {
      const targetHandle = edge.targetHandle ?? edge.sourceHandle;
      const sourceHandle = edge.sourceHandle ?? '__self__';

      if (!targetHandle) {
        continue;
      }

      inputMappings[targetHandle] = {
        sourceRef: edge.source,
        sourceHandle,
      };
    }

    return {
      ref: id,
      componentId: node.type,
      params,
      dependsOn: Array.from(incomingEdges.get(id) ?? []),
      inputMappings,
    };
  });

  const entryNode = orderedIds[0];

  const definition: WorkflowDefinition = {
    title: graph.name,
    description: graph.description,
    entrypoint: { ref: entryNode },
    actions,
    config: { environment: 'default', timeoutSeconds: 0 },
  };

  return WorkflowDefinitionSchema.parse(definition);
}
