import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import neo4j from 'neo4j-driver';
import type { Driver } from 'neo4j-driver';
import { ConfigService } from '@nestjs/config';
import type { AuthContext } from '../../auth/types';
import { checkPermission, errorResult, jsonResult } from './types';

/**
 * Write-operation keywords that are blocked to enforce read-only access.
 * Reuses the same validation logic as the worker's cartography-query component.
 */
const WRITE_KEYWORDS = [
  'CREATE',
  'MERGE',
  'DELETE',
  'DETACH',
  'SET',
  'REMOVE',
  'DROP',
  'CALL\\s+\\{',
  'FOREACH',
] as const;

const WRITE_PATTERN = new RegExp(`\\b(${WRITE_KEYWORDS.join('|')})\\b`, 'i');

function isReadOnlyQuery(query: string): boolean {
  const stripped = query
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""');
  return !WRITE_PATTERN.test(stripped);
}

const DEFAULT_QUERY_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RECORDS = 500;

/**
 * Convert Neo4j driver values to plain JavaScript objects.
 */
function toPlainValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (neo4j.isInt(value)) {
    return neo4j.integer.inSafeRange(value)
      ? neo4j.integer.toNumber(value)
      : neo4j.integer.toString(value);
  }

  if (value instanceof neo4j.types.Node) {
    return {
      _type: 'node',
      labels: value.labels,
      properties: toPlainValue(value.properties),
      elementId: value.elementId,
    };
  }

  if (value instanceof neo4j.types.Relationship) {
    return {
      _type: 'relationship',
      type: value.type,
      properties: toPlainValue(value.properties),
      startNodeElementId: value.startNodeElementId,
      endNodeElementId: value.endNodeElementId,
      elementId: value.elementId,
    };
  }

  if (value instanceof neo4j.types.Path) {
    return {
      _type: 'path',
      start: toPlainValue(value.start),
      end: toPlainValue(value.end),
      segments: value.segments.map((seg) => ({
        start: toPlainValue(seg.start),
        relationship: toPlainValue(seg.relationship),
        end: toPlainValue(seg.end),
      })),
    };
  }

  if (Array.isArray(value)) {
    return value.map(toPlainValue);
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = toPlainValue(val);
    }
    return result;
  }

  return value;
}

export function registerCloudGraphTools(
  server: McpServer,
  auth: AuthContext,
  deps: { configService: ConfigService },
): void {
  function getDriver(): Driver {
    const uri = deps.configService.get<string>('NEO4J_URI', 'bolt://localhost:7687');
    const user = deps.configService.get<string>('NEO4J_USER', '');
    const password = deps.configService.get<string>('NEO4J_PASSWORD', '');
    const neo4jAuth =
      user.trim().length > 0 && password.trim().length > 0
        ? neo4j.auth.basic(user, password)
        : undefined;

    return neo4j.driver(uri, neo4jAuth, {
      disableLosslessIntegers: true,
    });
  }

  // ── Query Cloud Graph ─────────────────────────────────────────────────

  server.registerTool(
    'query_cloud_graph',
    {
      description:
        'Execute a read-only Cypher query against the Cartography Neo4j infrastructure graph. ' +
        'Use this to investigate cloud assets, relationships, blast radius, and security posture. ' +
        'Supports MATCH, RETURN, WHERE, WITH, ORDER BY, LIMIT, SKIP, UNION, UNWIND, OPTIONAL MATCH. ' +
        'Write operations (CREATE, MERGE, DELETE, SET, REMOVE, DROP) are blocked. ' +
        'Examples: "MATCH (i:EC2Instance) WHERE i.exposed_internet = true RETURN i.name, i.publicipaddress", ' +
        '"MATCH (r:AWSRole)-[:POLICY]->(p:AWSPolicy) WHERE p.name CONTAINS \'admin\' RETURN r.name, p.name"',
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe(
            'Read-only Cypher query. Must use MATCH/RETURN patterns. No write operations allowed.',
          ),
        parameters: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'Optional query parameters for parameterized Cypher queries ($param references).',
          ),
        maxRecords: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe('Maximum number of records to return (default: 500, max: 1000).'),
      },
    },
    async (params) => {
      const gate = checkPermission(auth, 'assets.read');
      if (!gate.allowed) return gate.error;

      const query = params.query.trim();

      // Enforce read-only
      if (!isReadOnlyQuery(query)) {
        return errorResult(
          new Error(
            'Write operations are not allowed. Only read-only Cypher queries (MATCH, RETURN, WITH, WHERE, ORDER BY, LIMIT) are permitted.',
          ),
        );
      }

      const maxRecords = params.maxRecords ?? DEFAULT_MAX_RECORDS;
      const database = deps.configService.get<string>('NEO4J_DATABASE', 'neo4j');
      const driver = getDriver();
      const session = driver.session({
        database,
        defaultAccessMode: neo4j.session.READ,
      });

      try {
        const startTime = Date.now();
        const result = await session.run(query, params.parameters ?? {}, {
          timeout: DEFAULT_QUERY_TIMEOUT_MS,
        });
        const queryTimeMs = Date.now() - startTime;

        const truncated = result.records.length > maxRecords;
        const limitedRecords = result.records.slice(0, maxRecords);

        const records = limitedRecords.map((record: any) => {
          const obj: Record<string, unknown> = {};
          for (const key of record.keys as string[]) {
            obj[key] = toPlainValue(record.get(key));
          }
          return obj;
        });

        const keys = result.records.length > 0 ? [...result.records[0].keys] : [];

        return jsonResult({
          records,
          keys,
          recordCount: records.length,
          totalAvailable: result.records.length,
          truncated,
          queryTimeMs,
        });
      } catch (error) {
        return errorResult(error);
      } finally {
        await session.close();
        await driver.close();
      }
    },
  );

  // ── Get Cloud Graph Schema ─────────────────────────────────────────────

  server.registerTool(
    'get_cloud_graph_schema',
    {
      description:
        'Get the labels and relationship types available in the Cartography cloud graph. ' +
        'Use this to discover what asset types (EC2Instance, S3Bucket, AWSRole, etc.) and ' +
        'relationships (RESOURCE, POLICY, MEMBER_OF_IAM_GROUP, etc.) exist before writing Cypher queries.',
      inputSchema: {},
    },
    async () => {
      const gate = checkPermission(auth, 'assets.read');
      if (!gate.allowed) return gate.error;

      const database = deps.configService.get<string>('NEO4J_DATABASE', 'neo4j');
      const driver = getDriver();
      const session = driver.session({
        database,
        defaultAccessMode: neo4j.session.READ,
      });

      try {
        const [labelsResult, relTypesResult] = await Promise.all([
          session.run('CALL db.labels()', {}, { timeout: 5000 }),
          session.run('CALL db.relationshipTypes()', {}, { timeout: 5000 }),
        ]);

        const labels = labelsResult.records.map((r: any) => toPlainValue(r.get(0)) as string);
        const relationshipTypes = relTypesResult.records.map(
          (r: any) => toPlainValue(r.get(0)) as string,
        );

        return jsonResult({
          labels: labels.sort(),
          relationshipTypes: relationshipTypes.sort(),
          labelCount: labels.length,
          relationshipTypeCount: relationshipTypes.length,
        });
      } catch (error) {
        return errorResult(error);
      } finally {
        await session.close();
        await driver.close();
      }
    },
  );
}
