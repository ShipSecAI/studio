#!/bin/sh
# OpenSearch Security Entrypoint (Production-Ready)
#
# This entrypoint:
#   1. Templates the internalProxies regex in config.yml
#   2. Launches a background process to initialize security after OpenSearch starts
#   3. Uses a marker file to avoid re-initializing on every restart
#
# Environment variables:
#   OPENSEARCH_INTERNAL_PROXIES - Trusted proxy IP regex (default: Docker bridge)
#   SECURITY_AUTO_INIT - Auto-initialize security index (default: true)

set -e

# Configuration
INTERNAL_PROXIES="${OPENSEARCH_INTERNAL_PROXIES:-(172|192|10)\\.\\d+\\.\\d+\\.\\d+}"
SECURITY_AUTO_INIT="${SECURITY_AUTO_INIT:-true}"
SECURITY_INIT_MARKER="/usr/share/opensearch/data/.security_initialized"

SRC_CONFIG="/usr/share/opensearch/config/opensearch-security/config.yml"
DEST_DIR="/usr/share/opensearch/config/opensearch-security-templated"
DEST_CONFIG="${DEST_DIR}/config.yml"

echo "[opensearch-security] Templating internalProxies: ${INTERNAL_PROXIES}"

if [ -f "${SRC_CONFIG}" ]; then
  # Create destination directory if needed
  mkdir -p "${DEST_DIR}"

  # Copy and template the config file
  sed "s/__INTERNAL_PROXIES__/${INTERNAL_PROXIES}/g" "${SRC_CONFIG}" > "${DEST_CONFIG}"

  # Copy other security config files to the templated directory
  for file in /usr/share/opensearch/config/opensearch-security/*.yml; do
    filename=$(basename "$file")
    if [ "$filename" != "config.yml" ]; then
      cp "$file" "${DEST_DIR}/${filename}"
    fi
  done

  echo "[opensearch-security] Config templating complete"
else
  echo "[opensearch-security] WARNING: Config file not found at ${SRC_CONFIG}"
fi

# Background security initialization function
security_init_background() {
  # Wait for OpenSearch to be ready
  echo "[opensearch-security] Waiting for OpenSearch to be ready..."
  ADMIN_PASSWORD="${OPENSEARCH_ADMIN_PASSWORD:-admin}"
  MAX_RETRIES=60
  RETRY_COUNT=0

  while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    # Use admin credentials - OpenSearch rejects unauthenticated requests
    # even before security is fully initialized
    if curl -sf -u "admin:${ADMIN_PASSWORD}" \
        --cacert /usr/share/opensearch/config/certs/root-ca.pem \
        https://localhost:9200/_cluster/health > /dev/null 2>&1; then
      echo "[opensearch-security] OpenSearch is ready"
      break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    sleep 2
  done

  if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo "[opensearch-security] ERROR: OpenSearch not ready after $MAX_RETRIES attempts"
    return 1
  fi

  # Always run securityadmin.sh to apply our templated config.
  # OpenSearch may auto-init security from the raw config dir (with __INTERNAL_PROXIES__
  # placeholder), so we must overwrite it with the properly templated version.
  # The marker file (checked at the outer level) prevents re-runs on subsequent restarts.
  echo "[opensearch-security] Applying templated security config with securityadmin.sh..."
  /usr/share/opensearch/plugins/opensearch-security/tools/securityadmin.sh \
    -cd "${DEST_DIR}" \
    -icl \
    -nhnv \
    -cacert /usr/share/opensearch/config/certs/root-ca.pem \
    -cert /usr/share/opensearch/config/certs/admin.pem \
    -key /usr/share/opensearch/config/certs/admin-key.pem

  if [ $? -eq 0 ]; then
    echo "[opensearch-security] Security initialization complete"
    touch "$SECURITY_INIT_MARKER"
  else
    echo "[opensearch-security] ERROR: Security initialization failed"
    return 1
  fi
}

# Launch background security initialization if enabled and not already done
if [ "${SECURITY_AUTO_INIT}" = "true" ]; then
  if [ -f "$SECURITY_INIT_MARKER" ]; then
    echo "[opensearch-security] Security previously initialized (marker exists)"
  else
    echo "[opensearch-security] Will initialize security after OpenSearch starts..."
    # Run in background so OpenSearch can start
    security_init_background &
  fi
else
  echo "[opensearch-security] Auto-init disabled (SECURITY_AUTO_INIT=${SECURITY_AUTO_INIT})"
fi

# Execute the original OpenSearch entrypoint
exec /usr/share/opensearch/opensearch-docker-entrypoint.sh "$@"
