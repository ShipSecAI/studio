# Agentic Code Findings

ShipSec code security is not a scanner summary product.

The product has two separate code-intelligence loops:

1. **Code wiki ingest** builds durable understanding of the repository: architecture, trust boundaries, endpoint ownership, sensitive data flows, deployment clues, and local conventions. It is memory for future agents, not the primary finding producer.
2. **Agentic code review** produces first-class findings and linked threat candidates. It reads code, diffs, wiki context, prior findings, and deployment/cloud context, then emits structured security findings that can be deduped, reopened, resolved, and linked to larger threats.

Scanner rows may exist as supporting evidence, but the product direction is agent-first. The agent is expected to reason through the code like a security engineer, not merely collect OpenGrep or TruffleHog output.

## Review Modes

### Baseline Review

A baseline review runs on the default branch, a deployed release SHA, or another production-equivalent revision.

Its job is to answer:

- What security issues exist in the current code?
- Which endpoints, functions, data flows, identities, and stores are affected?
- Which findings belong together as one threat?
- What evidence proves the issue?
- How would we verify the fix later?

Baseline findings become the living inventory behind the "What's Broken" product surface.

### PR Review

A PR review runs on a proposed change.

Its job is to answer:

- Did this PR introduce a new finding?
- Did this PR make an existing finding worse?
- Did this PR fix an existing linked finding?
- Which existing findings are relevant but unchanged?
- What should block merge?

PR review must load existing linked findings before reasoning. A PR can therefore close the loop: if it changes the vulnerable route, identity check, data access path, or sanitizer that caused an existing finding, the agent can emit a `fixed_candidate` transition with evidence.

## Product Truth

Agentic code findings must be persisted as product truth, not only comments or markdown.

The first implementation path uses the existing `shipsec.ingestion-batch.v1` contract:

- `security_scanner_runs` records the agentic review run.
- `security_assets` records repositories, files, API routes, packages, services, and container images.
- `security_observations` records the agent's concrete observation with raw normalized detail.
- `security_finding_instances` records the durable finding keyed by semantic code location and weakness.
- `security_evidence_items` records the agent output or code snippet evidence.
- `security_graph_edges` links assets to findings and findings to evidence.

ClickHouse remains useful for fast scanner-row analytics. Postgres owns the durable finding lifecycle.

## Finding Shape

The agent should emit structured JSON. Markdown is allowed only as a secondary report.

```json
{
  "findings": [
    {
      "title": "Missing tenant authorization on workflow run lookup",
      "severity": "high",
      "confidence": 0.87,
      "category": "authorization",
      "weaknessClass": "idor",
      "status": "existing",
      "file": "backend/src/workflows/workflows.controller.ts",
      "line": 142,
      "endpoint": "GET /api/v1/workflows/:workflowId/runs/:runId",
      "functionName": "getWorkflowRun",
      "description": "The handler loads a workflow run by id without proving it belongs to the authenticated organization.",
      "attackerPrerequisite": "Authenticated user in another organization with a guessed or leaked run id.",
      "impact": "Cross-tenant workflow run metadata and artifacts may be exposed.",
      "evidence": [
        "Route parameter runId is passed to repository lookup.",
        "Repository filter does not include organizationId before returning the row."
      ],
      "fix": "Add organization-scoped lookup and deny if run.organizationId does not match auth.organizationId.",
      "verification": "Add an integration test where org A cannot read org B's run id."
    }
  ],
  "threatCandidates": [
    {
      "title": "Cross-tenant workflow artifact exposure",
      "linkedFindingKeys": [
        "code:shipsec/studio:idor:GET /api/v1/workflows/:workflowId/runs/:runId"
      ],
      "impact": "Customer workflow metadata and artifacts can cross tenant boundaries.",
      "confidence": 0.78
    }
  ],
  "wikiUpdates": []
}
```

Stable finding keys should avoid line numbers when a semantic anchor exists:

```text
code:<repo>:<weaknessClass>:<endpoint|function|file|package|image>
```

Examples:

```text
code:shipsec/studio:idor:GET /api/v1/workflows/:workflowId/runs/:runId
code:shipsec/studio:secret-handling:backend/src/secrets/secrets.service.ts
code:shipsec/studio:vulnerable-dependency:@org/pkg@1.2.3:CVE-2026-1234
```

## Agent Prompt Contract

The agent must be prompted as a security investigator:

```text
You are a senior application security engineer.

Your job is to find real exploitable security issues in this codebase.
Do not summarize scanners. Scanners are optional evidence only.
Use the wiki as context, but verify from source code.

For every finding include:
- affected endpoint/function/file/package
- vulnerable behavior
- attacker prerequisite
- exploit path
- impact
- evidence
- confidence
- fix
- verification plan

For PR review, classify each finding as:
- introduced
- worsened
- fixed_candidate
- unchanged_existing
- uncertain

Return structured JSON matching the ShipSec agentic code finding schema.
```

## Workflow Shape

Baseline:

```text
checkout repo/release
load code wiki context
load prior linked findings
load relevant cloud/infra/deployment facts
run Codex/OpenCode agent
normalize agent findings
persist ingestion batch
link findings into threats
update wiki secondarily
```

PR:

```text
load PR context and diff
checkout PR head
load existing linked findings touching changed files/endpoints
load code wiki context
run Codex/OpenCode agent
normalize agent findings
persist ingestion batch
emit PR report and merge gate result
```

The wiki update happens after the finding run. It records new durable knowledge learned during the investigation, but it is not the main deliverable.

## First Vertical Slice

The first shippable slice is:

- An agent prompt/template that asks for structured JSON.
- A `shipsec.agent-code-findings.normalize` component that converts that JSON into `shipsec.ingestion-batch.v1`.
- Use the existing `shipsec.ingestion.persist` component to write durable findings.
- Wire the agentic review workflow so `core.ai.opencode.report -> shipsec.agent-code-findings.normalize -> shipsec.ingestion.persist`.

This makes agent-found code issues first-class findings, ready for later linked-threat reconciliation.
