#!/bin/sh
set -eu

create_database_if_missing() {
  db_name="$1"
  echo "🗄️  Ensuring ${db_name} database exists..."
  if psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname='${db_name}'" | grep -q 1; then
    echo "  Database ${db_name} already exists, skipping..."
    return
  fi

  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" -d postgres <<-EOSQL
    CREATE DATABASE "${db_name}" OWNER "$POSTGRES_USER";
    GRANT ALL PRIVILEGES ON DATABASE "${db_name}" TO "$POSTGRES_USER";
EOSQL
  echo "  ✅ ${db_name} created"
}

create_database_if_missing "temporal"

echo "✅ Database init complete"
