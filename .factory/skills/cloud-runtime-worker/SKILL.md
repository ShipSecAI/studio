---
name: cloud-runtime-worker
description: Implement provider-aware worker runtime, Cartography execution, graph normalization, and shared Cloud Inventory backend behavior.
---

# Cloud Runtime Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use this skill for backend + worker features that change provider-aware sync planning, Cartography execution, graph extraction/normalization, sync-run bookkeeping, or shared Cloud Inventory API behavior.

## Required Skills

- `component-development` — invoke when changing Cartography component behavior, runner integration, credential mounting, or isolated-volume usage.

## Work Procedure

1. Read the assigned feature, mission `AGENTS.md`, `.factory/library/architecture.md`, and `.factory/library/user-testing.md`.
2. If touching worker component/runtime code, invoke `component-development` before implementation.
3. Trace the full runtime path before editing: trigger -> sync context -> worker runtime -> Cartography -> Neo4j -> Cloud Inventory API.
4. Write failing tests first in backend and/or worker locations that cover the new provider-aware behavior and any AWS regression boundaries.
5. Implement the smallest provider-aware change that preserves the shared `Index Infra` and shared inventory API surfaces.
6. For inventory/API changes, verify that public response shapes stay stable.
7. Run targeted worker/backend checks, then broader package validation as needed: `bun --cwd worker run build`, `bun --cwd worker run test`, `bun --cwd backend run test`, `bun run typecheck`, `bun run lint`.
8. Do at least one manual verification against instance 2 using `curl`; if the feature includes staging-only proof hooks, state clearly what remains staging-only in the handoff.

## Example Handoff

```json
{
  "salientSummary": "Implemented provider-aware sync planning and GCP Cartography credential mounting while keeping the single Index Infra workflow. Cloud Inventory APIs now read normalized GCP assets from the shared graph-backed surface.",
  "whatWasImplemented": "Generalized sync planning to support AWS multi-profile and GCP per-connection execution, added GCP Cartography runtime support with GOOGLE_APPLICATION_CREDENTIALS mounting, and extended graph normalization plus asset-discovery APIs to expose mixed-provider inventory without changing the public response envelope.",
  "whatWasLeftUndone": "Full staging proof of the complete GCP inventory path was not run in this feature and should be validated in the final milestone.",
  "verification": {
    "commandsRun": [
      {
        "command": "bun --cwd worker run build",
        "exitCode": 0,
        "observation": "Worker build succeeded after runtime changes."
      },
      {
        "command": "bun --cwd worker run test",
        "exitCode": 0,
        "observation": "Worker runtime/component tests passed."
      },
      {
        "command": "bun --cwd backend run test",
        "exitCode": 0,
        "observation": "Asset discovery and graph normalization tests passed."
      },
      {
        "command": "bun run typecheck",
        "exitCode": 0,
        "observation": "Workspace typecheck passed for backend/worker/shared packages."
      },
      {
        "command": "bun run lint",
        "exitCode": 0,
        "observation": "Lint passed for touched packages."
      },
      {
        "command": "curl http://localhost:3411/api/v1/asset-discovery/assets?provider=gcp",
        "exitCode": 0,
        "observation": "Shared asset endpoint returned normalized GCP assets using the stable public schema."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Inspected workflow run and sync-run linkage after a manual cloud sync on instance 2",
        "observed": "Sync history preserved temporalWorkflowId/temporalRunId linkage for the provider-aware execution."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "worker/src/components/security/__tests__/cartography-gcp-runtime.test.ts",
        "cases": [
          {
            "name": "mounts GCP service account and sets GOOGLE_APPLICATION_CREDENTIALS",
            "verifies": "Cartography gcp runtime receives credentials through the shared runner abstraction."
          },
          {
            "name": "retains AWS multi-profile support",
            "verifies": "Existing AWS Cartography runtime behavior is preserved."
          }
        ]
      },
      {
        "file": "backend/src/asset-discovery/__tests__/cloud-graph.gcp.spec.ts",
        "cases": [
          {
            "name": "normalizes GCP graph nodes into shared asset contract",
            "verifies": "GCP graph-backed assets appear through the stable asset-discovery API shape."
          }
        ]
      }
    ]
  },
  "discoveredIssues": [
    {
      "severity": "medium",
      "description": "Staging-only proof for full Index Infra -> Neo4j -> Cloud Inventory remains necessary before final mission sign-off."
    }
  ]
}
```

## When to Return to Orchestrator

- The feature requires a new cloud-provider product decision rather than a provider-adapter extension.
- Staging credentials, Neo4j access, or shared infrastructure needed for proof are unavailable.
- A required public API contract would need to change in a way not already approved by the mission.
