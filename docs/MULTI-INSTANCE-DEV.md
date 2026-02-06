# Multi-Instance Development (Shared Infra)

ShipSec Studio supports running multiple isolated dev instances (0-9) on one machine.

The key design is:

- **One shared Docker infra stack** (`shipsec-infra`): Postgres, Temporal, Redpanda, Redis, MinIO, Loki, etc.
- **Many app instances** (PM2): `shipsec-{backend,worker,frontend}-N`
- **Isolation comes from namespacing**, not per-instance infra containers:
  - Postgres database: `shipsec_instance_N`
  - Temporal namespace + task queue: `shipsec-dev-N`
  - Kafka topics: `telemetry.*.instance-N` (via `SHIPSEC_INSTANCE`)

## Quick Start

```bash
# First-time setup
just init

# Pick an "active" instance for this workspace (stored in .shipsec-instance)
just instance use 5

# Start the active instance (defaults to 0 if not set)
just dev

# Start a specific instance explicitly
just dev 2 start

# Stop just the active instance
just dev stop

# Stop all instances + shared infra
just dev stop all
```

## Active Instance (Workspace Default)

By default, `just dev` and related commands operate on an **active instance**.

- Set it: `just instance use 5`
- Show it: `just instance show`
- Storage: `.shipsec-instance` (gitignored)
- Override per-shell: set `SHIPSEC_INSTANCE=N` in your environment
- Override per-command: pass an explicit instance number (`just dev 3 ...`)

## Port Map

Instance-scoped (offset by `N * 100`):

| Service  | Base | Instance 0 | Instance 1 | Instance 2 | Instance 5 |
| -------- | ---- | ---------- | ---------- | ---------- | ---------- |
| Frontend | 5173 | 5173       | 5273       | 5373       | 5673       |
| Backend  | 3211 | 3211       | 3311       | 3411       | 3711       |

Shared infra (fixed ports for all instances):

| Service          | Port        |
| ---------------- | ----------- |
| Postgres         | 5433        |
| Temporal         | 7233        |
| Temporal UI      | 8081        |
| Redis            | 6379        |
| Redpanda (Kafka) | 9092        |
| Redpanda Console | 8082        |
| MinIO API/UI     | 9000 / 9001 |
| Loki             | 3100        |

## Commands

### Start / Stop

```bash
# Start active instance
just dev

# Start specific instance
just dev 1 start

# Stop active instance (does NOT stop shared infra)
just dev stop

# Stop a specific instance
just dev 1 stop

# Stop all instances AND shared infra
just dev stop all
```

### Logs / Status

```bash
# Logs/status for active instance
just dev logs
just dev status

# Logs/status for a specific instance
just dev 2 logs
just dev 2 status

# Infra + PM2 overview
just dev status all
```

### Clean (Reset Instance State)

`clean` removes instance-local state and resets its “namespace”:

- Drops/recreates `shipsec_instance_N` and reruns migrations
- Best-effort deletes Temporal namespace `shipsec-dev-N`
- Best-effort deletes Kafka topics `telemetry.*.instance-N`
- Deletes `.instances/instance-N/`

```bash
just dev 0 clean
just dev 5 clean
```

## What Happens When You Run `just dev N start`

1. Ensures `.instances/instance-N/{backend,worker,frontend}.env` exist (copied from root envs).
2. Brings up shared infra once (Docker Compose project `shipsec-infra`).
3. Bootstraps per-instance state:
   - Ensures DB `shipsec_instance_N` exists
   - Runs migrations against that DB
   - Ensures Temporal namespace `shipsec-dev-N` exists
   - Ensures per-instance Kafka topics exist (best-effort)
4. Starts 3 PM2 apps for that instance:
   - `shipsec-backend-N` (port `3211 + N*100`)
   - `shipsec-worker-N` (Temporal namespace/task queue `shipsec-dev-N`)
   - `shipsec-frontend-N` (Vite port `5173 + N*100`, `VITE_API_URL` points at the instance backend)

## Directory Structure

Instance env overrides live in `.instances/` (auto-generated, safe to delete):

```
.instances/
  instance-0/
    backend.env
    worker.env
    frontend.env
  instance-1/
    ...
```

## E2E Tests (Instance-Aware)

E2E tests choose which backend to hit via instance selection:

- `SHIPSEC_INSTANCE` (preferred)
- or `E2E_INSTANCE`
- or the workspace active instance (`.shipsec-instance`)

Run E2E against the active instance:

```bash
bun run test:e2e
```

Run E2E against a specific instance:

```bash
SHIPSEC_INSTANCE=5 bun run test:e2e
```

## Troubleshooting

### Port already in use (frontend/backend)

```bash
lsof -i :3211
lsof -i :5173
```

### Instance is unhealthy but infra is fine

```bash
just dev 5 logs
just dev 5 status
just dev 5 clean
just dev 5 start
```

### Infra conflicts / stuck containers

```bash
just dev stop all
just infra clean
```
