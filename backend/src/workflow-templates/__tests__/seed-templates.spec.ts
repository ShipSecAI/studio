import { describe, expect, it } from 'bun:test';

import { compileWorkflowGraph } from '../../dsl/compiler';
import { WorkflowGraphSchema } from '../../workflows/dto/workflow-graph.dto';
import { SEED_TEMPLATES } from '../seed-templates';

describe('SEED_TEMPLATES', () => {
  it('keeps all seeded graphs compilable', () => {
    for (const template of SEED_TEMPLATES) {
      const graph = WorkflowGraphSchema.parse(template.graph);
      expect(() => compileWorkflowGraph(graph)).not.toThrow();
    }
  });

  it('fans Attack Surface Recon dedupe output into analytics and ASM assets', () => {
    const template = SEED_TEMPLATES.find((item) => item.slug === 'sys-attack-surface-recon');
    expect(template).toBeDefined();
    if (!template) throw new Error('Attack Surface Recon template not found');

    const graph = WorkflowGraphSchema.parse(template.graph);
    const dedupe = graph.nodes.find((node) => node.type === 'core.asm.recon-dedupe');
    const analytics = graph.nodes.find((node) => node.type === 'core.analytics.sink');
    const asmAssets = graph.nodes.find((node) => node.type === 'core.asm.assets-upsert');

    expect(dedupe).toBeDefined();
    expect(analytics).toBeDefined();
    expect(asmAssets).toBeDefined();
    expect(
      graph.edges.some(
        (edge) =>
          edge.source === dedupe?.id &&
          edge.target === analytics?.id &&
          edge.sourceHandle === 'results' &&
          edge.targetHandle === 'input1',
      ),
    ).toBe(true);
    expect(
      graph.edges.some(
        (edge) =>
          edge.source === dedupe?.id &&
          edge.target === asmAssets?.id &&
          edge.sourceHandle === 'results' &&
          edge.targetHandle === 'results',
      ),
    ).toBe(true);
  });
});
