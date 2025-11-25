# ShipSec Studio

> The execution studio for security teams. Design reusable reconnaissance workflows, see every run unfold live, and keep humans in the loop with opinionated guardrails.

![Security Automation](https://img.shields.io/badge/Security-Automation-orange)
![Live Observability](https://img.shields.io/badge/Live-Observability-blue)
![Component Catalog](https://img.shields.io/badge/Component-Catalog-4CAF50)

ShipSec Studio bundles everything you need to design security workflows: a visual builder for automation graphs, a typed API for orchestration, and a worker tier that executes components inside guarded containers.

---

## Product Tour

| Workflow Builder | Live Execution Timeline | Secrets & Integrations |
| --- | --- | --- |
| ![Workflow Builder](docs/media/workflow-sample.png) | ![Execution Timeline](docs/media/workflow-execution.png) | ![Secrets & Integrations](docs/media/secret-manager.png) |

| Connections Catalog | Org Dashboard |
| --- | --- |
| ![Connections Catalog](docs/media/connections-screen.png) | ![Org Dashboard](docs/media/dashboard.png) |

> 📸 Gallery assets live under `docs/media/`. Replace the existing `workflow-sample.png`, `workflow-execution.png`, `secret-manager.png`, `connections-screen.png`, or `dashboard.png` files to refresh the screenshots without editing the README.

---

## Table of Contents

- [Why ShipSec Studio?](#why-shipsec-studio)
- [Architecture at a Glance](#architecture-at-a-glance)
- [Quick Start](#quick-start)
- [Operating the Stack](#operating-the-stack)
- [Running Tests & Quality Gates](#running-tests--quality-gates)
- [Observability & Analytics](#observability--analytics)
- [Documentation Map](#documentation-map)
- [Troubleshooting](#troubleshooting)
- [Contributing & Support](#contributing--support)

---

## Why ShipSec Studio?

- **Component-driven orchestration** – Drag-and-drop vetted discovery, DNS, HTTP, and enrichment components or wire in custom activities through the ShipSec SDK.
- **Temporal reliability** – Every workflow run becomes a `shipsec-run-*` Temporal execution with retries, heartbeats, and resumability baked in.
- **Live execution visibility** – Runs stream structured traces, Loki-backed logs, and per-node progress to the canvas in real time.
- **Team-ready guardrails** – Secrets live behind Clerk-gated orgs, analytics respect privacy defaults, and every contract is enforced via shared Zod schemas.
- **Single-machine friendly** – Docker Compose, PM2, and Bun keep the full stack runnable on a laptop while remaining production-faithful.

---

## Architecture at a Glance

ShipSec Studio is a Bun workspace with four top-level apps plus shared packages.

```
studio-main/
├─ frontend/   # React + Vite execution studio
├─ backend/    # NestJS API, Temporal client, Loki bridge
├─ worker/     # Temporal workers + security tool runners
├─ packages/   # Shared SDKs and Zod contracts (@shipsec/shared, etc.)
└─ docs/ & .ai/ # Specs, runbooks, implementation plans
```

### Module responsibilities

- **Frontend (`frontend/src/features`)** – Workflow builder, execution timeline, and observability views powered by Zustand stores.
- **Backend (`backend/src/modules`)** – REST + SSE surface for workflows, trace streaming, and metadata. Schema lives in `backend/src/db`.
- **Worker (`worker/src/temporal`)** – Activity runners that wrap ProjectDiscovery tools (dnsx, katana, etc.) with consistent JSON contracts.
- **Shared packages (`packages/*`)** – Zod schemas, SDK helpers, and component manifests consumed across tiers.
- **Docs & runbooks (`docs`, `.ai/`)** – Execution contracts, observability roadmap, and incident notes. Update them when behaviour changes.

---

## Quick Start

### Prerequisites

- Docker Desktop with ≥8 GB RAM
- Bun runtime ([bun.sh](https://bun.sh))
- PM2 (`npm install -g pm2`)
- `just` command runner (`brew install just` or `sudo pacman -S just`)
- Open ports: `5433`, `7233`, `8081`, `9000`, `9001`, `3100`

### 1. Clone & install dependencies

```bash
./install.sh
```

> **macOS users:** The install script automatically handles SDK path configuration for native module compilation. If you prefer to run `bun install` directly, set `export SDKROOT=$(xcrun --show-sdk-path)` first.

### 2. Configure environment variables

```bash
cp backend/.env.example backend/.env
cp worker/.env.example worker/.env
cp frontend/.env.example frontend/.env
```

Optional PostHog analytics in dev:

```
VITE_PUBLIC_POSTHOG_KEY=phc_...
VITE_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

### 3. Bring up the shared infrastructure

```bash
just infra-up     # Postgres, Temporal, MinIO, Loki
just status       # Health check
```

### 4. Run migrations

```bash
bun run migrate
```

### 5. Start backend, worker, and frontend

```bash
pm2 start pm2.config.cjs
pm2 status

timeout 5s pm2 logs backend --lines 50 || true
timeout 5s pm2 logs worker --lines 50 || true
```

Frontends can either run through PM2 (see `pm2.config.cjs`) or directly via Vite:

```bash
bun --cwd frontend dev
```

Default endpoints:
- Frontend builder → http://localhost:5173
- Backend API → http://localhost:3211
- Temporal UI → http://localhost:8081
- MinIO console → http://localhost:9001

> The backend also runs migrations on boot, but `bun run migrate` keeps your schema honest after pulling changes.

---

## Operating the Stack

### Docker workflow

```bash
just infra-up     # Infra only (recommended)
just infra-down
just infra-logs
```

Full containerized stack (services + apps):

```bash
just up
just down
just logs
```

Services map

- PostgreSQL → `localhost:5433`
- Temporal gRPC → `localhost:7233`
- Temporal UI → `http://localhost:8081`
- MinIO → `http://localhost:9000` (`minioadmin/minioadmin`)
- MinIO Console → `http://localhost:9001`
- Loki → `http://localhost:3100`

### Local PM2 stack

```bash
pm2 startOrReload pm2.config.cjs
pm2 logs shipsec-frontend
pm2 logs shipsec-backend
pm2 logs shipsec-worker
```

### One-command dev stack

Prefer a single entrypoint that runs Docker infra, backend, worker, and the Vite dev server? Use the orchestrated script:

```bash
bun run dev:stack
```

It performs three steps for you:
1. `docker compose -p shipsec up -d` to ensure Temporal, Postgres, MinIO, and Loki are available.
2. `pm2 startOrReload pm2.config.cjs` to boot `shipsec-backend`, `shipsec-worker`, and `shipsec-frontend`.
3. `pm2 logs shipsec-frontend` to stream builder output (press `Ctrl+C` to detach without stopping the processes).

### Stopping the stack

```bash
bun run dev:stack:stop      # Stops PM2 apps + docker compose -p shipsec down
```

Manual shutdown:

```bash
pm2 stop all
docker compose -p shipsec down
```

Add `--volumes` to wipe data, then rerun migrations + Temporal namespace setup.

### Logs & telemetry

- Use `timeout 5s pm2 logs <process> --lines 50` to avoid stuck tails.
- Loki is pre-wired; point Grafana or scripts at `http://localhost:3100` with the `shipsec` tenant.

---

## Running Tests & Quality Gates

```bash
bun run test                     # Monorepo tests
bun run --filter backend test    # Backend focus
bun run --filter worker test     # Worker focus
bun run lint                     # ESLint + Prettier
bun run typecheck                # tsc project references
bun --cwd backend run migration:smoke   # Migration guard
```

Backend integration suites (Temporal + Postgres) require the docker infra and can be toggled with `RUN_BACKEND_INTEGRATION=true`.

---

## Observability & Analytics

- Contracts live in [`docs/execution-contract.md`](docs/execution-contract.md) and `@shipsec/shared`. Update both when payloads change.
- `.ai/implementation-plan.md` tracks the observability roadmap (Phases 0–8) with status notes.
- `.ai/visual-execution-notes.md` captures live tracing learnings and UI expectations.
- Loki pipelines (Phase 5) and live trace streaming (Phase 6) are already shipped—preserve their schemas when extending functionality.
- Frontend analytics are opt-in. Set `VITE_PUBLIC_POSTHOG_KEY`/`HOST` to enable typed events listed in `docs/analytics.md`.

---

## Documentation Map

- `docs/guide.md` – master index of architecture docs and `.ai` decision logs.
- `docs/execution-contract.md` – canonical workflow + trace schemas.
- `docs/analytics.md` – PostHog setup, env gating, troubleshooting.
- `frontend/README.md` – builder-specific workflows and Tailwind conventions.
- `.ai/implementation-plan.md` – multi-phase observability plan (current status: Phases 5–7 ✅, Phase 8 planned).
- `.ai/*` – component SDK notes, temporal worker architecture, runbooks, differentiators.

Treat docs like code: update the closest guide whenever behaviour changes and note the doc work (or why none was needed) in PRs.

---

## Troubleshooting

### macOS: Native module build errors

If you encounter errors about missing C++ headers (`'memory' file not found`) during `bun install`:

```bash
export SDKROOT=$(xcrun --show-sdk-path)
bun install
```

Or use the provided install script which handles this automatically:

```bash
./install.sh
```

### Temporal namespace missing

```bash
docker compose -p shipsec --profile setup up -d
```

### Temporal not reachable

```bash
docker compose -p shipsec ps   # Expect "healthy" Temporal containers
```

### PM2 process crash

1. Verify `.env` values match Docker services.
2. Ensure Temporal namespace exists (`docker logs shipsec-temporal-setup`).
3. Re-run migrations (`bun run migrate`) and restart PM2.

### Database schema drift

```bash
bun run migrate
pm2 restart all
```

### Clean rebuild

```bash
pm2 stop all
docker compose -p shipsec down --volumes
docker volume ls -q | grep shipsec | xargs -r docker volume rm

just infra-up
bun run migrate
pm2 start pm2.config.cjs
```

---

## Contributing & Support

- Follow Conventional Commit subjects (`feat:`, `fix:`, `docs:`) and reference issues/milestones in PRs.
- Run `bun run test`, `bun run lint`, and `bun run typecheck` before opening a PR; mention any intentional gaps.
- Keep workflow IDs in the `shipsec-run-*` shape and reuse shared schemas instead of bespoke types.
- For new workflows or contract changes, validate against `docs/execution-contract.md`, add fixtures, and document manual validation (Temporal run IDs, Loki queries) in the PR description.
- Need help? Start with `docs/guide.md`, `.ai/visual-execution-notes.md`, or open a discussion/issue referencing the relevant module.

Bring your own creativity—ShipSec Studio is built to be extended.
