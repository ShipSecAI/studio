import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { SecretEncryption, parseMasterKey } from '@shipsec/shared';
import * as bcrypt from 'bcryptjs';

// ─── Configuration ───────────────────────────────────────────────────────────

const ORG_ID = process.env.SEED_ORG_ID || 'stress-test';

interface TierConfig {
  workflows: number;
  workflowVersionsRange: [number, number];
  workflowRuns: number;
  tracesPerRunRange: [number, number];
  nodeIoPerRunRange: [number, number];
  schedules: number;
  webhookConfigs: number;
  webhookDeliveries: number;
  humanInputRequests: number;
  artifactsAndFiles: number;
  mcpGroups: number;
  mcpServers: number;
  mcpToolsPerServerRange: [number, number];
  agentTraceEventsPerRun: [number, number];
  secrets: number;
  apiKeys: number;
}

const TIERS: Record<string, TierConfig> = {
  small: {
    workflows: 10,
    workflowVersionsRange: [1, 3],
    workflowRuns: 100,
    tracesPerRunRange: [5, 15],
    nodeIoPerRunRange: [3, 10],
    schedules: 5,
    webhookConfigs: 5,
    webhookDeliveries: 20,
    humanInputRequests: 10,
    artifactsAndFiles: 10,
    mcpGroups: 3,
    mcpServers: 6,
    mcpToolsPerServerRange: [3, 8],
    agentTraceEventsPerRun: [10, 50],
    secrets: 5,
    apiKeys: 3,
  },
  medium: {
    workflows: 50,
    workflowVersionsRange: [1, 5],
    workflowRuns: 2000,
    tracesPerRunRange: [5, 50],
    nodeIoPerRunRange: [3, 20],
    schedules: 30,
    webhookConfigs: 25,
    webhookDeliveries: 200,
    humanInputRequests: 100,
    artifactsAndFiles: 100,
    mcpGroups: 10,
    mcpServers: 30,
    mcpToolsPerServerRange: [3, 15],
    agentTraceEventsPerRun: [10, 100],
    secrets: 20,
    apiKeys: 10,
  },
  large: {
    workflows: 200,
    workflowVersionsRange: [1, 10],
    workflowRuns: 20000,
    tracesPerRunRange: [5, 500],
    nodeIoPerRunRange: [3, 50],
    schedules: 150,
    webhookConfigs: 100,
    webhookDeliveries: 2000,
    humanInputRequests: 1000,
    artifactsAndFiles: 500,
    mcpGroups: 30,
    mcpServers: 100,
    mcpToolsPerServerRange: [3, 30],
    agentTraceEventsPerRun: [10, 500],
    secrets: 50,
    apiKeys: 25,
  },
};

// Status/trigger distributions
const RUN_STATUS_DIST: [string, number][] = [
  ['COMPLETED', 0.6],
  ['FAILED', 0.15],
  ['RUNNING', 0.05],
  ['CANCELLED', 0.05],
  ['TIMED_OUT', 0.03],
  ['QUEUED', 0.02],
  ['TERMINATED', 0.02],
  ['AWAITING_INPUT', 0.05],
  ['STALE', 0.03],
];

const TRIGGER_DIST: [string, number][] = [
  ['manual', 0.4],
  ['schedule', 0.3],
  ['api', 0.2],
  ['webhook', 0.1],
];

const SCHEDULE_STATUS_DIST: [string, number][] = [
  ['active', 0.7],
  ['paused', 0.2],
  ['error', 0.1],
];

const DELIVERY_STATUS_DIST: [string, number][] = [
  ['delivered', 0.7],
  ['processing', 0.1],
  ['failed', 0.2],
];

const HUMAN_INPUT_STATUS_DIST: [string, number][] = [
  ['pending', 0.3],
  ['resolved', 0.5],
  ['expired', 0.15],
  ['cancelled', 0.05],
];

const HUMAN_INPUT_TYPE_DIST: [string, number][] = [
  ['approval', 0.4],
  ['form', 0.25],
  ['selection', 0.15],
  ['review', 0.15],
  ['acknowledge', 0.05],
];

// Real registered component IDs from the worker component registry
const NODE_TYPES = [
  'core.workflow.entrypoint',
  'core.http.request',
  'core.ai.agent',
  'core.logic.script',
  'core.ai.generate-text',
  'core.workflow.call',
  'core.file.writer',
  'core.artifact.writer',
  'core.notification.slack',
  'core.text.splitter',
  'core.text.joiner',
  'core.array.pack',
  'core.array.pick',
  'core.file.loader',
  'core.secret.fetch',
  'core.manual_action.approval',
  'core.manual_action.form',
  'core.manual_action.selection',
  'core.provider.openai',
  'core.provider.gemini',
  'core.destination.artifact',
  'core.destination.s3',
  'core.credentials.aws',
  'core.analytics.sink',
];

const CRON_EXPRESSIONS = [
  '0 */6 * * *',
  '0 9 * * 1-5',
  '*/15 * * * *',
  '0 0 * * *',
  '30 8 * * 1',
  '0 */2 * * *',
  '0 12 * * *',
  '*/30 * * * *',
];

const TIMEZONES = ['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo'];

const WORKFLOW_NAMES = [
  'Data Pipeline',
  'Customer Onboarding',
  'Report Generator',
  'Notification Sender',
  'Data Sync',
  'Invoice Processor',
  'Lead Scorer',
  'Content Publisher',
  'Inventory Check',
  'Order Fulfillment',
  'User Provisioning',
  'Backup Automation',
  'Health Monitor',
  'ETL Process',
  'API Gateway',
  'Log Aggregator',
  'Deployment Pipeline',
  'Testing Suite',
  'Security Scanner',
  'Cost Optimizer',
];

const SECRET_NAMES = [
  'stripe_api_key',
  'openai_token',
  'aws_access_key',
  'aws_secret_key',
  'slack_webhook_url',
  'github_pat',
  'postgres_password',
  'redis_password',
  'sendgrid_key',
  'twilio_auth_token',
  'gcp_service_account',
  'datadog_api_key',
  'sentry_dsn',
  'cloudflare_token',
  'jwt_signing_secret',
  'smtp_password',
  'mongo_connection_string',
  'elasticsearch_api_key',
  'pagerduty_token',
  'vercel_token',
  'docker_registry_password',
  'npm_auth_token',
  'azure_client_secret',
  'firebase_admin_key',
  'algolia_api_key',
  'mixpanel_token',
  'segment_write_key',
  'intercom_access_token',
  'hubspot_api_key',
  'salesforce_client_secret',
  'jira_api_token',
  'confluence_token',
  'linear_api_key',
  'notion_integration_secret',
  'airtable_api_key',
  'google_maps_api_key',
  'mapbox_access_token',
  'plaid_secret',
  'braintree_private_key',
  'coinbase_api_secret',
  'anthropic_api_key',
  'cohere_api_key',
  'pinecone_api_key',
  'weaviate_api_key',
  'replicate_api_token',
  'huggingface_token',
  'stability_api_key',
  'deepgram_api_key',
  'assemblyai_api_key',
  'eleven_labs_api_key',
];

const SECRET_TAGS: string[][] = [
  ['payment', 'stripe'],
  ['ai', 'llm'],
  ['cloud', 'aws'],
  ['cloud', 'aws'],
  ['messaging', 'slack'],
  ['ci-cd', 'github'],
  ['database', 'postgres'],
  ['database', 'redis'],
  ['email'],
  ['messaging', 'twilio'],
  ['cloud', 'gcp'],
  ['monitoring'],
  ['monitoring', 'sentry'],
  ['cdn', 'cloudflare'],
  ['auth'],
  ['email', 'smtp'],
  ['database', 'mongo'],
  ['search'],
  ['monitoring', 'pagerduty'],
  ['deployment'],
];

const API_KEY_NAMES = [
  'Production API',
  'Staging API',
  'CI/CD Pipeline',
  'Monitoring Service',
  'Partner Integration',
  'Mobile App',
  'Internal Dashboard',
  'Data Pipeline',
  'Webhook Processor',
  'Testing Automation',
  'Analytics Service',
  'Customer Portal',
  'Batch Processor',
  'Admin Console',
  'Third-Party Integration',
  'Load Balancer Health',
  'CDN Purge Service',
  'Log Collector',
  'Alerting System',
  'Backup Service',
  'Migration Script',
  'Sandbox Environment',
  'Demo App',
  'Developer Portal',
  'Support Tool',
];

const API_KEY_PERMISSION_PRESETS: {
  workflows: { run: boolean; list: boolean; read: boolean };
  runs: { read: boolean; cancel: boolean };
}[] = [
  // Full access
  { workflows: { run: true, list: true, read: true }, runs: { read: true, cancel: true } },
  // Read-only
  { workflows: { run: false, list: true, read: true }, runs: { read: true, cancel: false } },
  // Run-only
  { workflows: { run: true, list: true, read: false }, runs: { read: false, cancel: false } },
  // Run + monitor
  { workflows: { run: true, list: true, read: true }, runs: { read: true, cancel: false } },
  // List-only
  { workflows: { run: false, list: true, read: false }, runs: { read: false, cancel: false } },
];

const UNICODE_NAMES = [
  '数据管道',
  'ワークフロー処理',
  '🚀 Rocket Pipeline',
  'الأتمتة الذكية',
  '데이터 동기화',
  'Ünîcödé Wörkflöw',
];

const AGENT_PART_TYPES = [
  'text',
  'tool-call',
  'tool-result',
  'step-start',
  'source-url',
  'reasoning',
  'file',
  'error',
];

// ─── Utilities ───────────────────────────────────────────────────────────────

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickWeighted(dist: [string, number][]): string {
  const r = Math.random();
  let cumulative = 0;
  for (const [value, weight] of dist) {
    cumulative += weight;
    if (r <= cumulative) return value;
  }
  return dist[dist.length - 1][0];
}

function randomDate(daysBack: number): Date {
  const now = Date.now();
  return new Date(now - Math.random() * daysBack * 24 * 60 * 60 * 1000);
}

function shortUUID(): string {
  return randomUUID().split('-')[0];
}

function escapeLiteral(val: string): string {
  return val.replace(/'/g, "''");
}

function sqlVal(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return `'${escapeLiteral(v.toISOString())}'`;
  if (typeof v === 'object') return `'${escapeLiteral(JSON.stringify(v))}'::jsonb`;
  return `'${escapeLiteral(String(v))}'`;
}

function generateLongName(): string {
  const base = pick(WORKFLOW_NAMES);
  return (
    base + ' - ' + Array.from({ length: 20 }, () => pick(WORKFLOW_NAMES).split(' ')[0]).join(' ')
  );
}

// ─── Graph Generators ────────────────────────────────────────────────────────

type TemplateType = 'simple_http' | 'ai_agent' | 'complex_branching' | 'subflow' | 'large_pipeline';

const TEMPLATES: TemplateType[] = [
  'simple_http',
  'ai_agent',
  'complex_branching',
  'subflow',
  'large_pipeline',
];

function nodeCountForTemplate(template: TemplateType, isLarge: boolean): number {
  switch (template) {
    case 'simple_http':
      return randInt(3, 5);
    case 'ai_agent':
      return randInt(5, 8);
    case 'complex_branching':
      return randInt(10, 20);
    case 'subflow':
      return randInt(8, 15);
    case 'large_pipeline':
      return isLarge ? randInt(20, 50) : randInt(15, 25);
  }
}

function generateWorkflowGraph(
  name: string,
  template: TemplateType,
  nodeCount: number,
  secretNames: string[] = [],
) {
  const nodes: {
    id: string;
    type: string;
    position: { x: number; y: number };
    data: {
      label: string;
      config: { params: Record<string, unknown>; inputOverrides: Record<string, unknown> };
    };
  }[] = [];
  const edges: {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
  }[] = [];

  // Always start with entrypoint
  const entryId = `node_${shortUUID()}`;
  nodes.push({
    id: entryId,
    type: 'core.workflow.entrypoint',
    position: { x: 0, y: 0 },
    data: {
      label: 'Entry Point',
      config: { params: {}, inputOverrides: {} },
    },
  });

  // Optionally inject a secret-fetch node (~30% of workflows when secrets exist)
  let prevId = entryId;
  if (secretNames.length > 0 && Math.random() < 0.3) {
    const secretNodeId = `node_${shortUUID()}`;
    const chosenSecret = pick(secretNames);
    nodes.push({
      id: secretNodeId,
      type: 'core.secret.fetch',
      position: { x: 250, y: 0 },
      data: {
        label: 'Fetch Secret',
        config: {
          params: { secretId: chosenSecret, outputFormat: 'raw' },
          inputOverrides: {},
        },
      },
    });
    edges.push({
      id: `edge_${shortUUID()}`,
      source: entryId,
      target: secretNodeId,
    });
    prevId = secretNodeId;
  }

  // Generate remaining nodes
  const templateNodeTypes: Record<TemplateType, string[]> = {
    simple_http: [
      'core.http.request',
      'core.text.splitter',
      'core.text.joiner',
      'core.file.writer',
    ],
    ai_agent: [
      'core.ai.agent',
      'core.ai.generate-text',
      'core.provider.openai',
      'core.http.request',
      'core.text.joiner',
    ],
    complex_branching: [
      'core.http.request',
      'core.logic.script',
      'core.manual_action.approval',
      'core.artifact.writer',
      'core.text.splitter',
      'core.array.pick',
    ],
    subflow: [
      'core.http.request',
      'core.workflow.call',
      'core.logic.script',
      'core.file.loader',
      'core.text.joiner',
    ],
    large_pipeline: NODE_TYPES.slice(1), // all except entrypoint
  };

  const availableTypes = templateNodeTypes[template];

  for (let i = 1; i < nodeCount; i++) {
    const nodeId = `node_${shortUUID()}`;
    const nodeType = pick(availableTypes);
    const layer = Math.floor(i / 3);
    const posInLayer = i % 3;

    nodes.push({
      id: nodeId,
      type: nodeType,
      position: { x: (layer + 1) * 250, y: posInLayer * 150 },
      data: {
        label: `${nodeType.split('.').pop()} ${i}`,
        config: { params: {}, inputOverrides: {} },
      },
    });

    // Connect to previous node (simple chain with some branching for complex)
    if (template === 'complex_branching' && i > 3 && Math.random() < 0.3) {
      // Connect to a random earlier node instead
      const randomEarlier = nodes[randInt(1, Math.max(1, i - 2))];
      edges.push({
        id: `edge_${shortUUID()}`,
        source: randomEarlier.id,
        target: nodeId,
      });
    } else {
      edges.push({
        id: `edge_${shortUUID()}`,
        source: prevId,
        target: nodeId,
      });
    }

    prevId = nodeId;
  }

  return {
    name,
    description:
      Math.random() < 0.3 ? null : `Auto-generated ${template} workflow for stress testing`,
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function generateCompiledDefinition(
  graph: ReturnType<typeof generateWorkflowGraph>,
): Record<string, unknown> {
  const actions = graph.nodes.map((n) => ({
    ref: n.id,
    componentId: n.type,
    params: {},
    inputOverrides: {},
    dependsOn: [] as string[],
    inputMappings: {},
  }));

  // Set up dependsOn from edges
  for (const edge of graph.edges) {
    const action = actions.find((a) => a.ref === edge.target);
    if (action && !action.dependsOn.includes(edge.source)) {
      action.dependsOn.push(edge.source);
    }
  }

  const depCounts: Record<string, number> = {};
  for (const a of actions) {
    depCounts[a.ref] = a.dependsOn.length;
  }

  return {
    version: 2,
    title: graph.name,
    description: graph.description,
    entrypoint: { ref: graph.nodes[0].id },
    nodes: Object.fromEntries(
      graph.nodes.map((n) => [n.id, { ref: n.id, label: n.data.label, mode: 'normal' }]),
    ),
    edges: graph.edges.map((e) => ({
      id: e.id,
      sourceRef: e.source,
      targetRef: e.target,
      kind: 'success',
    })),
    dependencyCounts: depCounts,
    actions,
    config: { environment: 'default', timeoutSeconds: 0 },
  };
}

// ─── Trace Generator ─────────────────────────────────────────────────────────

function generateTraceSequence(
  nodeRefs: string[],
  runStatus: string,
  maxTraces: number,
): {
  type: string;
  nodeRef: string;
  message: string | null;
  error: unknown;
  outputSummary: unknown;
  level: string;
  data: unknown;
}[] {
  const traces: {
    type: string;
    nodeRef: string;
    message: string | null;
    error: unknown;
    outputSummary: unknown;
    level: string;
    data: unknown;
  }[] = [];

  const maxPerNode = Math.max(2, Math.floor(maxTraces / Math.max(1, nodeRefs.length)));
  const isFailed = runStatus === 'FAILED';
  const isRunning = runStatus === 'RUNNING' || runStatus === 'QUEUED';
  // For running runs, only process a subset of nodes (the run is still in progress)
  const activeNodeCount = isRunning
    ? Math.max(1, Math.floor(nodeRefs.length * (0.3 + Math.random() * 0.5)))
    : nodeRefs.length;

  for (let ni = 0; ni < activeNodeCount && traces.length < maxTraces; ni++) {
    const nodeRef = nodeRefs[ni];
    const isLastNode = ni === nodeRefs.length - 1;
    const isLastActiveNode = ni === activeNodeCount - 1;

    // NODE_STARTED
    traces.push({
      type: 'NODE_STARTED',
      nodeRef,
      message: null,
      error: null,
      outputSummary: null,
      level: 'info',
      data: null,
    });

    // Optional progress events
    const progressCount = randInt(0, Math.min(3, maxPerNode - 2));
    for (let p = 0; p < progressCount && traces.length < maxTraces; p++) {
      traces.push({
        type: 'NODE_PROGRESS',
        nodeRef,
        message: `Processing step ${p + 1}`,
        error: null,
        outputSummary: null,
        level: 'info',
        data: null,
      });
    }

    // Optional HTTP events
    if (Math.random() < 0.3 && traces.length + 2 <= maxTraces) {
      const corrId = randomUUID();
      traces.push({
        type: 'HTTP_REQUEST_SENT',
        nodeRef,
        message: null,
        error: null,
        outputSummary: null,
        level: 'info',
        data: {
          correlationId: corrId,
          request: { method: 'GET', url: 'https://api.example.com/data' },
        },
      });
      traces.push({
        type: 'HTTP_RESPONSE_RECEIVED',
        nodeRef,
        message: null,
        error: null,
        outputSummary: null,
        level: 'info',
        data: { correlationId: corrId, har: { status: 200 } },
      });
    }

    // Completion
    if (isFailed && isLastNode) {
      traces.push({
        type: 'NODE_FAILED',
        nodeRef,
        message: 'Connection timeout',
        error: { message: 'Connection timeout', code: 'ETIMEDOUT' },
        outputSummary: null,
        level: 'error',
        data: null,
      });
    } else if (runStatus === 'CANCELLED' && isLastNode) {
      traces.push({
        type: 'NODE_SKIPPED',
        nodeRef,
        message: 'Run cancelled',
        error: null,
        outputSummary: null,
        level: 'warn',
        data: null,
      });
    } else if (runStatus === 'TIMED_OUT' && isLastNode) {
      // Fix: TIMED_OUT runs should end with a timeout error, not NODE_COMPLETED
      traces.push({
        type: 'NODE_FAILED',
        nodeRef,
        message: 'Execution timed out',
        error: { message: 'Execution timed out', code: 'DEADLINE_EXCEEDED' },
        outputSummary: null,
        level: 'error',
        data: null,
      });
    } else if ((runStatus === 'TERMINATED' || runStatus === 'STALE') && isLastNode) {
      // Fix: TERMINATED/STALE runs should not show all nodes completed
      traces.push({
        type: 'NODE_FAILED',
        nodeRef,
        message: runStatus === 'TERMINATED' ? 'Run terminated by system' : 'Run became stale',
        error: {
          message: runStatus === 'TERMINATED' ? 'Run terminated by system' : 'Run became stale',
          code: runStatus === 'TERMINATED' ? 'TERMINATED' : 'STALE',
        },
        outputSummary: null,
        level: 'error',
        data: null,
      });
    } else if (isRunning && isLastActiveNode) {
      // Last active node in a running run — still executing, no completion event
    } else {
      traces.push({
        type: 'NODE_COMPLETED',
        nodeRef,
        message: null,
        error: null,
        outputSummary: { result: 'ok' },
        level: 'info',
        data: null,
      });
    }
  }

  return traces;
}

// ─── Batch Insert Helper ─────────────────────────────────────────────────────

async function batchInsert(
  client: PoolClient,
  table: string,
  columns: string[],
  rows: string[][],
  batchSize = 500,
): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values = batch.map((row) => `(${row.join(', ')})`).join(',\n');
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values} ON CONFLICT DO NOTHING`;
    const result = await client.query(sql);
    inserted += result.rowCount ?? 0;
    if (inserted % 1000 === 0 && inserted > 0) {
      console.log(`  ... ${table}: ${inserted}/${rows.length} rows`);
    }
  }
  return inserted;
}

// ─── Seeders ─────────────────────────────────────────────────────────────────

interface WorkflowData {
  id: string;
  name: string;
  graph: ReturnType<typeof generateWorkflowGraph>;
  nodeRefs: string[];
  createdAt: Date;
}

interface VersionData {
  id: string;
  workflowId: string;
  version: number;
}

interface RunData {
  runId: string;
  workflowId: string;
  versionId: string | null;
  version: number | null;
  status: string;
  nodeRefs: string[];
  createdAt: Date;
  isAgentRun: boolean;
}

interface SeededSecret {
  id: string;
  name: string;
}

async function seedSecrets(client: PoolClient, count: number): Promise<SeededSecret[]> {
  const masterKeyRaw = process.env.SECRET_STORE_MASTER_KEY;
  if (!masterKeyRaw) {
    console.log('\n⚠ SECRET_STORE_MASTER_KEY not set — skipping secrets seeding');
    return [];
  }

  console.log(`\nSeeding ${count} secrets with encrypted values...`);

  const masterKey = parseMasterKey(masterKeyRaw);
  const encryptor = new SecretEncryption(masterKey);

  const seeded: SeededSecret[] = [];
  const secretRows: string[][] = [];
  const versionRows: string[][] = [];

  const secretCols = [
    'id',
    'name',
    'description',
    'tags',
    'organization_id',
    'created_at',
    'updated_at',
  ];
  const versionCols = [
    'id',
    'secret_id',
    'version',
    'encrypted_value',
    'iv',
    'auth_tag',
    'encryption_key_id',
    'created_at',
    'created_by',
    'organization_id',
    'is_active',
  ];

  for (let i = 0; i < count; i++) {
    const secretId = randomUUID();
    const baseName = SECRET_NAMES[i % SECRET_NAMES.length];
    const name = `${baseName}_${shortUUID()}`;
    const tags = SECRET_TAGS[i % SECRET_TAGS.length] ?? [];
    const createdAt = randomDate(90);

    seeded.push({ id: secretId, name });

    secretRows.push([
      sqlVal(secretId),
      sqlVal(name),
      sqlVal(`Seed secret for ${baseName.replace(/_/g, ' ')}`),
      sqlVal(tags),
      sqlVal(ORG_ID),
      sqlVal(createdAt),
      sqlVal(new Date(createdAt.getTime() + randInt(0, 7 * 24 * 60 * 60 * 1000))),
    ]);

    // Encrypt a realistic fake value
    const fakeValue = `sk_test_${randomUUID().replace(/-/g, '')}`;
    const material = await encryptor.encrypt(fakeValue);

    const versionId = randomUUID();
    versionRows.push([
      sqlVal(versionId),
      sqlVal(secretId),
      sqlVal(1),
      sqlVal(material.ciphertext),
      sqlVal(material.iv),
      sqlVal(material.authTag),
      sqlVal(material.keyId),
      sqlVal(createdAt),
      sqlVal('seed-script'),
      sqlVal(ORG_ID),
      sqlVal(true),
    ]);

    // Fix: ~30% of secrets get a second version — version 1 is the older inactive one,
    // version 2 is the current active one (version numbers should increase with time)
    if (Math.random() < 0.3) {
      // Demote the existing entry to version 1 (older, inactive) by re-dating it
      const olderDate = new Date(createdAt.getTime() - randInt(1, 30) * 24 * 60 * 60 * 1000);
      secretRows[secretRows.length - 1][5] = sqlVal(olderDate); // shift secret created_at back

      // Re-assign existing version row to be version 1 (older, inactive)
      versionRows[versionRows.length - 1][2] = sqlVal(1); // version = 1
      versionRows[versionRows.length - 1][7] = sqlVal(olderDate); // created_at
      versionRows[versionRows.length - 1][10] = sqlVal(false); // is_active = false

      // New version 2 is the current active one
      const newValue = `sk_test_v2_${randomUUID().replace(/-/g, '')}`;
      const newMaterial = await encryptor.encrypt(newValue);

      versionRows.push([
        sqlVal(randomUUID()),
        sqlVal(secretId),
        sqlVal(2),
        sqlVal(newMaterial.ciphertext),
        sqlVal(newMaterial.iv),
        sqlVal(newMaterial.authTag),
        sqlVal(newMaterial.keyId),
        sqlVal(createdAt), // version 2 created at the secret's main created_at
        sqlVal('seed-script'),
        sqlVal(ORG_ID),
        sqlVal(true), // active
      ]);
    }
  }

  const insertedSecrets = await batchInsert(client, 'secrets', secretCols, secretRows);
  const insertedVersions = await batchInsert(client, 'secret_versions', versionCols, versionRows);
  console.log(`  Inserted ${insertedSecrets} secrets, ${insertedVersions} secret versions`);
  return seeded;
}

async function seedApiKeys(client: PoolClient, count: number): Promise<void> {
  console.log(`\nSeeding ${count} API keys...`);

  const rows: string[][] = [];
  const columns = [
    'id',
    'name',
    'description',
    'key_hash',
    'key_prefix',
    'key_hint',
    'permissions',
    'scopes',
    'organization_id',
    'created_by',
    'is_active',
    'expires_at',
    'last_used_at',
    'usage_count',
    'rate_limit',
    'created_at',
    'updated_at',
  ];

  for (let i = 0; i < count; i++) {
    const id = randomUUID();
    const name = `${API_KEY_NAMES[i % API_KEY_NAMES.length]} #${i + 1}`;

    // Generate a realistic key and hash it
    const keyId = randomUUID().replace(/-/g, '').slice(0, 8);
    const keySecret = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 8);
    const plainKey = `sk_live_${keyId}_${keySecret}`;
    const keyHash = await bcrypt.hash(plainKey, 10);
    const keyHint = plainKey.slice(-8);

    const permissions = pick(API_KEY_PERMISSION_PRESETS);
    const isActive = Math.random() < 0.8;
    const createdAt = randomDate(90);
    const hasExpiry = Math.random() < 0.4;
    const expiresAt = hasExpiry
      ? new Date(Date.now() + randInt(1, 365) * 24 * 60 * 60 * 1000)
      : null;
    const wasUsed = Math.random() < 0.7;
    const lastUsedAt = wasUsed ? randomDate(7) : null;
    const usageCount = wasUsed ? randInt(1, 10000) : 0;
    const rateLimit = Math.random() < 0.5 ? pick([60, 120, 300, 600, 1000]) : null;

    rows.push([
      sqlVal(id),
      sqlVal(name),
      sqlVal(`API key for ${name.toLowerCase()}`),
      sqlVal(keyHash),
      sqlVal('sk_live_'),
      sqlVal(keyHint),
      sqlVal(permissions),
      sqlVal([]),
      sqlVal(ORG_ID),
      sqlVal('seed-script'),
      sqlVal(isActive),
      sqlVal(expiresAt),
      sqlVal(lastUsedAt),
      sqlVal(usageCount),
      sqlVal(rateLimit),
      sqlVal(createdAt),
      sqlVal(new Date(createdAt.getTime() + randInt(0, 7 * 24 * 60 * 60 * 1000))),
    ]);
  }

  const inserted = await batchInsert(client, 'api_keys', columns, rows);
  console.log(`  Inserted ${inserted} API keys`);
}

async function seedFiles(client: PoolClient, count: number): Promise<string[]> {
  console.log(`\nSeeding ${count} files...`);
  const fileIds: string[] = [];
  const rows: string[][] = [];
  const columns = [
    'id',
    'file_name',
    'mime_type',
    'size',
    'storage_key',
    'organization_id',
    'uploaded_at',
  ];

  for (let i = 0; i < count; i++) {
    const id = randomUUID();
    fileIds.push(id);
    const ext = pick(['json', 'csv', 'txt', 'pdf', 'png']);
    rows.push([
      sqlVal(id),
      sqlVal(`stress-test-file-${i}.${ext}`),
      sqlVal(ext === 'png' ? 'image/png' : ext === 'pdf' ? 'application/pdf' : `text/${ext}`),
      sqlVal(randInt(100, 500000)),
      sqlVal(`stress-test/${id}/${i}.${ext}`),
      sqlVal(ORG_ID),
      sqlVal(randomDate(90)),
    ]);
  }

  const inserted = await batchInsert(client, 'files', columns, rows);
  console.log(`  Inserted ${inserted} files`);
  return fileIds;
}

async function seedWorkflows(
  client: PoolClient,
  count: number,
  tierName: string,
  secretNames: string[] = [],
): Promise<WorkflowData[]> {
  console.log(`\nSeeding ${count} workflows...`);
  const workflows: WorkflowData[] = [];
  const rows: string[][] = [];
  const columns = [
    'id',
    'name',
    'description',
    'graph',
    'organization_id',
    'compiled_definition',
    'last_run',
    'run_count',
    'created_at',
    'updated_at',
  ];

  for (let i = 0; i < count; i++) {
    const id = randomUUID();
    const template = pick(TEMPLATES);
    const isLarge = tierName === 'large';
    const nodeCount = nodeCountForTemplate(template, isLarge);

    // 5% long names, 5% unicode
    let name: string;
    const nameRoll = Math.random();
    if (nameRoll < 0.05) {
      name = generateLongName();
    } else if (nameRoll < 0.1) {
      name = pick(UNICODE_NAMES);
    } else {
      name = `${pick(WORKFLOW_NAMES)} #${i + 1}`;
    }

    const graph = generateWorkflowGraph(name, template, nodeCount, secretNames);
    const compiled = generateCompiledDefinition(graph);
    const nodeRefs = graph.nodes.map((n) => n.id);
    const createdAt = randomDate(90);

    workflows.push({ id, name, graph, nodeRefs, createdAt });

    rows.push([
      sqlVal(id),
      sqlVal(name),
      sqlVal(graph.description),
      sqlVal(graph),
      sqlVal(ORG_ID),
      sqlVal(compiled),
      // Fix: last_run must be after workflow created_at (derived, not independent random)
      sqlVal(
        Math.random() < 0.8
          ? new Date(
              createdAt.getTime() + randInt(60000, Date.now() - createdAt.getTime() || 60000),
            )
          : null,
      ),
      // Fix: run_count set to 0 initially — updated after runs are seeded via SQL
      sqlVal(0),
      sqlVal(createdAt),
      sqlVal(new Date(createdAt.getTime() + randInt(0, 7 * 24 * 60 * 60 * 1000))),
    ]);
  }

  const inserted = await batchInsert(client, 'workflows', columns, rows);
  console.log(`  Inserted ${inserted} workflows`);
  return workflows;
}

async function seedVersions(
  client: PoolClient,
  workflows: WorkflowData[],
  versionRange: [number, number],
): Promise<VersionData[]> {
  console.log(`\nSeeding workflow versions...`);
  const versions: VersionData[] = [];
  const rows: string[][] = [];
  const columns = [
    'id',
    'workflow_id',
    'version',
    'graph',
    'organization_id',
    'compiled_definition',
    'created_at',
  ];

  for (const wf of workflows) {
    const vCount = randInt(versionRange[0], versionRange[1]);
    for (let v = 1; v <= vCount; v++) {
      const id = randomUUID();
      // Fix: version created_at must be after the workflow's created_at
      const versionCreatedAt = new Date(
        wf.createdAt.getTime() + v * randInt(60000, 7 * 24 * 60 * 60 * 1000),
      );
      versions.push({ id, workflowId: wf.id, version: v });
      rows.push([
        sqlVal(id),
        sqlVal(wf.id),
        sqlVal(v),
        sqlVal(wf.graph),
        sqlVal(ORG_ID),
        sqlVal(generateCompiledDefinition(wf.graph)),
        sqlVal(versionCreatedAt),
      ]);
    }
  }

  const inserted = await batchInsert(client, 'workflow_versions', columns, rows);
  console.log(`  Inserted ${inserted} workflow versions`);
  return versions;
}

async function seedMcpData(
  client: PoolClient,
  groupCount: number,
  serverCount: number,
  toolsRange: [number, number],
): Promise<{ groupIds: string[]; serverIds: string[] }> {
  console.log(`\nSeeding MCP data (${groupCount} groups, ${serverCount} servers)...`);

  // Groups
  const groupIds: string[] = [];
  const groupRows: string[][] = [];
  const groupCols = [
    'id',
    'slug',
    'name',
    'description',
    'credential_contract_name',
    'enabled',
    'created_at',
    'updated_at',
  ];

  for (let i = 0; i < groupCount; i++) {
    const id = randomUUID();
    groupIds.push(id);
    // Fix: updated_at must be after created_at
    const groupCreatedAt = randomDate(60);
    groupRows.push([
      sqlVal(id),
      sqlVal(`stress-test-group-${i}`),
      sqlVal(`Stress Test Group ${i}`),
      sqlVal(`MCP group for stress testing #${i}`),
      sqlVal('none'),
      sqlVal(true),
      sqlVal(groupCreatedAt),
      sqlVal(new Date(groupCreatedAt.getTime() + randInt(0, 30 * 24 * 60 * 60 * 1000))),
    ]);
  }

  await batchInsert(client, 'mcp_groups', groupCols, groupRows);
  console.log(`  Inserted ${groupCount} MCP groups`);

  // Servers
  const serverIds: string[] = [];
  const serverRows: string[][] = [];
  const serverCols = [
    'id',
    'name',
    'description',
    'transport_type',
    'endpoint',
    'command',
    'enabled',
    'health_check_url',
    'last_health_status',
    'group_id',
    'organization_id',
    'created_at',
    'updated_at',
  ];

  for (let i = 0; i < serverCount; i++) {
    const id = randomUUID();
    serverIds.push(id);
    const isHttp = Math.random() < 0.6;
    const groupId = pick(groupIds);
    // Fix: updated_at must be after created_at
    const serverCreatedAt = randomDate(60);
    serverRows.push([
      sqlVal(id),
      sqlVal(`stress-test-server-${i}`),
      sqlVal(`MCP server #${i} for stress testing`),
      sqlVal(isHttp ? 'http' : 'stdio'),
      sqlVal(isHttp ? `http://localhost:${3000 + i}/mcp` : null),
      sqlVal(isHttp ? null : 'npx'),
      sqlVal(Math.random() < 0.9),
      sqlVal(isHttp ? `http://localhost:${3000 + i}/health` : null),
      sqlVal(pick(['healthy', 'unhealthy', 'unknown', null])),
      sqlVal(groupId),
      sqlVal(ORG_ID),
      sqlVal(serverCreatedAt),
      sqlVal(new Date(serverCreatedAt.getTime() + randInt(0, 30 * 24 * 60 * 60 * 1000))),
    ]);
  }

  await batchInsert(client, 'mcp_servers', serverCols, serverRows);
  console.log(`  Inserted ${serverCount} MCP servers`);

  // Group-server junction
  const junctionRows: string[][] = [];
  const junctionCols = ['group_id', 'server_id', 'recommended', 'default_selected', 'created_at'];

  for (const sid of serverIds) {
    const gid = pick(groupIds);
    junctionRows.push([
      sqlVal(gid),
      sqlVal(sid),
      sqlVal(Math.random() < 0.3),
      sqlVal(Math.random() < 0.7),
      sqlVal(randomDate(60)),
    ]);
  }

  await batchInsert(client, 'mcp_group_servers', junctionCols, junctionRows);

  // Tools
  const toolRows: string[][] = [];
  const toolCols = [
    'id',
    'server_id',
    'tool_name',
    'description',
    'input_schema',
    'enabled',
    'discovered_at',
  ];

  for (const sid of serverIds) {
    const toolCount = randInt(toolsRange[0], toolsRange[1]);
    for (let t = 0; t < toolCount; t++) {
      toolRows.push([
        sqlVal(randomUUID()),
        sqlVal(sid),
        sqlVal(`tool_${shortUUID()}_${t}`),
        sqlVal(`Auto-discovered tool #${t}`),
        sqlVal({ type: 'object', properties: { input: { type: 'string' } } }),
        sqlVal(Math.random() < 0.85),
        sqlVal(randomDate(30)),
      ]);
    }
  }

  const toolsInserted = await batchInsert(client, 'mcp_server_tools', toolCols, toolRows);
  console.log(`  Inserted ${toolsInserted} MCP server tools`);

  return { groupIds, serverIds };
}

async function seedRuns(
  client: PoolClient,
  workflows: WorkflowData[],
  versions: VersionData[],
  count: number,
): Promise<RunData[]> {
  console.log(`\nSeeding ${count} workflow runs...`);
  const runs: RunData[] = [];
  const rows: string[][] = [];
  const columns = [
    'run_id',
    'workflow_id',
    'workflow_version_id',
    'workflow_version',
    'temporal_run_id',
    'parent_run_id',
    'parent_node_ref',
    'total_actions',
    'inputs',
    'trigger_type',
    'trigger_source',
    'trigger_label',
    'input_preview',
    'organization_id',
    'status',
    'close_time',
    'created_at',
    'updated_at',
  ];

  const versionsByWorkflow = new Map<string, VersionData[]>();
  for (const v of versions) {
    const arr = versionsByWorkflow.get(v.workflowId) || [];
    arr.push(v);
    versionsByWorkflow.set(v.workflowId, arr);
  }

  // First pass: create runs
  for (let i = 0; i < count; i++) {
    const wf = pick(workflows);
    const wfVersions = versionsByWorkflow.get(wf.id) || [];
    const version = wfVersions.length > 0 ? pick(wfVersions) : null;
    const status = pickWeighted(RUN_STATUS_DIST);
    const trigger = pickWeighted(TRIGGER_DIST);
    const runId = `wfr_${randomUUID()}`;
    const isOpenStatus = ['RUNNING', 'QUEUED', 'AWAITING_INPUT'].includes(status);
    // Fix: open runs use recent timestamps for realistic durations;
    // closed runs use a random time after the workflow was created (not before it)
    const createdAt = isOpenStatus
      ? randomDate(0.1)
      : new Date(
          wf.createdAt.getTime() +
            randInt(60000, Math.max(60001, Date.now() - wf.createdAt.getTime())),
        );
    const isAgentRun = wf.graph.nodes.some((n) => n.type === 'core.ai.agent');

    runs.push({
      runId,
      workflowId: wf.id,
      versionId: version?.id ?? null,
      version: version?.version ?? null,
      status,
      nodeRefs: wf.nodeRefs,
      createdAt,
      isAgentRun,
    });

    const triggerLabels: Record<string, string> = {
      manual: 'Manual run',
      schedule: 'Scheduled run',
      api: 'API trigger',
      webhook: 'Webhook trigger',
    };

    rows.push([
      sqlVal(runId),
      sqlVal(wf.id),
      sqlVal(version?.id ?? null),
      sqlVal(version?.version ?? null),
      sqlVal(`temporal-${shortUUID()}`),
      sqlVal(null), // parentRunId set in second pass
      sqlVal(null),
      sqlVal(wf.nodeRefs.length),
      sqlVal({}),
      sqlVal(trigger),
      sqlVal(trigger === 'webhook' ? `/hooks/${shortUUID()}` : null),
      sqlVal(triggerLabels[trigger] || 'Manual run'),
      sqlVal({ runtimeInputs: {}, nodeOverrides: {} }),
      sqlVal(ORG_ID),
      sqlVal(status),
      sqlVal(isOpenStatus ? null : new Date(createdAt.getTime() + randInt(1000, 300000))),
      sqlVal(createdAt),
      sqlVal(new Date(createdAt.getTime() + randInt(1000, 300000))),
    ]);
  }

  const inserted = await batchInsert(client, 'workflow_runs', columns, rows);
  console.log(`  Inserted ${inserted} workflow runs`);

  // Second pass: set parent-child relationships (~10% are child runs, up to 3-4 deep chains)
  const parentCandidates = runs.filter((r) => r.status === 'COMPLETED');
  const childCount = Math.floor(runs.length * 0.1);

  if (parentCandidates.length > 0 && childCount > 0) {
    console.log(`  Setting ${childCount} parent-child relationships...`);
    const shuffled = [...runs].sort(() => Math.random() - 0.5).slice(0, childCount);
    for (const child of shuffled) {
      // Fix: only assign parent if child was created after parent (child runs are spawned during parent execution)
      const validParents = parentCandidates.filter(
        (p) => p.runId !== child.runId && p.createdAt.getTime() < child.createdAt.getTime(),
      );
      if (validParents.length === 0) continue;
      const parent = pick(validParents);
      await client.query(
        `UPDATE workflow_runs SET parent_run_id = $1, parent_node_ref = $2 WHERE run_id = $3`,
        [parent.runId, pick(parent.nodeRefs), child.runId],
      );
    }
  }

  return runs;
}

async function seedTraces(
  client: PoolClient,
  runs: RunData[],
  tracesRange: [number, number],
): Promise<void> {
  console.log(`\nSeeding workflow traces...`);
  const columns = [
    'run_id',
    'workflow_id',
    'organization_id',
    'type',
    'node_ref',
    'timestamp',
    'message',
    'error',
    'output_summary',
    'level',
    'data',
    'sequence',
    'created_at',
  ];

  let totalInserted = 0;
  const batchRows: string[][] = [];

  // 2% of runs have zero traces
  const runsWithTraces = runs.filter(() => Math.random() > 0.02);

  for (const run of runsWithTraces) {
    const maxTraces = randInt(tracesRange[0], tracesRange[1]);
    const traceEvents = generateTraceSequence(run.nodeRefs, run.status, maxTraces);
    const baseTime = run.createdAt.getTime();

    // Fix: use cumulative offset so timestamps are always monotonically increasing
    let cumulativeOffset = 0;
    for (let seq = 0; seq < traceEvents.length; seq++) {
      const evt = traceEvents[seq];
      cumulativeOffset += randInt(100, 5000);
      const ts = new Date(baseTime + cumulativeOffset);

      batchRows.push([
        sqlVal(run.runId),
        sqlVal(run.workflowId),
        sqlVal(ORG_ID),
        sqlVal(evt.type),
        sqlVal(evt.nodeRef),
        sqlVal(ts),
        sqlVal(evt.message),
        sqlVal(evt.error),
        sqlVal(evt.outputSummary),
        sqlVal(evt.level),
        sqlVal(evt.data),
        sqlVal(seq),
        sqlVal(ts),
      ]);
    }

    // Flush periodically
    if (batchRows.length >= 1000) {
      totalInserted += await batchInsert(client, 'workflow_traces', columns, batchRows, 500);
      batchRows.length = 0;
    }
  }

  if (batchRows.length > 0) {
    totalInserted += await batchInsert(client, 'workflow_traces', columns, batchRows, 500);
  }

  console.log(`  Inserted ${totalInserted} workflow traces`);
}

async function seedNodeIO(
  client: PoolClient,
  runs: RunData[],
  ioRange: [number, number],
): Promise<void> {
  console.log(`\nSeeding node I/O...`);
  const columns = [
    'run_id',
    'node_ref',
    'workflow_id',
    'organization_id',
    'component_id',
    'inputs',
    'inputs_size',
    'inputs_spilled',
    'outputs',
    'outputs_size',
    'outputs_spilled',
    'started_at',
    'completed_at',
    'duration_ms',
    'status',
    'error_message',
    'created_at',
    'updated_at',
  ];

  let totalInserted = 0;
  const batchRows: string[][] = [];
  const seenKeys = new Set<string>();

  for (const run of runs) {
    const ioCount = Math.min(randInt(ioRange[0], ioRange[1]), run.nodeRefs.length);
    const selectedNodes = run.nodeRefs.slice(0, ioCount);

    // Fix: stagger node start times sequentially so later nodes start after earlier ones
    let nodeTimeOffset = 0;
    for (const nodeRef of selectedNodes) {
      const key = `${run.runId}:${nodeRef}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      const isFailed =
        run.status === 'FAILED' && nodeRef === selectedNodes[selectedNodes.length - 1];
      const isRunning = ['RUNNING', 'QUEUED'].includes(run.status);
      const isLastSelectedNode = nodeRef === selectedNodes[selectedNodes.length - 1];
      // Only the last node in a running run is still executing; earlier nodes completed
      const nodeStatus = isFailed
        ? 'failed'
        : isRunning && isLastSelectedNode
          ? 'running'
          : 'completed';
      nodeTimeOffset += randInt(100, 5000);
      const startedAt = new Date(run.createdAt.getTime() + nodeTimeOffset);
      const durationMs = randInt(50, 30000);
      nodeTimeOffset += durationMs; // next node starts after this one completes

      // 5% large outputs (50-100KB)
      const isLargeOutput = Math.random() < 0.05;
      const outputData = isLargeOutput
        ? { data: 'x'.repeat(randInt(50000, 100000)) }
        : { result: 'ok', value: randInt(1, 1000) };
      const outputJson = JSON.stringify(outputData);

      batchRows.push([
        sqlVal(run.runId),
        sqlVal(nodeRef),
        sqlVal(run.workflowId),
        sqlVal(ORG_ID),
        sqlVal(pick(NODE_TYPES)),
        sqlVal({ input1: 'value1' }),
        sqlVal(20),
        sqlVal(false),
        sqlVal(outputData),
        sqlVal(outputJson.length),
        sqlVal(isLargeOutput),
        sqlVal(startedAt),
        sqlVal(nodeStatus === 'running' ? null : new Date(startedAt.getTime() + durationMs)),
        sqlVal(nodeStatus === 'running' ? null : durationMs),
        sqlVal(nodeStatus),
        sqlVal(isFailed ? 'Connection timeout' : null),
        sqlVal(startedAt),
        // Fix: running nodes haven't completed yet, so updated_at should be startedAt
        sqlVal(nodeStatus === 'running' ? startedAt : new Date(startedAt.getTime() + durationMs)),
      ]);
    }

    if (batchRows.length >= 1000) {
      totalInserted += await batchInsert(client, 'node_io', columns, batchRows, 500);
      batchRows.length = 0;
    }
  }

  if (batchRows.length > 0) {
    totalInserted += await batchInsert(client, 'node_io', columns, batchRows, 500);
  }

  console.log(`  Inserted ${totalInserted} node I/O records`);
}

async function seedSchedules(
  client: PoolClient,
  workflows: WorkflowData[],
  versions: VersionData[],
  count: number,
): Promise<void> {
  console.log(`\nSeeding ${count} workflow schedules...`);
  const columns = [
    'id',
    'workflow_id',
    'workflow_version_id',
    'workflow_version',
    'name',
    'description',
    'cron_expression',
    'timezone',
    'human_label',
    'overlap_policy',
    'status',
    'last_run_at',
    'next_run_at',
    'input_payload',
    'temporal_schedule_id',
    'temporal_snapshot',
    'organization_id',
    'created_at',
    'updated_at',
  ];

  const versionsByWorkflow = new Map<string, VersionData[]>();
  for (const v of versions) {
    const arr = versionsByWorkflow.get(v.workflowId) || [];
    arr.push(v);
    versionsByWorkflow.set(v.workflowId, arr);
  }

  const rows: string[][] = [];

  for (let i = 0; i < count; i++) {
    const wf = pick(workflows);
    const wfVersions = versionsByWorkflow.get(wf.id) || [];
    const version = wfVersions.length > 0 ? pick(wfVersions) : null;
    const status = pickWeighted(SCHEDULE_STATUS_DIST);
    const cron = pick(CRON_EXPRESSIONS);
    const tz = pick(TIMEZONES);
    // Fix: updated_at must be after created_at (derive, don't use independent random)
    const schedCreatedAt = randomDate(60);

    rows.push([
      sqlVal(randomUUID()),
      sqlVal(wf.id),
      sqlVal(version?.id ?? null),
      sqlVal(version?.version ?? null),
      sqlVal(`Schedule for ${wf.name.substring(0, 50)} #${i}`),
      sqlVal(Math.random() < 0.3 ? null : `Runs ${cron} in ${tz}`),
      sqlVal(cron),
      sqlVal(tz),
      sqlVal(`Every ${pick(['6 hours', 'weekday at 9am', '15 minutes', 'day at midnight'])}`),
      sqlVal(pick(['skip', 'buffer', 'allow'])),
      sqlVal(status),
      sqlVal(status !== 'error' ? randomDate(7) : null),
      sqlVal(status === 'active' ? new Date(Date.now() + randInt(60000, 86400000)) : null),
      sqlVal({ runtimeInputs: {}, nodeOverrides: {} }),
      sqlVal(`temporal-sched-${shortUUID()}`),
      sqlVal({}),
      sqlVal(ORG_ID),
      sqlVal(schedCreatedAt),
      sqlVal(new Date(schedCreatedAt.getTime() + randInt(0, 30 * 24 * 60 * 60 * 1000))),
    ]);
  }

  const inserted = await batchInsert(client, 'workflow_schedules', columns, rows);
  console.log(`  Inserted ${inserted} workflow schedules`);
}

async function seedWebhooks(
  client: PoolClient,
  workflows: WorkflowData[],
  versions: VersionData[],
  runs: RunData[],
  configCount: number,
  deliveryCount: number,
): Promise<void> {
  console.log(`\nSeeding ${configCount} webhook configs, ${deliveryCount} deliveries...`);

  // Webhook configurations
  const configCols = [
    'id',
    'workflow_id',
    'workflow_version_id',
    'workflow_version',
    'name',
    'description',
    'webhook_path',
    'parsing_script',
    'expected_inputs',
    'status',
    'organization_id',
    'created_at',
    'updated_at',
  ];

  const versionsByWorkflow = new Map<string, VersionData[]>();
  for (const v of versions) {
    const arr = versionsByWorkflow.get(v.workflowId) || [];
    arr.push(v);
    versionsByWorkflow.set(v.workflowId, arr);
  }

  const webhookIds: string[] = [];
  const configRows: string[][] = [];

  for (let i = 0; i < configCount; i++) {
    const id = randomUUID();
    webhookIds.push(id);
    const wf = pick(workflows);
    const wfVersions = versionsByWorkflow.get(wf.id) || [];
    const version = wfVersions.length > 0 ? pick(wfVersions) : null;

    // Fix: updated_at must be after created_at
    const whConfigCreatedAt = randomDate(60);
    configRows.push([
      sqlVal(id),
      sqlVal(wf.id),
      sqlVal(version?.id ?? null),
      sqlVal(version?.version ?? null),
      sqlVal(`Webhook ${wf.name.substring(0, 40)} #${i}`),
      sqlVal(Math.random() < 0.3 ? null : 'Auto-generated webhook'),
      sqlVal(`wh_${shortUUID()}_${i}`),
      sqlVal('return { ...body };'),
      sqlVal([{ id: 'input1', label: 'Input 1', type: 'text', required: true }]),
      sqlVal(Math.random() < 0.8 ? 'active' : 'inactive'),
      sqlVal(ORG_ID),
      sqlVal(whConfigCreatedAt),
      sqlVal(new Date(whConfigCreatedAt.getTime() + randInt(0, 30 * 24 * 60 * 60 * 1000))),
    ]);
  }

  const configsInserted = await batchInsert(
    client,
    'webhook_configurations',
    configCols,
    configRows,
  );
  console.log(`  Inserted ${configsInserted} webhook configurations`);

  // Webhook deliveries
  const deliveryCols = [
    'id',
    'webhook_id',
    'workflow_run_id',
    'status',
    'payload',
    'headers',
    'parsed_data',
    'error_message',
    'created_at',
    'completed_at',
  ];

  const deliveryRows: string[][] = [];

  // Fix: link deliveries to actual webhook-triggered runs and ensure completed_at >= created_at
  const webhookRuns = runs.filter((r) => r.status === 'COMPLETED' || r.status === 'FAILED');
  for (let i = 0; i < deliveryCount; i++) {
    const webhookId = pick(webhookIds);
    const status = pickWeighted(DELIVERY_STATUS_DIST);
    const deliveryCreatedAt = randomDate(30);
    // Fix: link to an actual run when delivered (not always null)
    const linkedRun = status === 'delivered' && webhookRuns.length > 0 ? pick(webhookRuns) : null;

    deliveryRows.push([
      sqlVal(randomUUID()),
      sqlVal(webhookId),
      sqlVal(linkedRun?.runId ?? null),
      sqlVal(status),
      sqlVal({ event: 'test', data: { index: i } }),
      sqlVal({ 'content-type': 'application/json' }),
      sqlVal(status === 'delivered' ? { parsed: true } : null),
      sqlVal(status === 'failed' ? 'Webhook processing failed' : null),
      sqlVal(deliveryCreatedAt),
      // Fix: completed_at must be after created_at (not independent random)
      sqlVal(
        status !== 'processing'
          ? new Date(deliveryCreatedAt.getTime() + randInt(100, 30000))
          : null,
      ),
    ]);
  }

  const deliveriesInserted = await batchInsert(
    client,
    'webhook_deliveries',
    deliveryCols,
    deliveryRows,
  );
  console.log(`  Inserted ${deliveriesInserted} webhook deliveries`);
}

async function seedHumanInputRequests(
  client: PoolClient,
  runs: RunData[],
  count: number,
): Promise<void> {
  console.log(`\nSeeding ${count} human input requests...`);
  const columns = [
    'id',
    'run_id',
    'workflow_id',
    'node_ref',
    'status',
    'input_type',
    'input_schema',
    'title',
    'description',
    'context',
    'resolve_token',
    'timeout_at',
    'response_data',
    'responded_at',
    'responded_by',
    'organization_id',
    'created_at',
    'updated_at',
  ];

  const rows: string[][] = [];

  // Fix: ensure every AWAITING_INPUT run gets at least one pending human input request
  const awaitingRuns = runs.filter((r) => r.status === 'AWAITING_INPUT');
  const guaranteedRows: { run: RunData; status: string }[] = awaitingRuns.map((r) => ({
    run: r,
    status: 'pending',
  }));

  // Fill remaining slots with random assignments
  const remainingCount = Math.max(0, count - guaranteedRows.length);
  const randomRows: { run: RunData; status: string }[] = [];
  for (let i = 0; i < remainingCount; i++) {
    randomRows.push({
      run: pick(runs),
      status: pickWeighted(HUMAN_INPUT_STATUS_DIST),
    });
  }

  const allInputRows = [...guaranteedRows, ...randomRows];

  for (let i = 0; i < allInputRows.length; i++) {
    const { run, status } = allInputRows[i];
    const inputType = pickWeighted(HUMAN_INPUT_TYPE_DIST);
    // Fix: created_at should be within the run's time window, not an independent random date
    const runDuration = Math.max(60000, Date.now() - run.createdAt.getTime());
    const createdAt = new Date(
      run.createdAt.getTime() + randInt(1000, Math.min(runDuration, 24 * 60 * 60 * 1000)),
    );

    rows.push([
      sqlVal(randomUUID()),
      sqlVal(run.runId),
      sqlVal(run.workflowId),
      sqlVal(pick(run.nodeRefs)),
      sqlVal(status),
      sqlVal(inputType),
      sqlVal({ type: 'object', properties: {} }),
      sqlVal(`${inputType.charAt(0).toUpperCase() + inputType.slice(1)} Request #${i}`),
      sqlVal(Math.random() < 0.3 ? null : `Please ${inputType} this action`),
      sqlVal({ workflow: run.workflowId }),
      sqlVal(`token_${randomUUID()}`),
      sqlVal(status === 'expired' ? new Date(createdAt.getTime() + 3600000) : null),
      sqlVal(status === 'resolved' ? { approved: true } : null),
      sqlVal(
        status === 'resolved' ? new Date(createdAt.getTime() + randInt(60000, 3600000)) : null,
      ),
      sqlVal(status === 'resolved' ? 'stress-test-user' : null),
      sqlVal(ORG_ID),
      sqlVal(createdAt),
      sqlVal(
        status !== 'pending' ? new Date(createdAt.getTime() + randInt(60000, 3600000)) : createdAt,
      ),
    ]);
  }

  const inserted = await batchInsert(client, 'human_input_requests', columns, rows);
  console.log(`  Inserted ${inserted} human input requests`);
}

async function seedArtifacts(
  client: PoolClient,
  runs: RunData[],
  fileIds: string[],
  count: number,
): Promise<void> {
  console.log(`\nSeeding ${count} artifacts...`);
  const columns = [
    'id',
    'run_id',
    'workflow_id',
    'workflow_version_id',
    'component_id',
    'component_ref',
    'file_id',
    'name',
    'mime_type',
    'size',
    'destinations',
    'metadata',
    'organization_id',
    'created_at',
  ];

  const rows: string[][] = [];

  for (let i = 0; i < count; i++) {
    const run = pick(runs);
    const fileId = pick(fileIds);
    const ext = pick(['json', 'csv', 'txt', 'pdf', 'png']);
    // Fix: artifact created_at should be within the run's execution window
    const artifactCreatedAt = new Date(run.createdAt.getTime() + randInt(1000, 300000));

    rows.push([
      sqlVal(randomUUID()),
      sqlVal(run.runId),
      sqlVal(run.workflowId),
      sqlVal(run.versionId),
      sqlVal(pick(NODE_TYPES)),
      sqlVal(pick(run.nodeRefs)),
      sqlVal(fileId),
      sqlVal(`artifact-${i}.${ext}`),
      sqlVal(ext === 'png' ? 'image/png' : ext === 'pdf' ? 'application/pdf' : `text/${ext}`),
      sqlVal(randInt(100, 500000)),
      sqlVal(pick([['run'], ['library'], ['run', 'library']])),
      sqlVal(Math.random() < 0.5 ? { generated: true, index: i } : null),
      sqlVal(ORG_ID),
      sqlVal(artifactCreatedAt),
    ]);
  }

  const inserted = await batchInsert(client, 'artifacts', columns, rows);
  console.log(`  Inserted ${inserted} artifacts`);
}

async function seedAgentTraceEvents(
  client: PoolClient,
  runs: RunData[],
  eventsRange: [number, number],
): Promise<void> {
  const agentRuns = runs.filter((r) => r.isAgentRun);
  if (agentRuns.length === 0) {
    console.log(`\nNo agent runs to seed trace events for.`);
    return;
  }

  console.log(`\nSeeding agent trace events for ${agentRuns.length} agent runs...`);
  const columns = [
    'agent_run_id',
    'workflow_run_id',
    'node_ref',
    'sequence',
    'timestamp',
    'part_type',
    'payload',
    'created_at',
  ];

  let totalInserted = 0;
  const batchRows: string[][] = [];

  for (const run of agentRuns) {
    const agentNodeRefs = run.nodeRefs.slice(0, Math.max(1, Math.floor(run.nodeRefs.length / 3)));
    const agentRunId = `agent_${shortUUID()}`;
    // Fix: all events in a single agent run belong to the same agent node
    const agentNodeRef = pick(agentNodeRefs);
    const eventCount = randInt(eventsRange[0], eventsRange[1]);
    const baseTime = run.createdAt.getTime();
    // Fix: use cumulative offset for monotonically increasing timestamps
    let agentCumulativeOffset = 0;

    for (let seq = 0; seq < eventCount; seq++) {
      const partType = pick(AGENT_PART_TYPES);
      agentCumulativeOffset += randInt(500, 3000);
      const ts = new Date(baseTime + agentCumulativeOffset);

      let payload: unknown;
      switch (partType) {
        case 'text':
          payload = { text: `Agent response step ${seq}` };
          break;
        case 'tool-call':
          payload = { toolName: `tool_${shortUUID()}`, args: { input: 'test' } };
          break;
        case 'tool-result':
          payload = { result: { output: 'success' } };
          break;
        case 'step-start':
          payload = { step: seq };
          break;
        case 'reasoning':
          payload = { reasoning: `Thinking about step ${seq}...` };
          break;
        case 'error':
          payload = { error: 'Something went wrong', code: 'ERR_UNKNOWN' };
          break;
        default:
          payload = { data: partType };
      }

      batchRows.push([
        sqlVal(agentRunId),
        sqlVal(run.runId),
        sqlVal(agentNodeRef),
        sqlVal(seq),
        sqlVal(ts),
        sqlVal(partType),
        sqlVal(payload),
        sqlVal(ts),
      ]);
    }

    if (batchRows.length >= 1000) {
      totalInserted += await batchInsert(client, 'agent_trace_events', columns, batchRows, 500);
      batchRows.length = 0;
    }
  }

  if (batchRows.length > 0) {
    totalInserted += await batchInsert(client, 'agent_trace_events', columns, batchRows, 500);
  }

  console.log(`  Inserted ${totalInserted} agent trace events`);
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

async function cleanup(client: PoolClient): Promise<void> {
  console.log('\nCleaning up stress-test data...\n');

  // Delete in reverse FK order
  const deletions = [
    `DELETE FROM agent_trace_events WHERE workflow_run_id IN (SELECT run_id FROM workflow_runs WHERE organization_id = '${ORG_ID}')`,
    `DELETE FROM artifacts WHERE organization_id = '${ORG_ID}'`,
    `DELETE FROM human_input_requests WHERE organization_id = '${ORG_ID}'`,
    `DELETE FROM webhook_deliveries WHERE webhook_id IN (SELECT id FROM webhook_configurations WHERE organization_id = '${ORG_ID}')`,
    `DELETE FROM webhook_configurations WHERE organization_id = '${ORG_ID}'`,
    `DELETE FROM workflow_schedules WHERE organization_id = '${ORG_ID}'`,
    `DELETE FROM node_io WHERE organization_id = '${ORG_ID}'`,
    `DELETE FROM workflow_traces WHERE organization_id = '${ORG_ID}'`,
    `DELETE FROM workflow_runs WHERE organization_id = '${ORG_ID}'`,
    `DELETE FROM mcp_server_tools WHERE server_id IN (SELECT id FROM mcp_servers WHERE organization_id = '${ORG_ID}')`,
    `DELETE FROM mcp_group_servers WHERE server_id IN (SELECT id FROM mcp_servers WHERE organization_id = '${ORG_ID}')`,
    `DELETE FROM mcp_servers WHERE organization_id = '${ORG_ID}'`,
    `DELETE FROM mcp_groups WHERE slug LIKE 'stress-test-group-%'`,
    `DELETE FROM api_keys WHERE organization_id = '${ORG_ID}'`,
    `DELETE FROM secret_versions WHERE organization_id = '${ORG_ID}'`,
    `DELETE FROM secrets WHERE organization_id = '${ORG_ID}'`,
    `DELETE FROM workflow_versions WHERE organization_id = '${ORG_ID}'`,
    `DELETE FROM workflows WHERE organization_id = '${ORG_ID}'`,
    `DELETE FROM files WHERE organization_id = '${ORG_ID}'`,
  ];

  for (const sql of deletions) {
    const table = sql.match(/FROM (\S+)/)?.[1] || 'unknown';
    const result = await client.query(sql);
    console.log(`  Deleted ${result.rowCount} rows from ${table}`);
  }

  console.log('\nCleanup complete.');
}

// ─── Main ────────────────────────────────────────────────────────────────────

function parseArgs(): { tier: string; clean: boolean } {
  const args = process.argv.slice(2);
  let tier = 'small';
  let clean = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tier' && args[i + 1]) {
      tier = args[i + 1];
      i++;
    }
    if (args[i] === '--clean') {
      clean = true;
    }
  }

  if (!TIERS[tier]) {
    console.error(`Invalid tier: ${tier}. Choose from: ${Object.keys(TIERS).join(', ')}`);
    process.exit(1);
  }

  return { tier, clean };
}

async function main() {
  const { tier, clean } = parseArgs();
  const config = TIERS[tier];

  const connectionString =
    process.env.DATABASE_URL || 'postgresql://shipsec:shipsec@localhost:5433/shipsec';

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    if (clean) {
      await client.query('BEGIN');
      await cleanup(client);
      await client.query('COMMIT');
      return;
    }

    console.log(`\nStress Test Seed - Tier: ${tier.toUpperCase()}`);
    console.log('='.repeat(50));

    // Auto-clean existing seed data before re-seeding to prevent accumulation
    await client.query('BEGIN');
    await cleanup(client);
    await client.query('COMMIT');

    const startTime = Date.now();

    // Seed in FK-safe order, one transaction per entity type
    await client.query('BEGIN');
    const fileIds = await seedFiles(client, config.artifactsAndFiles);
    await client.query('COMMIT');

    await client.query('BEGIN');
    const seededSecrets = await seedSecrets(client, config.secrets);
    await client.query('COMMIT');

    const secretNames = seededSecrets.map((s) => s.name);

    await client.query('BEGIN');
    const workflows = await seedWorkflows(client, config.workflows, tier, secretNames);
    await client.query('COMMIT');

    await client.query('BEGIN');
    const versions = await seedVersions(client, workflows, config.workflowVersionsRange);
    await client.query('COMMIT');

    await client.query('BEGIN');
    await seedMcpData(client, config.mcpGroups, config.mcpServers, config.mcpToolsPerServerRange);
    await client.query('COMMIT');

    await client.query('BEGIN');
    const runs = await seedRuns(client, workflows, versions, config.workflowRuns);
    await client.query('COMMIT');

    // Fix: update run_count to match actual seeded runs per workflow
    await client.query('BEGIN');
    await client.query(`
      UPDATE workflows SET run_count = sub.cnt
      FROM (SELECT workflow_id, COUNT(*) AS cnt FROM workflow_runs WHERE organization_id = '${ORG_ID}' GROUP BY workflow_id) sub
      WHERE workflows.id = sub.workflow_id AND workflows.organization_id = '${ORG_ID}'
    `);
    await client.query('COMMIT');

    await client.query('BEGIN');
    await seedTraces(client, runs, config.tracesPerRunRange);
    await client.query('COMMIT');

    await client.query('BEGIN');
    await seedNodeIO(client, runs, config.nodeIoPerRunRange);
    await client.query('COMMIT');

    await client.query('BEGIN');
    await seedSchedules(client, workflows, versions, config.schedules);
    await client.query('COMMIT');

    await client.query('BEGIN');
    await seedWebhooks(
      client,
      workflows,
      versions,
      runs,
      config.webhookConfigs,
      config.webhookDeliveries,
    );
    await client.query('COMMIT');

    await client.query('BEGIN');
    await seedHumanInputRequests(client, runs, config.humanInputRequests);
    await client.query('COMMIT');

    await client.query('BEGIN');
    await seedArtifacts(client, runs, fileIds, config.artifactsAndFiles);
    await client.query('COMMIT');

    await client.query('BEGIN');
    await seedAgentTraceEvents(client, runs, config.agentTraceEventsPerRun);
    await client.query('COMMIT');

    await client.query('BEGIN');
    await seedApiKeys(client, config.apiKeys);
    await client.query('COMMIT');

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n' + '='.repeat(50));
    console.log(`Seed complete in ${elapsed}s`);
    console.log(`Tier: ${tier} | Organization: ${ORG_ID}`);
    console.log(`Run --clean to remove all stress-test data.`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\nSeed failed:');
    console.error(error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Script encountered an unexpected error');
  console.error(error);
  process.exit(1);
});
