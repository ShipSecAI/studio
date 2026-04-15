# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** required env vars, external API keys/services, instance-specific setup notes, staging prerequisites.
**What does NOT belong here:** service ports/commands (use `.factory/services.yaml`).

---

## Local validation target

- Use dedicated `SHIPSEC_INSTANCE=2` only.
- Frontend: `http://localhost:5373`
- Backend: `http://localhost:3411`
- Do not validate through instance `0` routing or the current active instance `5`.

## Shared infrastructure

- Shared local Docker infra provides Postgres, Temporal, Kafka/Redpanda, Redis, MinIO, Loki, Bifrost, and Neo4j.
- Reuse shared infra; do not reset it as part of this mission.

## GCP prerequisites

- Real GCP Service Account JSON is required for local onboarding validation.
- Full `Index Infra -> Cartography -> Neo4j -> Cloud Inventory` proof is deferred to staging and requires real staging credentials plus provider permissions for the approved GCP asset classes.
- Never commit service account JSON or derived secret material.

## ShipSec instance notes

- Per-instance frontend env must keep `VITE_API_URL=""` so requests remain same-origin.
- Backend and worker instance envs must share compatible secret-store and internal-service settings.
- If route shapes change, regenerate OpenAPI and the backend client before closing the feature.
