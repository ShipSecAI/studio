# E2E Tests

End-to-end tests for workflow execution with real backend, worker, and infrastructure.

## Directory Structure

```
e2e-tests/
  helpers/
    api-base.ts              # API base URL resolution
    aws-eventbridge.ts       # AWS CLI helpers for cloud tests
    e2e-harness.ts           # Shared boilerplate (describe/test wrappers, polling, CRUD)
  fixtures/
    guardduty-alert.json
    guardduty-eventbridge-envelope.json
  core/                      # Local-only tests (no cloud keys, no Docker)
    error-handling.test.ts
    secret-resolution.test.ts
    subworkflow.test.ts
    webhooks.test.ts
    node-io-spilling.test.ts
    http-observability.test.ts
  pipeline/                  # Full AI agent pipeline (needs API keys + Docker)
    alert-investigation.test.ts
    mock-agent-tool-discovery.test.ts
  cloud/                     # Real AWS infrastructure (expensive, slow)
    guardduty-eventbridge.test.ts
  cleanup.ts
```

## Tiers

| Tier         | Directory   | Gate                                             | Description                                                                                      | Runtime   |
| ------------ | ----------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------ | --------- |
| **Core**     | `core/`     | `RUN_E2E=true`                                   | Backend + worker only. No cloud keys, no Docker.                                                 | 1-6 min   |
| **Pipeline** | `pipeline/` | `RUN_E2E=true` + API keys                        | AI agent pipeline with tools (AbuseIPDB, VirusTotal, AWS MCP). Needs external API keys + Docker. | 5-8 min   |
| **Cloud**    | `cloud/`    | `RUN_E2E=true` + `RUN_CLOUD_E2E=true` + API keys | Provisions real AWS infrastructure (IAM, EventBridge, ngrok).                                    | 10-15 min |

## Prerequisites

Local development environment must be running:

```bash
docker compose -p shipsec up -d
pm2 start pm2.config.cjs
```

## Running Tests

```bash
# All tiers
source e2e-tests/.env.e2e && bun run test:e2e

# Core only (fast, no keys needed)
bun run test:e2e:core

# Pipeline only (needs API keys in env)
source e2e-tests/.env.e2e && bun run test:e2e:pipeline

# Cloud only (needs AWS + ngrok)
source e2e-tests/.env.e2e && RUN_CLOUD_E2E=true bun run test:e2e:cloud
```

## Environment Variables

Copy `e2e-tests/.env.e2e.example` to `e2e-tests/.env.e2e` and fill in:

| Variable                | Required by     | Description                             |
| ----------------------- | --------------- | --------------------------------------- |
| `RUN_E2E`               | All             | Set to `true` to enable E2E tests       |
| `RUN_CLOUD_E2E`         | Cloud           | Set to `true` for expensive cloud tests |
| `ZAI_API_KEY`           | Pipeline, Cloud | Z.AI API key for OpenCode agent         |
| `ABUSEIPDB_API_KEY`     | Pipeline, Cloud | AbuseIPDB API key                       |
| `VIRUSTOTAL_API_KEY`    | Pipeline, Cloud | VirusTotal API key                      |
| `AWS_ACCESS_KEY_ID`     | Pipeline, Cloud | AWS access key for MCP tools            |
| `AWS_SECRET_ACCESS_KEY` | Pipeline, Cloud | AWS secret key                          |
| `AWS_REGION`            | Pipeline, Cloud | AWS region (default: us-east-1)         |

Tests are automatically skipped if services aren't available or required env vars are missing.
