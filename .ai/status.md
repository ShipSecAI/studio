# ShipSec Studio – Current State (as of monorepo bootstrap)

## Repository Layout
- Root configured as a Bun workspace (`package.json`, `bunfig.toml`).
- `frontend/`: existing Vite + React workflow builder migrated intact; package manager now Bun.
- `backend/`: new NestJS (Express adapter) service written in TypeScript; exposes `/health` endpoint; `bun --watch` dev script.

## Tooling
- Bun v1.1.20 used for both workspaces.
- `bun install` succeeds; lockfile stored as `bun.lock`.
- Dev scripts:
  - `bun run dev:frontend` (Vite dev server)
  - `bun run dev:backend` (NestJS in watch mode)

## Branch & Commit
- Working branch: `monorepo-bootstrap` (based off `ssa-frontend`).
- Latest commit: `chore: bootstrap bun workspace with frontend and nest backend`.

## Next Steps (suggested)
1. Resolve port binding in local env (sandbox currently blocks 3000; configure env or use Codex IDE backend).
2. Flesh out backend modules (auth, workflows, Temporal integration).
3. Hook frontend API client to new backend endpoints once defined.
4. Add scripts for concurrent dev (`bun run dev` orchestrating both).
