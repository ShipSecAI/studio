# Analytics Output Port Design

## Status: Approved
## Date: 2025-01-21

## Problem Statement

When connecting a component's `rawOutput` (which contains complex nested JSON) to the Analytics Sink, OpenSearch hits the default field limit of 1000 fields. This is because:

1. **Dynamic mapping explosion**: Elasticsearch/OpenSearch creates a field for every unique JSON path
2. **Nested structures**: Arrays with objects like `issues[0].metadata.schema` create many paths
3. **Varying schemas**: Different scanner outputs accumulate unique field paths over time

Example error:
```
illegal_argument_exception: Limit of total fields [1000] has been exceeded
```

## Solution

### Design Decisions

1. **Each component owns its analytics schema**
   - Components output structured `list<json>` through dedicated ports (`findings`, `results`, `secrets`, `issues`)
   - Component authors define the structure appropriate for their tool
   - No generic "one schema fits all" approach

2. **Analytics Sink accepts `list<json>`**
   - Input type: `z.array(z.record(z.string(), z.unknown()))`
   - Each item in the array is indexed as a separate document
   - Rejects arbitrary nested objects (must be an array)

3. **Same timestamp for all findings in a batch**
   - All findings from one component execution share the same `@timestamp`
   - Captured once at the start of indexing, applied to all documents

4. **Nested `shipsec` context**
   - Workflow context stored under `shipsec.*` namespace
   - Prevents field name collision with component data
   - Clear separation: component fields at root, system fields under `shipsec`

5. **Nested objects serialized before indexing**
   - Any nested object or array within a finding is JSON-stringified
   - Prevents field explosion from dynamic mapping
   - Trade-off: Can't query inside serialized fields directly, but prevents index corruption

6. **No `data` wrapper**
   - Original PRD design wrapped component output in a `data` field
   - New design: finding fields are at the top level for easier querying

### Document Structure

**Before (PRD design):**
```json
{
  "workflow_id": "...",
  "workflow_name": "...",
  "run_id": "...",
  "node_ref": "...",
  "component_id": "...",
  "@timestamp": "...",
  "asset_key": "...",
  "data": {
    "check_id": "DB_RLS_DISABLED",
    "severity": "CRITICAL",
    "metadata": { "schema": "public", "table": "users" }
  }
}
```

**After (new design):**
```json
{
  "check_id": "DB_RLS_DISABLED",
  "severity": "CRITICAL",
  "title": "RLS Disabled on Table: users",
  "resource": "public.users",
  "metadata": "{\"schema\":\"public\",\"table\":\"users\"}",
  "scanner": "supabase-scanner",
  "asset_key": "abcdefghij1234567890",
  "finding_hash": "a1b2c3d4e5f67890",

  "shipsec": {
    "organization_id": "org_123",
    "run_id": "shipsec-run-xxx",
    "workflow_id": "d1d33161-929f-4af4-9a64-xxx",
    "workflow_name": "Supabase Security Audit",
    "component_id": "core.analytics.sink",
    "node_ref": "analytics-sink-1"
  },

  "@timestamp": "2025-01-21T10:30:00.000Z"
}
```

### Component Output Ports

Components should use their existing structured list outputs:

| Component | Port | Type | Notes |
|-----------|------|------|-------|
| Nuclei | `results` | `z.array(z.record(z.string(), z.unknown()))` | Scanner + asset_key added |
| TruffleHog | `results` | `z.array(z.record(z.string(), z.unknown()))` | Scanner + asset_key added |
| Supabase Scanner | `results` | `z.array(z.record(z.string(), z.unknown()))` | Scanner + asset_key added |

All `results` ports include:
- `scanner`: Scanner identifier (e.g., `'nuclei'`, `'trufflehog'`, `'supabase-scanner'`)
- `asset_key`: Primary asset identifier from the finding
- `finding_hash`: Stable hash for deduplication (16-char hex from SHA-256)

### Finding Hash for Deduplication

The `finding_hash` enables tracking findings across workflow runs:

**Generation:**
```typescript
import { createHash } from 'crypto';

function generateFindingHash(...fields: (string | undefined | null)[]): string {
  const normalized = fields.map((f) => (f ?? '').toLowerCase().trim()).join('|');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}
```

**Key fields per scanner:**
| Scanner | Hash Fields |
|---------|-------------|
| Nuclei | `templateId + host + matchedAt` |
| TruffleHog | `DetectorType + Redacted + filePath` |
| Supabase Scanner | `check_id + projectRef + resource` |

**Use cases:**
- **New vs recurring**: Is this finding appearing for the first time?
- **First-seen / last-seen**: When did we first detect this? Is it still present?
- **Resolution tracking**: Findings that stop appearing may be resolved
- **Deduplication**: Remove duplicates in dashboards across runs

### `shipsec` Context Fields

The indexer automatically adds these fields under `shipsec`:

| Field | Description |
|-------|-------------|
| `organization_id` | Organization that owns the workflow |
| `run_id` | Unique identifier for this workflow execution |
| `workflow_id` | ID of the workflow definition |
| `workflow_name` | Human-readable workflow name |
| `component_id` | Component type (e.g., `core.analytics.sink`) |
| `node_ref` | Node reference in the workflow graph |
| `asset_key` | Auto-detected or specified asset identifier |

### Querying in OpenSearch

With this structure, users can:
- Filter by organization: `shipsec.organization_id: "org_123"`
- Filter by workflow: `shipsec.workflow_id: "xxx"`
- Filter by run: `shipsec.run_id: "xxx"`
- Filter by asset: `asset_key: "api.example.com"`
- Filter by scanner: `scanner: "nuclei"`
- Filter by component-specific fields: `severity: "CRITICAL"`
- Aggregate by severity: `terms` aggregation on `severity` field
- Track finding history: `finding_hash: "a1b2c3d4" | sort @timestamp`
- Find recurring findings: Group by `finding_hash`, count occurrences

### Trade-offs

| Decision | Pro | Con |
|----------|-----|-----|
| Serialize nested objects | Prevents field explosion | Can't query inside serialized fields |
| `shipsec` namespace | No field collision | Slightly more verbose queries |
| No generic schema | Better fit per component | Less consistency across components |
| Same timestamp per batch | Accurate (same scan time) | Can't distinguish individual finding times |

### Implementation Files

1. `/worker/src/utils/opensearch-indexer.ts` - Add `shipsec` context, serialize nested objects
2. `/worker/src/components/core/analytics-sink.ts` - Accept `list<json>`, consistent timestamp
3. Component files - Ensure structured output, add `results` port where missing

### Backward Compatibility

- Existing workflows connecting `rawOutput` to Analytics Sink will still work
- Analytics Sink continues to accept any data type for backward compatibility
- New `list<json>` processing only triggers when input is an array

### Future Considerations

1. **Index templates**: Create OpenSearch index template with explicit mappings for `shipsec.*` fields
2. **Field discovery**: Build UI to show available fields from indexed data
3. **Schema validation**: Optional strict mode to validate findings against expected schema
