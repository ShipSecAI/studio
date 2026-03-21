/**
 * Shared ClickHouse Analytics Schema
 *
 * Single source of truth for the findings table schema.
 * Import from here in both backend (tenant service) and worker (indexer)
 * to eliminate duplication and keep DDL/migration/row-building in sync.
 */

// ---------------------------------------------------------------------------
// Column metadata types
// ---------------------------------------------------------------------------

/** Column kind drives type-specific marshalling in buildFindingRow */
export type ColumnKind =
  | 'string'
  | 'lowcardinality'
  | 'datetime'
  | 'uint32'
  | 'date'
  | 'array'
  | 'map'
  | 'json';

/** Full metadata for a single ClickHouse column in the findings table */
export interface ColumnDef {
  /** ClickHouse column name */
  name: string;
  /** Full ClickHouse type string, e.g. `'LowCardinality(String)'` */
  chType: string;
  /** Semantic kind used for marshalling */
  kind: ColumnKind;
  /** ClickHouse DEFAULT expression, e.g. `"''"`, `'now64(3)'`, `'[]'`, `'map()'` */
  default?: string;
  /** CODEC expression, e.g. `'DoubleDelta, ZSTD(3)'` */
  codec?: string;
  /** Whether this column is exposed in user-facing filters / sorts / aggregations */
  filterable?: boolean;
  /** If set, column is MATERIALIZED with this expression, e.g. `'toDate(timestamp)'` */
  materialized?: string;
}

// ---------------------------------------------------------------------------
// Master column definitions
// ---------------------------------------------------------------------------

/** All columns in the findings table, in schema order */
export const COLUMN_DEFS: ColumnDef[] = [
  // Primary identifiers
  { name: 'organization_id', chType: 'LowCardinality(String)', kind: 'lowcardinality' },
  { name: 'finding_hash', chType: 'String', kind: 'string', filterable: true },

  // Timestamps
  { name: 'timestamp', chType: 'DateTime64(3)', kind: 'datetime', codec: 'DoubleDelta, ZSTD(3)', filterable: true },
  { name: 'ingested_at', chType: 'DateTime64(3)', kind: 'datetime', default: 'now64(3)', codec: 'DoubleDelta, ZSTD(3)', filterable: true },

  // Materialized partition key
  { name: 'event_date', chType: 'Date', kind: 'date', materialized: 'toDate(timestamp)', codec: 'Delta, ZSTD(3)' },

  // Workflow context
  { name: 'workflow_id', chType: 'String', kind: 'string', default: "''", filterable: true },
  { name: 'workflow_name', chType: 'String', kind: 'string', default: "''", filterable: true },
  { name: 'run_id', chType: 'String', kind: 'string', default: "''", filterable: true },
  { name: 'node_ref', chType: 'String', kind: 'string', default: "''" },
  { name: 'component_id', chType: 'LowCardinality(String)', kind: 'lowcardinality', default: "''", filterable: true },

  // Asset context
  { name: 'asset_key', chType: 'String', kind: 'string', default: "''", filterable: true },

  // Trigger context
  { name: 'trigger_source', chType: 'String', kind: 'string', default: "''", filterable: true },
  { name: 'trigger_type', chType: 'String', kind: 'string', default: "''", filterable: true },

  // Scan context
  { name: 'repository', chType: 'String', kind: 'string', default: "''", filterable: true },
  { name: 'branch', chType: 'String', kind: 'string', default: "''", filterable: true },
  { name: 'commit_sha', chType: 'String', kind: 'string', default: "''", filterable: true },
  { name: 'account_id', chType: 'String', kind: 'string', default: "''", filterable: true },
  { name: 'connection_name', chType: 'String', kind: 'string', default: "''", filterable: true },
  { name: 'provider', chType: 'LowCardinality(String)', kind: 'lowcardinality', default: "''", filterable: true },

  // Finding core fields
  { name: 'scanner', chType: 'LowCardinality(String)', kind: 'lowcardinality', default: "''", filterable: true },
  { name: 'severity', chType: 'LowCardinality(String)', kind: 'lowcardinality', default: "''", filterable: true },
  { name: 'status', chType: 'LowCardinality(String)', kind: 'lowcardinality', default: "''", filterable: true },
  { name: 'title', chType: 'String', kind: 'string', default: "''", filterable: true },
  { name: 'description', chType: 'String', kind: 'string', default: "''", filterable: true },
  { name: 'rule_id', chType: 'String', kind: 'string', default: "''", filterable: true },
  { name: 'check_name', chType: 'String', kind: 'string', default: "''", filterable: true },
  { name: 'check_id', chType: 'String', kind: 'string', default: "''", filterable: true },
  { name: 'region', chType: 'LowCardinality(String)', kind: 'lowcardinality', default: "''", filterable: true },
  { name: 'service_name', chType: 'LowCardinality(String)', kind: 'lowcardinality', default: "''", filterable: true },
  { name: 'ip', chType: 'String', kind: 'string', default: "''", filterable: true },
  { name: 'file', chType: 'String', kind: 'string', default: "''", filterable: true },
  { name: 'source_input', chType: 'String', kind: 'string', default: "''", filterable: true },
  { name: 'compliance', chType: 'Array(String)', kind: 'array', default: '[]', filterable: true },
  { name: 'line', chType: 'UInt32', kind: 'uint32', default: '0', codec: 'T64, ZSTD(3)', filterable: true },
  { name: 'snippet', chType: 'String', kind: 'string', default: "''", filterable: true },
  { name: 'resource_tags', chType: 'Map(String, String)', kind: 'map', default: 'map()', filterable: true },

  // Dynamic overflow
  { name: 'extra', chType: 'JSON', kind: 'json', default: "'{}'" },
];

// ---------------------------------------------------------------------------
// Derived column sets
// ---------------------------------------------------------------------------

/** Set of all known column names in the findings table */
export const KNOWN_COLUMNS = new Set(COLUMN_DEFS.map(c => c.name));

/** Set of columns that can appear in user-facing filters, sorts, and aggregations */
export const FILTERABLE_COLUMNS = new Set(COLUMN_DEFS.filter(c => c.filterable).map(c => c.name));

/** Set of columns with Array(String) type — require array marshalling */
export const ARRAY_COLUMNS = new Set(COLUMN_DEFS.filter(c => c.kind === 'array').map(c => c.name));

/** Set of columns with Map(String, String) type — require object marshalling */
export const MAP_COLUMNS = new Set(COLUMN_DEFS.filter(c => c.kind === 'map').map(c => c.name));

// ---------------------------------------------------------------------------
// Timestamp conversion
// ---------------------------------------------------------------------------

/**
 * Convert an ISO 8601 timestamp (or Date) to ClickHouse DateTime64(3) format.
 * ClickHouse JSONEachRow cannot parse trailing 'Z' or 'T' separators.
 * Converts e.g. '2026-03-17T19:22:05.000Z' → '2026-03-17 19:22:05.000'
 */
function toClickHouseDateTime(value: string | Date): string {
  const iso = typeof value === 'string' ? value : value.toISOString();
  return iso.replace('T', ' ').replace('Z', '');
}

// ---------------------------------------------------------------------------
// Row building
// ---------------------------------------------------------------------------

/** Metadata passed alongside a raw document when building a findings row */
export interface FindingRowMetadata {
  workflowId: string;
  workflowName: string;
  runId: string;
  nodeRef: string;
  componentId: string;
  assetKey: string | null;
  triggerSource?: string;
  triggerType?: string;
  /** Keys: repository, branch, commitSha, accountId, connectionName, provider */
  scanContext?: Record<string, string>;
}

/**
 * Build a ClickHouse findings row from a raw document and run metadata.
 *
 * Known columns are mapped to their typed fields; unknown keys are collected
 * into the `extra` JSON overflow column. The `shipsec` envelope key is
 * unwrapped and its sub-keys promoted if they match known columns.
 */
export function buildFindingRow(
  orgId: string,
  document: Record<string, any>,
  metadata: FindingRowMetadata,
): Record<string, any> {
  const extra: Record<string, any> = {};
  const row: Record<string, any> = {
    organization_id: orgId.toLowerCase(),
    finding_hash: document.finding_hash || '',
    timestamp: toClickHouseDateTime(document['@timestamp'] || new Date().toISOString()),
    workflow_id: metadata.workflowId,
    workflow_name: metadata.workflowName,
    run_id: metadata.runId,
    node_ref: metadata.nodeRef,
    component_id: metadata.componentId,
    asset_key: metadata.assetKey || '',
    trigger_source: metadata.triggerSource || '',
    trigger_type: metadata.triggerType || '',
  };

  // Map scan context keys to column names
  if (metadata.scanContext) {
    const SCAN_CONTEXT_MAP: Record<string, string> = {
      repository: 'repository',
      branch: 'branch',
      commitSha: 'commit_sha',
      accountId: 'account_id',
      connectionName: 'connection_name',
      provider: 'provider',
    };
    for (const [key, value] of Object.entries(metadata.scanContext)) {
      const colName = SCAN_CONTEXT_MAP[key];
      if (colName && value) row[colName] = value;
    }
  }

  // Copy document fields — known columns go to typed fields, rest to extra
  for (const [key, value] of Object.entries(document)) {
    if (key === '@timestamp' || key === 'finding_hash') continue;
    if (key === 'shipsec') {
      // Unwrap shipsec envelope and promote known sub-keys
      if (typeof value === 'object' && value !== null) {
        for (const [sk, sv] of Object.entries(value)) {
          if (KNOWN_COLUMNS.has(sk)) row[sk] = sv;
        }
      }
      continue;
    }
    if (KNOWN_COLUMNS.has(key)) {
      if (ARRAY_COLUMNS.has(key)) {
        row[key] = Array.isArray(value) ? value : [];
      } else if (MAP_COLUMNS.has(key)) {
        row[key] = typeof value === 'object' && value !== null ? value : {};
      } else if (key === 'line') {
        row[key] = typeof value === 'number' ? value : parseInt(value) || 0;
      } else {
        row[key] = typeof value === 'object' ? JSON.stringify(value) : value;
      }
    } else {
      extra[key] = value;
    }
  }

  row.extra = extra;
  return row;
}

// ---------------------------------------------------------------------------
// Asset key detection
// ---------------------------------------------------------------------------

const ASSET_KEY_FIELDS = ['asset_key', 'host', 'domain', 'subdomain', 'url', 'ip', 'asset', 'target'];

/**
 * Detect an asset key from a document, checking an explicit field first,
 * then falling back through a priority list of common asset identifier fields.
 */
export function detectAssetKey(document: Record<string, any>, explicitField?: string): string | null {
  if (explicitField && document[explicitField]) return String(document[explicitField]);
  for (const field of ASSET_KEY_FIELDS) {
    if (document[field]) return String(document[field]);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Severity ordering
// ---------------------------------------------------------------------------

/**
 * Generate a ClickHouse CASE expression that orders severity values
 * from critical → high → medium → low → info → unknown.
 */
export function severityOrderExpr(direction: 'asc' | 'desc'): string {
  return `CASE severity
    WHEN 'critical' THEN 1
    WHEN 'high' THEN 2
    WHEN 'medium' THEN 3
    WHEN 'low' THEN 4
    WHEN 'info' THEN 5
    ELSE 6 END ${direction}`;
}

