import { WorkflowGraphDto, WorkflowNodeDto } from '../workflows/dto/workflow-graph.dto';
// Ensure all worker components are registered before accessing the registry
import '../../../worker/src/components';
import { componentRegistry } from '@shipsec/component-sdk';
import {
  WorkflowAction,
  WorkflowDefinition,
  WorkflowDefinitionSchema,
  WorkflowEdge,
  WorkflowNodeMetadata,
} from './types';
import { validateWorkflowGraph } from './validator';

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

export function compileWorkflowGraph(graph: WorkflowGraphDto): WorkflowDefinition {
  // Filter out UI-only nodes (like text-block) that shouldn't be executed
  const executableNodes = graph.nodes.filter((node: WorkflowNodeDto) => {
    const component = componentRegistry.get(node.type);
    if (!component) {
      return true; // Let validation catch unknown components
    }
    // Skip UI-only components (they're for documentation/notes, not execution)
    const isUiOnly = (component.metadata as any)?.uiOnly === true;
    return !isUiOnly;
  });

  const nodeIds = executableNodes.map((node: WorkflowNodeDto) => node.id);

  // Ensure all executable nodes reference registered components.
  for (const node of executableNodes) {
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

  const nodesMetadata: Record<string, WorkflowNodeMetadata> = {};
  for (const node of executableNodes) {
    const config = (node.data?.config ?? {}) as Record<string, unknown>;
    const joinStrategyValue = config.joinStrategy;
    const joinStrategy =
      typeof joinStrategyValue === 'string' && ['all', 'any', 'first'].includes(joinStrategyValue)
        ? (joinStrategyValue as WorkflowNodeMetadata['joinStrategy'])
        : undefined;

    const streamIdValue = config.streamId;
    const groupIdValue = config.groupId;
    const maxConcurrencyValue = config.maxConcurrency;

    nodesMetadata[node.id] = {
      ref: node.id,
      label: node.data?.label,
      joinStrategy,
      streamId: typeof streamIdValue === 'string' && streamIdValue.length > 0 ? streamIdValue : undefined,
      groupId: typeof groupIdValue === 'string' && groupIdValue.length > 0 ? groupIdValue : undefined,
      maxConcurrency:
        typeof maxConcurrencyValue === 'number' && Number.isFinite(maxConcurrencyValue)
          ? maxConcurrencyValue
          : undefined,
    };
  }

  const actions: WorkflowAction[] = orderedIds.map((id) => {
    const node = executableNodes.find((n: WorkflowNodeDto) => n.id === id)!;
    const config = (node.data?.config ?? {}) as Record<string, unknown>;
    const {
      joinStrategy: _joinStrategy,
      streamId: _streamId,
      groupId: _groupId,
      maxConcurrency: _maxConcurrency,
      ...componentParams
    } = config;

    // Build input mappings from edges
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

    const component = componentRegistry.get(node.type);
    const params: Record<string, unknown> = { ...componentParams };

    const inputMetadata = new Map(
      component?.metadata?.inputs?.map((input) => [input.id, input]) ?? [],
    );

    // Remove manual values for connected ports unless the port explicitly prefers manual overrides
    for (const targetKey of Object.keys(inputMappings)) {
      const metadata = inputMetadata.get(targetKey);
      const prefersManual = metadata?.valuePriority === 'manual-first';
      if (!prefersManual) {
        delete params[targetKey];
      }
    }

    // Validate required inputs have either a manual value or a connection
    for (const [inputId, metadata] of inputMetadata.entries()) {
      if (!metadata.required) {
        continue;
      }

      const hasPortMapping = Boolean(inputMappings[inputId]);
      const manualValue = componentParams[inputId];
      const hasManual =
        manualValue !== undefined &&
        manualValue !== null &&
        (typeof manualValue !== 'string' || manualValue.trim().length > 0);

      if (!hasPortMapping && !hasManual) {
        throw new Error(
          `[${node.type}] Required input '${inputId}' is missing. Provide a manual value or connect a port.`,
        );
      }
    }

    return {
      ref: id,
      componentId: node.type,
      params,
      dependsOn: Array.from(incomingEdges.get(id) ?? []),
      inputMappings,
    };
  });

  const entrypointAction = actions.find(
    (action) => action.componentId === 'core.workflow.entrypoint',
  );
  if (!entrypointAction) {
    throw new Error('Workflow requires an Entry Point component (core.workflow.entrypoint).');
  }
  const entryNode = entrypointAction.ref;

  const dependencyCounts: Record<string, number> = {};
  for (const action of actions) {
    dependencyCounts[action.ref] = action.dependsOn.length;
  }

  const edges: WorkflowEdge[] = graph.edges.map((edge) => ({
    id: edge.id,
    sourceRef: edge.source,
    targetRef: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    kind: 'success',
  }));

  // Verify the entrypoint ref points to an entrypoint component
  const entrypointActionVerify = actions.find((action) => action.ref === entryNode);
  if (!entrypointActionVerify || entrypointActionVerify.componentId !== 'core.workflow.entrypoint') {
    throw new Error(
      `Workflow compilation error: Entrypoint ref '${entryNode}' does not point to an Entry Point component. ` +
      `Found component: ${entrypointActionVerify?.componentId ?? 'none'}. ` +
      `This indicates a workflow configuration error.`
    );
  }

  const definition: WorkflowDefinition = {
    version: 2,
    title: graph.name,
    description: graph.description,
    entrypoint: { ref: entryNode },
    nodes: nodesMetadata,
    edges,
    dependencyCounts,
    actions,
    config: { environment: 'default', timeoutSeconds: 0 },
  };

  // Validate the workflow before returning
  const validationResult = validateWorkflowGraph(graph, definition);
  if (!validationResult.isValid) {
    const errorMessages = validationResult.errors.map(e => `[${e.node}] ${e.field}: ${e.message}${e.suggestion ? ' (Suggestion: ' + e.suggestion + ')' : ''}`);
    const errorMessage = `Workflow validation failed:\n${errorMessages.join('\n')}`;
    throw new Error(errorMessage);
  }

  // Log warnings for user information
  if (validationResult.warnings.length > 0) {
    console.warn(`Workflow validation warnings for ${graph.name}:`);
    validationResult.warnings.forEach(w => {
      console.warn(`  [${w.node}] ${w.field}: ${w.message}${w.suggestion ? ' (Suggestion: ' + w.suggestion + ')' : ''}`);
    });
  }

  return WorkflowDefinitionSchema.parse(definition);
}
