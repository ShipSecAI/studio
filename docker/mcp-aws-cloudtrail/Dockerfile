ARG BASE_IMAGE=shipsec/mcp-stdio-proxy:latest
FROM ${BASE_IMAGE}

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && rm -rf /var/lib/apt/lists/* \
  && pip install --no-cache-dir --break-system-packages uv \
  && uv pip install --system --break-system-packages awslabs-cloudtrail-mcp-server

ENV MCP_COMMAND=awslabs.cloudtrail-mcp-server
ENV MCP_ARGS='[]'
