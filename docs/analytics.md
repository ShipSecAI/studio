# Analytics Pipeline

This document describes the analytics infrastructure for ShipSec Studio, including OpenSearch for data storage, OpenSearch Dashboards for visualization, and the routing architecture.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Nginx (port 80)                              │
│                                                                      │
│  /analytics/*  ──────►  OpenSearch Dashboards (5601)                │
│  /api/*        ──────►  Backend API (3211)                          │
│  /*            ──────►  Frontend SPA (8080)                         │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Worker Service                               │
│                                                                      │
│  Analytics Sink Component  ──────►  OpenSearch (9200)               │
│  (OPENSEARCH_URL env var)                                           │
└─────────────────────────────────────────────────────────────────────┘
```

## Components

### OpenSearch (Port 9200)

Time-series database for storing security findings and workflow analytics.

**Configuration:**
- Single-node deployment (dev/simple prod)
- Security plugin disabled for development
- Index pattern: `security-findings-{org-id}-{date}`

### OpenSearch Dashboards (Port 5601)

Web UI for exploring and visualizing analytics data.

**Configuration (`opensearch-dashboards.yml`):**
```yaml
server.basePath: "/analytics"
server.rewriteBasePath: true
opensearch.hosts: ["http://opensearch:9200"]
```

**Key Settings:**
- `basePath: "/analytics"` - All URLs are prefixed with `/analytics`
- `rewriteBasePath: true` - Strips `/analytics` from incoming requests, adds it back to responses

### Analytics Sink (Worker Component)

The `core.analytics.sink` component writes workflow results to OpenSearch.

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
OPENSEARCH_URL=http://opensearch:9200
```

**Document Structure:**
```json
{
  "@timestamp": "2026-01-25T01:22:43.783Z",
  "title": "Finding title",
  "severity": "high",
  "description": "...",
  "shipsec": {
    "organization_id": "local-dev",
    "run_id": "shipsec-run-xxx",
    "workflow_id": "workflow-xxx",
    "workflow_name": "My Workflow",
    "component_id": "core.analytics.sink",
    "node_ref": "analytics-sink-123"
  }
}
```

## Nginx Routing

All traffic flows through Nginx on port 80:

| Path | Target | Description |
|------|--------|-------------|
| `/analytics/*` | `opensearch-dashboards:5601` | Analytics dashboard UI |
| `/api/*` | `backend:3211` | Backend REST API |
| `/*` | `frontend:8080` | Frontend SPA (catch-all) |

### OpenSearch Dashboards Routing Details

The `/analytics` route requires special handling:

1. **Authentication**: Routes are protected - users must be logged in to access
2. **Session Cookies**: Backend validates session cookies for analytics route auth
3. **BasePath Configuration**: OpenSearch Dashboards is configured with `server.basePath: "/analytics"`
4. **Proxy Pass**: Nginx forwards requests to OpenSearch Dashboards without path rewriting
5. **rewriteBasePath**: OpenSearch Dashboards strips `/analytics` internally and adds it back to URLs

```nginx
location /analytics/ {
    proxy_pass http://opensearch-dashboards;
    proxy_set_header osd-xsrf "true";
    proxy_cookie_path /analytics/ /analytics/;
}
```

## Frontend Integration

The frontend links to OpenSearch Dashboards Discover app with pre-filtered queries:

```typescript
const baseUrl = '/analytics';
// Use .keyword fields for exact match filtering
const filterQuery = `shipsec.run_id.keyword:"${runId}"`;

// Build Discover URL with proper state format
const gParam = encodeURIComponent('(time:(from:now-7d,to:now))');
const aParam = encodeURIComponent(
  `(columns:!(_source),index:'security-findings-*',interval:auto,query:(language:kuery,query:'${filterQuery}'),sort:!('@timestamp',desc))`
);
const url = `${baseUrl}/app/discover#/?_g=${gParam}&_a=${aParam}`;

// Open in new tab
window.open(url, '_blank', 'noopener,noreferrer');
```

**Key points:**
- Use `.keyword` fields (e.g., `shipsec.run_id.keyword`) for exact match filtering
- Use Discover app (`/app/discover`) for viewing raw data without saved views
- Include `index`, `columns`, `interval`, and `sort` in the `_a` param

**Environment Variable:**
```
VITE_OPENSEARCH_DASHBOARDS_URL=/analytics
```

## Data Flow

1. **Workflow Execution**: Worker runs workflow with Analytics Sink component
2. **Data Enrichment**: Analytics Sink adds `shipsec.*` metadata fields
3. **Indexing**: Documents bulk-indexed to OpenSearch via `OPENSEARCH_URL`
4. **Visualization**: Users explore data in OpenSearch Dashboards at `/analytics`

## Analytics API Limits

To protect OpenSearch and keep queries responsive:

- `size` must be a non-negative integer and is capped at **1000**
- `from` must be a non-negative integer and is capped at **10000**

Requests exceeding these limits return `400 Bad Request`.

## Analytics Settings Updates

The analytics settings update API supports **partial updates**:

- `analyticsRetentionDays` is optional
- `subscriptionTier` is optional

Omit fields you don’t want to change. The backend validates the retention days only when provided.

## Troubleshooting

### Analytics Sink Not Writing Data

**Symptom:** New workflow runs don't appear in OpenSearch

**Check:**
```bash
# Verify worker has OPENSEARCH_URL set
docker exec shipsec-worker env | grep OPENSEARCH

# Check worker logs for indexing errors
docker logs shipsec-worker 2>&1 | grep -i "analytics\|indexing"
```

**Solution:** Ensure `OPENSEARCH_URL=http://opensearch:9200` is set in worker environment.

### OpenSearch Dashboards Shows Blank Page

**Symptom:** Page loads but content area is empty

**Check:**
1. Browser console for JavaScript errors
2. Time range filter (data might be outside selected range)
3. Index pattern selection

**Solution:**
- Set time range to "Last 30 days" or wider
- Ensure `security-findings-*` index pattern is selected

### Query Returns No Results

**Check if data exists:**
```bash
# Count documents
curl -s "http://localhost:9200/security-findings-*/_count" | jq '.count'

# List run_ids with data
curl -s "http://localhost:9200/security-findings-*/_search" \
  -H "Content-Type: application/json" \
  -d '{"size":0,"aggs":{"run_ids":{"terms":{"field":"shipsec.run_id.keyword"}}}}' \
  | jq '.aggregations.run_ids.buckets'
```

## Environment Variables

| Variable | Service | Description |
|----------|---------|-------------|
| `OPENSEARCH_URL` | Worker | OpenSearch connection URL |
| `OPENSEARCH_USERNAME` | Worker | Optional: OpenSearch username |
| `OPENSEARCH_PASSWORD` | Worker | Optional: OpenSearch password |
| `VITE_OPENSEARCH_DASHBOARDS_URL` | Frontend | Dashboard URL for links |

## See Also

- [Docker README](../docker/README.md) - Docker deployment configurations
- [nginx.full.conf](../docker/nginx/nginx.full.conf) - Full stack nginx routing
- [opensearch-dashboards.yml](../docker/opensearch-dashboards.yml) - Dashboard configuration
