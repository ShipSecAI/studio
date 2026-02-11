#!/bin/bash

# ShipSec E2E Local Testing Script
# Usage: ./scripts/e2e-local-test.sh [test-name]
# Example: ./scripts/e2e-local-test.sh alert-investigation

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env.e2e"
TEST_NAME="${1:-alert-investigation}"

echo "🧪 ShipSec E2E Local Testing"
echo "================================"
echo ""

# Check if running in correct directory
if [ ! -f "$PROJECT_ROOT/package.json" ]; then
    echo "❌ Error: Not in ShipSec project root"
    exit 1
fi

# Check environment file
if [ ! -f "$ENV_FILE" ]; then
    echo "⚠️  Missing $ENV_FILE"
    echo ""
    echo "Setting up environment..."
    bun run e2e-tests/scripts/setup-e2e-env.ts || {
        echo "❌ Setup cancelled"
        exit 1
    }
    echo ""
fi

# Check required env vars
echo "📋 Checking environment variables..."

source "$ENV_FILE"

MISSING=()
for var in ZAI_API_KEY ABUSEIPDB_API_KEY VIRUSTOTAL_API_KEY AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do
    val=$(eval echo \$$var)
    if [ -z "$val" ] || [ "$val" = "" ]; then
        MISSING+=("$var")
    else
        echo "  ✅ $var: ${val:0:10}..."
    fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
    echo ""
    echo "❌ Missing required environment variables:"
    for var in "${MISSING[@]}"; do
        echo "   - $var"
    done
    echo ""
    echo "Edit .env.e2e to add values"
    exit 1
fi

echo ""

# Check if services are running
echo "🔍 Checking if ShipSec backend is running..."

INSTANCE=$(just instance show 2>/dev/null || echo "0")
BACKEND_PORT=$((3211 + INSTANCE * 100))
BACKEND_URL="http://localhost:$BACKEND_PORT"

if ! curl -sf "$BACKEND_URL/health" > /dev/null 2>&1; then
    echo ""
    echo "⚠️  Backend not responding at $BACKEND_URL"
    echo ""
    echo "Start services with:"
    echo "  just instance use $INSTANCE"
    echo "  just dev start"
    echo ""
    exit 1
fi

echo "  ✅ Backend running at $BACKEND_URL"
echo ""

# Run tests
echo "🚀 Running E2E tests..."
echo ""

export RUN_E2E=true
export NODE_OPTIONS="--max_old_space_size=4096"

cd "$PROJECT_ROOT"

if [ "$TEST_NAME" = "all" ]; then
    echo "Running all E2E tests..."
    bun run test:e2e
else
    echo "Running E2E test: $TEST_NAME.test.ts"
    bun run test:e2e -- "$TEST_NAME.test.ts"
fi

TEST_EXIT=$?

if [ $TEST_EXIT -eq 0 ]; then
    echo ""
    echo "✅ E2E tests PASSED!"
    echo ""
    echo "📊 View results:"
    echo "   Frontend: http://localhost:$((5173 + INSTANCE * 100))"
    echo "   Temporal: http://localhost:8081"
else
    echo ""
    echo "❌ E2E tests FAILED"
    echo ""
    echo "📖 Troubleshooting:"
    echo "   1. Check backend logs: just dev logs"
    echo "   2. View Temporal UI: http://localhost:8081"
    echo "   3. Verify env vars: cat .env.e2e"
fi

exit $TEST_EXIT
