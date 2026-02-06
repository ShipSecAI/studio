#!/bin/bash
# Initialize OpenSearch Security index using securityadmin.sh
#
# This script properly initializes the security configuration without using
# the deprecated demo installer. It should be run:
#   - After first-time OpenSearch startup
#   - After modifying security configuration files
#   - When migrating from demo to production security
#
# Prerequisites:
#   - OpenSearch must be running with TLS enabled
#   - Admin certificates must exist in docker/certs/
#   - Security config files in docker/opensearch-security/
#
# Usage:
#   ./security-init.sh                    # Use defaults
#   ./security-init.sh --force            # Force reinitialize (overwrites existing)
#   OPENSEARCH_HOST=my-host ./security-init.sh  # Custom host

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$SCRIPT_DIR/.."

# Configuration
OPENSEARCH_HOST="${OPENSEARCH_HOST:-opensearch}"
OPENSEARCH_PORT="${OPENSEARCH_PORT:-9200}"
CERTS_DIR="${CERTS_DIR:-$DOCKER_DIR/certs}"
SECURITY_CONFIG_DIR="${SECURITY_CONFIG_DIR:-$DOCKER_DIR/opensearch-security}"
CONTAINER_NAME="${OPENSEARCH_CONTAINER:-shipsec-opensearch}"

# Parse arguments
FORCE_INIT=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --force|-f)
            FORCE_INIT=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo "=== OpenSearch Security Initialization ==="
echo ""
echo "Configuration:"
echo "  Container:     $CONTAINER_NAME"
echo "  Certs dir:     $CERTS_DIR"
echo "  Security dir:  $SECURITY_CONFIG_DIR"
echo "  Force init:    $FORCE_INIT"
echo ""

# Verify prerequisites
if [ ! -f "$CERTS_DIR/admin.pem" ] || [ ! -f "$CERTS_DIR/admin-key.pem" ]; then
    echo "Error: Admin certificates not found in $CERTS_DIR"
    echo "Run: just generate-certs"
    exit 1
fi

if [ ! -f "$CERTS_DIR/root-ca.pem" ]; then
    echo "Error: Root CA certificate not found in $CERTS_DIR"
    exit 1
fi

if [ ! -d "$SECURITY_CONFIG_DIR" ]; then
    echo "Error: Security config directory not found: $SECURITY_CONFIG_DIR"
    exit 1
fi

# Check if OpenSearch container is running
if ! docker ps --filter "name=$CONTAINER_NAME" --format "{{.Names}}" | grep -q "$CONTAINER_NAME"; then
    echo "Error: OpenSearch container '$CONTAINER_NAME' is not running"
    echo "Start it first with: just dev or just prod-secure"
    exit 1
fi

# Wait for OpenSearch to be ready
echo "Waiting for OpenSearch to be ready..."
MAX_RETRIES=30
for i in $(seq 1 $MAX_RETRIES); do
    if docker exec "$CONTAINER_NAME" curl -sf \
        --cacert /usr/share/opensearch/config/certs/root-ca.pem \
        https://localhost:9200/_cluster/health > /dev/null 2>&1; then
        echo "OpenSearch is ready!"
        break
    fi

    if [ $i -eq $MAX_RETRIES ]; then
        echo "Error: OpenSearch not ready after $MAX_RETRIES attempts"
        exit 1
    fi

    echo "  Waiting... (attempt $i/$MAX_RETRIES)"
    sleep 2
done

# Check if security index already exists
echo ""
echo "Checking security index status..."
SECURITY_STATUS=$(docker exec "$CONTAINER_NAME" curl -sf \
    --cacert /usr/share/opensearch/config/certs/root-ca.pem \
    https://localhost:9200/_plugins/_security/health 2>/dev/null || echo "not_initialized")

if echo "$SECURITY_STATUS" | grep -q '"status":"UP"'; then
    if [ "$FORCE_INIT" != "true" ]; then
        echo "Security index already initialized."
        echo "Use --force to reinitialize (this will overwrite existing configuration)"
        exit 0
    fi
    echo "Security index exists, but --force specified. Reinitializing..."
else
    echo "Security index not initialized. Proceeding with initialization..."
fi

# Copy security config files to container (in case they've been updated)
echo ""
echo "Copying security configuration to container..."
docker cp "$SECURITY_CONFIG_DIR/." "$CONTAINER_NAME:/usr/share/opensearch/config/opensearch-security-init/"

# Run securityadmin.sh
echo ""
echo "Running securityadmin.sh to initialize security index..."
docker exec "$CONTAINER_NAME" /usr/share/opensearch/plugins/opensearch-security/tools/securityadmin.sh \
    -cd /usr/share/opensearch/config/opensearch-security-init \
    -icl \
    -nhnv \
    -cacert /usr/share/opensearch/config/certs/root-ca.pem \
    -cert /usr/share/opensearch/config/certs/admin.pem \
    -key /usr/share/opensearch/config/certs/admin-key.pem

# Verify initialization
echo ""
echo "Verifying security initialization..."
sleep 2
FINAL_STATUS=$(docker exec "$CONTAINER_NAME" curl -sf \
    --cacert /usr/share/opensearch/config/certs/root-ca.pem \
    https://localhost:9200/_plugins/_security/health 2>/dev/null || echo "{}")

if echo "$FINAL_STATUS" | grep -q '"status":"UP"'; then
    echo ""
    echo "=== Security Initialization Complete ==="
    echo ""
    echo "Security plugin status: UP"
    echo ""
    echo "Next steps:"
    echo "  - Test authentication: curl -u admin:PASSWORD --cacert docker/certs/root-ca.pem https://localhost:9200"
    echo "  - Update internal_users.yml with production password hashes"
    echo "  - Re-run this script with --force after updating passwords"
else
    echo ""
    echo "Warning: Security initialization may have failed"
    echo "Check OpenSearch logs: docker logs $CONTAINER_NAME"
    exit 1
fi
