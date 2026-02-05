ARG BASE_IMAGE=shipsec/mcp-stdio-proxy:latest
FROM ${BASE_IMAGE}

# Install Python and uv for AWS MCP servers
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-dev build-essential \
  && rm -rf /var/lib/apt/lists/* \
  && pip install --no-cache-dir --break-system-packages uv

# Install 10 essential AWS security MCP servers
# Core security & auditing
RUN uv pip install --system --break-system-packages awslabs.cloudtrail-mcp-server
RUN uv pip install --system --break-system-packages awslabs.iam-mcp-server
RUN uv pip install --system --break-system-packages awslabs.s3-tables-mcp-server
RUN uv pip install --system --break-system-packages awslabs.cloudwatch-mcp-server

# Networking & infrastructure security
RUN uv pip install --system --break-system-packages awslabs.aws-network-mcp-server

# Serverless security
RUN uv pip install --system --break-system-packages awslabs.lambda-tool-mcp-server

# Database security
RUN uv pip install --system --break-system-packages awslabs.dynamodb-mcp-server

# Documentation & best practices
RUN uv pip install --system --break-system-packages awslabs.aws-documentation-mcp-server
RUN uv pip install --system --break-system-packages awslabs.well-architected-security-mcp-server

# API explorer (for any AWS service)
RUN uv pip install --system --break-system-packages awslabs.aws-api-mcp-server

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
