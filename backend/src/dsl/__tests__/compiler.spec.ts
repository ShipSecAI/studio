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
          label: 'Trigger',
          position: { x: 0, y: 0 },
        },
        {
          id: 'loader',
          type: 'core.file.loader',
          label: 'File loader',
          position: { x: 0, y: 100 },
        },
        {
          id: 'webhook',
          type: 'core.webhook.post',
          label: 'Webhook',
          position: { x: 0, y: 200 },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'loader' },
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
  });

  it('throws when referencing an unknown component', () => {
    const graph: WorkflowGraph = {
      name: 'invalid workflow',
      nodes: [
        {
          id: 'missing',
          type: 'component.not.registered',
          label: 'Missing',
          position: { x: 0, y: 0 },
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
          label: 'A',
          position: { x: 0, y: 0 },
        },
        {
          id: 'b',
          type: registeredComponent.id,
          label: 'B',
          position: { x: 0, y: 100 },
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
});
