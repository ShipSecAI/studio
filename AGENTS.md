# ShipSec Studio

Security workflow orchestration platform. Visual builder + Temporal for reliability.

## Stack

- `frontend/` — React + Vite
- `backend/` — NestJS API
- `worker/` — Temporal activities + components
- `packages/` — Shared code (component-sdk, backend-client)

## Development

```bash
just init              # First time setup
just dev               # Start the active instance (default: 0)
just dev stop          # Stop the active instance (does NOT stop shared infra)
just dev stop all      # Stop all instances + shared infra
just dev logs          # View logs for the active instance
just help              # All commands
```

**Active instance**:

```bash
just instance show     # Print active instance number
just instance use 5    # Set active instance for this workspace
```

**Instance env files**:

```bash
just instance-init 5           # Initialize .instances/instance-5/*.env
just instance-env init 5       # Create from app/.env or app/.env.example
just instance-env update 5     # Re-apply instance-scoped vars (including worker BACKEND_URL)
just instance-env copy 5 6     # Copy env setup from instance 5 -> 6
just instance-env show 6       # Show file status and computed values
```

**URLs**:

- Frontend: `http://localhost:${5173 + instance*100}`
- Backend: `http://localhost:${3211 + instance*100}`
- Temporal UI (shared): http://localhost:8081

Full details: `docs/MULTI-INSTANCE-DEV.md`

### Multi-Instance Local Dev (Important)

Local development runs as **multiple app instances** (PM2) on top of **one shared Docker infra stack**.

- Shared infra (Docker Compose project `shipsec-infra`): Postgres/Temporal/Redpanda/Redis/MinIO/Loki on fixed ports.
- Per-instance apps: `shipsec-{frontend,backend,worker}-N`.
- Isolation is via per-instance DB + Temporal namespace/task queue + Kafka topic suffixing + instance-scoped Kafka consumer groups/client IDs (not per-instance infra containers).
- The workspace can have an **active instance** (stored in `.shipsec-instance`, gitignored).
- Instance env files are stored at `.instances/instance-N/{backend,worker,frontend}.env` and can be managed with `just instance-env ...`.

**Agent rule:** before running any dev commands, ensure you’re targeting the intended instance.

- Always check: `just instance show`
- If the task is ambiguous (logs, curl, E2E, “run locally”, etc.), ask the user which instance to use.
- If the user says “use instance N”, prefer either:
  - `just instance use N` then run `just dev` / `bun run test:e2e`, or
  - explicit env override (`SHIPSEC_INSTANCE=N just dev ...`) for one-off commands.

**Ports / URLs**

- Frontend: `5173 + N*100`
- Backend: `3211 + N*100`
- Temporal UI (shared): http://localhost:8081

**E2E tests**

- E2E targets the backend for `SHIPSEC_INSTANCE` (or the active instance).
- When asked to run E2E, confirm the instance and ensure that instance is running: `SHIPSEC_INSTANCE=N just dev start` (or `just instance use N` then `just dev start`).

**Keep docs in sync**

If you change instance/infra behavior (justfile/scripts/pm2 config), update `docs/MULTI-INSTANCE-DEV.md` and this section accordingly in the same PR.

### After Backend Route Changes

```bash
bun --cwd backend run generate:openapi
bun --cwd packages/backend-client run generate
```

### Testing

```bash
bun run test           # All tests
bun run typecheck      # Type check
bun run lint           # Lint
```

### Database

```bash
just db-reset                              # Reset database
bun --cwd backend run migration:generate   # Generate migration SQL from schema changes
bun --cwd backend run migration:migrate    # Apply committed migrations
bun run migrate                            # Root alias for migration:migrate
bun --cwd backend run db:studio            # View data
```

### Database Schema Safety (CRITICAL)

We use **`drizzle-kit generate` + `drizzle-kit migrate`** for both dev and production.

- `migration:generate` creates reviewable SQL files in `backend/drizzle/`.
- `migration:migrate` applies committed SQL migrations in order.
- `migration:push` remains a **manual escape hatch only** and must never run from automated startup paths.

**Rules for modifying database schema files (`backend/src/database/schema/*.ts`):**

1. **Never rely on app startup to apply schema changes.** Generate and commit migrations explicitly before restart/deploy.
2. **Required workflow:** schema change → `bun --cwd backend run migration:generate` → review SQL → commit `backend/drizzle/*` (SQL + `meta/`) → `bun --cwd backend run migration:migrate`.
3. **Adding constraints to existing columns** (e.g., `.unique()`, `.notNull()`) can be destructive. Review generated SQL carefully.
4. **NEVER change a column type in place** (e.g., `varchar` → `text`) without a safe multi-step migration.
5. **NEVER rename columns/tables directly** in schema when data exists; use explicit add/backfill/swap migrations.
6. **If generated SQL truncates or drops data, STOP and ask the user.**
7. **Use multi-step migrations for risky changes:** add nullable column/table first, backfill, then enforce constraints in a follow-up migration.

**SQL migration files in `backend/drizzle/` are the source of truth** and are applied by `migration:migrate`.

### Backend Query Safety (N+1 Prevention)

**Never** call a repository or service method inside `.map()`, `for`, or `forEach` on a list of records in service methods that handle list endpoints. This creates N+1 query patterns that scale linearly with data.

- If a batch method doesn't exist, **create one** (using `IN` / `GROUP BY` / `DISTINCT ON`) before using it in a list context.
- See `docs/development/performance-patterns.md` § "Preventing N+1 Regressions" for patterns and conventions.

## Rules

1. TypeScript, 2-space indent
2. Conventional commits with DCO: `git commit -s -m "feat: ..."`
3. Tests alongside code in `__tests__/` folders
4. **E2E Tests**: Mandatory for significant features. Place in `e2e-tests/` folder.
5. **GitHub CLI**: Use `gh` for all GitHub operations (issues, PRs, actions, releases). Never use browser automation for GitHub tasks.
6. **No shortcuts to avoid best practices.** Never use a non-idiomatic workaround just because the correct approach has a local dev constraint (e.g., an interactive prompt, a manual step, or a one-time migration). Use the proper, idiomatic pattern and handle the constraint explicitly — even if it means asking the user to run a command manually. Hacks that avoid good engineering to save a step are not acceptable.

### Frontend: Read Before Writing Code

Before writing ANY frontend code that fetches data or adds a page, you MUST read these files first:

1. `frontend/docs/state.md` — Decision guide: TanStack Query vs Zustand, hook patterns, anti-patterns
2. `frontend/docs/performance.md` — Stale time tiers, bundle splitting, prefetch patterns, query key architecture
3. `frontend/src/lib/queryKeys.ts` — Existing query key factories (add new keys here, never inline)
4. Browse `frontend/src/hooks/queries/` — Follow existing hook naming conventions (`use<Domain>Queries.ts`)

### Frontend Data Fetching (Mandatory)

6. **All API data must use TanStack Query hooks** in `frontend/src/hooks/queries/`. Never use `useState` + `useEffect` to fetch backend data — this is the single most important frontend rule.
7. **Query keys** go in `frontend/src/lib/queryKeys.ts` (org-scoped, factory functions).
8. **After mutations**, invalidate the relevant query cache via `queryClient.invalidateQueries()` — do not manually update local state.
9. **Derive data** from query results using `useMemo`, not by copying into separate `useState`.
10. **Zustand stores** are for client-only UI state (canvas, timeline, auth). Never store API data in Zustand.

See `frontend/docs/state.md` for patterns, anti-patterns, and the full decision guide.

### Frontend Performance (Mandatory)

See `frontend/docs/performance.md` for the complete reference with code examples.

11. **Every new page must use `React.lazy()`** in `App.tsx`. Add the route to `routePrefetchMap` in `src/lib/prefetch-routes.ts`.
12. **Set `staleTime: Infinity` for static/reference data** (components, templates, providers). The 30s default is wrong for them.
13. **Use `skipToken` for conditional queries** instead of `enabled: false` alone. See `useRunQueries.ts`.
14. **Granular Zustand selectors**: `useStore((s) => s.field)`, never `const store = useStore()`.
15. **No N+1 queries**: never call a query hook inside `.map()`. Use a batched endpoint (see `useMcpGroupsWithServers`).

---

## Architecture

Full details: **`docs/architecture.mdx`**

```
Frontend ←→ Backend ←→ Temporal ←→ Worker
                                      ↓
                            Component Execution
                                      ↓
              Terminal(Redis) | Events(Kafka) | Logs(Loki)
                                      ↓
                          Frontend (SSE/WebSocket)
```

### Component Runners

- **inline** — TypeScript code (HTTP calls, transforms, file ops)
- **docker** — Containers (security tools: Subfinder, DNSX, Nuclei)
- **remote** — External executors (future: K8s, ECS)

### Real-time Streaming

- Terminal: Redis Streams → SSE → xterm.js
- Events: Kafka → WebSocket
- Logs: Loki + PostgreSQL

---

<skills_system priority="1">

<usage>
When tasks match a skill, load it: `cat .claude/skills/<name>/SKILL.md`
</usage>

<available_skills>
<skill>
<name>component-development</name>
<description>Creating components (inline/docker). Dynamic ports, retry policies, PTY patterns, IsolatedContainerVolume.</description>
<location>project</location>
</skill>
<skill>
<name>performance-review</name>
<description>Review code changes for frontend performance anti-patterns. Checks stale times, bundle splitting, Zustand selectors, N+1 queries, and React rendering.</description>
<location>project</location>
</skill>
<skill>
<name>stress-test-frontend</name>
<description>Run a frontend load testing audit. Seeds data, tests all pages via Chrome DevTools MCP, records network calls, TanStack queries, DOM sizes, and generates a timestamped report.</description>
<location>project</location>
</skill>
</available_skills>

</skills_system>
