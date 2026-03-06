import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';

import type { AuthContext } from '../../auth/types';
import * as schema from '../../database/schema';
import { asmAssets, asmDomains } from '../../database/schema/asm';
import { AsmService } from '../asm.service';

const runIntegration = process.env.RUN_BACKEND_INTEGRATION === 'true';

const connectionString =
  process.env.DATABASE_URL ??
  process.env.STUDIO_DATABASE_URL ??
  'postgresql://shipsec:shipsec@localhost:5433/shipsec_instance_5';

const makeAuth = (organizationId: string): AuthContext => ({
  userId: `user-${randomUUID()}`,
  organizationId,
  roles: ['ADMIN'],
  isAuthenticated: true,
  provider: 'local',
});

describe.if(runIntegration)('AsmService integration', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let service: AsmService;
  const createdOrgIds = new Set<string>();

  beforeAll(() => {
    pool = new Pool({ connectionString });
    db = drizzle(pool, { schema });
    service = new AsmService(
      db as any,
      {
        list: async () => [],
      } as any,
      {} as any,
      {
        list: async () => [],
      } as any,
    );
  });

  afterEach(async () => {
    for (const organizationId of createdOrgIds) {
      await db.delete(asmAssets).where(eq(asmAssets.organizationId, organizationId));
      await db.delete(asmDomains).where(eq(asmDomains.organizationId, organizationId));
    }
    createdOrgIds.clear();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('reproduces the old ANY(($1)) Postgres failure with real ASM data', async () => {
    const organizationId = `org-${randomUUID()}`;
    createdOrgIds.add(organizationId);

    const [domain] = await db
      .insert(asmDomains)
      .values({
        organizationId,
        domain: `example-${randomUUID().slice(0, 8)}.com`,
      })
      .returning();

    await db.insert(asmAssets).values({
      organizationId,
      domainId: domain.id,
      hostname: `app.${domain.domain}`,
      type: 'subdomain',
      techStack: ['nginx'],
    });

    await expect(
      Promise.resolve(
        db.execute(sql`
        SELECT
          domain_id,
          COUNT(*)::int AS asset_count,
          COALESCE(
            ARRAY(SELECT DISTINCT unnest FROM unnest(array_agg(DISTINCT t.tech)) AS unnest WHERE unnest IS NOT NULL),
            '{}'
          ) AS techs
        FROM asm_assets a
        LEFT JOIN LATERAL unnest(a.tech_stack) AS t(tech) ON true
        WHERE a.domain_id = ANY(${[domain.id]})
        GROUP BY domain_id
      `),
      ),
    ).rejects.toThrow();
  });

  it('lists ASM domains successfully with asset stats on real Postgres data', async () => {
    const organizationId = `org-${randomUUID()}`;
    createdOrgIds.add(organizationId);
    const auth = makeAuth(organizationId);

    const [domain] = await db
      .insert(asmDomains)
      .values({
        organizationId,
        domain: `example-${randomUUID().slice(0, 8)}.com`,
      })
      .returning();

    await db.insert(asmAssets).values([
      {
        organizationId,
        domainId: domain.id,
        hostname: `app.${domain.domain}`,
        type: 'subdomain',
        techStack: ['nginx', 'react'],
      },
      {
        organizationId,
        domainId: domain.id,
        hostname: `api.${domain.domain}`,
        type: 'subdomain',
        techStack: ['nginx', 'bun'],
      },
    ]);

    const result = await service.listDomains(auth, { limit: 10, offset: 0 });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(domain.id);
    expect(result[0]?.domain).toBe(domain.domain);
    expect(result[0]?.assetCount).toBe(2);
    expect([...(result[0]?.techStack ?? [])].sort()).toEqual(['bun', 'nginx', 'react']);
  });
});
