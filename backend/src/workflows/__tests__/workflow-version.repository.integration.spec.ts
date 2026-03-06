import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';

import { WorkflowGraphSchema, type WorkflowGraphDto } from '../dto/workflow-graph.dto';
import { WorkflowVersionRepository } from '../repository/workflow-version.repository';

const runIntegration = process.env.RUN_BACKEND_INTEGRATION === 'true';

const connectionString =
  process.env.DATABASE_URL ??
  process.env.STUDIO_DATABASE_URL ??
  'postgresql://shipsec:shipsec@localhost:5433/shipsec_instance_5';

const buildGraph = (name: string): WorkflowGraphDto =>
  WorkflowGraphSchema.parse({
    name,
    description: 'repository integration test',
    nodes: [
      {
        id: 'trigger',
        type: 'core.workflow.entrypoint',
        position: { x: 0, y: 0 },
        data: {
          label: 'Trigger',
          config: {
            params: {},
            inputOverrides: {},
          },
        },
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  });

describe.if(runIntegration)('WorkflowVersionRepository integration', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let repository: WorkflowVersionRepository;

  beforeAll(() => {
    pool = new Pool({ connectionString });
    db = drizzle(pool);
    repository = new WorkflowVersionRepository(db as any);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM workflow_versions`);
  });

  it('returns the latest version for each workflow within the organization', async () => {
    const orgId = `org-${randomUUID()}`;
    const otherOrgId = `org-${randomUUID()}`;
    const workflowA = randomUUID();
    const workflowB = randomUUID();
    const workflowC = randomUUID();

    await repository.create({
      workflowId: workflowA,
      graph: buildGraph('A v1'),
      organizationId: orgId,
    });
    await repository.create({
      workflowId: workflowA,
      graph: buildGraph('A v2'),
      organizationId: orgId,
    });
    await repository.create({
      workflowId: workflowB,
      graph: buildGraph('B v1'),
      organizationId: orgId,
    });
    await repository.create({
      workflowId: workflowC,
      graph: buildGraph('C other org'),
      organizationId: otherOrgId,
    });

    const result = await repository.findLatestByWorkflowIds([workflowA, workflowB, workflowC], {
      organizationId: orgId,
    });

    expect(result.get(workflowA)?.version).toBe(2);
    expect(result.get(workflowA)?.organizationId).toBe(orgId);
    expect(result.get(workflowB)?.version).toBe(1);
    expect(result.get(workflowB)?.organizationId).toBe(orgId);
    expect(result.has(workflowC)).toBe(false);
  });
});
