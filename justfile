#!/usr/bin/env just

# ShipSec Studio - Simplified Docker Setup
# Run `just` to see available commands

default:
    @just --list

# === Infrastructure Only ===
infra-up:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🚀 Starting Docker infrastructure..."
    docker compose -f docker/docker-compose.infra.yml up -d
    echo "✅ Infrastructure started"
    echo "📊 Services:"
    echo "   - PostgreSQL: localhost:5433"
    echo "   - Temporal: localhost:7233"
    echo "   - Temporal UI: http://localhost:8081"
    echo "   - MinIO: http://localhost:9000 (minioadmin/minioadmin)"
    echo "   - MinIO Console: http://localhost:9001"
    echo "   - Loki: http://localhost:3100"
    echo "   - Redis: localhost:6379"

infra-down:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🛑 Stopping infrastructure..."
    docker compose -f docker/docker-compose.infra.yml down
    echo "✅ Infrastructure stopped"

infra-logs:
    docker compose -f docker/docker-compose.infra.yml logs -f

infra-clean:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🧹 Cleaning infrastructure..."
    docker compose -f docker/docker-compose.infra.yml down -v
    docker volume prune -f
    echo "✅ Infrastructure cleaned"

# === Production: Full Docker Setup ===
up:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🚀 Starting PRODUCTION environment (everything in Docker)..."
    echo "📝 Environment: PRODUCTION"
    echo "   - Temporal Namespace: shipsec-prod"
    echo "   - Temporal Task Queue: shipsec-prod"
    docker compose -f docker/docker-compose.full.yml up -d
    echo "✅ Production environment started"
    echo "📊 Services:"
    echo "   - Frontend: http://localhost:8090"
    echo "   - Backend API: http://localhost:3211"
    echo "   - PostgreSQL: localhost:5433"
    echo "   - Temporal: localhost:7233"
    echo "   - Temporal UI: http://localhost:8081"
    echo "   - MinIO Console: http://localhost:9001"
    echo "   - Redis: localhost:6379"

down:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🛑 Stopping production environment..."
    docker compose -f docker/docker-compose.full.yml down
    echo "✅ Production environment stopped"

logs:
    docker compose -f docker/docker-compose.full.yml logs -f

clean:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🧹 Cleaning production environment..."
    docker compose -f docker/docker-compose.full.yml down -v
    docker system prune -f
    docker volume prune -f
    echo "✅ Production environment cleaned"

# === Development: Docker Infra + PM2 Apps ===
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🚀 Starting DEVELOPMENT environment (Docker infra + PM2 apps)..."
    echo "📝 Environment: DEVELOPMENT"
    echo "   - Temporal Namespace: shipsec-dev"
    echo "   - Temporal Task Queue: shipsec-dev"
    echo "   - Hot-reload: Enabled"
    
    # Start infrastructure
    just infra-up
    
    # Wait for infrastructure to be ready
    echo "⏳ Waiting for infrastructure to be ready..."
    sleep 10
    
    # Check if infrastructure is healthy
    timeout 30s bash -c 'until docker exec shipsec-postgres pg_isready -U shipsec >/dev/null 2>&1; do sleep 1; done' || true
    
    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        echo "📦 Installing dependencies..."
        bun install
    fi
    
    # Start apps with PM2 (dev mode)
    echo "🚀 Starting applications with PM2 (dev mode, hot-reload enabled)..."
    SHIPSEC_ENV=development NODE_ENV=development pm2 startOrReload pm2.config.cjs --only shipsec-frontend,shipsec-backend,shipsec-worker --update-env
    
    echo "✅ Development environment started"
    echo "📊 Services:"
    echo "   - Frontend: http://localhost:5173"
    echo "   - Backend API: http://localhost:3211"
    echo "   - PostgreSQL: localhost:5433"
    echo "   - Temporal: localhost:7233"
    echo "   - Temporal UI: http://localhost:8081"
    echo "   - MinIO Console: http://localhost:9001"
    echo "   - Redis: localhost:6379"
    echo ""
    echo "💡 View logs: pm2 logs"
    echo "💡 View status: pm2 status"

dev-stop:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🛑 Stopping development environment..."
    pm2 delete shipsec-frontend shipsec-backend shipsec-worker shipsec-test-worker 2>/dev/null || true
    just infra-down
    echo "✅ Development environment stopped"

# === Utilities ===
status:
    @echo "📊 Docker container status:"
    @echo ""
    @echo "Infrastructure:"
    @docker compose -f docker/docker-compose.infra.yml ps 2>/dev/null || echo "  Not running"
    @echo ""
    @echo "Full environment:"
    @docker compose -f docker/docker-compose.full.yml ps 2>/dev/null || echo "  Not running"

build:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🔨 Building application images..."
    docker compose -f docker/docker-compose.full.yml build backend frontend worker
    echo "✅ Images built"

# === PM2 Management ===
pm2-start:
    #!/usr/bin/env bash
    set -euo pipefail
    SHIPSEC_ENV=development NODE_ENV=development pm2 startOrReload pm2.config.cjs --update-env

pm2-stop:
    pm2 delete shipsec-frontend shipsec-backend shipsec-worker shipsec-test-worker 2>/dev/null || true

pm2-logs:
    pm2 logs

pm2-status:
    pm2 status

# === Help ===
help:
    @echo "ShipSec Studio - Environment Setup"
    @echo ""
    @echo "PRODUCTION (Full Docker):"
    @echo "  just up            # Start everything in Docker (prod env)"
    @echo "  just down          # Stop production environment"
    @echo "  just logs          # View production logs"
    @echo "  just clean         # Clean production environment"
    @echo ""
    @echo "DEVELOPMENT (Docker Infra + PM2 Apps):"
    @echo "  just dev           # Start Docker infra + PM2 apps (dev env, hot-reload)"
    @echo "  just dev-stop      # Stop development environment"
    @echo ""
    @echo "Infrastructure Only:"
    @echo "  just infra-up      # Start Docker infrastructure"
    @echo "  just infra-down    # Stop infrastructure"
    @echo "  just infra-logs    # View infrastructure logs"
    @echo "  just infra-clean   # Clean infrastructure"
    @echo ""
    @echo "PM2 Management:"
    @echo "  just pm2-start     # Start PM2 apps"
    @echo "  just pm2-stop      # Stop PM2 apps"
    @echo "  just pm2-logs      # View PM2 logs"
    @echo "  just pm2-status    # View PM2 status"
    @echo ""
    @echo "Utilities:"
    @echo "  just status        # Show container status"
    @echo "  just build         # Build application images"
    @echo ""
    @echo "Environment Differences:"
    @echo "  PRODUCTION:"
    @echo "    - Temporal Namespace: shipsec-prod"
    @echo "    - Temporal Task Queue: shipsec-prod"
    @echo "    - All services in Docker"
    @echo "  DEVELOPMENT:"
    @echo "    - Temporal Namespace: shipsec-dev"
    @echo "    - Temporal Task Queue: shipsec-dev"
    @echo "    - Infrastructure in Docker, apps via PM2 (hot-reload)"