# Analytics Pipeline

This document describes the analytics infrastructure for ShipSec Studio, including ClickHouse for data storage and the API-driven query architecture.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Nginx (port 80)                              │
│                                                                      │
│  /api/*        ──────►  Backend API (3211)                          │
│  /*            ──────►  Frontend SPA (8080)                         │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Worker Service                               │
│                                                                      │
│  Analytics Sink Component  ──────►  ClickHouse (8123)               │
│  (CLICKHOUSE_URL env var)                                           │
└─────────────────────────────────────────────────────────────────────┘
```

## Components

### ClickHouse (Port 8123)

Columnar analytics database for storing security findings and workflow analytics.

**Tables:**

- `security_findings` — Event log table (MergeTree), partitioned by `toYYYYMM(timestamp)`
- `security_findings_latest` — Deduplicated latest state (ReplacingMergeTree), partitioned by `organization_id`

A materialized view automatically populates `security_findings_latest` from the event log, keeping the latest version of each finding by `finding_hash`.

### Analytics Sink (Worker Component)

The `core.analytics.sink` component writes workflow results directly to ClickHouse via the ClickHouse HTTP client.

**Input Ports:**

- Ships with a default `input1` port so at least one connector is always available.
- Users can configure additional input ports via the **Data Inputs** parameter
  (e.g., to aggregate results from multiple scanners into one index).
- Extra ports are resolved dynamically through the `resolvePorts` mechanism. When
  loading a saved workflow the backend calls `resolveGraphPorts()` server-side;
  when importing from a JSON file the frontend calls `resolvePorts` per-node to
  ensure all dynamic handles are present before rendering.

**Environment Variable:**

```yaml
CLICKHOUSE_URL=http://clickhouse:8123
```

**Document Structure:**

```json
{
  "timestamp": "2026-01-25T01:22:43.783Z",
  "title": "Finding title",
  "severity": "high",
  "description": "...",
  "organization_id": "local-dev",
  "run_id": "shipsec-run-xxx",
  "workflow_id": "workflow-xxx",
  "workflow_name": "My Workflow",
  "component_id": "core.analytics.sink",
  "node_ref": "analytics-sink-123",
  "finding_hash": "a1b2c3d4e5f67890"
}
```

## Frontend Integration

The frontend links to the analytics API with pre-filtered queries. Dashboard data comes from API queries against the ClickHouse backend — there is no separate dashboard UI.

```typescript
// Query findings for a specific run
const response = await fetch('/api/v1/analytics/query', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    organizationId: orgId,
    filters: { run_id: runId },
    size: 100,
  }),
});
```

## Data Flow

1. **Workflow Execution**: Worker runs workflow with Analytics Sink component
2. **Data Enrichment**: Analytics Sink adds workflow context metadata fields
3. **Indexing**: Documents written directly to ClickHouse via `CLICKHOUSE_URL`
4. **Querying**: Frontend queries indexed data via the `/api/v1/analytics/query` endpoint

## Analytics API Limits

To protect ClickHouse and keep queries responsive:

- `size` must be a non-negative integer and is capped at **1000**
- `from` must be a non-negative integer and is capped at **10000**

Requests exceeding these limits return `400 Bad Request`.

## Analytics Settings Updates

The analytics settings update API supports **partial updates**:

- `analyticsRetentionDays` is optional
- `subscriptionTier` is optional

Omit fields you don't want to change. The backend validates the retention days only when provided.

## Multi-Tenant Architecture

Each organization's data is isolated by `organization_id`. The ClickHouse schema enforces tenant isolation at the query layer — all analytics API calls automatically scope queries to the authenticated organization.

### Security Guarantees

- The JWT is cryptographically signed by Clerk — `org_id` cannot be forged
- The backend validates `X-Organization-Id` headers against the JWT's `org_id` — cross-tenant header spoofing is rejected
- All queries are scoped to the resolved organization ID

## Troubleshooting

### Analytics Sink Not Writing Data

**Symptom:** New workflow runs don't appear in analytics

**Check:**

```bash
# Verify worker has CLICKHOUSE_URL set
docker exec shipsec-worker env | grep CLICKHOUSE

# Check worker logs for indexing errors
docker logs shipsec-worker 2>&1 | grep -i "analytics\|indexing"
```

**Solution:** Ensure `CLICKHOUSE_URL=http://clickhouse:8123` is set in worker environment.

### Query Returns No Results

**Check if data exists:**

```bash
# Count documents via ClickHouse HTTP interface
curl -s "http://localhost:8123/?query=SELECT+count()+FROM+security_findings"

# List run_ids with data
curl -s "http://localhost:8123/?query=SELECT+run_id,+count()+FROM+security_findings+GROUP+BY+run_id+LIMIT+10"
```

## Environment Variables

| Variable              | Service | Description                   |
| --------------------- | ------- | ----------------------------- |
| `CLICKHOUSE_URL`      | Worker  | ClickHouse connection URL     |
| `CLICKHOUSE_USER`     | Worker  | Optional: ClickHouse username |
| `CLICKHOUSE_PASSWORD` | Worker  | Optional: ClickHouse password |

## See Also

- The public repo documents the analytics model and application behavior, not a bundled deployment overlay.
