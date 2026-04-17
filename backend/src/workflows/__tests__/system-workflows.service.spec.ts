import { describe, expect, it, mock } from 'bun:test';

import { SystemWorkflowsService } from '../system-workflows.service';

function createDbSelectQueue(results: unknown[]) {
  let index = 0;

  return {
    select: () => ({
      from: () => {
        const result = results[index++];
        return {
          leftJoin: () => ({
            where: async () => result,
          }),
          where: async () => result,
        };
      },
    }),
  } as any;
}

describe('SystemWorkflowsService.ensureSystemWorkflows', () => {
  it('updates existing system workflows when the backing default template graph changes', async () => {
    const existingWorkflows = [
      {
        id: 'workflow-1',
        name: 'AWS Cloud Security Scan',
        slug: 'sys-aws-cloud-security-scan',
        templateId: 'template-1',
      },
    ];
    const templateGraph = {
      name: 'AWS Cloud Security Scan',
      description: 'Updated template graph',
      nodes: [{ id: 'entry' }, { id: 'prowler' }],
      edges: [{ id: 'e1' }],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const db = createDbSelectQueue([
      existingWorkflows,
      [
        {
          id: 'template-1',
          name: 'AWS Cloud Security Scan',
          graph: templateGraph,
          isDefault: true,
        },
      ],
      existingWorkflows,
    ]);
    const workflowRepo = {
      createSystemWorkflow: mock(() => Promise.resolve(undefined)),
      findById: mock(() =>
        Promise.resolve({
          id: 'workflow-1',
          graph: {
            name: 'AWS Cloud Security Scan',
            description: 'Old graph',
            nodes: [{ id: 'entry' }],
            edges: [],
            viewport: { x: 0, y: 0, zoom: 1 },
          },
        }),
      ),
      update: mock(() => Promise.resolve(undefined)),
      delete: mock(() => Promise.resolve(undefined)),
    } as any;
    const versionRepo = {
      create: mock(() => Promise.resolve({ id: 'version-2' })),
    } as any;

    const service = new SystemWorkflowsService(db, workflowRepo, versionRepo);

    const result = await service.ensureSystemWorkflows('org-1');

    expect(workflowRepo.update).toHaveBeenCalledWith('workflow-1', templateGraph, {
      organizationId: 'org-1',
    });
    expect(versionRepo.create).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      graph: templateGraph,
      organizationId: 'org-1',
    });
    expect(result).toEqual(existingWorkflows);
  });
});
