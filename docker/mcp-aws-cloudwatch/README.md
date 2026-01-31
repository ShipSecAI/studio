# AWS CloudWatch MCP Proxy Image

This image extends the MCP stdio proxy and installs the CloudWatch MCP server.

## Build

```bash
docker build -t shipsec/mcp-aws-cloudwatch:latest docker/mcp-aws-cloudwatch
```

## Run (example)

```bash
docker run --rm -p 8080:8080 \
  -e AWS_ACCESS_KEY_ID=... \
  -e AWS_SECRET_ACCESS_KEY=... \
  -e AWS_SESSION_TOKEN=... \
  -e AWS_REGION=us-east-1 \
  shipsec/mcp-aws-cloudwatch:latest
```

The proxy exposes MCP on `http://localhost:8080/mcp`.
