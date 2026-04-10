import { z } from 'zod';
import neo4j from 'neo4j-driver';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';

/**
 * Write-operation keywords that are blocked to enforce read-only access.
 * Cartography query tool is exposed to AI agents and must not allow mutations.
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
  // Strip single-line and block comments, then string literals to avoid false positives
  const stripped = query
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""');
  return !WRITE_PATTERN.test(stripped);
}

const inputSchema = inputs({
  query: port(
    z
      .string()
      .min(1, 'Cypher query is required')
      .describe('Cypher query to execute against the Cartography Neo4j graph.'),
    {
      label: 'Cypher Query',
      description:
        'A read-only Cypher query. Examples: "MATCH (n:EC2Instance {exposed_internet: true}) RETURN n.instanceid, n.publicipaddress"',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
  queryParams: port(
    z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Optional parameters for parameterized Cypher queries.'),
    {
      label: 'Query Parameters',
      description: 'Key-value pairs for $param references in the Cypher query.',
      connectionType: { kind: 'primitive', name: 'json' },
    },
  ),
});

const parameterSchema = parameters({
  neo4jUri: param(
    z.string().default('bolt://neo4j:7687').describe('Neo4j Bolt URI for the Cartography graph.'),
    {
      label: 'Neo4j URI',
      editor: 'text',
      description:
        'Bolt protocol URI for the Neo4j instance. Defaults to the platform Neo4j service.',
    },
  ),
  neo4jUser: param(
    z.string().optional().describe('Neo4j username (optional if auth is disabled).'),
    {
      label: 'Neo4j User',
      editor: 'text',
      placeholder: 'neo4j',
      description: 'Username for Neo4j authentication. Leave empty if NEO4J_AUTH=none.',
    },
  ),
  neo4jPassword: param(
    z.string().optional().describe('Neo4j password (optional if auth is disabled).'),
    {
      label: 'Neo4j Password',
      editor: 'password',
      description: 'Password for Neo4j authentication. Leave empty if NEO4J_AUTH=none.',
    },
  ),
  maxRecords: param(
    z
      .number()
      .int()
      .min(1)
      .max(10000)
      .default(1000)
      .describe('Maximum number of records to return.'),
    {
      label: 'Max Records',
      editor: 'number',
      description: 'Limit the number of returned records to prevent excessive memory usage.',
    },
  ),
});

const queryResultSchema = z.object({
  records: z.array(z.record(z.string(), z.unknown())),
  recordCount: z.number(),
  keys: z.array(z.string()),
  queryTimeMs: z.number(),
  truncated: z.boolean(),
});

const outputSchema = outputs({
  result: port(queryResultSchema, {
    label: 'Query Result',
    description: 'Structured query results with records, keys, and metadata.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
  records: port(z.array(z.record(z.string(), z.unknown())), {
    label: 'Records',
    description: 'Array of result records as plain objects.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  recordCount: port(z.number(), {
    label: 'Record Count',
    description: 'Number of records returned.',
  }),
});

/**
 * Convert Neo4j driver values to plain JavaScript objects.
 * Neo4j integers, nodes, relationships need special handling.
 */
function toPlainValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  // Neo4j Integer
  if (neo4j.isInt(value)) {
    return neo4j.integer.inSafeRange(value)
      ? neo4j.integer.toNumber(value)
      : neo4j.integer.toString(value);
  }

  // Neo4j Node
  if (value instanceof neo4j.types.Node) {
    return {
      _type: 'node',
      labels: value.labels,
      properties: toPlainValue(value.properties),
      elementId: value.elementId,
    };
  }

  // Neo4j Relationship
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

  // Neo4j Path
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

  // Arrays
  if (Array.isArray(value)) {
    return value.map(toPlainValue);
  }

  // Plain objects
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = toPlainValue(val);
    }
    return result;
  }

  return value;
}

const definition = defineComponent({
  id: 'mcp.cartography.query',
  label: 'Cartography Query',
  category: 'mcp',
  runner: {
    kind: 'inline',
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Execute read-only Cypher queries against the Cartography Neo4j infrastructure graph. Use this to answer questions about assets, relationships, blast radius, and security posture. Write operations (CREATE, MERGE, DELETE, SET) are blocked for safety.',
  toolProvider: {
    kind: 'component',
    name: 'cartography_query',
    description:
      'Query the Cartography infrastructure graph via Cypher. Ask about EC2 instances, S3 buckets, IAM roles, security groups, blast radius, and more. Read-only.',
  },
  ui: {
    slug: 'cartography-query',
    version: '1.0.0',
    type: 'process',
    category: 'mcp',
    description:
      'Query the Cartography Neo4j infrastructure graph with Cypher. Supports asset discovery, relationship traversal, blast radius analysis, and security posture queries.',
    documentation: 'https://github.com/cartography-cncf/cartography',
    icon: 'Search',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'MATCH (i:EC2Instance {exposed_internet: true}) RETURN i.instanceid, i.publicipaddress',
      'MATCH (a:AWSAccount)-[:RESOURCE]->(s:S3Bucket {anonymous_access: true}) RETURN a.name, s.name',
      'MATCH (instance:EC2Instance {instanceid: $instanceId})-[r]-(connected) RETURN labels(connected), type(r)',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedInputs = inputSchema.parse(inputs);
    const parsedParams = parameterSchema.parse(params);

    const query = parsedInputs.query.trim();

    // Enforce read-only queries
    if (!isReadOnlyQuery(query)) {
      throw new Error(
        'Write operations are not allowed. Cartography Query only supports read-only Cypher (MATCH, RETURN, WITH, WHERE, ORDER BY, LIMIT, UNION, UNWIND, OPTIONAL MATCH, CALL for procedures).',
      );
    }

    context.logger.info(`[CartographyQuery] Executing Cypher query (${query.length} chars)`);

    const auth =
      parsedParams.neo4jUser && parsedParams.neo4jPassword
        ? neo4j.auth.basic(parsedParams.neo4jUser, parsedParams.neo4jPassword)
        : undefined;

    const driver = neo4j.driver(parsedParams.neo4jUri, auth);
    const session = driver.session({ defaultAccessMode: neo4j.session.READ });

    try {
      const startTime = Date.now();
      const result = await session.run(query, parsedInputs.queryParams ?? {});
      const queryTimeMs = Date.now() - startTime;

      const maxRecords = parsedParams.maxRecords;
      const truncated = result.records.length > maxRecords;
      const limitedRecords = result.records.slice(0, maxRecords);

      const records = limitedRecords.map((record) => {
        const obj: Record<string, unknown> = {};
        for (const key of record.keys as string[]) {
          obj[key] = toPlainValue(record.get(key));
        }
        return obj;
      });

      const keys = result.records.length > 0 ? [...result.records[0].keys] : [];

      context.logger.info(
        `[CartographyQuery] Returned ${records.length} records in ${queryTimeMs}ms${truncated ? ' (truncated)' : ''}`,
      );

      const queryResult = {
        records,
        recordCount: records.length,
        keys,
        queryTimeMs,
        truncated,
      };

      return outputSchema.parse({
        result: queryResult,
        records,
        recordCount: records.length,
      });
    } finally {
      await session.close();
      await driver.close();
    }
  },
});

componentRegistry.register(definition);

type Input = (typeof inputSchema)['__inferred'];
type Output = (typeof outputSchema)['__inferred'];

export type { Input as CartographyQueryInput, Output as CartographyQueryOutput };
