#!/usr/bin/env bash
# Bootstrap shared infra resources for a specific instance.
# - Ensure instance DB exists
# - Run migrations against that DB
# - Ensure Temporal namespace exists
# - Ensure Kafka topics exist (best-effort)
#
# Usage: ./scripts/instance-bootstrap.sh [instance_number]

set -euo pipefail

INSTANCE="${1:-0}"
INFRA_PROJECT_NAME="shipsec-infra"
DB_NAME="shipsec_instance_${INSTANCE}"
NAMESPACE="shipsec-dev-${INSTANCE}"
TEMPORAL_ADDRESS="127.0.0.1:7233"

BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

log_info() { echo -e "${BLUE}ℹ${NC} $*"; }
log_success() { echo -e "${GREEN}✅${NC} $*"; }
log_error() { echo -e "${RED}❌${NC} $*"; }

POSTGRES_CONTAINER="$(
  docker compose -f docker/docker-compose.infra.yml --project-name="$INFRA_PROJECT_NAME" ps -q postgres 2>/dev/null || true
)"

if [ -z "$POSTGRES_CONTAINER" ]; then
  log_error "Postgres container not found (infra project: $INFRA_PROJECT_NAME). Is infra running?"
  exit 1
fi

log_info "Ensuring database exists: $DB_NAME"
docker exec "$POSTGRES_CONTAINER" \
  psql -v ON_ERROR_STOP=1 -U shipsec -d postgres <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}') THEN
    CREATE DATABASE "${DB_NAME}" OWNER shipsec;
    GRANT ALL PRIVILEGES ON DATABASE "${DB_NAME}" TO shipsec;
  END IF;
END
\$\$;
SQL

log_info "Running migrations for instance $INSTANCE..."
export SHIPSEC_INSTANCE="$INSTANCE"
export DATABASE_URL="postgresql://shipsec:shipsec@localhost:5433/${DB_NAME}"
if bun --cwd backend run migration:push >/dev/null 2>&1; then
  log_success "Migrations completed"
else
  log_error "Migrations failed"
  exit 1
fi

if ! command -v temporal >/dev/null 2>&1; then
  log_info "temporal CLI not found; skipping Temporal namespace bootstrap"
else
  log_info "Ensuring Temporal namespace exists: $NAMESPACE"
  if temporal operator namespace describe --address "$TEMPORAL_ADDRESS" --namespace "$NAMESPACE" >/dev/null 2>&1; then
    log_success "Temporal namespace exists"
  else
    temporal operator namespace create --address "$TEMPORAL_ADDRESS" --namespace "$NAMESPACE" --retention 72h >/dev/null
    log_success "Temporal namespace created"
  fi
fi

# Best-effort Kafka topic creation in shared Redpanda.
REDPANDA_CONTAINER="$(
  docker compose -f docker/docker-compose.infra.yml --project-name="$INFRA_PROJECT_NAME" ps -q redpanda 2>/dev/null || true
)"
if [ -n "$REDPANDA_CONTAINER" ]; then
  log_info "Ensuring Kafka topics exist for instance $INSTANCE (best-effort)..."
  for base in telemetry.logs telemetry.events telemetry.agent-trace telemetry.node-io; do
    topic="${base}.instance-${INSTANCE}"
    docker exec "$REDPANDA_CONTAINER" rpk topic create "$topic" --brokers redpanda:9092 >/dev/null 2>&1 || true
  done
  log_success "Kafka topics ensured"
fi

