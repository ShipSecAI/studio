#!/bin/bash

# Port for MCP server
PORT=8000

# Start MCP server in the background
echo "Starting MCP server on port $PORT..."
node http_mcp_server.js > mcp_server.log 2>&1 &
MCP_PID=$!

# Wait for MCP server to be ready
sleep 2

# Path to this directory (absolute)
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

cd "$DIR"

echo "Running OpenCode agent..."
docker run --rm \
  --network host \
  -v "$DIR:/workspace" \
  -e OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
  ghcr.io/anomalyco/opencode \
  run --log-level INFO "$(cat prompt.txt)"

# Kill MCP server
echo "Cleaning up MCP server (PID $MCP_PID)..."
kill $MCP_PID

echo "Done. Check mcp_server.log for server logs."
