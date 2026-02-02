# MCP Docker Images

This directory contains Docker images for the MCP (Model Context Protocol) Library implementation.

## Overview

The MCP Docker images provide a standardized way to deploy MCP servers with a built-in stdio proxy. Each image includes:

1. **Base stdio proxy** (`mcp-stdio-proxy`): A Node.js HTTP server that acts as a bridge between MCP stdio servers and HTTP clients
2. **Provider suites** (`mcp-aws-suite`): Bundled MCP servers for specific cloud providers

## Quick Start with Docker Compose

Start all services:

```bash
cd docker
docker-compose up -d
```

Check health of services:

```bash
curl http://localhost:8080/health          # stdio proxy
curl http://localhost:8081/health        # AWS suite
```

## Individual Services

### stdio proxy

- Port: 8080
- Purpose: Base HTTP to stdio proxy for MCP servers

### AWS Suite

- Port: 8081
- MCP servers: CloudTrail, CloudWatch, EC2, S3
- Environment: `MCP_COMMAND`, `MCP_ARGS`

## Customization

You can override the default MCP server using environment variables:

```bash
# Using docker-compose
docker-compose up -e MCP_COMMAND=awslabs.cloudwatch-mcp-server

# Or with docker run
docker run -e MCP_COMMAND=github.github-issue-mcp-server shipsec/mcp-aws-suite:latest
```

## Build Instructions

Build individual images:

```bash
# Build stdio proxy
cd mcp-stdio-proxy
docker build -t shipsec/mcp-stdio-proxy:latest .

# Build AWS suite
cd mcp-aws-suite
docker build -t shipsec/mcp-aws-suite:latest .

```

## Authentication

Each suite requires specific authentication:

- **AWS Suite**: AWS credentials (access key, secret key, or credentials file)
  See individual suite README for detailed authentication instructions.
