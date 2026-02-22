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
});
