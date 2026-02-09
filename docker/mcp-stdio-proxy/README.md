# MCP Stdio Proxy

This image wraps a stdio-based MCP server and exposes it over Streamable HTTP.

## Build

```bash
docker build -t shipsec/mcp-stdio-proxy:latest docker/mcp-stdio-proxy
```

## Run

```bash
docker run --rm -p 8080:8080 \
  -e MCP_COMMAND=uvx \
  -e MCP_ARGS='["awslabs-cloudwatch-mcp-server"]' \
  shipsec/mcp-stdio-proxy:latest
```

The proxy will expose MCP on `http://localhost:8080/mcp` and a basic health endpoint at `/health`.

## Environment

- `MCP_COMMAND` (required): Command to launch the stdio MCP server.
- `MCP_ARGS` (optional): JSON array or space-delimited list of arguments.
- `PORT` / `MCP_PORT` (optional): Port for the HTTP server (default: 8080).

## Notes

- The proxy lists tools once at startup and registers them. Restart the container if tools change.
- Make sure the stdio server binary is present in the image. For third-party tools, build a derived image that installs them.
