#!/bin/bash
# Create additional PostgreSQL databases required by ShipSec
# This script is run automatically by PostgreSQL init-entrypoint
#
# Creates:
#   - temporal: Required by Temporal workflow engine
#   - shipsec_instance_0..9: Multi-instance dev databases

set -e

# --- Temporal database (required for workflow engine) ---
echo "🗄️  Creating Temporal database..."
if psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" -d postgres -lqt | cut -d \| -f 1 | grep -qw "temporal"; then
  echo "  Database temporal already exists, skipping..."
else
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" -d postgres <<-EOSQL
    CREATE DATABASE temporal OWNER "$POSTGRES_USER";
    GRANT ALL PRIVILEGES ON DATABASE temporal TO "$POSTGRES_USER";
EOSQL
  echo "  ✅ temporal created"
fi

# --- Instance-specific databases (for multi-instance dev) ---
echo "🗄️  Creating instance-specific databases..."
for i in {0..9}; do
  DB_NAME="shipsec_instance_$i"

  if psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" -d postgres -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
    echo "  Database $DB_NAME already exists, skipping..."
  else
    echo "  Creating $DB_NAME..."
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" -d postgres <<-EOSQL
      CREATE DATABASE "$DB_NAME" OWNER "$POSTGRES_USER";
      GRANT ALL PRIVILEGES ON DATABASE "$DB_NAME" TO "$POSTGRES_USER";
EOSQL
  fi
done

echo "✅ All databases created successfully"
