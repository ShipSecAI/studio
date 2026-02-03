import { describe, expect, it } from 'bun:test';

import '@shipsec/studio-worker/components'; // Register components
import { WorkflowGraphDto } from '../../workflows/dto/workflow-graph.dto';
import { componentRegistry } from '@shipsec/component-sdk';
import { compileWorkflowGraph } from '../compiler';

describe('compileWorkflowGraph', () => {
  it('builds a workflow definition with actions in topological order', () => {
    const graph: WorkflowGraphDto = {
      name: 'Sample workflow',
      description: 'valid dag',
      nodes: [
        {
          id: 'trigger',
          type: 'core.workflow.entrypoint',
          position: { x: 0, y: 0 },
          data: {
            label: 'Trigger',
            config: {
              params: {
                runtimeInputs: [{ id: 'fileId', label: 'File ID', type: 'file', required: true }],
              },
              inputOverrides: {},
            },
          },
        },
        {
          id: 'loader',
          type: 'core.file.loader',
          position: { x: 0, y: 100 },
          data: {
            label: 'File loader',
            config: {
              params: {},
              inputOverrides: {
                fileId: '11111111-1111-4111-8111-111111111111',
              },
            },
          },
        },
        {
          id: 'webhook',
          type: 'core.http.request',
          position: { x: 0, y: 200 },
          data: {
            label: 'Webhook',
            config: {
              params: {
                method: 'POST',
              },
              inputOverrides: {
                url: 'https://example.com/webhook',
                body: JSON.stringify({ from: 'loader' }),
              },
            },
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trigger',
          target: 'loader',
          sourceHandle: 'fileId',
          targetHandle: 'fileId',
        },
        {
          id: 'e2',
          source: 'loader',
          target: 'webhook',
          sourceHandle: 'textContent',
          targetHandle: 'body',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const definition = compileWorkflowGraph(graph);

    expect(definition.title).toBe('Sample workflow');
    expect(definition.entrypoint.ref).toBe('trigger');
    expect(definition.actions.map((action) => action.ref)).toEqual([
      'trigger',
      'loader',
      'webhook',
    ]);
    expect(definition.actions[1].dependsOn).toEqual(['trigger']);
    expect(definition.actions[2].dependsOn).toEqual(['loader']);
    expect(definition.version).toBe(2);
    expect(Object.keys(definition.nodes)).toEqual(['trigger', 'loader', 'webhook']);
    expect(definition.nodes.trigger.label).toBe('Trigger');
    expect(definition.dependencyCounts).toMatchObject({
      trigger: 0,
      loader: 1,
      webhook: 1,
    });
    expect(definition.edges).toEqual([
      {
        id: 'e1',
        sourceRef: 'trigger',
        targetRef: 'loader',
        sourceHandle: 'fileId',
        targetHandle: 'fileId',
        kind: 'success',
      },
      {
        id: 'e2',
        sourceRef: 'loader',
        targetRef: 'webhook',
        sourceHandle: 'textContent',
        targetHandle: 'body',
        kind: 'success',
      },
    ]);
  });

  it('throws when referencing an unknown component', () => {
    const graph: WorkflowGraphDto = {
      name: 'invalid workflow',
      nodes: [
        {
          id: 'missing',
          type: 'component.not.registered',
          position: { x: 0, y: 0 },
          data: {
            label: 'Missing',
            config: {
              params: {},
              inputOverrides: {},
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    expect(() => compileWorkflowGraph(graph)).toThrow(
      'Component not registered: component.not.registered',
    );
  });

  it('throws when workflow contains a cycle', () => {
    const registeredComponent = componentRegistry.get('core.workflow.entrypoint');
    if (!registeredComponent) {
      throw new Error('Default components must be registered for tests');
    }

    const graph: WorkflowGraphDto = {
      name: 'cyclic workflow',
      nodes: [
        {
          id: 'a',
          type: registeredComponent.id,
          position: { x: 0, y: 0 },
          data: {
            label: 'A',
            config: {
              params: {
                runtimeInputs: [{ id: 'inputA', label: 'Input A', type: 'text', required: false }],
              },
              inputOverrides: {},
            },
          },
        },
        {
          id: 'b',
          type: registeredComponent.id,
          position: { x: 0, y: 100 },
          data: {
            label: 'B',
            config: {
              params: {
                runtimeInputs: [{ id: 'inputB', label: 'Input B', type: 'text', required: false }],
              },
              inputOverrides: {},
            },
          },
        },
      ],
      edges: [
        { id: 'a-to-b', source: 'a', target: 'b' },
        { id: 'b-to-a', source: 'b', target: 'a' },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    expect(() => compileWorkflowGraph(graph)).toThrow('Workflow graph contains a cycle');
  });

  it('always marks the Entry Point component as the workflow entrypoint', () => {
    const graph: WorkflowGraphDto = {
      name: 'misordered root workflow',
      nodes: [
        {
          id: 'log-node',
          type: 'core.text.splitter',
          position: { x: 0, y: 0 },
          data: {
            label: 'Text Splitter',
            config: {
              params: {
                separator: '\\n',
              },
              inputOverrides: {
                text: 'hello',
              },
            },
          },
        },
        {
          id: 'entry-node',
          type: 'core.workflow.entrypoint',
          position: { x: 0, y: 150 },
          data: {
            label: 'Entry Point',
            config: {
              params: {
                runtimeInputs: [{ id: 'inputA', label: 'Input A', type: 'text', required: true }],
              },
              inputOverrides: {},
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const definition = compileWorkflowGraph(graph);

    expect(definition.entrypoint.ref).toBe('entry-node');
  });

  it('tracks dependency counts and metadata for converging branches', () => {
    const graph: WorkflowGraphDto = {
      name: 'Diamond workflow',
      nodes: [
        {
          id: 'start',
          type: 'core.workflow.entrypoint',
          position: { x: 0, y: 0 },
          data: {
            label: 'Start',
            config: {
              params: {
                runtimeInputs: [{ id: 'branchSeed', label: 'Seed', type: 'text', required: false }],
              },
              inputOverrides: {},
            },
          },
        },
        {
          id: 'branchA',
          type: 'core.text.splitter',
          position: { x: -100, y: 100 },
          data: {
            label: 'Branch A',
            config: {
              params: {
                separator: '\n',
              },
              inputOverrides: {
                text: 'Branch A payload',
              },
            },
          },
        },
        {
          id: 'branchB',
          type: 'core.text.splitter',
          position: { x: 100, y: 100 },
          data: {
            label: 'Branch B',
            config: {
              params: {
                separator: '\n',
              },
              inputOverrides: {
                text: 'Branch B payload',
              },
            },
          },
        },
        {
          id: 'merge',
          type: 'core.text.splitter',
          position: { x: 0, y: 200 },
          data: {
            label: 'Merge',
            config: {
              params: {
                separator: '\n',
              },
              inputOverrides: {
                text: 'Merge payload',
              },
            },
          },
        },
      ],
      edges: [
        { id: 'start-a', source: 'start', target: 'branchA' },
        { id: 'start-b', source: 'start', target: 'branchB' },
        { id: 'a-merge', source: 'branchA', target: 'merge' },
        { id: 'b-merge', source: 'branchB', target: 'merge' },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const definition = compileWorkflowGraph(graph);

    const mergeAction = definition.actions.find((action) => action.ref === 'merge');
    expect(mergeAction?.dependsOn.sort()).toEqual(['branchA', 'branchB']);
    expect(definition.dependencyCounts.merge).toBe(2);
    expect(definition.nodes.merge.label).toBe('Merge');
    expect(definition.edges.find((edge) => edge.id === 'start-a')).toEqual({
      id: 'start-a',
      sourceRef: 'start',
      targetRef: 'branchA',
      sourceHandle: undefined,
      targetHandle: undefined,
      kind: 'success',
    });
  });

  it('populates connectedToolNodeIds for nodes with incoming edges to the tools port', () => {
    const graph: WorkflowGraphDto = {
      name: 'Agent Tool workflow',
      nodes: [
        {
          id: 'start',
          type: 'core.workflow.entrypoint',
          position: { x: 0, y: 0 },
          data: {
            label: 'Start',
            config: { params: { runtimeInputs: [] }, inputOverrides: {} },
          },
        },
        {
          id: 'tool1',
          type: 'core.http.request',
          position: { x: 0, y: 100 },
          data: {
            label: 'Tool 1',
            config: {
              mode: 'tool',
              params: {},
              inputOverrides: { url: 'https://tool1.com' },
            },
          },
        },
        {
          id: 'tool2',
          type: 'core.http.request',
          position: { x: 100, y: 100 },
          data: {
            label: 'Tool 2',
            config: {
              mode: 'tool',
              params: {},
              inputOverrides: { url: 'https://tool2.com' },
            },
          },
        },
        {
          id: 'agent',
          type: 'core.ai.agent',
          position: { x: 50, y: 200 },
          data: {
            label: 'Agent',
            config: {
              params: {},
              inputOverrides: { userInput: 'Hello' },
            },
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'tool1' },
        { id: 'e2', source: 'start', target: 'tool2' },
        {
          id: 't1',
          source: 'tool1',
          target: 'agent',
          sourceHandle: 'tools',
          targetHandle: 'tools',
        },
        {
          id: 't2',
          source: 'tool2',
          target: 'agent',
          sourceHandle: 'tools',
          targetHandle: 'tools',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const definition = compileWorkflowGraph(graph);

    expect(definition.nodes.agent.connectedToolNodeIds).toHaveLength(2);
    expect(definition.nodes.agent.connectedToolNodeIds).toContain('tool1');
    expect(definition.nodes.agent.connectedToolNodeIds).toContain('tool2');
    expect(definition.nodes.tool1.mode).toBe('tool');
    expect(definition.nodes.tool2.mode).toBe('tool');
  });
});
