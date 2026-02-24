ARG BASE_IMAGE=shipsec/mcp-stdio-proxy:latest
FROM ${BASE_IMAGE}

# Install Python, uv, and all AWS MCP servers in a single layer
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-dev build-essential \
  && pip install --no-cache-dir --break-system-packages uv \
  && uv pip install --system --break-system-packages \
    awslabs.cloudtrail-mcp-server \
    awslabs.iam-mcp-server \
    awslabs.s3-tables-mcp-server \
    awslabs.cloudwatch-mcp-server \
    awslabs.aws-network-mcp-server \
    awslabs.lambda-tool-mcp-server \
    awslabs.dynamodb-mcp-server \
    awslabs.aws-documentation-mcp-server \
    awslabs.well-architected-security-mcp-server \
    awslabs.aws-api-mcp-server \
  && apt-get purge -y python3-dev build-essential \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

# Compatibility shim for fastmcp expecting streamable_http_client
RUN python3 - <<'PY'
from pathlib import Path

content = """
try:
    import mcp.client.streamable_http as _m
    if not hasattr(_m, 'streamable_http_client') and hasattr(_m, 'streamablehttp_client'):
        _m.streamable_http_client = _m.streamablehttp_client
except Exception:
    pass
"""

# Prefer usercustomize (loaded after sitecustomize) to avoid clobbering system hooks.
usercustomize = Path('/usr/local/lib/python3.11/dist-packages/usercustomize.py')
usercustomize.write_text(content)

# Also append to system sitecustomize if present to ensure patch executes.
sitecustomize = Path('/usr/lib/python3/dist-packages/sitecustomize.py')
if sitecustomize.exists():
    existing = sitecustomize.read_text()
    if 'streamable_http_client' not in existing:
        sitecustomize.write_text(existing + "\\n" + content)
PY

# Set default MCP command (can be overridden via MCP_COMMAND env var)
ENV MCP_COMMAND=awslabs.cloudtrail-mcp-server
ENV MCP_ARGS='[]'

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1
