# ShipSec Studio – Local Development Guide

This repository powers ShipSec Studio: a Temporal-backed, component-driven workflow platform for offensive security automation. The sections below capture the commands we use every day to run the stack, stream logs safely, and execute tests.

## Documentation Map
- `docs/guide.md` – Table of contents for architecture docs, package guides, and `.ai` decision logs.
- `frontend/README.md` – Frontend-specific workflow (with deeper dives in `frontend/docs/*`).
- `docs/execution-contract.md` – Canonical schemas for workflow runs and trace streaming. Update this first when contracts change.
- `docs/analytics.md` – Frontend analytics (PostHog) setup, gating, and troubleshooting.
- `.github/pull_request_template.md` – Checklist reminding you to keep docs in sync with code changes.

## Prerequisites

Before starting, ensure you have:

- **Docker** (minimum 8 GB RAM allocated to Docker Desktop)
- **Bun** runtime ([install here](https://bun.sh))
- **PM2** process manager: `npm install -g pm2`
- **Just** command runner: `sudo pacman -S just` (Arch) or `brew install just` (macOS)
- Ports `5433`, `7233`, `8081`, `9000`, `9001`, and `3100` available

## Docker Setup (Quick Start)

**Infrastructure Only (Recommended for Development):**
```bash
just infra-up     # Start PostgreSQL, Temporal, MinIO, Loki
just infra-down   # Stop infrastructure
just infra-logs   # View logs
```

**Full Docker Setup:**
```bash
just up           # Start everything in Docker
just down         # Stop all containers
just logs         # View all logs
```

**Services Available:**
- PostgreSQL: localhost:5433
- Temporal: localhost:7233
- Temporal UI: http://localhost:8081
- MinIO: http://localhost:9000 (minioadmin/minioadmin)
- MinIO Console: http://localhost:9001
- Loki: http://localhost:3100

Optional analytics in Docker:
- When using `docker/docker-compose.full.yml`, you can pass PostHog vars via shell export or a `.env` file next to the compose:
  - `VITE_PUBLIC_POSTHOG_KEY`
  - `VITE_PUBLIC_POSTHOG_HOST`
  If unset, the frontend disables analytics automatically.

## Initial Setup (First Time Only)

Follow these steps in order when setting up the project for the first time:

### 1. Install Dependencies

```bash
bun install
```

### 2. Configure Environment Variables

Create `.env` files from examples:

```bash
# Backend environment
cp backend/.env.example backend/.env

# Worker environment
cp worker/.env.example worker/.env

# Frontend environment
cp frontend/.env.example frontend/.env
```

Adjust values in the `.env` files if needed (defaults work for local development).

Optional (analytics in dev): add to `frontend/.env` if you want PostHog enabled locally. Without these, analytics remains disabled.

```
VITE_PUBLIC_POSTHOG_KEY=phc_...
VITE_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com   # or your self-hosted URL
```

### 3. Start Docker Infrastructure

```bash
just infra-up     # Start Postgres, Temporal, MinIO, and Loki
just status       # Verify all services are healthy
```

### 4. Apply Database Migrations

```bash
bun run migrate
```

This creates the required Postgres schema for the backend.

> **Note**: The migration command uses the `DATABASE_URL` from `backend/.env`, which is automatically loaded by the migration script.

---

## Daily Development

For regular development after initial setup:

### 1. Start Docker Services

```bash
just infra-up     # Start infrastructure
just status       # Verify services are running
```

### 2. Start Backend & Worker

```bash
pm2 start pm2.config.cjs
pm2 status

# Check logs (use timeout to avoid hanging)
timeout 5s pm2 logs backend --lines 50 || true
timeout 5s pm2 logs worker --lines 50 || true
```

> **Note**: The backend automatically runs migrations on startup, but you can run `bun run migrate` manually after pulling schema changes.
> **SWC tip**: The PM2 config now resolves the native `@swc/core` binary dynamically. If you see a warning about the resolver, confirm the optional platform package installed correctly (`bun install` on the target host).

### 3. Start Frontend

```bash
cd frontend
bun run dev
```

The application will be available at:
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3211
- **Temporal UI**: http://localhost:8081
- **MinIO Console**: http://localhost:9001

---

## One-Command Dev Stack

Prefer a single command? Run the entire development stack—Docker services, backend + worker, and the Vite dev server—via PM2:

```bash
# Start Temporal/Postgres/MinIO/Loki, backend, worker, and frontend dev server
bun run dev:stack
```

The script performs the following steps:

1. `docker compose -p shipsec up -d` to bring up Temporal, Postgres, MinIO, and Loki.
2. `pm2 startOrReload pm2.config.cjs` to launch:
   - `shipsec-backend` (Bun dev server for the API),
   - `shipsec-worker` (Temporal worker, default task queue),
   - `shipsec-frontend` (Vite dev server).
3. `pm2 logs shipsec-frontend` streams the frontend output for live iteration. Press `Ctrl+C` to stop tailing; PM2 keeps the apps running in the background.

### Stopping the stack

```bash
bun run dev:stack:stop
```

This shuts down the PM2 apps (backend, worker, frontend) and runs `docker compose -p shipsec down`.

### Inspecting status or additional logs

```bash
pm2 status
pm2 logs shipsec-backend
pm2 logs shipsec-worker
```
## Running Tests and Quality Gates

```bash
# Full monorepo tests
bun run test

# Targeted test suites
bun run --filter backend test
bun run --filter worker test

# Code quality checks
bun run lint
bun run typecheck

# Migration smoke test (runs migrations inside a rollback transaction)
bun --cwd backend run migration:smoke
```

## Documentation Updates
Treat docs like code:
- Touch the closest guide whenever behaviour or APIs change (e.g., update `frontend/docs/state.md` when store contracts shift).
- Reflect new or relocated docs in `docs/guide.md` so other teams can find them.
- Note the documentation work (or why none was needed) in the PR template—this keeps the history useful for humans and automation.
- Optional: run a Markdown linter if you have one locally; otherwise keep formatting consistent with existing files.

---

## Shutting Down

```bash
# Stop application processes
pm2 stop all

# Stop Docker services
docker compose -p shipsec down

# Optional: Remove persistent volumes for a clean slate
docker compose -p shipsec down --volumes
```

> **Note**: After `docker compose down --volumes`, you'll need to re-run the Temporal namespace setup (step 4 in Initial Setup).

---

## Troubleshooting Tips

### Temporal Namespace Not Found Error

If you see `Namespace shipsec-dev is not found`:

```bash
# Re-run the one-time setup
docker compose -p shipsec --profile setup up -d
```

### Temporal Not Reachable

Ensure Docker is running and Temporal is healthy:

```bash
docker compose -p shipsec ps
# Look for "healthy" status on the temporal service
```

### PM2 Processes Crash Immediately

1. Check environment variables match Docker services (Postgres password, Temporal namespace)
2. Ensure Temporal namespace exists: `docker logs shipsec-temporal-setup`
3. Verify migrations have run: `bun run migrate`

### Database Schema Incomplete

The migration guard detected missing tables:

```bash
bun run migrate
pm2 restart all
```

### Clean Rebuild

For a completely fresh start:

```bash
# Stop everything
pm2 stop all
docker compose -p shipsec down --volumes

# Remove all ShipSec volumes
docker volume ls -q | grep shipsec | xargs -r docker volume rm

# Start from scratch
docker compose -p shipsec up -d
docker compose -p shipsec --profile setup up -d
bun run migrate
pm2 start pm2.config.cjs
```

---

## Additional Resources

- **Execution Contract**: Formal schemas for workflow run status and trace events live in [`docs/execution-contract.md`](docs/execution-contract.md)
- **Shared Types**: The `@shipsec/shared` package (`packages/shared`) exports Zod schemas used by backend and frontend
- **Architecture**: See `ARCHITECTURE.md`, `.ai/implementation-plan.md`, and docs in the `.ai/` folder for deeper context
