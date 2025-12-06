#!/usr/bin/env just

# ShipSec Studio - Development Environment
# Run `just` or `just help` to see available commands

default:
    @just help

# === Development (recommended for contributors) ===

# Start development environment with hot-reload
dev action="start":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{action}}" in
        start)
            echo "🚀 Starting development environment..."

            # Start infrastructure
            docker compose -f docker/docker-compose.infra.yml up -d

            # Wait for Postgres
            echo "⏳ Waiting for infrastructure..."
            timeout 30s bash -c 'until docker exec shipsec-postgres pg_isready -U shipsec >/dev/null 2>&1; do sleep 1; done' || true

            # Install dependencies if needed
            [ ! -d "node_modules" ] && bun install

            # Update git SHA and start PM2
            ./scripts/set-git-sha.sh || true
            SHIPSEC_ENV=development NODE_ENV=development pm2 startOrReload pm2.config.cjs --only shipsec-frontend,shipsec-backend,shipsec-worker --update-env

            echo ""
            echo "✅ Development environment ready"
            echo "   Frontend:    http://localhost:5173"
            echo "   Backend:     http://localhost:3211"
            echo "   Temporal UI: http://localhost:8081"
            echo ""
            echo "💡 just dev logs   - View application logs"
            echo "💡 just dev stop   - Stop everything"
            ;;
        stop)
            echo "🛑 Stopping development environment..."
            pm2 delete shipsec-frontend shipsec-backend shipsec-worker shipsec-test-worker 2>/dev/null || true
            docker compose -f docker/docker-compose.infra.yml down
            echo "✅ Stopped"
            ;;
        logs)
            pm2 logs
            ;;
        status)
            pm2 status
            docker compose -f docker/docker-compose.infra.yml ps
            ;;
        *)
            echo "Usage: just dev [start|stop|logs|status]"
            ;;
    esac

# === Production (Docker-based) ===

# Run production environment in Docker
prod action="start":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{action}}" in
        start)
            echo "🚀 Starting production environment..."
            docker compose -f docker/docker-compose.full.yml up -d
            echo ""
            echo "✅ Production environment ready"
            echo "   Frontend:    http://localhost:8090"
            echo "   Backend:     http://localhost:3211"
            echo "   Temporal UI: http://localhost:8081"
            ;;
        stop)
            docker compose -f docker/docker-compose.full.yml down
            echo "✅ Production stopped"
            ;;
        build)
            echo "🔨 Building and starting production..."
            docker compose -f docker/docker-compose.full.yml up -d --build
            echo "✅ Production built and started"
            echo "   Frontend: http://localhost:8090"
            echo "   Backend:  http://localhost:3211"
            ;;
        logs)
            docker compose -f docker/docker-compose.full.yml logs -f
            ;;
        status)
            docker compose -f docker/docker-compose.full.yml ps
            ;;
        clean)
            docker compose -f docker/docker-compose.full.yml down -v
            docker system prune -f
            echo "✅ Production cleaned"
            ;;
        *)
            echo "Usage: just prod [start|stop|build|logs|status|clean]"
            ;;
    esac

# === Infrastructure Only ===

# Manage infrastructure containers separately
infra action="up":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{action}}" in
        up)
            docker compose -f docker/docker-compose.infra.yml up -d
            echo "✅ Infrastructure started (Postgres, Temporal, MinIO, Redis)"
            ;;
        down)
            docker compose -f docker/docker-compose.infra.yml down
            echo "✅ Infrastructure stopped"
            ;;
        logs)
            docker compose -f docker/docker-compose.infra.yml logs -f
            ;;
        clean)
            docker compose -f docker/docker-compose.infra.yml down -v
            echo "✅ Infrastructure cleaned"
            ;;
        *)
            echo "Usage: just infra [up|down|logs|clean]"
            ;;
    esac

# === Utilities ===

# Show status of all services
status:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "📊 ShipSec Studio Status"
    echo ""
    echo "=== PM2 Services ==="
    pm2 status 2>/dev/null || echo "  (PM2 not running)"
    echo ""
    echo "=== Infrastructure Containers ==="
    docker compose -f docker/docker-compose.infra.yml ps 2>/dev/null || echo "  (Infrastructure not running)"
    echo ""
    echo "=== Production Containers ==="
    docker compose -f docker/docker-compose.full.yml ps 2>/dev/null || echo "  (Production not running)"

# Reset database (drops all data)
db-reset:
    #!/usr/bin/env bash
    set -euo pipefail
    if ! docker ps --filter "name=shipsec-postgres" --format "{{{{.Names}}}}" | grep -q "shipsec-postgres"; then
        echo "❌ PostgreSQL not running. Run: just dev" && exit 1
    fi
    docker exec shipsec-postgres psql -U shipsec -d postgres -c "DROP DATABASE IF EXISTS shipsec;"
    docker exec shipsec-postgres psql -U shipsec -d postgres -c "CREATE DATABASE shipsec;"
    bun --cwd=backend run migration:push
    echo "✅ Database reset"

# Build production images without starting
build:
    docker compose -f docker/docker-compose.full.yml build
    echo "✅ Images built"

# === Help ===

help:
    @echo "ShipSec Studio"
    @echo ""
    @echo "Development (hot-reload):"
    @echo "  just dev        Start development environment"
    @echo "  just dev stop   Stop everything"
    @echo "  just dev logs   View application logs"
    @echo ""
    @echo "Production (Docker):"
    @echo "  just prod         Start with cached images"
    @echo "  just prod build   Rebuild and start"
    @echo "  just prod stop    Stop production"
    @echo "  just prod logs    View production logs"
    @echo "  just prod clean   Remove all data"
    @echo ""
    @echo "Utilities:"
    @echo "  just status       Show status of all services"
    @echo "  just infra up     Start only infrastructure"
    @echo "  just db-reset     Reset database"
    @echo "  just build        Build images only"
