#!/usr/bin/env bash
set -euo pipefail

INSTANCE="${1:-0}"

if ! [[ "$INSTANCE" =~ ^[0-9]+$ ]]; then
  echo "[warn] Skipping local DB ensure: instance must be numeric, got '$INSTANCE'" >&2
  exit 0
fi

DB_NAME="shipsec"
if [ "$INSTANCE" -ne 0 ]; then
  DB_NAME="shipsec_instance_${INSTANCE}"
fi

COMPOSE_FILES=(-f docker/docker-compose.infra.yml)

if ! command -v docker >/dev/null 2>&1; then
  exit 0
fi

if ! docker compose "${COMPOSE_FILES[@]}" ps --status running postgres 2>/dev/null | grep -q '\bpostgres\b'; then
  exit 0
fi

EXISTS="$(
  docker compose "${COMPOSE_FILES[@]}" exec -T postgres \
    psql -U shipsec -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" \
    2>/dev/null | tr -d '[:space:]'
)"

if [ "$EXISTS" = "1" ]; then
  exit 0
fi

echo "🗄️  Creating local compose database '${DB_NAME}'..."
docker compose "${COMPOSE_FILES[@]}" exec -T postgres \
  psql -U shipsec -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE \"${DB_NAME}\" OWNER shipsec;"

