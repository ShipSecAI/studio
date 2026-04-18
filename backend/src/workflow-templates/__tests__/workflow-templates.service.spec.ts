import { describe, expect, it } from 'bun:test';

import { WorkflowTemplatesService } from '../workflow-templates.service';

describe('WorkflowTemplatesService.syncDefaultGraphs', () => {
  it('creates a new workflow version instead of rewriting existing versions', async () => {
    const updateCalls: { table: any; values: any }[] = [];
    const insertCalls: { table: any; values: any }[] = [];
    let selectCall = 0;
    const db = {
      select: () => ({
        from: () => {
          const current = selectCall++;
          if (current === 0) {
            return {
              where: async () => [{ id: 'workflow-1', organizationId: 'org-1' }],
            };
          }

          return {
            where: () => ({
              orderBy: () => ({
                limit: async () => [{ version: 3 }],
              }),
            }),
          };
        },
      }),
      update: (table: any) => ({
        set: (values: any) => ({
          where: async () => {
            updateCalls.push({ table, values });
          },
        }),
      }),
      insert: (table: any) => ({
        values: async (values: any) => {
          insertCalls.push({ table, values });
        },
      }),
      delete: () => ({
        where: async () => undefined,
      }),
    } as any;

    const service = new WorkflowTemplatesService(db);

    await (service as any).syncDefaultGraphs([
      {
        id: 'template-1',
        name: 'AWS Cloud Security Scan',
        slug: 'sys-aws-cloud-security-scan',
        isDefault: true,
        graph: { name: 'old', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      },
    ]);

    expect(updateCalls).toHaveLength(2);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]?.values).toEqual(
      expect.objectContaining({
        workflowId: 'workflow-1',
        version: 4,
        organizationId: 'org-1',
      }),
    );
  });
});
