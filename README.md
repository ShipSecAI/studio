# ShipSec Studio – Local Development Guide

This repository powers ShipSec Studio: a Temporal-backed, component-driven workflow platform for offensive security automation. The sections below capture the commands we use every day to run the stack, stream logs safely, and execute tests.

## Prerequisites

- Docker (minimum 8 GB RAM allocated to Docker Desktop or your runtime).
- [Bun](https://bun.sh) and `pm2` installed globally (`npm install -g pm2`).
- `.env` created from `.env.example` with credentials for Temporal, Postgres, MinIO, and Loki.
- Node modules installed: `bun install` at the repo root.

## Bring Up Core Infrastructure

Temporal, Postgres, MinIO, and Loki live in the root `docker-compose.yml`.

```bash
docker compose up -d

# Quick health checks
docker compose ps
curl -f http://localhost:8081/health || echo "Temporal UI not ready yet"
```

## Install bun
`bun install`

## Start API & Worker with PM2

The `pm2.config.cjs` file registers the backend API and Temporal worker processes.

```bash
pm2 start pm2.config.cjs
pm2 status

# Inspect logs without getting stuck in follow mode
timeout 5s pm2 logs backend --lines 50 || true
timeout 5s pm2 logs worker --lines 50 || true
```

> Always wrap `pm2 logs` with `timeout` (or use `--nostream`) so scripts do not hang when tailing output.

To start the frontend :
```sh
cd frontend
bun run dev
```

## Running Tests and Quality Gates

```bash
# Full monorepo tests
bun run test

# Optional targeted suites
bun run --filter backend test
bun run lint
bun run typecheck
# Migration smoke test (runs migrations inside a rollback transaction)
bun --cwd backend run migration:smoke
```

## Shutting Down

```bash
pm2 stop all
docker compose down
# Optional: remove persistent volumes for a clean slate
docker volume ls -q | grep shipsec | xargs -r docker volume rm
```

## Troubleshooting Tips

- **Temporal not reachable**: ensure Docker Desktop is running and `docker compose ps` shows the `temporal` service as `healthy`.
- **PM2 processes crash immediately**: confirm environment variables match the Docker services (Postgres password, Temporal namespace).
- **Logs required for debugging**: use `timeout` with `pm2 logs` so you can bail out automatically in CI scripts.
- **Clean rebuild**: `docker compose down --volumes` followed by `docker compose up -d` gives a pristine Temporal/Postgres cluster.

## Execution Contract

Formal schemas for workflow run status and trace events live in [`docs/execution-contract.md`](docs/execution-contract.md) and are exported via the `@shipsec/shared` package (`packages/shared`). Backend and frontend code should consume the shared Zod schemas instead of redefining enums locally.

For deeper architectural context, see `ARCHITECTURE.md`, `.ai/implementation-plan.md`, and the docs in the `.ai/` folder.
