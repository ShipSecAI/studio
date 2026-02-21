# Multi-Instance Development (Shared Infra)

ShipSec Studio supports running multiple isolated dev instances (0-9) on one machine.

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

- **One shared Docker infra stack**: Postgres, Temporal, Redpanda, Redis, MinIO, etc.
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

Use `just instance-env` to manage them:

```bash
# Create env files for an instance (uses app/.env, or falls back to app/.env.example)
just instance-env init 2

# Re-apply only instance-scoped values (ports, DB, Temporal namespace)
just instance-env update 2

# Copy env files between instances and rescope values
just instance-env copy 2 5

# Show file presence + computed values
just instance-env show 5
```

`just dev` auto-initializes env files for the active instance when missing (without overwriting existing files).

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
| Redpanda (Kafka) | 19092       |
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

## E2E Tests (Instance-Aware)

E2E tests use the same instance resolution to pick the right backend port:

```bash
# Against the active instance
bun run test:e2e

# Against a specific instance
SHIPSEC_INSTANCE=2 bun run test:e2e
```

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
