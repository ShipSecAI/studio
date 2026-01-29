# PRD: Workflow Analytics Dashboards

## Introduction

Add a Security Analytics platform to ShipSec Studio that enables users to index workflow output data into OpenSearch and visualize it through dashboards. This allows security teams to track findings, assets, and trends across all their workflows—transforming raw scan outputs into actionable intelligence.

**Key Insight:** This is not about workflow execution metrics (runs, durations, failures). This is about **security findings analytics**—indexing the actual output data from workflows (subdomains discovered, vulnerabilities found, secrets detected) and enabling trend analysis, correlation, and alerting.

### Example Use Cases

| Workflow Type | Output Data Indexed | Analytics Enabled |
|--------------|---------------------|-------------------|
| Attack Surface Management | Subdomains, DNS records, HTTP probe results | Asset inventory, new assets over time, tech stack distribution |
| Nuclei Vulnerability Scans | CVEs, severity, affected hosts | Vuln trends, severity breakdown, remediation progress |
| Secret Scanning | Repos, secret types, file paths | Secrets per repo, leak trends, secret type distribution |
| ESPM | Posture findings, misconfigurations | Posture score over time, findings by category |

---

## Goals

- Enable users to index workflow output data from any node into OpenSearch
- Provide per-organization data isolation in a multi-tenant SaaS environment
- Allow users to create custom dashboards, queries, and alerts on their security data
- Support multi-stage pipeline data capture (e.g., index DNSX output AND HTTPx output from same workflow)
- Expose an API for programmatic access to analytics data
- Deliver a seamless authentication experience via Clerk OIDC SSO

---

## User Stories

### Phase 1: Core Infrastructure & MVP

#### US-001: Analytics Sink Component
**Description:** As a workflow builder, I want to add an Analytics Sink node to my workflow so that I can index output data from any upstream node into OpenSearch.

**Acceptance Criteria:**
- [ ] New "Analytics Sink" component available in workflow editor component palette
- [ ] Component accepts connection from any upstream node
- [ ] Component configuration includes:
  - [ ] Optional custom index suffix (default: workflow slug)
  - [ ] Asset key field hint (optional override for auto-detection)
- [ ] Component auto-detects correlation key from common fields: `host`, `domain`, `subdomain`, `url`, `ip`, `asset`, `target`
- [ ] Data indexed with standard metadata: `workflow_id`, `workflow_name`, `run_id`, `node_ref`, `component_id`, `@timestamp`
- [ ] Array outputs are indexed as individual documents (one per item)
- [ ] Typecheck passes
- [ ] Component works in workflow execution

#### US-002: Index-per-Org-per-Day Strategy
**Description:** As a platform operator, I want each organization's data stored in separate daily indices so that data is isolated without requiring document-level security.

**Acceptance Criteria:**
- [ ] Index naming convention: `security-findings-{org_id}-{YYYY.MM.DD}`
- [ ] Index template created with standard mappings for metadata fields
- [ ] Each org's role restricted to index pattern: `security-findings-{org_id}-*`
- [ ] No `organization_id` field needed in documents (org is in index name)
- [ ] ILM policy configured for index lifecycle (hot → warm → cold → delete)
- [ ] Typecheck passes

#### US-003: OpenSearch Cluster Setup
**Description:** As a platform operator, I want OpenSearch deployed and configured so that it can receive and store analytics data.

**Acceptance Criteria:**
- [ ] OpenSearch cluster deployed (Docker Compose for dev, managed service for prod)
- [ ] Security plugin enabled with authentication required
- [ ] Index templates created for `security-findings-*` pattern
- [ ] ILM policies configured with default retention (90 days, tier-configurable)
- [ ] Cluster accessible from Studio backend
- [ ] Health check endpoint verified

#### US-004: Clerk OIDC Integration
**Description:** As a user, I want to access OpenSearch Dashboards with my existing Studio login so that I don't need separate credentials.

**Acceptance Criteria:**
- [ ] Clerk configured as OIDC provider for OpenSearch
- [ ] OpenSearch Security plugin configured to accept Clerk OIDC tokens
- [ ] User's `org_id` extracted from token claims
- [ ] `org_id` mapped to OpenSearch tenant and role
- [ ] User automatically lands in their org's tenant space on login
- [ ] SSO flow tested end-to-end

#### US-005: OpenSearch Dashboards Deployment
**Description:** As a platform operator, I want OpenSearch Dashboards deployed on a subdomain so that users can access analytics.

**Acceptance Criteria:**
- [ ] OpenSearch Dashboards deployed at `analytics.shipsec.ai` (or configured subdomain)
- [ ] HTTPS enabled with valid certificate
- [ ] OIDC authentication configured (redirects to Clerk)
- [ ] Multi-tenancy enabled (each org gets isolated tenant space)
- [ ] Default index pattern `security-findings-{org_id}-*` pre-created per tenant
- [ ] Basic branding applied (logo, colors where possible)

#### US-006: Studio Sidebar Integration
**Description:** As a user, I want to access analytics from the Studio sidebar so that I can easily navigate to my dashboards.

**Acceptance Criteria:**
- [ ] "Dashboards" item added to Studio sidebar navigation
- [ ] Clicking opens OpenSearch Dashboards in new tab
- [ ] URL includes org context for proper tenant routing
- [ ] Icon consistent with Studio design system
- [ ] Typecheck passes
- [ ] Verify in browser

#### US-007: Analytics API Endpoint
**Description:** As a developer, I want to query my analytics data via API so that I can integrate with external tools or build custom visualizations.

**Acceptance Criteria:**
- [ ] `POST /api/analytics/query` endpoint created
- [ ] Accepts OpenSearch query DSL in request body
- [ ] Automatically scopes queries to user's org index pattern
- [ ] Returns OpenSearch response (hits, aggregations)
- [ ] Authentication required (Clerk session or API key)
- [ ] Rate limiting applied
- [ ] API documented in OpenAPI spec
- [ ] Typecheck passes

#### US-008: Basic Alerting
**Description:** As a security engineer, I want to create alerts on my analytics data so that I'm notified when important conditions are met.

**Acceptance Criteria:**
- [ ] OpenSearch Alerting plugin enabled
- [ ] Users can create monitors in their tenant
- [ ] Alert conditions can query their org's index pattern
- [ ] Notification channels supported: Email, Webhook
- [ ] Alerts scoped to user's org (cannot alert on other orgs' data)
- [ ] Sample alert documented: "Alert when >10 critical findings in 24h"

#### US-009: Data Retention Configuration
**Description:** As an org admin, I want to configure how long my analytics data is retained so that I can balance storage costs with data availability.

**Acceptance Criteria:**
- [ ] Default retention based on subscription tier (Free: 30 days, Pro: 90 days, Enterprise: 1 year)
- [ ] Org admin can configure retention within tier limits via Studio settings
- [ ] ILM policy updated when retention changed
- [ ] Old indices deleted automatically per policy
- [ ] Storage usage visible in Studio settings
- [ ] Typecheck passes

#### US-010: Error Handling for Analytics Sink
**Description:** As a workflow builder, I want to know if analytics indexing fails so that I can troubleshoot issues.

**Acceptance Criteria:**
- [ ] Indexing errors logged to workflow trace
- [ ] Indexing failure does NOT fail the workflow (fire-and-forget by default)
- [ ] Optional "fail on index error" configuration per sink
- [ ] Retry with exponential backoff (3 attempts)
- [ ] Error details visible in execution inspector
- [ ] Typecheck passes

---

### Phase 2: Enhanced Integration

#### US-011: Native Summary Widgets in Studio
**Description:** As a user, I want to see key analytics metrics in Studio without leaving the app so that I get quick insights.

**Acceptance Criteria:**
- [ ] Analytics summary panel on Studio dashboard/home
- [ ] Shows: Total findings (7d), Total assets, Critical findings count
- [ ] Data fetched via `/api/analytics/query`
- [ ] "View Full Dashboard" link to OpenSearch Dashboards
- [ ] Widgets refresh on page load
- [ ] Typecheck passes
- [ ] Verify in browser

#### US-012: Workflow-Level Analytics Link
**Description:** As a user, I want to view analytics for a specific workflow so that I can see trends for that workflow's outputs.

**Acceptance Criteria:**
- [ ] "View Analytics" button on workflow detail page
- [ ] Opens OpenSearch Dashboards with pre-filtered query: `workflow_id: "{id}"`
- [ ] User lands in Discover view with workflow filter applied
- [ ] Typecheck passes

#### US-013: Data Export
**Description:** As a user, I want to export my analytics data so that I can use it in external tools or reports.

**Acceptance Criteria:**
- [ ] Export button in OpenSearch Dashboards (native functionality)
- [ ] API endpoint: `GET /api/analytics/export?format=csv|json`
- [ ] Export scoped to user's org
- [ ] Large exports handled via async job + download link
- [ ] Typecheck passes

#### US-014: Org-Wide Dashboard Sharing
**Description:** As a team lead, I want to share dashboards with my org members so that we have consistent views.

**Acceptance Criteria:**
- [ ] Dashboards created in org tenant visible to all org members
- [ ] "Private" tenant space available for personal dashboards
- [ ] Org members can view shared dashboards
- [ ] Only dashboard creator or org admin can edit/delete
- [ ] Typecheck passes

---

### Phase 3: Native Dashboard Builder (Future)

#### US-015: Native Query Builder
**Description:** As a user, I want to build queries in Studio using a visual interface so that I don't need to learn OpenSearch query syntax.

**Acceptance Criteria:**
- [ ] Visual query builder component in Studio
- [ ] Field picker shows available fields from indexed data
- [ ] Filter builder: field, operator, value
- [ ] Aggregation builder: group by, metrics (count, sum, avg, etc.)
- [ ] Time range selector
- [ ] Preview results in table
- [ ] Generates OpenSearch query DSL
- [ ] Typecheck passes
- [ ] Verify in browser

#### US-016: Native Dashboard UI
**Description:** As a user, I want to create dashboards entirely within Studio so that I have a consistent experience.

**Acceptance Criteria:**
- [ ] Dashboard builder page in Studio
- [ ] Drag-and-drop widget placement
- [ ] Widget types: Metric card, Line chart, Bar chart, Pie chart, Table, Map
- [ ] Each widget configured with query + visualization settings
- [ ] Dashboard persistence (saved to database)
- [ ] Dashboard sharing within org
- [ ] Typecheck passes
- [ ] Verify in browser

#### US-017: Scheduled Reports
**Description:** As a team lead, I want to receive scheduled dashboard reports via email so that I stay informed without logging in.

**Acceptance Criteria:**
- [ ] Schedule configuration per dashboard (daily, weekly, monthly)
- [ ] Report generated as PDF or HTML
- [ ] Emailed to configured recipients
- [ ] Schedule management in Studio settings
- [ ] Typecheck passes

---

## Functional Requirements

### Analytics Sink Component

- **FR-1:** Analytics Sink component available in workflow editor palette under "Outputs" category
- **FR-2:** Component accepts input from any upstream node output
- **FR-3:** Component configuration:
  - `indexSuffix` (optional): Custom suffix for index name, default is workflow slug
  - `assetKeyField` (optional): Override auto-detected correlation key
  - `failOnError` (optional, default: false): Whether indexing failure should fail the workflow
- **FR-4:** Auto-detect asset key from fields: `host`, `domain`, `subdomain`, `url`, `ip`, `asset`, `target`, `hostname`, `fqdn`
- **FR-5:** If input is array, index each item as separate document
- **FR-6:** If input is object, index as single document
- **FR-7:** Standard metadata added to each document:
  ```json
  {
    "workflow_id": "uuid",
    "workflow_name": "ASM Scan",
    "run_id": "run-abc123",
    "node_ref": "analytics-sink-1",
    "component_id": "httpx",
    "@timestamp": "2024-01-20T10:30:00Z",
    "asset_key": "api.example.com",
    "data": { /* original output */ }
  }
  ```

### Indexing Strategy

- **FR-8:** Index naming: `security-findings-{org_id}-{YYYY.MM.DD}`
- **FR-9:** Index template for `security-findings-*`:
  ```json
  {
    "settings": {
      "number_of_shards": 1,
      "number_of_replicas": 1,
      "index.lifecycle.name": "security-findings-policy"
    },
    "mappings": {
      "properties": {
        "@timestamp": { "type": "date" },
        "workflow_id": { "type": "keyword" },
        "workflow_name": { "type": "keyword" },
        "run_id": { "type": "keyword" },
        "node_ref": { "type": "keyword" },
        "component_id": { "type": "keyword" },
        "asset_key": { "type": "keyword" },
        "data": { "type": "object", "dynamic": true }
      }
    }
  }
  ```
- **FR-10:** Dynamic mapping enabled for `data` field to handle varied schemas

### Multi-Tenancy

- **FR-11:** Each org role restricted to index pattern: `security-findings-{org_id}-*`
- **FR-12:** OpenSearch tenant space created per org on first login
- **FR-13:** Tenant name matches org_id from Clerk
- **FR-14:** Users cannot query, view, or access other orgs' indices or tenants

### Authentication

- **FR-15:** Clerk configured as OIDC provider with claims: `sub`, `org_id`, `email`
- **FR-16:** OpenSearch role mapping: `org_id` claim → tenant + index permissions
- **FR-17:** Session timeout matches Clerk session (or 8 hours default)

### API

- **FR-18:** `POST /api/analytics/query` accepts:
  ```json
  {
    "query": { /* OpenSearch query DSL */ },
    "size": 100,
    "from": 0,
    "aggs": { /* aggregations */ }
  }
  ```
- **FR-19:** API automatically injects index pattern filter for user's org
- **FR-20:** API returns raw OpenSearch response
- **FR-21:** Rate limit: 100 requests/minute per user

### Alerting

- **FR-22:** OpenSearch Alerting plugin enabled
- **FR-23:** Users can create monitors scoped to their index pattern
- **FR-24:** Supported notification channels: Email, Webhook, Slack (via webhook)
- **FR-25:** Alert history visible in OpenSearch Dashboards

### Data Retention

- **FR-26:** ILM policy `security-findings-policy`:
  - Hot: 7 days (fast storage)
  - Warm: 30 days (compressed)
  - Cold: Until retention limit (highly compressed)
  - Delete: After org's retention period
- **FR-27:** Retention limits by tier:
  - Free: 30 days max
  - Pro: 90 days max
  - Enterprise: 365 days max (custom available)
- **FR-28:** Retention configurable via Studio API (within tier limits)

---

## Non-Goals (Out of Scope)

- **No pre-built dashboard templates** — Users create their own based on their workflow outputs
- **No cross-org analytics** — Each org sees only their data (no platform-wide views for users)
- **No real-time streaming** — Data indexed after workflow node completes, not during
- **No custom index mappings per user** — All orgs use same index template
- **No direct OpenSearch cluster access** — Users interact via Dashboards or API only
- **No on-premise OpenSearch management** — Self-hosted users manage their own cluster
- **No data migration tools** — No import from external systems in Phase 1

---

## Technical Considerations

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ShipSec Studio                               │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Workflow Execution                                               ││
│  │  ┌──────────┐    ┌──────────┐    ┌──────────────────┐          ││
│  │  │  DNSX    │───►│  HTTPx   │───►│  Analytics Sink  │          ││
│  │  └──────────┘    └──────────┘    └────────┬─────────┘          ││
│  │                        │                   │                     ││
│  │                        ▼                   │                     ││
│  │               ┌──────────────────┐         │                     ││
│  │               │  Analytics Sink  │         │                     ││
│  │               └────────┬─────────┘         │                     ││
│  └────────────────────────┼───────────────────┼─────────────────────┘│
│                           │                   │                      │
│  ┌────────────────────────┴───────────────────┴─────────────────────┐│
│  │ Studio Backend (NestJS)                                          ││
│  │  ┌─────────────────┐    ┌─────────────────┐                     ││
│  │  │ Analytics       │    │ OpenSearch      │                     ││
│  │  │ Service         │───►│ Client          │                     ││
│  │  └─────────────────┘    └────────┬────────┘                     ││
│  └──────────────────────────────────┼───────────────────────────────┘│
└─────────────────────────────────────┼────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    OpenSearch Cluster                                │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Indices                                                          ││
│  │  security-findings-org-abc-2024.01.20                           ││
│  │  security-findings-org-abc-2024.01.19                           ││
│  │  security-findings-org-xyz-2024.01.20                           ││
│  └─────────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Security Plugin                                                  ││
│  │  - OIDC auth (Clerk)                                            ││
│  │  - Role: org-abc-analyst → index: security-findings-org-abc-*   ││
│  │  - Tenant: org-abc (isolated saved objects)                     ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│              OpenSearch Dashboards (analytics.shipsec.ai)            │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │ Org ABC Tenant  │  │ Org XYZ Tenant  │  │ Org 123 Tenant  │     │
│  │ - Dashboards    │  │ - Dashboards    │  │ - Dashboards    │     │
│  │ - Saved queries │  │ - Saved queries │  │ - Saved queries │     │
│  │ - Alerts        │  │ - Alerts        │  │ - Alerts        │     │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

### Dependencies

- **OpenSearch 2.x** — Search and analytics engine
- **OpenSearch Dashboards 2.x** — Visualization UI
- **OpenSearch Security Plugin** — Authentication, authorization, multi-tenancy
- **OpenSearch Alerting Plugin** — Monitor and alert functionality
- **Clerk** — OIDC provider for SSO
- **@opensearch-project/opensearch** — Node.js client for Studio backend

### Deployment Options

1. **Development:** Docker Compose with single-node OpenSearch
2. **Production (Managed):** AWS OpenSearch Service, Aiven, or similar
3. **Production (Self-hosted):** Kubernetes with OpenSearch Operator
4. **Bundled:** Include in Studio's docker-compose for all-in-one deployment

### Performance Considerations

- Bulk indexing for array outputs (batch documents per request)
- Index refresh interval: 5s (balance between real-time and performance)
- Single shard per daily index (sufficient for most orgs)
- Consider rollover to larger indices for high-volume orgs

### Security Considerations

- All data encrypted at rest (OpenSearch native encryption)
- All traffic over HTTPS
- OIDC tokens validated on every request
- No cluster admin access for users
- Audit logging enabled for compliance

---

## Design Considerations

### Analytics Sink Component UI

```
┌─────────────────────────────────────────┐
│ 📊 Analytics Sink                       │
├─────────────────────────────────────────┤
│                                         │
│ Index Suffix (optional)                 │
│ ┌─────────────────────────────────────┐ │
│ │ asm-findings                        │ │
│ └─────────────────────────────────────┘ │
│ Default: workflow slug                  │
│                                         │
│ Asset Key Field (optional)              │
│ ┌─────────────────────────────────────┐ │
│ │ Auto-detect                       ▼ │ │
│ └─────────────────────────────────────┘ │
│ Looks for: host, domain, url, ip...     │
│                                         │
│ ☐ Fail workflow if indexing fails       │
│                                         │
└─────────────────────────────────────────┘
```

### Sidebar Navigation

```
┌──────────────────┐
│ 🔧 Workflow...   │
│ 📅 Schedules     │
│ 🔑 Secrets       │
│ 🔐 API Keys      │
│ 📁 Artifact...   │
│ ────────────────│
│ 📊 Dashboards    │  ← New item
│    Opens new tab │
└──────────────────┘
```

---

## Success Metrics

- **Adoption:** 50% of active orgs use Analytics Sink within 3 months
- **Engagement:** Average org creates 3+ dashboards
- **Data Volume:** Platform indexes 1M+ documents/month across all orgs
- **Reliability:** 99.9% indexing success rate
- **Performance:** P95 query latency < 500ms
- **Retention:** Users with dashboards have 20% higher retention

---

## Open Questions

1. **Index naming for multiple sinks:** If a workflow has multiple Analytics Sinks, should they go to the same index or different indices? (Proposal: same index, differentiated by `node_ref` and `component_id`)

2. **Large document handling:** What's the max document size to index? (Proposal: 1MB limit, larger outputs should be sampled or summarized)

3. **Historical backfill:** Should users be able to re-index historical run outputs? (Proposal: Out of scope for Phase 1, consider for Phase 2)

4. **Schema discovery:** Should Studio discover and display available fields from indexed data? (Proposal: Yes, add in Phase 2 for query builder)

5. **Cost attribution:** For managed OpenSearch, how to attribute costs per org? (Proposal: Track document count and storage per org, display in billing)

---

## Implementation Phases

### Phase 1: MVP (Core Infrastructure)
**User Stories:** US-001 through US-010
**Deliverables:**
- Analytics Sink component
- OpenSearch cluster setup
- Index-per-org strategy
- Clerk OIDC integration
- OpenSearch Dashboards on subdomain
- Studio sidebar link
- Analytics API endpoint
- Basic alerting
- Retention configuration

### Phase 2: Enhanced Integration
**User Stories:** US-011 through US-014
**Deliverables:**
- Native summary widgets in Studio
- Workflow-level analytics link
- Data export API
- Org-wide dashboard sharing

### Phase 3: Native Dashboard Builder (Future)
**User Stories:** US-015 through US-017
**Deliverables:**
- Native query builder in Studio
- Native dashboard UI
- Scheduled reports
- OpenSearch becomes invisible backend

---

## Appendix: Document Schema Examples

### Subdomain Discovery Output
```json
{
  "@timestamp": "2024-01-20T10:30:00Z",
  "workflow_id": "asm-workflow-123",
  "workflow_name": "ASM Daily Scan",
  "run_id": "run-abc456",
  "node_ref": "subfinder-1",
  "component_id": "subfinder",
  "asset_key": "api.example.com",
  "data": {
    "subdomain": "api.example.com",
    "source": "crtsh"
  }
}
```

### DNSX Output
```json
{
  "@timestamp": "2024-01-20T10:31:00Z",
  "workflow_id": "asm-workflow-123",
  "workflow_name": "ASM Daily Scan",
  "run_id": "run-abc456",
  "node_ref": "dnsx-1",
  "component_id": "dnsx",
  "asset_key": "api.example.com",
  "data": {
    "host": "api.example.com",
    "a": ["1.2.3.4"],
    "aaaa": [],
    "cname": ["api.cdn.example.com"],
    "mx": [],
    "ns": [],
    "status_code": "NOERROR"
  }
}
```

### HTTPx Output
```json
{
  "@timestamp": "2024-01-20T10:32:00Z",
  "workflow_id": "asm-workflow-123",
  "workflow_name": "ASM Daily Scan",
  "run_id": "run-abc456",
  "node_ref": "httpx-1",
  "component_id": "httpx",
  "asset_key": "api.example.com",
  "data": {
    "url": "https://api.example.com",
    "status_code": 200,
    "title": "API Gateway",
    "webserver": "nginx",
    "content_length": 1234,
    "technologies": ["nginx", "cloudflare"],
    "response_time": "150ms"
  }
}
```

### Nuclei Finding
```json
{
  "@timestamp": "2024-01-20T11:00:00Z",
  "workflow_id": "vuln-scan-456",
  "workflow_name": "Weekly Vuln Scan",
  "run_id": "run-def789",
  "node_ref": "nuclei-1",
  "component_id": "nuclei",
  "asset_key": "api.example.com",
  "data": {
    "template_id": "CVE-2021-44228",
    "template_name": "Log4j RCE",
    "severity": "critical",
    "host": "api.example.com",
    "matched_at": "https://api.example.com/vulnerable",
    "extracted_results": ["JNDI lookup triggered"],
    "curl_command": "curl -X GET ..."
  }
}
```

### Secret Finding (TruffleHog/GitLeaks)
```json
{
  "@timestamp": "2024-01-20T12:00:00Z",
  "workflow_id": "secret-scan-789",
  "workflow_name": "Repo Secret Scan",
  "run_id": "run-ghi012",
  "node_ref": "trufflehog-1",
  "component_id": "trufflehog",
  "asset_key": "github.com/org/repo",
  "data": {
    "repository": "github.com/org/repo",
    "file": "src/config.js",
    "line": 42,
    "secret_type": "AWS Access Key",
    "detector": "AWS",
    "verified": true,
    "commit": "abc123",
    "author": "dev@example.com",
    "date": "2024-01-15"
  }
}
```
