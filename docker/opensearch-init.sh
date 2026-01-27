#!/bin/bash
# OpenSearch Dashboards initialization script
# Creates default index patterns and saved objects

set -e

# Note: Use /analytics prefix since dashboards is configured with server.basePath=/analytics
DASHBOARDS_URL="${OPENSEARCH_DASHBOARDS_URL:-http://opensearch-dashboards:5601}"
DASHBOARDS_BASE_PATH="/analytics"
MAX_RETRIES=30
RETRY_INTERVAL=5

echo "[opensearch-init] Waiting for OpenSearch Dashboards to be ready..."

# Wait for Dashboards to be healthy (use basePath)
for i in $(seq 1 $MAX_RETRIES); do
  if curl -sf "${DASHBOARDS_URL}${DASHBOARDS_BASE_PATH}/api/status" > /dev/null 2>&1; then
    echo "[opensearch-init] OpenSearch Dashboards is ready!"
    break
  fi

  if [ $i -eq $MAX_RETRIES ]; then
    echo "[opensearch-init] ERROR: OpenSearch Dashboards not ready after $((MAX_RETRIES * RETRY_INTERVAL)) seconds"
    exit 1
  fi

  echo "[opensearch-init] Waiting for Dashboards... (attempt $i/$MAX_RETRIES)"
  sleep $RETRY_INTERVAL
done

# Check if index pattern already exists
echo "[opensearch-init] Checking for existing index patterns..."
EXISTING=$(curl -sf "${DASHBOARDS_URL}${DASHBOARDS_BASE_PATH}/api/saved_objects/_find?type=index-pattern&search_fields=title&search=security-findings-*" \
  -H "osd-xsrf: true" 2>/dev/null || echo '{"total":0}')

TOTAL=$(echo "$EXISTING" | grep -o '"total":[0-9]*' | grep -o '[0-9]*' || echo "0")

if [ "$TOTAL" -gt 0 ]; then
  echo "[opensearch-init] Index pattern 'security-findings-*' already exists, skipping creation"
else
  echo "[opensearch-init] Creating index pattern 'security-findings-*'..."

  # Use specific ID so dashboards can reference it consistently
  RESPONSE=$(curl -sf -X POST "${DASHBOARDS_URL}${DASHBOARDS_BASE_PATH}/api/saved_objects/index-pattern/security-findings-*" \
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
curl -sf -X POST "${DASHBOARDS_URL}${DASHBOARDS_BASE_PATH}/api/opensearch-dashboards/settings" \
  -H "Content-Type: application/json" \
  -H "osd-xsrf: true" \
  -d '{"changes":{"defaultIndex":"security-findings-*"}}' > /dev/null 2>&1 || true

echo "[opensearch-init] Initialization complete!"
