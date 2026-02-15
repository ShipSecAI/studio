# Billing Tiers & LiteLLM Integration - Implementation Plan

## Overview

Move billing tier limits from hardcoded TypeScript constants into DB (`subscription_plans` table), integrate LiteLLM spend API for real USD cost tracking, add frontend billing page, and wire up LiteLLM team/key management for per-org budget enforcement.

---

## Phase 1: Database Schema & Migration

### 1.1 Create `subscription_plans` Drizzle schema

**File**: `backend/src/database/schema/subscription-plans.ts` (NEW)

Table columns:

- `id` VARCHAR(50) PK — tier slug: `free`, `pro`, `team`, `enterprise`
- `display_name` VARCHAR(100)
- `price_usd_cents` INTEGER — 0 / 4900 / 14900 / 0 (custom)
- `workflow_runs_per_month` INTEGER
- `ai_budget_usd_cents` INTEGER — LiteLLM budget per org/month in cents
- `max_concurrent_runs` INTEGER
- `analytics_retention_days` INTEGER
- `max_workflows` INTEGER
- `is_active` BOOLEAN DEFAULT true
- `created_at`, `updated_at` TIMESTAMPTZ

### 1.2 Migration SQL

**File**: `backend/drizzle/0022_create-subscription-plans.sql` (NEW)

- CREATE TABLE subscription_plans
- INSERT 4 seed rows:
  - free: $0, 50 runs, $5 AI, 1 concurrent, 7d retention, 5 workflows
  - pro: $49, 500 runs, $50 AI, 3 concurrent, 30d retention, unlimited workflows (use -1)
  - team: $149, 2000 runs, $200 AI, 10 concurrent, 90d retention, unlimited workflows
  - enterprise: custom, unlimited everything (use -1 for unlimited)
- ON CONFLICT DO NOTHING (idempotent)

### 1.3 Add `subscription_plans` to migration guard

**File**: `backend/src/database/migration.guard.ts`

- Add `'subscription_plans'` to REQUIRED_TABLES array

### 1.4 Update SubscriptionTier type

**File**: `backend/src/database/schema/organization-settings.ts`

- Change type to: `'free' | 'pro' | 'team' | 'enterprise'`

### 1.5 Export from schema barrel

**File**: `backend/src/database/schema/index.ts`

- Add `export * from './subscription-plans'`

---

## Phase 2: LiteLLM Client Service (Backend)

### 2.1 Create LiteLLM client service

**File**: `backend/src/billing/litellm-client.service.ts` (NEW)

A NestJS service that wraps LiteLLM Proxy REST API calls:

```
Environment: LITELLM_PROXY_URL, LITELLM_MASTER_KEY
```

Methods:

- `getTeamSpend(teamId: string, startDate: Date, endDate: Date): Promise<number>`
  - Calls `GET /global/spend/report?group_by=team&start_date=...&end_date=...`
  - Filters response for matching team, returns total spend in USD

- `ensureTeam(orgId: string, maxBudgetUsd: number): Promise<{ teamId: string }>`
  - Calls `POST /team/new` with `team_id=orgId`, `max_budget=maxBudgetUsd`, `budget_duration=monthly`
  - Idempotent — if team exists, calls `POST /team/update` instead

- `getTeamInfo(orgId: string): Promise<{ spend: number; maxBudget: number }>`
  - Calls `GET /team/info?team_id=orgId`
  - Returns current spend and budget

- `generateKey(orgId: string): Promise<{ key: string }>`
  - Calls `POST /key/generate` with `team_id=orgId`

If `LITELLM_PROXY_URL` is not set, all methods return graceful defaults (spend=0, no-op for team/key ops). This lets self-hosted instances work without LiteLLM.

### 2.2 Create SubscriptionPlans service

**File**: `backend/src/billing/subscription-plans.service.ts` (NEW)

- Reads plans from `subscription_plans` table
- In-memory cache with 5min TTL
- `getPlanByTier(tier: SubscriptionTier): Promise<SubscriptionPlan>`
- `getAllActivePlans(): Promise<SubscriptionPlan[]>`

---

## Phase 3: Update Billing Service & API

### 3.1 Rewrite BillingService

**File**: `backend/src/billing/billing.service.ts`

Update `getUsage()`:

- Get org's tier from `OrganizationSettingsService`
- Get plan limits from `SubscriptionPlansService` (DB, not hardcoded)
- Get workflow run count from `BillingRepository.countWorkflowRunsForPeriod()` (existing)
- Get AI spend in USD from `LiteLLMClientService.getTeamSpend()` (NEW)
- Keep `totalTokensUsed` from agent_trace_events as supplementary info
- Return new response shape with USD values

New response shape:

```json
{
  "organizationId": "org-1",
  "subscriptionTier": "pro",
  "plan": { "id": "pro", "displayName": "Pro", "priceUsdCents": 4900 },
  "period": { "start": "...", "end": "..." },
  "workflowRuns": { "used": 42, "limit": 500, "remaining": 458 },
  "ai": { "spentUsd": 12.5, "budgetUsd": 50.0, "remainingUsd": 37.5, "totalTokensUsed": 125000 },
  "limits": { "maxConcurrentRuns": 3, "maxWorkflows": -1, "analyticsRetentionDays": 30 }
}
```

### 3.2 Add `GET /billing/plans` endpoint

**File**: `backend/src/billing/billing.controller.ts`

- New endpoint returning all active plans (for frontend pricing display)

### 3.3 Update DTOs

**File**: `backend/src/billing/dto/billing-usage.dto.ts` — rewrite to match new response shape
**File**: `backend/src/billing/dto/subscription-plan.dto.ts` (NEW) — plan DTO for /plans endpoint

### 3.4 Update BillingModule

**File**: `backend/src/billing/billing.module.ts`

- Add `SubscriptionPlansService`, `LiteLLMClientService` as providers
- Export `SubscriptionPlansService`

### 3.5 Delete dead code

**File**: `backend/src/billing/billing.limits.ts` — DELETE (hardcoded limits no longer needed)

### 3.6 Update analytics TIER_LIMITS

**File**: `backend/src/analytics/dto/analytics-settings.dto.ts`

- Add `team` entry: `{ name: 'Team', maxRetentionDays: 180 }`
  **File**: `frontend/src/pages/AnalyticsSettingsPage.tsx`
- Add `team` to the local TIER_LIMITS constant

### 3.7 Update tests

**File**: `backend/src/billing/__tests__/billing.service.spec.ts`

- Update to mock `SubscriptionPlansService` and `LiteLLMClientService`
- Verify USD-based response shape

---

## Phase 4: Frontend Billing Page

### 4.1 Create Progress component (missing)

**File**: `frontend/src/components/ui/progress.tsx` (NEW)

- Standard Radix UI Progress component with Tailwind styling

### 4.2 Create BillingPage

**File**: `frontend/src/pages/BillingPage.tsx` (NEW)

Layout:

- Header with org name + current tier badge
- Billing period indicator (current month)
- Two usage cards side-by-side:
  - **Workflow Runs**: progress bar, used/limit/remaining, warning at 90%
  - **AI Budget**: progress bar showing $spent / $budget, remaining, warning at 90%
- Plan Limits card: max concurrent runs, max workflows, analytics retention days
- All data from `GET /billing/usage`

### 4.3 Add route

**File**: `frontend/src/App.tsx`

- Add `<Route path="/billing" element={<BillingPage />} />`

### 4.4 Add sidebar nav item

**File**: `frontend/src/components/layout/AppLayout.tsx`

- Add "Billing & Usage" with CreditCard icon to the Manage section (after Analytics Settings)

---

## Phase 5: OpenAPI & Client Regeneration

### 5.1 Regenerate OpenAPI spec

- Run backend OpenAPI generation command
- This removes stale `/internal/billing/preflight` and `/internal/billing/release` endpoints
- Adds new `/billing/plans` endpoint

### 5.2 Regenerate backend-client types

- Run client generation from openapi.json
- Updates `packages/backend-client/src/client.ts`

### 5.3 Add billing methods to API client wrapper

**File**: `packages/backend-client/src/api-client.ts`

- Add `getBillingUsage()` and `getBillingPlans()` methods

### 5.4 Use typed client in frontend

**File**: `frontend/src/services/api.ts`

- Add `billing.getUsage()` and `billing.getPlans()` methods using the typed client

---

## Phase 6: Build Verification & Testing

- `tsc --noEmit` on backend and worker (zero errors)
- Run `bun test` for billing and agent-trace specs
- Verify `GET /billing/usage` returns new shape
- Verify `GET /billing/plans` returns 4 plans
- Verify frontend billing page renders with mock/real data

---

## File Change Summary

| Action | File                                                                     |
| ------ | ------------------------------------------------------------------------ |
| NEW    | `backend/src/database/schema/subscription-plans.ts`                      |
| NEW    | `backend/drizzle/0022_create-subscription-plans.sql`                     |
| NEW    | `backend/src/billing/litellm-client.service.ts`                          |
| NEW    | `backend/src/billing/subscription-plans.service.ts`                      |
| NEW    | `backend/src/billing/dto/subscription-plan.dto.ts`                       |
| NEW    | `frontend/src/components/ui/progress.tsx`                                |
| NEW    | `frontend/src/pages/BillingPage.tsx`                                     |
| EDIT   | `backend/src/database/schema/index.ts` — add subscription-plans export   |
| EDIT   | `backend/src/database/schema/organization-settings.ts` — add 'team' tier |
| EDIT   | `backend/src/database/migration.guard.ts` — add subscription_plans table |
| EDIT   | `backend/src/billing/billing.service.ts` — use DB plans + LiteLLM spend  |
| EDIT   | `backend/src/billing/billing.module.ts` — add new providers              |
| EDIT   | `backend/src/billing/billing.controller.ts` — add /plans endpoint        |
| EDIT   | `backend/src/billing/dto/billing-usage.dto.ts` — new response shape      |
| EDIT   | `backend/src/billing/__tests__/billing.service.spec.ts` — update mocks   |
| EDIT   | `backend/src/analytics/dto/analytics-settings.dto.ts` — add 'team' tier  |
| EDIT   | `frontend/src/pages/AnalyticsSettingsPage.tsx` — add 'team' tier         |
| EDIT   | `frontend/src/App.tsx` — add /billing route                              |
| EDIT   | `frontend/src/components/layout/AppLayout.tsx` — add sidebar item        |
| EDIT   | `frontend/src/services/api.ts` — add billing methods                     |
| EDIT   | `packages/backend-client/src/api-client.ts` — add billing methods        |
| DELETE | `backend/src/billing/billing.limits.ts`                                  |
| REGEN  | `openapi.json`                                                           |
| REGEN  | `packages/backend-client/src/client.ts`                                  |

## Out of Scope (future work)

- OpenCode billing header propagation (Docker container can't easily forward HTTP headers)
- Stripe integration for actual payment collection
- Plan upgrade/downgrade API
- LiteLLM team auto-provisioning on org creation (currently manual)
