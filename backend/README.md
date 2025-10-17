# ShipSec Backend

## Environment
- Copy `.env.example` to `.env` and adjust values as needed.
- Required variables:
  - `DATABASE_URL` – Postgres connection string (matches the `postgres` service in `docker-compose.yml` by default).
  - `TEMPORAL_ADDRESS` – Temporal server host:port (default `localhost:7233` when running docker compose).
  - `TEMPORAL_NAMESPACE` – Namespace to operate within (default `shipsec-dev`).
  - `TEMPORAL_TASK_QUEUE` – Task queue used for ShipSec workflows (default `shipsec-default`).
  - `TEMPORAL_BOOTSTRAP_DEMO` – Set to `true` to auto-create and run the demo workflow at startup (appears in Temporal UI).
  - `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` – Credentials for the MinIO console/API (`minioadmin` by default).

## Local services
- Run `docker compose up postgres temporal temporal-ui minio` from the repo root to start required infrastructure.
- Ensure the ports `5433`, `7233`, `8081`, `9000`, and `9001` are available before starting the stack.
- Start the API with `bun run dev` (or `bun run start` for production) and run the Temporal worker separately via `bun run worker:dev`.
- With `TEMPORAL_BOOTSTRAP_DEMO=true` the backend seeds a demo workflow and kicks off a run as soon as both the API and worker are online—you can view it in the Temporal UI at `http://localhost:8081`.
