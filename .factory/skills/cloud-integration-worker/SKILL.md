---
name: cloud-integration-worker
description: Implement provider-aware backend integration, connection, and schedule orchestration features for cloud inventory.
---

# Cloud Integration Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use this skill for backend features that change integration onboarding, connection management, provider metadata, validation/discovery endpoints, integration events, and `Index Infra` schedule/orchestration behavior.

## Required Skills

None.

## Work Procedure

1. Read the assigned feature, `mission.md`, mission `AGENTS.md`, and `.factory/library/architecture.md` before editing.
2. For backend route or integration changes, inspect the existing controller/service/repository/listener code paths and preserve public API shape unless the feature explicitly changes it.
3. Write failing tests first for the changed backend behavior (controller/service/repository/listener coverage as appropriate). Commit to the red-green flow: add tests, observe failure, then implement.
4. Implement the smallest provider-aware change that satisfies the feature while keeping `/gcp` thin and shared cloud surfaces generic.
5. If route shapes change, run `bun --cwd backend run generate:openapi` and `bun --cwd packages/backend-client run generate`.
6. Verify with targeted backend commands first, then broader checks if the change affects shared orchestration: `bun --cwd backend run test`, `bun --cwd backend run typecheck`, `bun --cwd backend run lint`.
7. Do at least one manual API verification with `curl` against instance 2 for every user-visible endpoint changed.
8. In the handoff, be explicit about routes changed, tests added, commands run, and any orchestration caveats still deferred.

## Example Handoff

```json
{
  "salientSummary": "Completed provider-aware Index Infra schedule anchoring for cloud connections and added GCP onboarding endpoint coverage. Backend contract shape stayed stable and curl checks on instance 2 showed the new GCP validate/discover flow working.",
  "whatWasImplemented": "Added GCP connection validation/discovery coverage and generalized connection-created orchestration so cloud onboarding now targets the shared Index Infra flow instead of AWS-only listeners. Updated backend tests for controller/service/listener behavior and regenerated OpenAPI/client artifacts after route changes.",
  "whatWasLeftUndone": "Staging-only inventory proof was not attempted in this feature; runtime Cartography support remains for a later milestone.",
  "verification": {
    "commandsRun": [
      {
        "command": "bun --cwd backend run test",
        "exitCode": 0,
        "observation": "Backend integration and listener tests passed after the provider-aware changes."
      },
      {
        "command": "bun --cwd backend run typecheck",
        "exitCode": 0,
        "observation": "No type regressions in integrations/schedules code."
      },
      {
        "command": "bun --cwd backend run lint",
        "exitCode": 0,
        "observation": "Lint passed on touched backend files."
      },
      {
        "command": "bun --cwd backend run generate:openapi && bun --cwd packages/backend-client run generate",
        "exitCode": 0,
        "observation": "OpenAPI and generated client updated for route changes."
      },
      {
        "command": "curl -X POST http://localhost:3411/api/v1/integrations/gcp/connections/...",
        "exitCode": 0,
        "observation": "Valid GCP onboarding request succeeded and returned a redacted connection payload."
      }
    ],
    "interactiveChecks": [
      {
        "action": "Manually queried schedules and workflow runs after creating a cloud connection on instance 2",
        "observed": "A shared Index Infra schedule and visible workflow run were present; no provider-specific workflow appeared."
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "backend/src/integrations/__tests__/provider-aware-index-infra.spec.ts",
        "cases": [
          {
            "name": "anchors shared Index Infra schedule for GCP connect",
            "verifies": "GCP connect reuses shared Index Infra schedule semantics."
          },
          {
            "name": "preserves AWS behavior while adding GCP",
            "verifies": "Existing AWS orchestration remains unchanged."
          }
        ]
      }
    ]
  },
  "discoveredIssues": [
    {
      "severity": "medium",
      "description": "Current schedule input model can only hold one integrationId, so broader multi-connection coverage may need a follow-up planning shape."
    }
  ]
}
```

## When to Return to Orchestrator

- A feature would require changing mission boundaries, especially instance usage or shared infra handling.
- Real credential or staging access is required and unavailable.
- Schedule/run semantics need a product decision because a single shared schedule cannot represent the intended connection coverage model cleanly.
