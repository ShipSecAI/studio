# Docker Configuration

This directory contains Docker Compose configurations for running ShipSec Studio in different environments.

## Docker Compose Files

| File                       | Purpose                      | When to Use                                            |
| -------------------------- | ---------------------------- | ------------------------------------------------------ |
| `docker-compose.infra.yml` | Infrastructure services only | Development with PM2 (frontend/backend on host)        |
| `docker-compose.full.yml`  | Full stack in containers     | Self-hosted deployment, all services containerized     |
| `docker-compose.prod.yml`  | Security overlay             | Production SaaS with multitenancy (overlays infra.yml) |

## Environment Modes

### Development Mode (`just dev`)

```bash
just dev
```

- **Compose file**: `docker-compose.infra.yml`
- **Frontend/Backend**: Run via PM2 on host machine
- **Infrastructure**: Runs in Docker (Postgres, Redis, Temporal, OpenSearch, etc.)
- **Nginx**: Uses `nginx.dev.conf` pointing to `host.docker.internal`
- **Security**: Disabled for fast iteration

**Access:**

- Frontend: http://localhost:5173
- Backend: http://localhost:3211
- Analytics: http://localhost:5601/analytics/

### Production Mode (`just prod`)

```bash
just prod
```

- **Compose file**: `docker-compose.full.yml`
- **All services**: Run as Docker containers
- **Nginx**: Unified entry point on port 80
- **Security**: Disabled (simple deployment)

**Access (all via port 80):**

- Frontend: http://localhost/
- Backend API: http://localhost/api/
- Analytics: http://localhost/analytics/

**Nginx Routing (nginx.prod.conf):**

| Path           | Target Container      | Port |
| -------------- | --------------------- | ---- |
| `/analytics/*` | opensearch-dashboards | 5601 |
| `/api/*`       | backend               | 3211 |
| `/*`           | frontend              | 8080 |

> **Note:** Frontend and backend containers only expose ports internally. All external traffic flows through nginx on port 80.

### Production Secure Mode (`just prod-secure`)

```bash
just generate-certs
export OPENSEARCH_ADMIN_PASSWORD='secure-password'
export OPENSEARCH_DASHBOARDS_PASSWORD='secure-password'
just prod-secure
```

- **Compose files**: `docker-compose.infra.yml` + `docker-compose.prod.yml` (overlay)
- **Security**: TLS enabled, authentication required
- **Multitenancy**: Strict SaaS isolation per customer
- **Nginx**: Uses `nginx.prod.conf` with container networking

**Access:**

- Analytics: https://localhost/analytics (auth required)
- OpenSearch: https://localhost:9200 (TLS)

## Nginx Configuration

| File                    | Target Services                                               | Use Case                                 |
| ----------------------- | ------------------------------------------------------------- | ---------------------------------------- |
| `nginx/nginx.dev.conf`  | `host.docker.internal:5173/3211`                              | Dev (PM2 on host)                        |
| `nginx/nginx.prod.conf` | `frontend:8080`, `backend:3211`, `opensearch-dashboards:5601` | Container mode (full stack + production) |

### Routing Architecture

All modes use nginx as a reverse proxy with unified routing:

```
┌─────────────────────────────────────────────────┐
│               Nginx (port 80/443)               │
├─────────────────────────────────────────────────┤
│  /analytics/*  →  OpenSearch Dashboards:5601   │
│  /api/*        →  Backend:3211                 │
│  /*            →  Frontend:8080                │
└─────────────────────────────────────────────────┘
```

### OpenSearch Dashboards BasePath

OpenSearch Dashboards is configured with `server.basePath: "/analytics"` to work behind nginx:

- Incoming requests: `/analytics/app/discover` → internally processed as `/app/discover`
- Outgoing URLs: Automatically prefixed with `/analytics`

## Analytics Pipeline

The worker service writes analytics data to OpenSearch via the Analytics Sink component.

**Required Environment Variable:**

```yaml
OPENSEARCH_URL=http://opensearch:9200
```

This is pre-configured in `docker-compose.full.yml`. For detailed analytics documentation, see [docs/analytics.md](../docs/analytics.md).

## Directory Structure

```
docker/
├── docker-compose.infra.yml      # Infrastructure (dev base)
├── docker-compose.full.yml       # Full stack containerized
├── docker-compose.prod.yml       # Security overlay for prod
├── nginx/
│   ├── nginx.dev.conf            # Routes to host (PM2)
│   └── nginx.prod.conf           # Routes to containers
├── opensearch-dashboards.yml     # Dev dashboards config
├── opensearch-dashboards.prod.yml # Prod dashboards config
├── opensearch-security/          # Security plugin configs
│   ├── internal_users.yml
│   ├── roles.yml
│   ├── roles_mapping.yml
│   └── tenants.yml
├── scripts/
│   └── generate-certs.sh         # TLS certificate generator
├── certs/                        # Generated certs (gitignored)
├── PRODUCTION.md                 # Production deployment guide
└── README.md                     # This file
```

## Quick Reference

| Command               | Description                                |
| --------------------- | ------------------------------------------ |
| `just dev`            | Start dev environment (PM2 + Docker infra) |
| `just dev stop`       | Stop dev environment                       |
| `just prod`           | Start full stack in Docker                 |
| `just prod stop`      | Stop production                            |
| `just prod-secure`    | Start with security & multitenancy         |
| `just generate-certs` | Generate TLS certificates                  |
| `just infra up`       | Start infrastructure only                  |
| `just help`           | Show all available commands                |

## See Also

- [PRODUCTION.md](PRODUCTION.md) - Detailed production deployment and customer provisioning guide
- [docs/analytics.md](../docs/analytics.md) - Analytics pipeline and OpenSearch configuration
