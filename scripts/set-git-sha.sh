#!/usr/bin/env bash
# Helper script to set git SHA environment variable for frontend
# This script should be run before starting the application

set -euo pipefail

# Get the current git commit SHA
GIT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "unknown")

# Frontend .env file
FRONTEND_ENV_FILE="frontend/.env"
if [ -f "$FRONTEND_ENV_FILE" ]; then
  # Update or add VITE_GIT_SHA
  if grep -q "^VITE_GIT_SHA=" "$FRONTEND_ENV_FILE"; then
    sed -i.bak "s|^VITE_GIT_SHA=.*|VITE_GIT_SHA=$GIT_SHA|" "$FRONTEND_ENV_FILE"
    rm -f "${FRONTEND_ENV_FILE}.bak"
  else
    echo "VITE_GIT_SHA=$GIT_SHA" >> "$FRONTEND_ENV_FILE"
  fi
  echo "✅  Git SHA set: $GIT_SHA (first 6 chars: ${GIT_SHA:0:6})"
else
  echo "⚠️  Frontend .env file not found at $FRONTEND_ENV_FILE"
fi
