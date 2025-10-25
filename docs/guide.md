# ShipSec Studio Documentation Guide

Use this guide as the table of contents for all living documentation in the repo.

## Core References
- `README.md` – Local setup, stack bring-up, and daily workflows.
- `ARCHITECTURE.md` – High-level system design and package map.
- `docs/execution-contract.md` – Canonical execution/trace schemas shared across backend, worker, and frontend.
- `docs/enterprise-components.md` – Enterprise-grade component backlog (secret store, secret fetcher, etc.).

## Package-Level Guides
- `frontend/README.md` – Frontend quickstart + command reference.
  - `frontend/docs/state.md` – Zustand stores, schema usage, execution streaming.
  - `frontend/docs/ui.md` – Canvas layout, Tailwind/shadcn conventions.
- `backend/README.md` – Environment configuration and service expectations.
- `packages/backend-client/README.md` – Regenerating the OpenAPI client.
- `worker/src/__tests__/README.md` – Temporal integration test playbook.

## Decision Logs & Observability Notes
- `.ai/implementation-plan.md` – Phase tracker for observability work (keep in sync with execution contract changes).
- `.ai/visual-execution-notes.md` – Running audit log of trace/streaming experiments.
- `.ai/temporal-worker-architecture.md` – Worker orchestration strategies.
- `.ai/component-sdk.md` – Authoritative component interface reference.

When architecture or contract decisions shift, update both the relevant `.ai` log and the public docs above so humans and automation stay aligned.

## Keeping Docs Healthy
1. Update the doc closest to the code you touched (e.g., modify `frontend/docs/state.md` when stores change).
2. Reflect the change in `docs/guide.md` if new docs are added or the hierarchy moves.
3. Run `bun run lint` (frontend) or package-specific formatters so Markdown embedded in TSX stays tidy.
4. Mention documentation updates (or deliberate gaps) in the PR checklist—see `.github/pull_request_template.md`.
