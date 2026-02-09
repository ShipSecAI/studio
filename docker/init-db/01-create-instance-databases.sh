#!/bin/bash
# Create instance-specific PostgreSQL databases
# This script is run automatically by PostgreSQL init-entrypoint

set -e

echo "🗄️  Creating instance-specific databases..."

# Create databases for instances 0-9
for i in {0..9}; do
  DB_NAME="shipsec_instance_$i"
  
  # Check if database already exists
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

echo "✅ Instance-specific databases created successfully"
echo ""
echo "Available databases:"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" -d postgres -c "\\l" | grep shipsec_instance
