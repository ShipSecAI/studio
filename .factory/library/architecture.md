# Architecture

How the system works: major components, relationships, data flows, and invariants.

**What belongs here:** shared cloud abstractions, provider-specific adapters, workflow/run flow, inventory source-of-truth rules.
**What does NOT belong here:** low-level implementation checklists or exact commands.

---

## Architectural intent

ShipSec should expose **cloud-agnostic product surfaces** and keep **provider-specific adapters** thin. For this mission, `/gcp` remains mostly an onboarding/runtime adapter surface, while `cloud/*`, `Index Infra`, and public asset-discovery APIs stay shared.

## Responsibility map

- `backend/src/integrations/*`: provider onboarding, connection validation, discovery, credential resolution, and integration events.
- `backend/src/asset-discovery/*`: shared sync orchestration, sync-run bookkeeping, graph-backed inventory APIs, and provider-normalized asset reads.
- `worker/src/asset-discovery/*` and `worker/src/components/security/*`: provider-aware Cartography execution and credential mounting through the shared runner abstraction.
- `frontend/src/pages/Integrations*`, `CloudAccountsPage`, and `CloudInventoryPage`: shared cloud product surfaces that must become provider-aware without splitting into provider-specific product pages.

## Shared product surfaces

- **Integrations**: provider catalog and provider detail routes
- **Cloud Accounts / Cloud Inventory**: shared browser surfaces for mixed-provider cloud operations
- **Index Infra**: the single visible system workflow for inventory indexing
- **Asset discovery APIs**: shared `/asset-discovery/assets`, `/summary`, and `/sync-runs` endpoints

## Provider-specific adapters

### AWS adapter responsibilities

- IAM-role onboarding and validation
- Organizations discovery
- Multi-profile Cartography target preparation
- AWS graph label/property normalization

### GCP adapter responsibilities

- Service Account JSON onboarding and validation
- Discover Projects / folders / org roots
- GCP Cartography credential mounting and target preparation
- GCP graph label/property normalization

## `Index Infra` invariant

`Index Infra` is the single user-visible system workflow family for cloud inventory indexing. Workers may generalize its internal inputs, schedule semantics, and provider-specific execution planning, but must not replace it with separate user-visible AWS/GCP workflow surfaces.

## Credential and normalization boundaries

- Backend resolves encrypted connection credentials into provider-specific runtime payloads safe for worker consumption.
- Worker converts those provider-specific payloads into Cartography runtime inputs and mounted credentials.
- Cartography writes provider graph data into Neo4j.
- Backend inventory readers normalize provider differences at read time into the shared public Cloud Inventory API shape.

## End-to-end flow

1. User creates or manages a cloud connection through Integrations / Cloud Accounts.
2. Integration connection events and manual sync actions feed the shared `Index Infra` orchestration surface.
3. Backend prepares provider-aware sync targets for worker execution.
4. Worker executes Cartography through the shared runner abstraction using provider-specific credential mounting.
5. Cartography writes to Neo4j.
6. Backend Cloud Inventory APIs read normalized graph-backed inventory from Neo4j.
7. Frontend Cloud Inventory presents mixed-provider assets through shared UI surfaces.

## Invariants

- `Index Infra` remains the only visible inventory workflow.
- Neo4j / Cartography remain the source of truth for inventory; do not introduce mirrored asset tables as the primary source.
- Public asset-discovery API shapes remain stable while becoming provider-aware internally.
- Shared cloud UI surfaces must not regress into AWS-only assumptions once GCP is introduced.
- Secret material must never be returned through create/list/validate/discover responses.

## Frontend scope for this mission

The required shared browser surfaces for this mission are:

- Integrations listing and provider detail routes
- Cloud Accounts / Cloud Scans management surfaces
- Cloud Inventory listing, filtering, sync initiation, and run-linking flows

## Validation boundary

- Local mission proof on instance `2` must validate onboarding and provider-aware cloud surfaces. This mission intentionally uses direct instance-2 URLs rather than instance-0/nginx routing.
- Full GCP inventory proof through Cartography/Neo4j/Cloud Inventory is required in staging before the mission can be declared fully complete.
