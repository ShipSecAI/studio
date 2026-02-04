#!/usr/bin/env bash
# Reset database for a specific instance
# Usage: ./scripts/db-reset-instance.sh [instance_number]

set -euo pipefail

INSTANCE=${1:-0}
COMPOSE_PROJECT_NAME="shipsec-dev-$INSTANCE"
DB_NAME="shipsec_instance_$INSTANCE"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
  echo -e "${BLUE}ℹ${NC} $*"
}

log_success() {
  echo -e "${GREEN}✅${NC} $*"
}

log_error() {
  echo -e "${RED}❌${NC} $*"
}

log_info "Resetting database for instance $INSTANCE..."
echo ""

# Find PostgreSQL container
POSTGRES_CONTAINER=$(docker compose -f docker/docker-compose.infra.yml \
  --project-name="$COMPOSE_PROJECT_NAME" \
  ps -q postgres 2>/dev/null || echo "")

if [ -z "$POSTGRES_CONTAINER" ]; then
  log_error "PostgreSQL container not found for instance $INSTANCE"
  log_error "Is the instance running? Try: just dev $INSTANCE start"
  exit 1
fi

log_info "Found PostgreSQL container: $POSTGRES_CONTAINER"

# Drop and recreate database
log_info "Dropping database $DB_NAME..."
docker exec "$POSTGRES_CONTAINER" \
  psql -v ON_ERROR_STOP=1 -U shipsec -d postgres \
  -c "DROP DATABASE IF EXISTS \"$DB_NAME\";" || true

log_info "Creating database $DB_NAME..."
docker exec "$POSTGRES_CONTAINER" \
  psql -v ON_ERROR_STOP=1 -U shipsec -d postgres \
  -c "CREATE DATABASE \"$DB_NAME\" OWNER shipsec; GRANT ALL PRIVILEGES ON DATABASE \"$DB_NAME\" TO shipsec;"

# Run migrations
log_info "Running migrations for instance $INSTANCE..."
export SHIPSEC_INSTANCE="$INSTANCE"
export DATABASE_URL="postgresql://shipsec:shipsec@localhost:$(( 5433 + INSTANCE * 100 ))/$DB_NAME"

if bun --cwd backend run migration:push > /dev/null 2>&1; then
  log_success "Migrations completed"
else
  log_error "Migrations failed"
  log_error "Check backend logs: just dev $INSTANCE logs"
  exit 1
fi

echo ""
log_success "Database reset for instance $INSTANCE"
log_info "Database: $DB_NAME"
log_info "Connection: postgresql://shipsec:shipsec@localhost:$(( 5433 + INSTANCE * 100 ))/$DB_NAME"
