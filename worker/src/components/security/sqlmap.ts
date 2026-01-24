import { z } from 'zod';
import {
  componentRegistry,
  runComponentWithRunner,
  type DockerRunnerConfig,
  ContainerError,
  ComponentRetryPolicy,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

const SQLMAP_IMAGE = 'googlesky/sqlmap:latest';
const SQLMAP_TIMEOUT_SECONDS = 600;

const techniqueEnum = z.enum(['B', 'E', 'U', 'S', 'T', 'Q', 'BEUSTQ']);

const levelEnum = z.enum(['1', '2', '3', '4', '5']);

const riskEnum = z.enum(['1', '2', '3']);

const inputSchema = inputs({
  targetUrl: port(z.string().url('Must be a valid URL'), {
    label: 'Target URL',
    description: 'Target URL with injectable parameter (e.g., http://example.com/page.php?id=1)',
  }),
});

const parameterSchema = parameters({
  data: param(z.string().trim().optional(), {
    label: 'POST Data',
    editor: 'textarea',
    rows: 2,
    placeholder: 'id=1&name=test',
    description: 'Data string to be sent through POST request.',
  }),
  cookie: param(z.string().trim().optional(), {
    label: 'Cookie',
    editor: 'text',
    placeholder: 'PHPSESSID=abc123',
    description: 'HTTP Cookie header value.',
  }),
  testParameter: param(z.string().trim().optional(), {
    label: 'Test Parameter',
    editor: 'text',
    placeholder: 'id',
    description: 'Testable parameter(s) to focus on (-p flag).',
  }),
  level: param(levelEnum.default('1'), {
    label: 'Level',
    editor: 'select',
    options: [
      { label: '1 - Default', value: '1' },
      { label: '2 - Cookie testing', value: '2' },
      { label: '3 - User-Agent/Referer testing', value: '3' },
      { label: '4 - More payloads', value: '4' },
      { label: '5 - Maximum payloads', value: '5' },
    ],
    description: 'Level of tests to perform (1-5). Higher levels test more injection points.',
  }),
  risk: param(riskEnum.default('1'), {
    label: 'Risk',
    editor: 'select',
    options: [
      { label: '1 - Default (safe)', value: '1' },
      { label: '2 - Heavy queries', value: '2' },
      { label: '3 - OR-based (dangerous)', value: '3' },
    ],
    description: 'Risk of tests to perform. Higher risk may modify data.',
  }),
  technique: param(techniqueEnum.default('BEUSTQ'), {
    label: 'Technique',
    editor: 'select',
    options: [
      { label: 'All techniques (BEUSTQ)', value: 'BEUSTQ' },
      { label: 'Boolean-based blind (B)', value: 'B' },
      { label: 'Error-based (E)', value: 'E' },
      { label: 'Union query-based (U)', value: 'U' },
      { label: 'Stacked queries (S)', value: 'S' },
      { label: 'Time-based blind (T)', value: 'T' },
      { label: 'Inline queries (Q)', value: 'Q' },
    ],
    description: 'SQL injection techniques to use.',
  }),
  dbms: param(z.string().trim().optional(), {
    label: 'DBMS',
    editor: 'select',
    options: [
      { label: 'Auto-detect', value: '' },
      { label: 'MySQL', value: 'MySQL' },
      { label: 'PostgreSQL', value: 'PostgreSQL' },
      { label: 'Microsoft SQL Server', value: 'Microsoft SQL Server' },
      { label: 'Oracle', value: 'Oracle' },
      { label: 'SQLite', value: 'SQLite' },
    ],
    description: 'Force back-end DBMS to this value.',
  }),
  threads: param(z.number().int().min(1).max(10).default(1), {
    label: 'Threads',
    editor: 'number',
    min: 1,
    max: 10,
    description: 'Max number of concurrent HTTP requests.',
  }),
  timeout: param(z.number().int().min(1).max(300).default(30), {
    label: 'Timeout',
    editor: 'number',
    min: 1,
    max: 300,
    description: 'Seconds to wait before timeout connection.',
  }),
  randomAgent: param(z.boolean().default(true), {
    label: 'Random User-Agent',
    editor: 'boolean',
    description: 'Use randomly selected HTTP User-Agent header.',
  }),
  tamper: param(z.string().trim().optional(), {
    label: 'Tamper Scripts',
    editor: 'text',
    placeholder: 'space2comment,between',
    description: 'Comma-separated tamper scripts for WAF bypass.',
  }),
  getBanner: param(z.boolean().default(true), {
    label: 'Get Banner',
    editor: 'boolean',
    description: 'Retrieve DBMS banner.',
  }),
  getCurrentUser: param(z.boolean().default(true), {
    label: 'Get Current User',
    editor: 'boolean',
    description: 'Retrieve DBMS current user.',
  }),
  getCurrentDb: param(z.boolean().default(true), {
    label: 'Get Current Database',
    editor: 'boolean',
    description: 'Retrieve DBMS current database.',
  }),
  isDba: param(z.boolean().default(false), {
    label: 'Check DBA',
    editor: 'boolean',
    description: 'Detect if the DBMS current user is DBA.',
  }),
  getDbs: param(z.boolean().default(false), {
    label: 'Enumerate Databases',
    editor: 'boolean',
    description: 'Enumerate DBMS databases.',
  }),
  getTables: param(z.boolean().default(false), {
    label: 'Enumerate Tables',
    editor: 'boolean',
    description: 'Enumerate DBMS database tables.',
  }),
  database: param(z.string().trim().optional(), {
    label: 'Database Name',
    editor: 'text',
    placeholder: 'mydb',
    description: 'DBMS database to enumerate.',
  }),
  customFlags: param(z.string().trim().optional(), {
    label: 'Custom Flags',
    editor: 'textarea',
    rows: 2,
    placeholder: '--forms --crawl=2',
    description: 'Additional sqlmap CLI flags to append.',
  }),
});

const injectionPointSchema = z.object({
  parameter: z.string(),
  place: z.string(),
  dbms: z.string().nullable(),
  dbmsVersion: z.array(z.string()),
  os: z.string().nullable(),
  techniques: z.array(
    z.object({
      type: z.string(),
      title: z.string(),
      payload: z.string(),
    }),
  ),
});

type InjectionPoint = z.infer<typeof injectionPointSchema>;

const outputSchema = outputs({
  vulnerable: port(z.boolean(), {
    label: 'Vulnerable',
    description: 'Whether SQL injection vulnerability was found.',
  }),
  injectionPoints: port(z.array(injectionPointSchema), {
    label: 'Injection Points',
    description: 'Discovered SQL injection points with details.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  banner: port(z.string().nullable(), {
    label: 'Banner',
    description: 'DBMS banner if retrieved.',
  }),
  currentUser: port(z.string().nullable(), {
    label: 'Current User',
    description: 'DBMS current user if retrieved.',
  }),
  currentDb: port(z.string().nullable(), {
    label: 'Current Database',
    description: 'DBMS current database if retrieved.',
  }),
  isDba: port(z.boolean().nullable(), {
    label: 'Is DBA',
    description: 'Whether current user is DBA.',
  }),
  databases: port(z.array(z.string()), {
    label: 'Databases',
    description: 'List of enumerated databases.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
  }),
  tables: port(z.array(z.string()), {
    label: 'Tables',
    description: 'List of enumerated tables.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw sqlmap output.',
  }),
  scanInfo: port(
    z.object({
      targetUrl: z.string(),
      level: z.string(),
      risk: z.string(),
      technique: z.string(),
      threads: z.number(),
    }),
    {
      label: 'Scan Info',
      description: 'Scan configuration used.',
      connectionType: { kind: 'primitive', name: 'json' },
    },
  ),
});

type Output = z.infer<typeof outputSchema>;

const sqlmapRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 2,
  initialIntervalSeconds: 5,
  maximumIntervalSeconds: 60,
  backoffCoefficient: 2.0,
  nonRetryableErrorTypes: ['ContainerError', 'ValidationError', 'ConfigurationError'],
};

const definition = defineComponent({
  id: 'shipsec.sqlmap.scan',
  label: 'SQLMap Scanner',
  category: 'security',
  retryPolicy: sqlmapRetryPolicy,
  runner: {
    kind: 'docker',
    image: SQLMAP_IMAGE,
    entrypoint: 'sh',
    network: 'bridge',
    timeoutSeconds: SQLMAP_TIMEOUT_SECONDS,
    command: ['-c', 'python /sqlmap/sqlmap.py "$@"', '--'],
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Run SQLMap to automatically detect and exploit SQL injection vulnerabilities. Supports multiple DBMS types and injection techniques.',
  ui: {
    slug: 'sqlmap',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description: 'Automatic SQL injection detection and exploitation tool.',
    documentation: 'https://github.com/sqlmapproject/sqlmap/wiki/Usage',
    documentationUrl: 'https://sqlmap.org/',
    icon: 'Database',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example: 'sqlmap -u "http://example.com/page.php?id=1" --batch --banner',
    examples: [
      'Basic scan: Test a URL parameter for SQL injection vulnerabilities.',
      'POST data: Use --data to test POST parameters.',
      'WAF bypass: Use tamper scripts like space2comment for WAF evasion.',
      'Database enumeration: Enable --dbs to list all databases.',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);
    const { targetUrl } = inputs;

    if (!targetUrl || targetUrl.trim().length === 0) {
      context.logger.info('[SQLMap] No target URL provided, skipping execution.');
      return outputSchema.parse({
        vulnerable: false,
        injectionPoints: [],
        banner: null,
        currentUser: null,
        currentDb: null,
        isDba: null,
        databases: [],
        tables: [],
        rawOutput: '',
        scanInfo: {
          targetUrl: '',
          level: parsedParams.level,
          risk: parsedParams.risk,
          technique: parsedParams.technique,
          threads: parsedParams.threads,
        },
      });
    }

    context.logger.info(`[SQLMap] Scanning target: ${targetUrl}`);
    context.emitProgress(`Starting SQLMap scan on ${targetUrl}`);

    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new ContainerError('SQLMap runner must be docker', {
        details: { expectedKind: 'docker', actualKind: baseRunner.kind },
      });
    }

    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const volume = new IsolatedContainerVolume(tenantId, context.runId);

    try {
      await volume.initialize({});

      const sqlmapArgs: string[] = [
        '-u',
        targetUrl,
        '--batch', // Non-interactive mode
        '-v',
        '3', // Verbosity for better output parsing
      ];

      // POST data
      if (parsedParams.data) {
        sqlmapArgs.push('--data', parsedParams.data);
      }

      // Cookie
      if (parsedParams.cookie) {
        sqlmapArgs.push('--cookie', parsedParams.cookie);
      }

      // Test parameter
      if (parsedParams.testParameter) {
        sqlmapArgs.push('-p', parsedParams.testParameter);
      }

      // Level and risk
      sqlmapArgs.push('--level', parsedParams.level);
      sqlmapArgs.push('--risk', parsedParams.risk);

      // Technique
      if (parsedParams.technique !== 'BEUSTQ') {
        sqlmapArgs.push('--technique', parsedParams.technique);
      }

      // DBMS
      if (parsedParams.dbms) {
        sqlmapArgs.push('--dbms', parsedParams.dbms);
      }

      // Threads and timeout
      sqlmapArgs.push('--threads', String(parsedParams.threads));
      sqlmapArgs.push('--timeout', String(parsedParams.timeout));

      // Random agent
      if (parsedParams.randomAgent) {
        sqlmapArgs.push('--random-agent');
      }

      // Tamper scripts
      if (parsedParams.tamper) {
        sqlmapArgs.push('--tamper', parsedParams.tamper);
      }

      // Enumeration options
      if (parsedParams.getBanner) {
        sqlmapArgs.push('--banner');
      }
      if (parsedParams.getCurrentUser) {
        sqlmapArgs.push('--current-user');
      }
      if (parsedParams.getCurrentDb) {
        sqlmapArgs.push('--current-db');
      }
      if (parsedParams.isDba) {
        sqlmapArgs.push('--is-dba');
      }
      if (parsedParams.getDbs) {
        sqlmapArgs.push('--dbs');
      }
      if (parsedParams.getTables) {
        sqlmapArgs.push('--tables');
        if (parsedParams.database) {
          sqlmapArgs.push('-D', parsedParams.database);
        }
      }

      // Custom flags
      if (parsedParams.customFlags) {
        const customArgs = parsedParams.customFlags.split(/\s+/).filter((arg) => arg.length > 0);
        sqlmapArgs.push(...customArgs);
      }

      // Output directory
      sqlmapArgs.push('--output-dir', '/data/output');

      const runnerConfig: DockerRunnerConfig = {
        kind: 'docker',
        image: baseRunner.image,
        network: baseRunner.network,
        timeoutSeconds: baseRunner.timeoutSeconds ?? SQLMAP_TIMEOUT_SECONDS,
        entrypoint: baseRunner.entrypoint,
        command: [...(baseRunner.command ?? []), ...sqlmapArgs],
        volumes: [volume.getVolumeConfig('/data', false)],
      };

      context.logger.info(`[SQLMap] Running with args: ${sqlmapArgs.join(' ')}`);

      const result = await runComponentWithRunner(
        runnerConfig,
        async () => ({}) as Output,
        { ...inputs, ...parsedParams },
        context,
      );

      // Get raw output from runner result
      let rawOutput = '';
      if (result && typeof result === 'object' && 'rawOutput' in result) {
        rawOutput = String((result as Record<string, unknown>).rawOutput ?? '');
      } else if (typeof result === 'string') {
        rawOutput = result;
      }

      // Parse the output
      const parsed = parseSqlmapOutput(rawOutput);

      context.logger.info(
        `[SQLMap] Scan complete: ${parsed.vulnerable ? 'VULNERABLE' : 'Not vulnerable'}`,
      );

      return outputSchema.parse({
        vulnerable: parsed.vulnerable,
        injectionPoints: parsed.injectionPoints,
        banner: parsed.banner,
        currentUser: parsed.currentUser,
        currentDb: parsed.currentDb,
        isDba: parsed.isDba,
        databases: parsed.databases,
        tables: parsed.tables,
        rawOutput,
        scanInfo: {
          targetUrl,
          level: parsedParams.level,
          risk: parsedParams.risk,
          technique: parsedParams.technique,
          threads: parsedParams.threads,
        },
      });
    } finally {
      await volume.cleanup();
      context.logger.info('[SQLMap] Cleaned up isolated volume.');
    }
  },
});

interface ParsedOutput {
  vulnerable: boolean;
  injectionPoints: InjectionPoint[];
  banner: string | null;
  currentUser: string | null;
  currentDb: string | null;
  isDba: boolean | null;
  databases: string[];
  tables: string[];
}

function parseSqlmapOutput(output: string): ParsedOutput {
  const result: ParsedOutput = {
    vulnerable: false,
    injectionPoints: [],
    banner: null,
    currentUser: null,
    currentDb: null,
    isDba: null,
    databases: [],
    tables: [],
  };

  if (!output || output.trim().length === 0) {
    return result;
  }

  // Check if vulnerable
  if (
    output.includes('is vulnerable') ||
    output.includes('sqlmap identified the following injection point')
  ) {
    result.vulnerable = true;
  }

  // Extract banner
  const bannerMatch = output.match(/banner:\s*['"]?([^'"}\n]+)['"]?/i);
  if (bannerMatch) {
    result.banner = bannerMatch[1].trim();
  }

  // Extract current user
  const userMatch = output.match(/current user:\s*['"]?([^'"}\n]+)['"]?/i);
  if (userMatch) {
    result.currentUser = userMatch[1].trim();
  }

  // Extract current database
  const dbMatch = output.match(/current database:\s*['"]?([^'"}\n]+)['"]?/i);
  if (dbMatch) {
    result.currentDb = dbMatch[1].trim();
  }

  // Extract DBA status
  if (output.includes('current user is DBA: True')) {
    result.isDba = true;
  } else if (output.includes('current user is DBA: False')) {
    result.isDba = false;
  }

  // Extract databases
  const dbsMatch = output.match(/available databases \[\d+\]:\s*([\s\S]*?)(?=\n\n|\[|$)/i);
  if (dbsMatch) {
    const dbLines = dbsMatch[1].split('\n');
    for (const line of dbLines) {
      const dbName = line.replace(/^\[\*\]\s*/, '').trim();
      if (dbName && !dbName.startsWith('[')) {
        result.databases.push(dbName);
      }
    }
  }

  // Extract tables
  const tablesMatch = output.match(
    /Database:\s*\w+\s*\[\d+\s*tables?\]:\s*([\s\S]*?)(?=\n\n|\[|$)/i,
  );
  if (tablesMatch) {
    const tableLines = tablesMatch[1].split('\n');
    for (const line of tableLines) {
      const tableName = line
        .replace(/^\|\s*/, '')
        .replace(/\s*\|$/, '')
        .trim();
      if (tableName && !tableName.startsWith('+') && !tableName.startsWith('-')) {
        result.tables.push(tableName);
      }
    }
  }

  // Extract injection points
  const paramMatch = output.match(/Parameter:\s*(\w+)\s*\((\w+)\)/g);
  if (paramMatch) {
    for (const match of paramMatch) {
      const parts = match.match(/Parameter:\s*(\w+)\s*\((\w+)\)/);
      if (parts) {
        const injectionPoint: InjectionPoint = {
          parameter: parts[1],
          place: parts[2],
          dbms: null,
          dbmsVersion: [],
          os: null,
          techniques: [],
        };

        // Try to extract DBMS info
        const dbmsMatch = output.match(/back-end DBMS:\s*([^\n]+)/i);
        if (dbmsMatch) {
          injectionPoint.dbms = dbmsMatch[1].trim();
        }

        // Extract technique info
        const techniqueMatches = output.matchAll(
          /Type:\s*([^\n]+)\s*Title:\s*([^\n]+)\s*Payload:\s*([^\n]+)/gi,
        );
        for (const techMatch of techniqueMatches) {
          injectionPoint.techniques.push({
            type: techMatch[1].trim(),
            title: techMatch[2].trim(),
            payload: techMatch[3].trim(),
          });
        }

        result.injectionPoints.push(injectionPoint);
      }
    }
  }

  return result;
}

componentRegistry.register(definition);

export type SqlmapInput = typeof inputSchema;
export type SqlmapOutput = typeof outputSchema;
export type { Output as SqlmapOutputData, InjectionPoint };
