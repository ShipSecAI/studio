# Feature Flags System

ShipSec Studio uses a **two-layer feature flag system**:

1. **PostHog (runtime)** — per-user/org targeting, kill switches, A/B testing
2. **Vite build-time flags** — hard-disable entire feature families for smaller deployments

## Quick Start

### Disabling a feature (kill switch)

1. Open PostHog dashboard → Feature Flags
2. Find the flag (e.g., `ff_ai_agent`)
3. Toggle it OFF or set targeting rules
4. Changes propagate to all users within ~30 seconds

### Enabling a feature for specific users/orgs

1. In PostHog → Feature Flags → find the flag
2. Add a release condition:
   - **Per user**: Match on `distinct_id` (Clerk user ID)
   - **Per org**: Match on group `organization` property
   - **Percentage rollout**: Set to e.g. 10% for gradual rollout
3. Save — changes take effect immediately for new sessions

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Vite Build-Time Layer (VITE_FF_*)                      │
│  ─ Set in .env / CI pipeline                            │
│  ─ Features set to 'false' are forced OFF everywhere    │
│  ─ Useful for smaller/simpler deployments               │
│  ─ Requires rebuild to change                           │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│  PostHog Runtime Layer (ff_*)                           │
│  ─ Evaluated per-user at runtime                        │
│  ─ Can target by user, org, percentage, properties      │
│  ─ Changes propagate in ~30s (no rebuild needed)        │
│  ─ Kill switch: disable instantly from PostHog UI       │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│  DAG Dependency Resolver                                │
│  ─ If parent feature is OFF → children are OFF too      │
│  ─ e.g., WORKFLOWS off → SCHEDULES, WEBHOOKS off       │
│  ─ Circular dependencies detected and logged            │
└─────────────────────────────────────────────────────────┘
```

## Feature Registry

All features are defined in `frontend/src/features/feature-flags/registry.ts`.

| Feature Key          | PostHog Flag            | Build-Time Env      | Depends On                     |
| -------------------- | ----------------------- | ------------------- | ------------------------------ |
| `WORKFLOWS`          | `ff_workflows`          | `VITE_FF_WORKFLOWS` | —                              |
| `WORKFLOW_TEMPLATES` | `ff_workflow_templates` | —                   | WORKFLOWS                      |
| `WORKFLOW_SCHEDULES` | `ff_workflow_schedules` | —                   | WORKFLOWS                      |
| `WEBHOOKS`           | `ff_webhooks`           | —                   | WORKFLOWS                      |
| `AI_AGENT`           | `ff_ai_agent`           | `VITE_FF_AI_AGENT`  | —                              |
| `GITHUB_INTEGRATION` | `ff_github_integration` | `VITE_FF_GITHUB`    | —                              |
| `CODE_SCANS`         | `ff_code_scans`         | —                   | GITHUB_INTEGRATION             |
| `PR_PROTECTION`      | `ff_pr_protection`      | —                   | GITHUB_INTEGRATION, CODE_SCANS |
| `CLOUD_SECURITY`     | `ff_cloud_security`     | `VITE_FF_CLOUD`     | —                              |
| `CLOUD_INVENTORY`    | `ff_cloud_inventory`    | —                   | CLOUD_SECURITY                 |
| `CLOUD_SCANS`        | `ff_cloud_scans`        | —                   | CLOUD_SECURITY                 |
| `ASM`                | `ff_asm`                | `VITE_FF_ASM`       | —                              |
| `ASM_DOMAINS`        | `ff_asm_domains`        | —                   | ASM                            |
| `ASM_ASSETS`         | `ff_asm_assets`         | —                   | ASM                            |
| `ASM_SCANS`          | `ff_asm_scans`          | —                   | ASM                            |
| `SECURITY_DASHBOARD` | `ff_security_dashboard` | —                   | —                              |
| `INTEGRATIONS`       | `ff_integrations`       | —                   | —                              |
| `SECRETS`            | `ff_secrets`            | —                   | —                              |
| `API_KEYS`           | `ff_api_keys`           | —                   | —                              |
| `MCP_SERVERS`        | `ff_mcp_servers`        | —                   | —                              |
| `ARTIFACTS`          | `ff_artifacts`          | —                   | —                              |
| `ACTION_CENTER`      | `ff_action_center`      | —                   | WORKFLOWS                      |
| `ANALYTICS_SETTINGS` | `ff_analytics_settings` | —                   | —                              |

## How to Add a New Feature Flag

### 1. Add to the registry

In `frontend/src/features/feature-flags/registry.ts`:

```typescript
MY_NEW_FEATURE: {
  key: 'MY_NEW_FEATURE',
  label: 'My New Feature',
  dependsOn: ['WORKFLOWS'],       // optional — parent features
  defaultEnabled: false,           // false = opt-in, true = opt-out
  posthogKey: 'ff_my_new_feature', // must match PostHog dashboard
  buildTimeEnv: 'VITE_FF_MY_FEATURE', // optional — for build-time hard disable
},
```

### 2. Add the type

In `frontend/src/features/feature-flags/types.ts`, add `'MY_NEW_FEATURE'` to the `FeatureKey` union.

### 3. Create the PostHog flag

In PostHog dashboard → Feature Flags → New:

- Key: `ff_my_new_feature`
- Rollout: 0% (disabled) or set targeting rules

### 4. Gate your UI

**Option A: Component gate**

```tsx
import { FeatureGate } from '@/features/feature-flags';

<FeatureGate flag="MY_NEW_FEATURE" fallback={<OldComponent />}>
  <NewComponent />
</FeatureGate>;
```

**Option B: Hook**

```tsx
import { useFeatureFlag } from '@/features/feature-flags';

function MyComponent() {
  const enabled = useFeatureFlag('MY_NEW_FEATURE');
  if (!enabled) return null;
  return <NewFeature />;
}
```

**Option C: Route guard**

```tsx
<Route element={<FeatureFlagRoute flag="MY_NEW_FEATURE" />}>
  <Route path="/new-feature" element={<NewFeaturePage />} />
</Route>
```

### 5. Add to sidebar (optional)

In `AppLayout.tsx`, add `requiredFlag: 'MY_NEW_FEATURE'` to your nav item.

### 6. Build-time gate (optional)

If you added `buildTimeEnv`, also:

1. Add to `env.schema.ts`: `VITE_FF_MY_FEATURE: viteBoolean(true)`
2. Add to `vite-env.d.ts`: `readonly VITE_FF_MY_FEATURE?: string`
3. Set `VITE_FF_MY_FEATURE=false` in `.env` to force the feature off

## Build-Time Flags

Build-time flags hard-disable top-level feature families before PostHog runtime evaluation.

### How it works

If `VITE_FF_AI_AGENT=false`, the AI agent stays disabled even if PostHog tries to enable it.

### Setting build-time flags

In `.env` or `.env.production`:

```bash
VITE_FF_WORKFLOWS=true
VITE_FF_AI_AGENT=true
VITE_FF_GITHUB=true
VITE_FF_CLOUD=true
VITE_FF_ASM=true
```

Set any to `false` to force that feature family off for the whole deployment.

## Dependency Cascade

When you disable a parent feature, all child features are automatically disabled:

```
WORKFLOWS (disabled)
  ├── WORKFLOW_TEMPLATES  → disabled
  ├── WORKFLOW_SCHEDULES  → disabled
  ├── WEBHOOKS            → disabled
  └── ACTION_CENTER       → disabled

GITHUB_INTEGRATION (disabled)
  ├── CODE_SCANS          → disabled
  └── PR_PROTECTION       → disabled (also depends on CODE_SCANS)
```

## PostHog Setup

### Required environment variables

```bash
VITE_PUBLIC_POSTHOG_KEY=phc_your_key_here
VITE_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com  # or your self-hosted URL
```

### Creating flags in PostHog

1. Go to PostHog → Feature Flags
2. Click "New feature flag"
3. Set the key to match the `posthogKey` in the registry (e.g., `ff_ai_agent`)
4. Configure release conditions:
   - **Everyone**: Toggle on/off for all users
   - **Percentage rollout**: Gradual release (e.g., 10% → 50% → 100%)
   - **User targeting**: Match on user properties (email, ID)
   - **Org targeting**: Match on group `organization` properties

### Per-organization targeting

The `PostHogClerkBridge` automatically sends Clerk org data to PostHog via `posthog.group()`. To target by organization:

1. In PostHog → Feature Flags → your flag
2. Add condition: Group type = `organization`, property = `name`, operator = `equals`, value = `Acme Corp`

## Testing Feature Flags Locally

### Override a flag in the browser console

```javascript
// Force-enable a flag
posthog.featureFlags.override({ ff_ai_agent: true });

// Force-disable a flag
posthog.featureFlags.override({ ff_ai_agent: false });

// Clear overrides
posthog.featureFlags.override({});
```

### Override via build-time env

In `.env.local`:

```bash
VITE_FF_AI_AGENT=false
```

Then restart the dev server.

## Kill Switch Workflow

When a feature is causing problems in production:

1. **Open PostHog** → Feature Flags
2. **Find the flag** (e.g., `ff_cloud_security`)
3. **Set rollout to 0%** or toggle OFF
4. **Feature disables within ~30 seconds** for all users
5. **Dependent features cascade** — disabling `CLOUD_SECURITY` also disables `CLOUD_INVENTORY` and `CLOUD_SCANS`
6. **No rebuild or deployment needed**

To restore: toggle the flag back ON in PostHog.
