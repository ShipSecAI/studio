# Integrations

ShipSec Studio provides first-class integrations with cloud providers and communication platforms. Integrations allow workflows to securely resolve credentials at runtime without embedding secrets directly into workflow definitions.

## Overview

The integrations system consists of three layers:

1. **Backend** -- Manages connection lifecycle, encrypted token storage, and credential resolution via REST API.
2. **Frontend** -- Settings UI for connecting providers, managing connections, and viewing setup instructions.
3. **Worker Components** -- Workflow nodes that resolve credentials from connections at execution time.

---

## Supported Providers

### Amazon Web Services (AWS)

Connect AWS accounts for cloud security posture management (CSPM), compliance scanning, and resource discovery.

**Auth Method:** IAM Role with External ID (cross-account trust policy)

**Supported Scenarios:**

- Single AWS Account
- Cross-Account via STS AssumeRole
- AWS Organizations (multi-account discovery)

### Google Cloud Platform (GCP)

Connect GCP projects and organizations for cloud inventory indexing and security analysis.

**Auth Method:** Service Account Impersonation (no customer key upload to ShipSec)

**Supported Scenarios:**

- Single GCP Project
- Multiple projects under one org/folder hierarchy
- Organization-level inventory (when org permissions are granted)

### Slack

Send workflow notifications, security alerts, and scan results to Slack channels.

**Auth Methods:**

- **Incoming Webhook** -- Simple webhook URL for posting messages to a channel
- **OAuth App** -- Full Slack App integration with scopes: `channels:read`, `chat:write`, `chat:write.public`, `commands`, `im:write`, `team:read`

---

## Setting Up AWS

### Step 1: Navigate to Integrations

Open **Settings > Integrations** in the ShipSec Studio dashboard. Click the **AWS** card.

### Step 2: Create an IAM Role

The setup page displays a pre-generated **External ID** and an **IAM Trust Policy** JSON document. Use these to create an IAM role in your AWS account:

1. Go to the AWS IAM Console > **Roles** > **Create Role**.
2. Choose **Another AWS account** as the trusted entity.
3. Paste the trust policy JSON from the ShipSec setup page.
4. Attach your desired permissions policy (e.g., `ReadOnlyAccess`, `SecurityAudit`, or a custom policy).
5. Name the role (e.g., `ShipSecStudioRole`) and create it.
6. Copy the **Role ARN** (e.g., `arn:aws:iam::123456789012:role/ShipSecStudioRole`).

### Step 3: Add the Connection

Back in the ShipSec UI:

1. Paste the **Role ARN** into the connection form.
2. Optionally set a default **AWS Region** (defaults to `us-east-1`).
3. Click **Connect**.

ShipSec will validate the credentials by calling `sts:GetCallerIdentity`. If successful, the connection appears in your connections list.

### Step 4: Discover Organization Accounts (Optional)

If the IAM role has `organizations:ListAccounts` permission, click **Discover Accounts** on the connection detail page to list all member accounts in your AWS Organization.

### Using AWS Connections in Workflows

Wire the **Connection ID** (visible on the connection card) into a workflow's **Entry Point** runtime input, or configure it directly in the **Integration Credential Resolver** node parameter.

The resolver will call the backend's internal credentials endpoint, assume the IAM role via STS, and output temporary credentials for downstream components like **Prowler Scan** or **AWS Org Discovery**.

---

## Setting Up GCP (Customer Organization Admin)

This section is for external customer org admins (for example, Headout).

### Step 1: Create a target ingest service account

Create a dedicated service account in your GCP project (example name: `shipsec-cartography-ingest`).

```bash
gcloud iam service-accounts create shipsec-cartography-ingest \
  --project=<YOUR_PROJECT_ID> \
  --display-name="ShipSec Cartography Ingest"
```

Service account email format:

`shipsec-cartography-ingest@<YOUR_PROJECT_ID>.iam.gserviceaccount.com`

### Step 2: Grant read permissions on your project/org

At minimum, grant project-level read permissions used by discovery:

```bash
gcloud projects add-iam-policy-binding <YOUR_PROJECT_ID> \
  --member="serviceAccount:shipsec-cartography-ingest@<YOUR_PROJECT_ID>.iam.gserviceaccount.com" \
  --role="roles/serviceusage.serviceUsageViewer"
```

Add your standard read roles (custom or predefined) for resources you want indexed (Compute, Storage, GKE, IAM service accounts, Cloud SQL, Secret Manager, DNS, etc).

For broader/complete coverage, include permissions for:

- Artifact Registry reads (`artifactregistry.locations.list`, etc)
- BigQuery connection reads (`bigquery.connections.list`, etc)

If organization-level IAM role inventory is needed, grant org-level visibility/role viewing to the same target service account (for example `roles/resourcemanager.organizationViewer` / `roles/browser` and `roles/iam.organizationRoleViewer`).

### Step 3: Grant ShipSec principal impersonation on the target SA

ShipSec provides you a source principal (service account) email. Grant it:

- `roles/iam.serviceAccountTokenCreator` on your target ingest service account

```bash
gcloud iam service-accounts add-iam-policy-binding \
  shipsec-cartography-ingest@<YOUR_PROJECT_ID>.iam.gserviceaccount.com \
  --project=<YOUR_PROJECT_ID> \
  --member="serviceAccount:<SHIPSEC_SOURCE_PRINCIPAL_EMAIL>" \
  --role="roles/iam.serviceAccountTokenCreator"
```

### Step 4: Add the GCP connection in ShipSec

In **Settings → Integrations → GCP**:

1. Enter a display name
2. Enter the target service account email
3. (Optional) set default project ID / organization ID
4. Click **Connect**

ShipSec validates impersonation and discovers available GCP scope resources.

> **Security model:** Customers do **not** upload JSON keys to ShipSec for this flow. ShipSec uses service-account impersonation against the customer-owned target service account.

---

## Setting Up Slack

### Incoming Webhook

1. Go to [Slack Incoming Webhooks](https://api.slack.com/messaging/webhooks) and create a webhook URL for your channel.
2. In **Settings > Integrations > Slack**, select **Incoming Webhook** as the auth method.
3. Paste the webhook URL and click **Connect**.
4. Click **Test** to verify the connection sends a message to your channel.

### OAuth App

1. In **Settings > Integrations > Slack**, select **Slack App (OAuth)**.
2. You'll be redirected to Slack's authorization page.
3. Authorize the ShipSec app for your workspace.
4. The connection is created automatically on successful authorization.

> **Note:** OAuth requires the Slack provider to be configured by an admin (client ID and secret via `SLACK_OAUTH_CLIENT_ID` / `SLACK_OAUTH_CLIENT_SECRET` environment variables or the provider config API).

---

## API Reference

### Provider Catalog

| Method | Endpoint                | Description                                                                |
| ------ | ----------------------- | -------------------------------------------------------------------------- |
| GET    | `/integrations/catalog` | List all integration providers with their auth methods and setup scenarios |

### Connection Management

| Method | Endpoint                                | Description                                                            |
| ------ | --------------------------------------- | ---------------------------------------------------------------------- |
| GET    | `/integrations/connections`             | List connections for the authenticated user                            |
| GET    | `/integrations/org/connections`         | List organization-scoped connections (optional `?provider=aws` filter) |
| DELETE | `/integrations/connections/:id`         | Remove a connection                                                    |
| POST   | `/integrations/connections/:id/refresh` | Refresh connection tokens                                              |

### AWS Endpoints

| Method | Endpoint                                         | Description                                         |
| ------ | ------------------------------------------------ | --------------------------------------------------- |
| GET    | `/integrations/aws/setup-info`                   | Get External ID and IAM trust policy for role setup |
| POST   | `/integrations/aws/connections`                  | Create an AWS IAM role connection                   |
| POST   | `/integrations/aws/connections/:id/validate`     | Validate an AWS connection's credentials            |
| POST   | `/integrations/aws/connections/:id/discover-org` | Discover AWS Organization member accounts           |

### GCP Endpoints

| Method | Endpoint                                              | Description                                   |
| ------ | ----------------------------------------------------- | --------------------------------------------- |
| POST   | `/integrations/gcp/connections`                       | Create a GCP impersonation-based connection   |
| POST   | `/integrations/gcp/connections/:id/validate`          | Validate a GCP connection                     |
| POST   | `/integrations/gcp/connections/:id/discover-projects` | Discover projects/folders/org scope resources |

### Slack Endpoints

| Method | Endpoint                                   | Description                                  |
| ------ | ------------------------------------------ | -------------------------------------------- |
| POST   | `/integrations/slack/connections`          | Create a Slack webhook connection            |
| POST   | `/integrations/slack/connections/:id/test` | Send a test message via the Slack connection |

### OAuth Flow

| Method | Endpoint                           | Description                                         |
| ------ | ---------------------------------- | --------------------------------------------------- |
| POST   | `/integrations/:provider/start`    | Initiate OAuth session (returns `authorizationUrl`) |
| POST   | `/integrations/:provider/exchange` | Complete OAuth token exchange                       |

### Internal Endpoints (Worker-to-Backend)

These endpoints are called by worker components at runtime and are protected by the `X-Internal-Token` header:

| Method | Endpoint                                    | Description                                                         |
| ------ | ------------------------------------------- | ------------------------------------------------------------------- |
| POST   | `/integrations/connections/:id/token`       | Issue raw connection token                                          |
| POST   | `/integrations/connections/:id/credentials` | Resolve typed credentials (provider, type, data, accountId, region) |

---

## Workflow Components

Three new core components support integrations in workflows:

### Integration Credential Resolver

**Component ID:** `core.integration.resolve-credentials`

Resolves credentials from an integration connection at runtime. This is the bridge between the integrations system and workflow execution.

| Input          | Type | Description                                                           |
| -------------- | ---- | --------------------------------------------------------------------- |
| `connectionId` | Text | Integration connection ID (wire from Entry Point or set as parameter) |
| `regions`      | Text | Optional region override (comma-separated)                            |

| Output           | Type   | Description                                                 |
| ---------------- | ------ | ----------------------------------------------------------- |
| `credentialType` | String | Credential type (e.g., `iam_role`, `oauth`, `webhook`)      |
| `provider`       | String | Provider name (e.g., `aws`, `slack`)                        |
| `accountId`      | String | Provider account identifier (e.g., AWS 12-digit account ID) |
| `regions`        | String | Resolved regions (input override or connection default)     |
| `data`           | Object | Raw credential payload (varies by provider)                 |

### AWS Org Discovery

**Component ID:** `core.aws.org-discovery`

Lists all accounts in an AWS Organization using `organizations:ListAccounts`. Paginates automatically.

| Input         | Type            | Description                                    |
| ------------- | --------------- | ---------------------------------------------- |
| `credentials` | AWS Credentials | AWS credentials with Organizations permissions |

| Output           | Type   | Description                                   |
| ---------------- | ------ | --------------------------------------------- |
| `accounts`       | Array  | List of `{ id, name, status, email }` objects |
| `organizationId` | String | AWS Organization ID                           |

### AWS Assume Role

**Component ID:** `core.aws.assume-role`

Assumes an IAM role via STS and returns temporary credentials. Useful for cross-account access patterns.

| Input               | Type            | Description                         |
| ------------------- | --------------- | ----------------------------------- |
| `sourceCredentials` | AWS Credentials | Credentials to use when calling STS |

| Parameter     | Type   | Description                                   |
| ------------- | ------ | --------------------------------------------- |
| `roleArn`     | String | ARN of the IAM role to assume                 |
| `externalId`  | String | Optional external ID for the trust policy     |
| `sessionName` | String | STS session name (default: `shipsec-session`) |

| Output        | Type            | Description                                     |
| ------------- | --------------- | ----------------------------------------------- |
| `credentials` | AWS Credentials | Temporary assumed-role credentials (1 hour TTL) |

---

## Sample Workflows

Four pre-built workflow templates are available in `docs/sample/`:

### AWS CSPM -- Org Account Discovery

**File:** `docs/sample/aws-cspm-org-discovery.json`

```
Entry Point → Resolve Credentials → Org Discovery
                                  → Assume Role
```

Resolves AWS credentials from an integration connection, discovers all member accounts in the AWS Organization, and optionally assumes a cross-account role.

**Runtime Inputs:**

- `connectionId` (required) -- AWS integration connection ID
- `targetRoleArn` (optional) -- Cross-account role to assume
- `externalId` (optional) -- External ID for the trust policy

### AWS CSPM -- Prowler Scan to Analytics

**File:** `docs/sample/aws-cspm-prowler-to-analytics.json`

```
Entry Point → Resolve Credentials → Prowler Scan → Analytics Sink
```

End-to-end CSPM workflow: resolves AWS credentials, runs a Prowler security scan (severity high/critical), and indexes the results into the Analytics dashboard via ClickHouse.

**Runtime Inputs:**

- `connectionId` (required) -- AWS integration connection ID
- `regions` (optional) -- Comma-separated AWS regions (default: `us-east-1`)

### AWS CSPM -- Org-Wide Prowler Scan to Analytics

**File:** `docs/sample/aws-cspm-org-prowler-to-analytics.json`

```
Entry Point → Resolve Credentials → Prowler Scan (orgScan=true) → Analytics Sink
```

Resolves AWS credentials for the organization management account, discovers all member accounts via AWS Organizations, assumes a cross-account role in each, runs Prowler per-account, and indexes aggregated findings into the Analytics dashboard via ClickHouse. Failed accounts are recorded and scanning continues.

**Runtime Inputs:**

- `connectionId` (required) -- AWS integration connection ID for the management account
- `regions` (optional) -- Comma-separated AWS regions (default: `us-east-1`)

**Key Parameters:**

- `orgScan: true` -- Enables organization-wide scanning
- `memberRoleName` -- IAM role to assume in each member account (default: `OrganizationAccountAccessRole`)
- `continueOnError: true` -- Record errors per account and continue scanning

### AWS CSPM -- Prowler Scan to Slack Summary

**File:** `docs/sample/aws-cspm-prowler-slack-summary.json`

```
Entry Point → Resolve AWS Credentials → Prowler Scan ─┐
           └→ Resolve Slack Credentials ───────────────┴→ Slack Message
```

Resolves AWS credentials, runs a Prowler security scan (severity high/critical), resolves Slack credentials from an integration connection (OAuth or webhook), and sends a formatted summary of findings to a Slack channel.

**Runtime Inputs:**

- `connectionId` (required) -- AWS integration connection ID
- `regions` (optional) -- Comma-separated AWS regions (default: `us-east-1`)
- `slackConnectionId` (required) -- Slack integration connection ID (OAuth or webhook)
- `slackChannel` (optional) -- Slack channel to post to (required for OAuth, ignored for webhook; default: `#general`)

### Importing Sample Workflows

**Via the UI:** Go to **Workflows** > **Import** and upload the JSON file.

**Via the API:**

```bash
curl -X POST http://localhost:3211/api/v1/workflows \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n admin:admin | base64)" \
  -d @docs/sample/aws-cspm-prowler-to-analytics.json
```

**Via the seed script:**

```bash
cd backend
bun run seed:aws-workflow
```

---

## Environment Variables

| Variable                        | Description                                   | Required         |
| ------------------------------- | --------------------------------------------- | ---------------- |
| `INTEGRATION_STORE_MASTER_KEY`  | 32-character encryption key for token storage | Yes (production) |
| `SHIPSEC_PLATFORM_ROLE_ARN`     | Platform IAM role ARN for AWS STS operations  | Yes (AWS)        |
| `SHIPSEC_AWS_ACCESS_KEY_ID`     | Platform AWS access key for STS calls         | Yes (AWS)        |
| `SHIPSEC_AWS_SECRET_ACCESS_KEY` | Platform AWS secret key for STS calls         | Yes (AWS)        |
| `SLACK_OAUTH_CLIENT_ID`         | Slack OAuth app client ID                     | For Slack OAuth  |
| `SLACK_OAUTH_CLIENT_SECRET`     | Slack OAuth app client secret                 | For Slack OAuth  |
| `INTERNAL_SERVICE_TOKEN`        | Shared token for worker-to-backend auth       | Recommended      |

> **Dev Fallback:** In development, `INTEGRATION_STORE_MASTER_KEY` falls back to a hardcoded key with a console warning. Do not use the fallback in production.
