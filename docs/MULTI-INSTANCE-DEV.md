# Multi-Instance Development (Shared Infra)

ShipSec Studio supports running multiple isolated dev instances (0-9) on one machine.

The key design is:

- **One shared Docker infra stack** (`shipsec-infra`): Postgres, Temporal, Redpanda, Redis, MinIO, Loki, LiteLLM, etc.
- **Many app instances** (PM2): `shipsec-{backend,worker,frontend}-N`
- **Isolation comes from namespacing**, not per-instance infra containers:
  - Postgres database: `shipsec_instance_N`
  - Temporal namespace + task queue: `shipsec-dev-N`
  - Kafka topics: `telemetry.*.instance-N` (via `SHIPSEC_INSTANCE`)
  - Backend Kafka consumer groups/client IDs: `...-N` suffixes (for log/event/node-io/agent-trace ingestors)

## Quick Start

```bash
# Instance 0 (default) — works exactly as before
just dev

# Check active instance for this workspace
just instance show

# Persist instance 1 for this workspace
just instance use 1
just dev          # now starts instance 1

# Stop your instance
just dev stop
```

## How It Works

- **One shared Docker infra stack**: Postgres, Temporal, Redpanda, Redis, MinIO, LiteLLM, etc.
- **Many app instances** via PM2: `shipsec-{backend,worker,frontend}-N`
- **Isolation via namespacing**, not per-instance containers:
  - Postgres database: `shipsec_instance_N`
  - Temporal namespace + task queue: `shipsec-dev-N`
  - Kafka client/group IDs: `shipsec-*-N`

## Selecting an Instance

The instance is resolved in this order:

1. `SHIPSEC_INSTANCE` environment variable (highest priority)
2. `.shipsec-instance` file in repo root (gitignored)
3. Defaults to `0`

```bash
# Per-command
SHIPSEC_INSTANCE=2 just dev

# Per-workspace (persistent)
just instance use 2
just dev
```

## Instance Env Files

PM2 can read per-instance env files from:

- `.instances/instance-N/backend.env`
- `.instances/instance-N/worker.env`
- `.instances/instance-N/frontend.env`

Instance frontend env files explicitly set `VITE_API_URL=""` so the Vite dev-server proxy can keep `/api/v1/*` on the matching instance backend instead of hard-coding instance `0`'s backend port.

Use `just instance-env` to manage them:

```bash
# Create env files for an instance (uses app/.env, or falls back to app/.env.example)
just instance-env init 2

# Re-apply only instance-scoped values (ports, DB, Temporal namespace, worker BACKEND_URL)
just instance-env update 2

# Copy env files between instances and rescope values
just instance-env copy 2 5

# Show file presence + computed values
just instance-env show 5
```

`just dev` auto-initializes env files for the active instance when missing (without overwriting existing files).

## Environment Configuration

Each service has its own `.env` file created from its `.env.example` template:

| File            | Service           | Created by                                   |
| --------------- | ----------------- | -------------------------------------------- |
| `backend/.env`  | Backend (NestJS)  | `just init` → copies `backend/.env.example`  |
| `worker/.env`   | Worker (Temporal) | `just init` → copies `worker/.env.example`   |
| `frontend/.env` | Frontend (Vite)   | `just init` → copies `frontend/.env.example` |

**There is no root `.env` for shared config.** If a root `.env` exists it is a leftover and can be deleted — nothing reads it. PM2 loads each service's own `.env` via `env_file` (see `pm2.config.cjs`).

For first-time environment setup (which variables to fill in), see the [Development Setup section in README.md](../README.md#-development-setup).

### Env loading order

1. **PM2** reads the service's `.env` file (or per-instance override from `.instances/instance-N/`)
2. **PM2 `env:` block** overrides specific values (Temporal namespace, Kafka client IDs, ports — all instance-scoped)
3. **Zod schema** validates and applies defaults for any unset optional vars

### Variables that must match across services

These variables appear in both `backend/.env` and `worker/.env` and **must have identical values** — they share the same database, encryption keys, and infrastructure:

| Variable                           | Why it must match                                  |
| ---------------------------------- | -------------------------------------------------- |
| `SECRET_STORE_MASTER_KEY`          | Same encryption key for secrets in shared Postgres |
| `DATABASE_URL`                     | Same database (PM2 overrides per-instance DB name) |
| `LOG_KAFKA_BROKERS`                | Same Kafka cluster                                 |
| `OPENSEARCH_URL`                   | Same OpenSearch cluster (if enabled)               |
| `OPENSEARCH_USERNAME` / `PASSWORD` | Same OpenSearch credentials                        |

### Env vars with auto-defaults (safe to omit)

These are set by PM2 or have schema defaults — you don't need them in `.env` files:

| Variable              | Default                           | Set by                |
| --------------------- | --------------------------------- | --------------------- |
| `TEMPORAL_ADDRESS`    | `localhost:7233`                  | PM2 + schema          |
| `TEMPORAL_NAMESPACE`  | `shipsec-dev-N`                   | PM2 (instance-scoped) |
| `TEMPORAL_TASK_QUEUE` | `shipsec-dev-N`                   | PM2 (instance-scoped) |
| `PORT`                | `3211 + N*100`                    | PM2 (instance-scoped) |
| `BACKEND_URL`         | `http://localhost:(3211 + N*100)` | PM2/script (worker)   |
| `MINIO_*`             | `localhost` / `minioadmin`        | Schema defaults       |
| `LOG_KAFKA_CLIENT_ID` | `shipsec-backend-N`               | PM2 (instance-scoped) |
| `LOG_KAFKA_GROUP_ID`  | `shipsec-*-N`                     | PM2 (instance-scoped) |

### Production vs local dev

| Concern              | Local dev                | Production                                              |
| -------------------- | ------------------------ | ------------------------------------------------------- |
| Orchestrator         | PM2 (`pm2.config.cjs`)   | Docker Compose (`docker-compose.full.yml`)              |
| Env source           | `{service}/.env` files   | Inline `environment:` in Compose                        |
| Service addresses    | `localhost:PORT`         | Docker service names (`temporal:7233`, `redpanda:9092`) |
| Temporal namespace   | `shipsec-dev-N`          | `shipsec-prod`                                          |
| `.env.example` files | Template for `just init` | Not used                                                |

## Port Map

Ports are offset by `N * 100`:

| Service  | Base | Instance 0 | Instance 1 | Instance 2 | Instance 5 |
| -------- | ---- | ---------- | ---------- | ---------- | ---------- |
| Frontend | 5173 | 5173       | 5273       | 5373       | 5673       |
| Backend  | 3211 | 3211       | 3311       | 3411       | 3711       |

Shared infra (fixed ports, same for all instances):

| Service          | Port        |
| ---------------- | ----------- |
| Postgres         | 5433        |
| Temporal         | 7233        |
| Temporal UI      | 8081        |
| Redis            | 6379        |
| LiteLLM          | 4001        |
| Redpanda (Kafka) | 9092        |
| Redpanda Console | 8082        |
| MinIO API/UI     | 9000 / 9001 |
| Loki             | 3100        |

## Nginx Limitation

The nginx reverse proxy (`http://localhost`) always routes to **instance 0** (ports 5173/3211 are hardcoded in `docker/nginx/nginx.dev.conf`). This is by design — nginx is shared infra.

For non-zero instances, access your app directly:

```
# Instance 1
http://localhost:5273        # frontend
http://localhost:3311/api    # backend API
```

The Vite dev server proxies `/api` calls to the correct backend port automatically (computed from `SHIPSEC_INSTANCE` in `vite.config.ts`).

## Commands

All commands respect `SHIPSEC_INSTANCE` (or the active instance selected by `just instance use N`):

```bash
# Select instance once per workspace
just instance use 1

# Start
just dev

# Stop (only stops PM2 apps; infra stays running for other instances)
just dev stop

# Logs (filtered to your instance's PM2 apps)
just dev logs

# Status
just dev status

# Clean (stops PM2 apps; only tears down infra if instance 0)
just dev clean

# One-off override without changing active workspace instance
SHIPSEC_INSTANCE=3 just dev
```

When stopping/cleaning instance 0, Docker infra is also torn down. For non-zero instances, only the PM2 apps are stopped (since other instances may still need the shared infra).

## Database Migrations

Use generated SQL migrations, not schema push:

```bash
# Generate SQL after schema edits (review + commit backend/drizzle/*)
bun --cwd backend run migration:generate

# Apply committed migrations
bun --cwd backend run migration:migrate

# Root alias
bun run migrate
```

## E2E Tests (Instance-Aware)

E2E tests use the same instance resolution to pick the right backend port:

```bash
# Against the active instance
bun run test:e2e

# Against a specific instance
SHIPSEC_INSTANCE=2 bun run test:e2e
```

## Environment Validation

`just dev` runs pre-flight environment validation before starting PM2. Each service's `.env` file is checked against its Zod schema:

```
✅  Backend environment OK
✅  Worker environment OK
✅  Frontend environment OK
```

If any required variable is missing or malformed, startup aborts with a clear error pointing to the relevant `.env.example` file. The validation scripts live at:

- `backend/scripts/validate-env.ts`
- `worker/scripts/validate-env.ts`
- `frontend/scripts/validate-env.ts`

### .env Gotchas

**Instance-aware DATABASE_URL**: PM2 creates per-instance databases named `shipsec_instance_N`. Your `backend/.env` and `worker/.env` must use this naming (e.g., `shipsec_instance_0`), not the bare `shipsec` database. The `.env.example` files reflect this.

**No root `.env`**: Do not use a root `.env` for shared config. Each service reads only its own `.env` file via PM2's `env_file`. If a root `.env` exists, it is ignored by PM2 (Vite may read it as a fallback, but `frontend/.env` takes precedence).

**No inline comments in .env**: PM2's env loader strips inline comments for unquoted values (e.g., `KEY=value # comment`), but some tools do not. Avoid inline comments entirely — use a full-line comment above the variable instead.

**Chat AI variables**: The worker requires `CHAT_AI_BASE_URL`, `CHAT_AI_API_KEY`, `CHAT_AI_MODEL_ID`, and `CHAT_AI_PROVIDER` for the chat feature. See `worker/.env.example` for reference values.

**LiteLLM variables**: Shared infra now includes a LiteLLM proxy on `http://localhost:4001` (via `docker-compose.dev-ports.yml`). To route local Chat AI through the proxy, set `LITELLM_PROXY_URL` / `LITELLM_MASTER_KEY` in backend env and `LITELLM_BASE_URL` / `LITELLM_API_KEY` in worker env. The default repo config exposes `gpt-5.4` and `openai/gpt-5.4` aliases, routing upstream to vibeproxy while using OpenAI GPT-5 pricing metadata for local billing tests. If your local LiteLLM build does not include the enterprise `/global/spend/report` endpoint, set `LITELLM_ALLOW_TEAM_INFO_SPEND_FALLBACK=true` in backend env to make the billing page use cumulative `/team/info` spend for the current month during local testing.

## Troubleshooting

### Port already in use

```bash
# Check which process is using the port
lsof -i :5273   # frontend instance 1
lsof -i :3311   # backend instance 1
```

### Instance is unhealthy but infra is fine

```bash
just instance use 1
just dev logs
just dev stop
just dev
```

### Infra conflicts / stuck containers

```bash
just dev stop    # stops instance 0 + infra
just infra clean
```
