# User Testing

Testing surfaces, required testing tools, and concurrency guidance for this mission.

**What belongs here:** validation surfaces, local/staging boundaries, required tools, concurrency limits, gotchas.
**What does NOT belong here:** implementation plans or feature decomposition.

---

## Validation Surface

### Local validation (instance 2)

- Target URLs:
  - Frontend: `http://localhost:5373`
  - Backend: `http://localhost:3411`
- Required tool for browser checks: `agent-browser`
- Required tool for API checks: `curl`
- Local validation proves:
  - GCP connection create / validate / discover-projects
  - provider-aware Integrations / Cloud Accounts / Cloud Inventory surfaces
  - visible workflow-run linking from sync actions
- Local validation does **not** prove the full graph-backed GCP inventory path.

### Staging validation

- Required for full mission completion.
- Must prove `Index Infra -> Cartography (gcp) -> Neo4j -> Cloud Inventory` with real staging credentials.
- Preferred tools: `agent-browser` for UI, `curl` for API, plus workflow logs as supporting evidence.

## Validation Concurrency

### agent-browser on local instance 2

- **Max concurrent validators: 2**
- Rationale: dry run showed 8 logical CPU cores, 16 GB RAM, and meaningful existing workstation load (bun/droid/Lens). Use a conservative limit to avoid destabilizing the shared local environment.

### curl/API validation on local instance 2

- **Max concurrent validators: 5**
- Rationale: HTTP/API checks are lightweight compared with browser sessions and can be parallelized more aggressively.

### Staging end-to-end proof

- **Max concurrent validators: 1 browser + 2 API checks**
- Rationale: staging proof is stateful, credential-backed, and should avoid overlapping runs that obscure attribution.

## Gotchas

- Never validate through instance `0`; use direct instance-2 URLs only.
- Do not treat local onboarding proof as full inventory proof.
- If the environment requires user-provided staging credentials or access and they are unavailable, return to the orchestrator instead of silently downgrading validation.
