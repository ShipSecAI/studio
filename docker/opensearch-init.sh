#!/bin/bash
# OpenSearch Dashboards initialization script
# Creates default index patterns and saved objects
#
# Environment variables:
#   OPENSEARCH_DASHBOARDS_URL - Dashboards URL (default: http://opensearch-dashboards:5601)
#   OPENSEARCH_SECURITY_ENABLED - Enable security mode (default: false)
#   OPENSEARCH_ADMIN_PASSWORD - Admin password (not used with proxy auth, kept for reference)
#   OPENSEARCH_CA_CERT - Path to CA cert for TLS (optional, for https)

set -e

# Note: Use /analytics prefix since dashboards is configured with server.basePath=/analytics
DASHBOARDS_URL="${OPENSEARCH_DASHBOARDS_URL:-http://opensearch-dashboards:5601}"
DASHBOARDS_BASE_PATH="/analytics"
MAX_RETRIES=30
RETRY_INTERVAL=5
SECURITY_ENABLED="${OPENSEARCH_SECURITY_ENABLED:-false}"

# Wrapper function for authenticated curl requests
# When security is enabled, Dashboards uses proxy auth (not basic auth)
# We send x-proxy-user and x-proxy-roles headers to authenticate
auth_curl() {
  if [ "$SECURITY_ENABLED" = "true" ]; then
    curl -H "x-proxy-user: admin" -H "x-proxy-roles: admin,all_access" "$@"
  else
    curl "$@"
  fi
}

echo "[opensearch-init] Security mode: ${SECURITY_ENABLED}"
echo "[opensearch-init] Waiting for OpenSearch Dashboards to be ready..."

# Wait for Dashboards to be healthy (use basePath)
# Accept 200 or 401 as "ready" - 401 means server is up but requires auth
# Note: Don't use -f flag as we want to capture 4xx status codes without curl failing
for i in $(seq 1 $MAX_RETRIES); do
  HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' "${DASHBOARDS_URL}${DASHBOARDS_BASE_PATH}/api/status" 2>/dev/null || echo "000")

  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "401" ]; then
    echo "[opensearch-init] OpenSearch Dashboards is ready! (HTTP $HTTP_CODE)"
    break
  fi

  if [ $i -eq $MAX_RETRIES ]; then
    echo "[opensearch-init] ERROR: OpenSearch Dashboards not ready after $((MAX_RETRIES * RETRY_INTERVAL)) seconds (last HTTP code: $HTTP_CODE)"
    exit 1
  fi

  echo "[opensearch-init] Waiting for Dashboards... (attempt $i/$MAX_RETRIES, HTTP $HTTP_CODE)"
  sleep $RETRY_INTERVAL
done

# In secure mode, skip index pattern creation via Dashboards API
# Reason: Dashboards uses proxy auth which requires requests to come through nginx
# Index patterns will be created when users first access Dashboards through the normal flow
if [ "$SECURITY_ENABLED" = "true" ]; then
  echo "[opensearch-init] Security mode enabled - skipping index pattern creation"
  echo "[opensearch-init] Index patterns will be created on first user access via nginx"
  echo "[opensearch-init] Initialization complete!"
  exit 0
fi

# Check if index pattern already exists (insecure mode only)
echo "[opensearch-init] Checking for existing index patterns..."
EXISTING=$(auth_curl -sf "${DASHBOARDS_URL}${DASHBOARDS_BASE_PATH}/api/saved_objects/_find?type=index-pattern&search_fields=title&search=security-findings-*" \
  -H "osd-xsrf: true" 2>/dev/null || echo '{"total":0}')

TOTAL=$(echo "$EXISTING" | grep -o '"total":[0-9]*' | grep -o '[0-9]*' || echo "0")

if [ "$TOTAL" -gt 0 ]; then
  echo "[opensearch-init] Index pattern 'security-findings-*' already exists, skipping creation"
else
  echo "[opensearch-init] Creating index pattern 'security-findings-*'..."

  # Use specific ID so dashboards can reference it consistently
  RESPONSE=$(auth_curl -sf -X POST "${DASHBOARDS_URL}${DASHBOARDS_BASE_PATH}/api/saved_objects/index-pattern/security-findings-*" \
    -H "Content-Type: application/json" \
    -H "osd-xsrf: true" \
    -d '{
      "attributes": {
        "title": "security-findings-*",
        "timeFieldName": "@timestamp"
      }
    }' 2>&1)

  if echo "$RESPONSE" | grep -q '"type":"index-pattern"'; then
    echo "[opensearch-init] Successfully created index pattern 'security-findings-*'"
  else
    echo "[opensearch-init] WARNING: Failed to create index pattern. Response: $RESPONSE"
    # Don't fail - the pattern might be created later when data exists
  fi
fi

# Set as default index pattern (optional, helps UX)
echo "[opensearch-init] Setting default index pattern..."
auth_curl -sf -X POST "${DASHBOARDS_URL}${DASHBOARDS_BASE_PATH}/api/opensearch-dashboards/settings" \
  -H "Content-Type: application/json" \
  -H "osd-xsrf: true" \
  -d '{"changes":{"defaultIndex":"security-findings-*"}}' > /dev/null 2>&1 || true

echo "[opensearch-init] Initialization complete!"
