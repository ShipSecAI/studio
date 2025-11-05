# ShipSec Studio Frontend

React + Vite UI for building and monitoring ShipSec Studio workflows.

## Prerequisites
- Bun 1.1.20 (see root `README.md` for install instructions)
- Docker stack and backend/worker services running (`bun run dev:infra` from repo root)

## Daily Commands
```bash
# Install workspace deps (run once from repo root)
bun install

# Start the UI with hot reload
bun --cwd frontend run dev

# Type-check and lint before committing
bun --cwd frontend run typecheck
bun --cwd frontend run lint

# Run component/unit tests (bun test + Testing Library)
bun --cwd frontend run test
```

## Key Concepts
- **Schema-first data** – Zod schemas live in `src/schemas/*` and are sourced from `@shipsec/shared`. Derive types with `z.infer` instead of ad‑hoc interfaces.
- **API client** – All HTTP calls flow through `src/services/api.ts`, which wraps the generated `@shipsec/backend-client`.
- **Execution streaming** – `src/store/executionStore.ts` orchestrates polling ↔︎ SSE streams for run status/log updates.
- **Design system** – Reusable pieces sit under `src/components/ui` and `src/components/layout`. Workflow canvas utilities reside in `src/components/workflow`.

## Where To Read More
- `frontend/docs/state.md` – Zustand stores, schema imports, and execution pipeline.
- `frontend/docs/ui.md` – Canvas layout, Tailwind conventions, shadcn usage.
- `docs/guide.md` – Cross-repo architecture + links into `.ai` decision logs.
- `docs/execution-contract.md` – Source of truth for run status/log schemas.
- `docs/analytics.md` – PostHog analytics setup, env gating, and troubleshooting.
