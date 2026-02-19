# Asset Discovery Service

## Problem

When users connect their AWS account to ShipSec (for Prowler, for example), the platform only uses those credentials reactively — a user must manually build a workflow and specify exactly what to scan. There is no persistent view of what exists in their cloud environment.

This means:

- **No inventory** — users can't browse their ECR images, S3 buckets, or IAM roles inside ShipSec
- **No auto-scanning** — when a new container image is pushed to ECR, nothing happens until someone manually triggers a scan
- **No cross-referencing** — can't correlate findings with infrastructure ("show me all vulnerabilities in images running in production EKS clusters")
- **No posture overview** — no dashboard showing "you have 47 ECR repos, 12 have critical vulns, 3 are unscanned"

Every CSPM tool (Wiz, Prisma Cloud, Snyk) solves this with an asset inventory that continuously syncs from connected cloud accounts. ShipSec needs the same foundation.

---

## Design Goals

1. **Reusable inventory** — discovered assets are stored in PostgreSQL and available to dashboards, workflows, reports, and search
2. **Event-driven** — new/changed/removed assets emit events that can trigger workflows (e.g., new ECR image → Trivy scan)
3. **Pluggable providers** — easy to add new discovery providers (ECR today, S3/IAM/EKS tomorrow) without changing the core
4. **Leverage existing infra** — use Temporal for scheduling, Kafka for events, existing AWS integration for credentials
5. **Organization-scoped** — all assets isolated by `organizationId`, multi-tenant safe

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        INTEGRATION CONNECTIONS                       │
│   AWS (IAM Role)  │  GitHub (OAuth)  │  GCP (future)  │  ...        │
└────────┬──────────┴────────┬─────────┴───────┬────────┴─────────────┘
         │                   │                 │
         ▼                   ▼                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     ASSET DISCOVERY SERVICE                          │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │ ECR Provider │  │ S3 Provider  │  │ IAM Provider │  ...          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘               │
│         │                 │                 │                        │
│         └─────────┬───────┴─────────┬───────┘                       │
│                   ▼                 ▼                                │
│          ┌──────────────┐  ┌──────────────────┐                     │
│          │  Sync Engine │  │ Change Detector   │                    │
│          │  (Temporal)  │  │ (diff old vs new) │                    │
│          └──────┬───────┘  └────────┬──────────┘                    │
│                 │                   │                                │
└─────────────────┼───────────────────┼────────────────────────────────┘
                  │                   │
                  ▼                   ▼
┌──────────────────────┐   ┌──────────────────────────┐
│   ASSET INVENTORY    │   │     CHANGE EVENTS        │
│   (PostgreSQL)       │   │     (Kafka)              │
│                      │   │                          │
│  assets              │   │  asset.created           │
│  asset_scan_status   │   │  asset.updated           │
│                      │   │  asset.removed           │
└──────────┬───────────┘   └────────────┬─────────────┘
           │                            │
           ▼                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          CONSUMERS                                    │
│                                                                       │
│  Dashboard        Workflow Triggers     Reports       API/Search      │
│  (browse assets)  (new image → scan)   (posture)    (query assets)   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### `assets` table

The core inventory table. One row per discovered cloud resource.

| Column              | Type                                  | Description                                                  |
| ------------------- | ------------------------------------- | ------------------------------------------------------------ |
| `id`                | UUID PK                               | Internal asset ID                                            |
| `organizationId`    | VARCHAR(255) NOT NULL                 | Tenant isolation                                             |
| `integrationId`     | UUID NOT NULL FK                      | Which connection discovered this asset                       |
| `provider`          | VARCHAR(64) NOT NULL                  | `aws`, `github`, `gcp`                                       |
| `assetType`         | VARCHAR(64) NOT NULL                  | `ecr_repository`, `ecr_image`, `s3_bucket`, `iam_role`, etc. |
| `externalId`        | TEXT NOT NULL                         | Provider-native identifier (ARN, URI, etc.)                  |
| `name`              | TEXT                                  | Human-readable name (repo name, bucket name, etc.)           |
| `region`            | VARCHAR(64)                           | Cloud region if applicable                                   |
| `metadata`          | JSONB NOT NULL DEFAULT '{}'           | Provider-specific data (tags, size, creation date, etc.)     |
| `firstDiscoveredAt` | TIMESTAMP NOT NULL                    | When ShipSec first saw this asset                            |
| `lastSeenAt`        | TIMESTAMP NOT NULL                    | Last sync that confirmed this asset exists                   |
| `status`            | VARCHAR(16) NOT NULL DEFAULT 'active' | `active`, `stale`, `removed`                                 |
| `createdAt`         | TIMESTAMP NOT NULL DEFAULT NOW()      |                                                              |
| `updatedAt`         | TIMESTAMP NOT NULL DEFAULT NOW()      |                                                              |

**Indexes:**

- `UNIQUE (organizationId, provider, assetType, externalId)` — deduplicate across syncs
- `(organizationId, assetType)` — filter by type
- `(organizationId, integrationId)` — filter by connection
- `(status, lastSeenAt)` — find stale assets

**Composite unique constraint** on `(organizationId, provider, assetType, externalId)` ensures each real-world resource maps to exactly one row, regardless of how many times we sync.

### `asset_scan_status` table

Tracks the last scan result for each asset. Separate from `assets` so discovery and scanning concerns stay decoupled.

| Column          | Type                                     | Description                                  |
| --------------- | ---------------------------------------- | -------------------------------------------- |
| `id`            | UUID PK                                  |                                              |
| `assetId`       | UUID NOT NULL FK → assets                |                                              |
| `scanType`      | VARCHAR(64) NOT NULL                     | `trivy_image`, `prowler`, etc.               |
| `lastScannedAt` | TIMESTAMP                                | When the last scan completed                 |
| `lastRunId`     | VARCHAR(255)                             | Workflow run ID of the last scan             |
| `findingCount`  | INTEGER                                  | Total findings from last scan                |
| `criticalCount` | INTEGER                                  | Critical severity count                      |
| `highCount`     | INTEGER                                  | High severity count                          |
| `status`        | VARCHAR(16) NOT NULL DEFAULT 'unscanned' | `unscanned`, `scanning`, `scanned`, `failed` |

**Index:** `UNIQUE (assetId, scanType)`

### Example: ECR Image Asset

```json
{
  "id": "a1b2c3d4-...",
  "organizationId": "org_abc",
  "integrationId": "int_xyz",
  "provider": "aws",
  "assetType": "ecr_image",
  "externalId": "arn:aws:ecr:us-east-1:123456789012:repository/my-app:sha256-abc123",
  "name": "my-app:v2.1.0",
  "region": "us-east-1",
  "metadata": {
    "repositoryName": "my-app",
    "repositoryUri": "123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app",
    "imageTag": "v2.1.0",
    "imageDigest": "sha256:abc123...",
    "imagePushedAt": "2026-02-15T10:30:00Z",
    "imageSizeInBytes": 45678912,
    "accountId": "123456789012"
  },
  "firstDiscoveredAt": "2026-02-15T11:00:00Z",
  "lastSeenAt": "2026-02-16T11:00:00Z",
  "status": "active"
}
```

---

## Discovery Providers

Each provider is a TypeScript class that knows how to list resources from a specific cloud service using existing integration credentials.

### Provider Interface

```typescript
interface DiscoveryProvider {
  /** Provider identifier (e.g., 'aws') */
  provider: string;

  /** Asset types this provider discovers */
  assetTypes: string[];

  /** Discover all assets for a given integration connection */
  discover(context: DiscoveryContext): AsyncIterable<DiscoveredAsset>;
}

interface DiscoveryContext {
  integrationId: string;
  organizationId: string;
  credentials: ResolvedCredentials; // From IntegrationsService
  logger: Logger;
}

interface DiscoveredAsset {
  assetType: string;
  externalId: string;
  name: string;
  region?: string;
  metadata: Record<string, unknown>;
}
```

### ECR Provider (first implementation)

```typescript
class EcrDiscoveryProvider implements DiscoveryProvider {
  provider = 'aws';
  assetTypes = ['ecr_repository', 'ecr_image'];

  async *discover(ctx: DiscoveryContext): AsyncIterable<DiscoveredAsset> {
    const ecr = new ECRClient({
      region: ctx.credentials.region,
      credentials: {
        accessKeyId: ctx.credentials.data.accessKeyId,
        secretAccessKey: ctx.credentials.data.secretAccessKey,
        sessionToken: ctx.credentials.data.sessionToken,
      },
    });

    // 1. List all repositories
    for await (const page of paginateDescribeRepositories(ecr, {})) {
      for (const repo of page.repositories ?? []) {
        yield {
          assetType: 'ecr_repository',
          externalId: repo.repositoryArn!,
          name: repo.repositoryName!,
          region: ctx.credentials.region,
          metadata: {
            repositoryUri: repo.repositoryUri,
            createdAt: repo.createdAt?.toISOString(),
            imageScanningEnabled: repo.imageScanningConfiguration?.scanOnPush,
            encryptionType: repo.encryptionConfiguration?.encryptionType,
          },
        };

        // 2. List images in each repository
        for await (const imgPage of paginateListImages(ecr, {
          repositoryName: repo.repositoryName,
        })) {
          for (const imageId of imgPage.imageIds ?? []) {
            yield {
              assetType: 'ecr_image',
              externalId: `${repo.repositoryArn}:${imageId.imageDigest}`,
              name: `${repo.repositoryName}:${imageId.imageTag ?? imageId.imageDigest?.slice(0, 12)}`,
              region: ctx.credentials.region,
              metadata: {
                repositoryName: repo.repositoryName,
                repositoryUri: repo.repositoryUri,
                imageTag: imageId.imageTag,
                imageDigest: imageId.imageDigest,
                accountId: repo.registryId,
              },
            };
          }
        }
      }
    }
  }
}
```

**AWS permissions used** (already granted by `ViewOnlyAccess` + `SecurityAudit`):

- `ecr:DescribeRepositories`
- `ecr:ListImages`
- `ecr:DescribeImages` (optional, for size/push date)
- `ecr:GetAuthorizationToken` (for image pulls during scanning)

No IAM changes needed for existing AWS connections.

### Future Providers

| Provider   | Asset Types                          | AWS Permissions Needed                      | Status             |
| ---------- | ------------------------------------ | ------------------------------------------- | ------------------ |
| **ECR**    | `ecr_repository`, `ecr_image`        | `ecr:Describe*`, `ecr:List*`                | **First**          |
| **S3**     | `s3_bucket`                          | `s3:ListAllMyBuckets`, `s3:GetBucketPolicy` | Future             |
| **IAM**    | `iam_user`, `iam_role`, `iam_policy` | `iam:List*`, `iam:Get*`                     | Future             |
| **EKS**    | `eks_cluster`, `eks_nodegroup`       | `eks:List*`, `eks:Describe*`                | Future             |
| **Lambda** | `lambda_function`                    | `lambda:List*`, `lambda:Get*`               | Future             |
| **RDS**    | `rds_instance`, `rds_cluster`        | `rds:Describe*`                             | Future             |
| **GitHub** | `ghcr_image`                         | OAuth `read:packages` scope                 | Future (scope gap) |

All AWS providers reuse the same integration credentials. Adding a provider is: implement `DiscoveryProvider`, register it, done.

---

## Sync Engine

Discovery runs as **Temporal workflows**, reusing the existing infrastructure.

### Sync Workflow

```
assetDiscoverySyncWorkflow
  ├── Input: { integrationId, organizationId, providerFilter?: string[] }
  │
  ├── Activity: resolveCredentials(integrationId)
  │   └── Returns temporary AWS creds (same as Prowler/Trivy use)
  │
  ├── Activity: runDiscovery(credentials, providerFilter)
  │   └── Iterates all registered providers for this integration type
  │   └── Collects DiscoveredAsset[] (batched, not held in memory)
  │
  ├── Activity: reconcileAssets(organizationId, integrationId, discoveredAssets)
  │   ├── UPSERT into assets table (update lastSeenAt for existing, insert new)
  │   ├── Mark assets not seen in this sync as stale (if lastSeenAt < syncStartTime)
  │   ├── Detect changes:
  │   │   ├── NEW: asset didn't exist before
  │   │   ├── UPDATED: metadata changed
  │   │   └── REMOVED: was active, now stale for > staleness threshold
  │   └── Return { created: Asset[], updated: Asset[], stale: Asset[] }
  │
  └── Activity: emitChangeEvents(changes)
      └── Publish to Kafka: asset.created, asset.updated, asset.removed
```

### Scheduling

Each integration connection gets a Temporal schedule for periodic sync:

| Event                    | Sync Behavior                                          |
| ------------------------ | ------------------------------------------------------ |
| **Connection created**   | Create Temporal schedule (default: every 6 hours)      |
| **Connection deleted**   | Delete Temporal schedule, mark all assets as removed   |
| **Manual trigger**       | User clicks "Sync Now" → triggers schedule immediately |
| **Connection validated** | Optionally trigger a sync                              |

The schedule is created when a user first connects their AWS account (or manually enables discovery on an existing connection). Uses the same `TemporalService.createSchedule()` pattern as workflow schedules.

**Schedule config:**

```typescript
{
  scheduleId: `asset-sync-${integrationId}`,
  cronExpression: '0 */6 * * *',  // Every 6 hours
  timezone: 'UTC',
  overlapPolicy: 'skip',  // Don't overlap syncs
  action: {
    type: 'startWorkflow',
    workflowType: 'assetDiscoverySyncWorkflow',
    args: [{ integrationId, organizationId }],
  },
}
```

### Staleness

- Assets not seen in the last 2 syncs → `status: 'stale'`
- Assets stale for > 7 days → `status: 'removed'` (soft delete, keep for audit)
- Users can configure staleness thresholds per org

---

## Change Detection and Workflow Triggers

When the sync detects new or changed assets, it publishes events to Kafka. These events can trigger scan workflows.

### Event Schema

```typescript
// Topic: shipsec-asset-events-{instance}
interface AssetChangeEvent {
  eventType: 'asset.created' | 'asset.updated' | 'asset.removed';
  organizationId: string;
  asset: {
    id: string;
    assetType: string;
    externalId: string;
    name: string;
    provider: string;
    region?: string;
    metadata: Record<string, unknown>;
  };
  changes?: {
    // For asset.updated
    fields: string[]; // Which metadata fields changed
  };
  timestamp: string;
}
```

### Connecting to Workflow Triggers

Two approaches (not mutually exclusive):

**A. Asset trigger rules (new concept)**

A lightweight config that says "when an asset of type X is created, trigger workflow Y":

```typescript
// Stored in a new `asset_trigger_rules` table
{
  id: 'rule_1',
  organizationId: 'org_abc',
  assetType: 'ecr_image',        // Match on asset type
  eventType: 'asset.created',     // Match on event
  workflowId: 'wf_trivy_scan',   // Workflow to trigger
  inputMapping: {                  // How to map asset data → workflow inputs
    imageRef: '{{asset.metadata.repositoryUri}}:{{asset.metadata.imageTag}}',
    awsRegion: '{{asset.region}}',
  },
  enabled: true,
}
```

When the backend event consumer sees an `asset.created` event for `ecr_image`, it checks trigger rules and starts the mapped workflow with the mapped inputs. This is essentially a specialized webhook — but driven by asset events instead of external HTTP calls.

**B. Reuse existing webhook infrastructure**

The sync workflow could call an internal webhook endpoint after detecting new assets, reusing the existing `webhookParsingWorkflow` infrastructure. Simpler to implement but less discoverable in the UI.

**Recommendation:** Start with approach B (internal webhook) for speed, plan approach A for better UX later.

---

## Existing Permissions Analysis

### AWS: What users already have

Users who connected AWS for Prowler attached `SecurityAudit` + `ViewOnlyAccess` policies. These already include:

| Service | Permissions Granted                                       | Sufficient for Discovery? |
| ------- | --------------------------------------------------------- | ------------------------- |
| ECR     | `ecr:Describe*`, `ecr:List*`, `ecr:GetAuthorizationToken` | Yes                       |
| S3      | `s3:GetBucket*`, `s3:ListAllMyBuckets`, `s3:ListBucket`   | Yes                       |
| IAM     | `iam:Get*`, `iam:List*`                                   | Yes                       |
| EKS     | `eks:Describe*`, `eks:List*`                              | Yes                       |
| Lambda  | `lambda:Get*`, `lambda:List*`                             | Yes                       |
| RDS     | `rds:Describe*`                                           | Yes                       |

**No IAM changes needed** for existing AWS connections. Discovery works out of the box.

### GitHub: Scope gap

Current OAuth scopes: `repo`, `read:user`

Missing for GHCR discovery: `read:packages`

**Migration path:**

1. Add `read:packages` to default scopes (`GITHUB_OAUTH_SCOPES` env var)
2. Existing users must re-authorize (GitHub requires re-consent for new scopes)
3. Could prompt in UI: "Re-authorize GitHub to enable container registry scanning"

---

## Backend Module Structure

```
backend/src/assets/
  ├── assets.module.ts              # NestJS module
  ├── assets.controller.ts          # REST API for browsing/searching assets
  ├── assets.service.ts             # Core asset CRUD + sync orchestration
  ├── assets.repository.ts          # Drizzle queries for assets table
  ├── asset-trigger-rules.service.ts # Trigger rule evaluation
  ├── discovery/
  │   ├── discovery-engine.ts       # Coordinates providers, runs sync
  │   ├── discovery-provider.ts     # Provider interface
  │   └── providers/
  │       ├── ecr.provider.ts       # ECR discovery (first)
  │       ├── s3.provider.ts        # S3 discovery (future)
  │       └── iam.provider.ts       # IAM discovery (future)
  └── __tests__/
      ├── assets.service.spec.ts
      └── ecr.provider.spec.ts
```

### API Endpoints

| Method | Endpoint                             | Description                                                |
| ------ | ------------------------------------ | ---------------------------------------------------------- |
| GET    | `/assets`                            | List assets (filterable by type, provider, region, status) |
| GET    | `/assets/:id`                        | Get asset detail + scan status                             |
| GET    | `/assets/summary`                    | Posture summary (counts by type, scan status, severity)    |
| POST   | `/assets/sync`                       | Trigger manual sync for an integration                     |
| GET    | `/assets/sync/:integrationId/status` | Check sync status                                          |

---

## Relationship to Scanning Workflows

Discovery and scanning are separate concerns that connect through events:

```
DISCOVERY (knows what exists)          SCANNING (knows if it's secure)
        │                                       │
        │  asset.created event                  │
        ├──────────────────────────────────────►│
        │                                       │
        │                         workflow runs scan
        │                                       │
        │  scan results update                  │
        │◄──────────────────────────────────────┤
        │                                       │
   asset_scan_status updated              findings stored
```

The asset inventory becomes the bridge between "what do I have?" and "is it secure?"

Example end-to-end flow:

1. User connects AWS account (already done for Prowler)
2. Asset discovery syncs → finds 47 ECR repos, 200+ images
3. New image pushed to ECR → next sync detects it → emits `asset.created`
4. Trigger rule fires → starts Trivy image scan workflow
5. Trivy scans → findings stored → `asset_scan_status` updated
6. Dashboard shows: "my-app:v2.1.0 — 3 critical, 7 high vulnerabilities"

---

## Out of Scope

- Frontend UI for asset browsing (separate design)
- Non-AWS providers in detail (follow the same pattern)
- Implementation timeline
- Cost estimation for cloud API calls
- Asset relationship graph (e.g., "this image runs in this EKS cluster") — future enhancement
