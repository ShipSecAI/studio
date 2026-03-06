import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import { Pool } from 'pg';

import * as schema from '../../database/schema';
import { mcpServers, mcpServerTools } from '../../database/schema';
import { McpServersRepository } from '../mcp-servers.repository';

const runIntegration = process.env.RUN_BACKEND_INTEGRATION === 'true';

const connectionString =
  process.env.DATABASE_URL ??
  process.env.STUDIO_DATABASE_URL ??
  'postgresql://shipsec:shipsec@localhost:5433/shipsec_instance_5';

describe.if(runIntegration)('McpServersRepository integration', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let repository: McpServersRepository;
  const createdServerIds = new Set<string>();

  beforeAll(() => {
    pool = new Pool({ connectionString });
    db = drizzle(pool, { schema });
    repository = new McpServersRepository(db as any);
  });

  afterEach(async () => {
    for (const serverId of createdServerIds) {
      await db.delete(mcpServerTools).where(eq(mcpServerTools.serverId, serverId));
      await db.delete(mcpServers).where(eq(mcpServers.id, serverId));
    }
    createdServerIds.clear();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('upsertTools removes missing tool names and keeps the retained tool enabled state', async () => {
    const organizationId = `org-${randomUUID()}`;
    const server = await repository.create({
      name: `test-server-${randomUUID().slice(0, 8)}`,
      description: 'integration test server',
      transportType: 'stdio',
      command: 'echo',
      args: ['hello'],
      organizationId,
      createdBy: 'integration-test',
    });
    createdServerIds.add(server.id);

    const initialTools = await repository.upsertTools(server.id, [
      {
        toolName: 'alpha',
        description: 'alpha tool',
        inputSchema: { type: 'object' },
      },
      {
        toolName: 'beta',
        description: 'beta tool',
        inputSchema: { type: 'object' },
      },
      {
        toolName: 'gamma',
        description: 'gamma tool',
        inputSchema: { type: 'object' },
      },
    ]);

    const beta = initialTools.find((tool) => tool.toolName === 'beta');
    expect(beta).toBeDefined();

    await db
      .update(mcpServerTools)
      .set({ enabled: false })
      .where(and(eq(mcpServerTools.serverId, server.id), eq(mcpServerTools.toolName, 'beta')));

    await repository.upsertTools(server.id, [
      {
        toolName: 'beta',
        description: 'beta tool updated',
        inputSchema: { type: 'object', title: 'beta' },
      },
      {
        toolName: 'delta',
        description: 'delta tool',
        inputSchema: { type: 'object' },
      },
    ]);

    const tools = await repository.listTools(server.id);

    expect(tools.map((tool) => tool.toolName)).toEqual(['beta', 'delta']);
    expect(tools.find((tool) => tool.toolName === 'beta')?.enabled).toBe(false);
    expect(tools.find((tool) => tool.toolName === 'beta')?.description).toBe('beta tool updated');
  });
});
