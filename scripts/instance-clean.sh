#!/usr/bin/env bash
# Clean shared infra resources for a specific instance.
# - Drop/recreate instance DB and re-run migrations (reset)
# - Delete Temporal namespace (best-effort)
# - Delete instance-scoped Kafka topics (best-effort)
#
# Usage: ./scripts/instance-clean.sh [instance_number]

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

log_info "Resetting database for instance $INSTANCE..."
if ! ./scripts/db-reset-instance.sh "$INSTANCE" >/dev/null; then
  log_error "Failed to reset database for instance $INSTANCE"
  exit 1
fi
log_success "Database reset complete"

if command -v temporal >/dev/null 2>&1; then
  log_info "Deleting Temporal namespace (best-effort): $NAMESPACE"
  temporal operator namespace delete --address "$TEMPORAL_ADDRESS" --namespace "$NAMESPACE" --yes >/dev/null 2>&1 || true
fi

REDPANDA_CONTAINER="$(
  docker compose -f docker/docker-compose.infra.yml --project-name="$INFRA_PROJECT_NAME" ps -q redpanda 2>/dev/null || true
)"
if [ -n "$REDPANDA_CONTAINER" ]; then
  log_info "Deleting Kafka topics for instance $INSTANCE (best-effort)..."
  for base in telemetry.logs telemetry.events telemetry.agent-trace telemetry.node-io; do
    topic="${base}.instance-${INSTANCE}"
    docker exec "$REDPANDA_CONTAINER" rpk topic delete "$topic" --brokers redpanda:9092 >/dev/null 2>&1 || true
  done
fi

log_success "Instance $INSTANCE infra state cleaned"
