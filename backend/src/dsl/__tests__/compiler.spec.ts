import { describe, expect, it } from 'bun:test';

import '@shipsec/worker/components'; // Register components
import { WorkflowGraph } from '../../workflows/dto/workflow-graph.dto';
import { componentRegistry } from '@shipsec/component-sdk';
import { compileWorkflowGraph } from '../compiler';

describe('compileWorkflowGraph', () => {
  it('builds a workflow definition with actions in topological order', () => {
    const graph: WorkflowGraph = {
      name: 'Sample workflow',
      description: 'valid dag',
      nodes: [
        {
          id: 'trigger',
          type: 'core.trigger.manual',
          position: { x: 0, y: 0 },
          data: {
            label: 'Trigger',
            config: {
              runtimeInputs: [
                { id: 'fileId', label: 'File ID', type: 'text', required: true },
              ],
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
              fileId: '00000000-0000-4000-8000-000000000001',
            },
          },
        },
        {
          id: 'webhook',
          type: 'core.webhook.post',
          position: { x: 0, y: 200 },
          data: {
            label: 'Webhook',
            config: {
              url: 'https://example.com/webhook',
              payload: { from: 'loader' },
            },
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'loader', sourceHandle: 'fileId', targetHandle: 'fileId' },
        { id: 'e2', source: 'loader', target: 'webhook' },
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
        sourceHandle: undefined,
        targetHandle: undefined,
        kind: 'success',
      },
    ]);
  });

  it('throws when referencing an unknown component', () => {
    const graph: WorkflowGraph = {
      name: 'invalid workflow',
      nodes: [
        {
          id: 'missing',
          type: 'component.not.registered',
          position: { x: 0, y: 0 },
          data: {
            label: 'Missing',
            config: {},
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
    const registeredComponent = componentRegistry.get('core.trigger.manual');
    if (!registeredComponent) {
      throw new Error('Default components must be registered for tests');
    }

    const graph: WorkflowGraph = {
      name: 'cyclic workflow',
      nodes: [
        {
          id: 'a',
          type: registeredComponent.id,
          position: { x: 0, y: 0 },
          data: {
            label: 'A',
            config: {
              runtimeInputs: [
                { id: 'inputA', label: 'Input A', type: 'text', required: false },
              ],
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
              runtimeInputs: [
                { id: 'inputB', label: 'Input B', type: 'text', required: false },
              ],
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

    expect(() => compileWorkflowGraph(graph)).toThrow(
      'Workflow graph contains a cycle',
    );
  });

  it('tracks dependency counts and metadata for converging branches', () => {
    const graph: WorkflowGraph = {
      name: 'Diamond workflow',
      nodes: [
        {
          id: 'start',
          type: 'core.trigger.manual',
          position: { x: 0, y: 0 },
          data: {
            label: 'Start',
            config: {
              runtimeInputs: [
                { id: 'branchSeed', label: 'Seed', type: 'text', required: false },
              ],
            },
          },
        },
        {
          id: 'branchA',
          type: 'core.trigger.manual',
          position: { x: -100, y: 100 },
          data: {
            label: 'Branch A',
            config: {
              runtimeInputs: [
                { id: 'branchAInput', label: 'Branch A Input', type: 'text', required: false },
              ],
            },
          },
        },
        {
          id: 'branchB',
          type: 'core.trigger.manual',
          position: { x: 100, y: 100 },
          data: {
            label: 'Branch B',
            config: {
              runtimeInputs: [
                { id: 'branchBInput', label: 'Branch B Input', type: 'text', required: false },
              ],
            },
          },
        },
        {
          id: 'merge',
          type: 'core.trigger.manual',
          position: { x: 0, y: 200 },
          data: {
            label: 'Merge',
            config: {
              runtimeInputs: [
                { id: 'mergeInput', label: 'Merge Input', type: 'text', required: false },
              ],
            },
          },
        },
      ],
      edges: [
        { id: 'start-a', source: 'start', target: 'branchA', sourceHandle: 'out', targetHandle: 'inA' },
        { id: 'start-b', source: 'start', target: 'branchB', sourceHandle: 'out', targetHandle: 'inB' },
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
      sourceHandle: 'out',
      targetHandle: 'inA',
      kind: 'success',
    });
  });
});
