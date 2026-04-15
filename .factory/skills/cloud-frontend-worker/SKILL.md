---
name: cloud-frontend-worker
description: Implement provider-aware Integrations, Cloud Accounts, and Cloud Inventory UI behavior for mixed-provider cloud inventory.
---

# Cloud Frontend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use this skill for frontend features affecting Integrations, Cloud Accounts, Cloud Inventory, provider-aware filtering, sync UX, and workflow-run linking in browser-visible surfaces.

## Required Skills

- `agent-browser` — invoke for browser verification of user-facing flows on instance 2.
- `performance-review` — invoke after implementation to check for frontend performance regressions and state/query anti-patterns.

## Work Procedure

1. Before editing frontend data-fetching or pages, read `frontend/docs/state.md`, `frontend/docs/performance.md`, `frontend/src/lib/queryKeys.ts`, and existing hooks under `frontend/src/hooks/queries/`.
2. Read mission `AGENTS.md`, `.factory/library/architecture.md`, and `.factory/library/user-testing.md`.
3. Write failing frontend tests first for the user-visible behavior being changed.
4. Implement using existing TanStack Query patterns; keep cloud product surfaces shared and provider-aware rather than introducing separate GCP-only product pages.
5. Invoke `performance-review` after implementation and address any high-signal findings before handoff.
6. Run frontend and workspace validation appropriate to the touched surface: `bun --cwd frontend run lint`, `bun run typecheck`, targeted tests, and broader `bun run lint` if shared query/hooks changed.
7. Invoke `agent-browser` and verify the exact user flows on instance 2 using `http://localhost:5373`. Capture screenshots or observations for Integrations, Cloud Accounts, Cloud Inventory, sync initiation, and run-link navigation as applicable.
8. In the handoff, call out any UI behavior that still depends on staging-only runtime proof.

## Example Handoff

```json
{
  "salientSummary": "Completed provider-aware GCP onboarding and Cloud Inventory UI parity on instance 2. Users can now see Google Cloud in Integrations, manage cloud connections without AWS-only framing, and trigger Sync Now through the shared cloud surfaces with preserved run linking.",
  "whatWasImplemented": "Added GCP to the integrations listing and detail surfaces, implemented provider-aware add/validate/discover actions, generalized Cloud Accounts and Cloud Inventory to support mixed-provider connections and visible provider filtering, and kept workflow-run linking behavior intact from Sync Now to run detail pages.",
  "whatWasLeftUndone": "The UI now supports the shared cloud flow locally, but final proof that staged GCP assets populate Cloud Inventory still depends on the staging validation milestone.",
  "verification": {
    "commandsRun": [
      {
        "command": "bun --cwd frontend run lint",
        "exitCode": 0,
        "observation": "Frontend lint passed on touched pages and hooks."
      },
      {
        "command": "bun run typecheck",
        "exitCode": 0,
        "observation": "Workspace typecheck passed after provider-aware UI changes."
      },
      {
        "command": "bun --cwd frontend run test",
        "exitCode": 0,
        "observation": "Frontend tests covering integrations/cloud pages passed."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Opened /integrations and /integrations/gcp on instance 2",
        "observed": "Google Cloud appeared as a first-class provider and Add Connection opened a real GCP form."
      },
      {
        "action": "Opened /cloud/accounts with mixed-provider fixtures",
        "observed": "GCP connections appeared without AWS-only copy in account management surfaces."
      },
      {
        "action": "Opened /cloud/inventory, applied provider filter, triggered Sync Now, and followed the run link",
        "observed": "Provider filter was visible, Sync Now offered provider-aware options, and View run navigated to the expected workflow run."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "frontend/src/pages/__tests__/CloudInventoryPage.gcp.spec.tsx",
        "cases": [
          {
            "name": "shows provider filter and mixed-provider assets",
            "verifies": "Cloud Inventory remains shared while supporting GCP visibility."
          },
          {
            "name": "Sync Now chooser includes GCP connections",
            "verifies": "Cloud Inventory sync UX is provider-aware rather than AWS-only."
          }
        ]
      }
    ]
  },
  "discoveredIssues": [
    {
      "severity": "low",
      "description": "Final staged asset screenshots remain pending until the staging proof milestone runs."
    }
  ]
}
```

## When to Return to Orchestrator

- The required UX depends on backend/runtime behavior that is not yet available.
- Agent-browser cannot complete a required flow because authentication, credentials, or instance-2 availability is blocked.
- A requested UI behavior would require changing the approved cloud-agnostic vs provider-specific boundary.
