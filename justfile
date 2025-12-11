#!/usr/bin/env just

# ShipSec Studio - Development Environment
# Run `just` or `just help` to see available commands

default:
    @just help

# === Development (recommended for contributors) ===

# Initialize environment files from examples
init:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🔧 Setting up ShipSec Studio..."

    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        echo "📦 Installing dependencies..."
        bun install
        echo "✅ Dependencies installed"
    else
        echo "✅ Dependencies already installed"
    fi

    # Copy env files if they don't exist
    [ ! -f "backend/.env" ] && cp backend/.env.example backend/.env && echo "✅ Created backend/.env"
    [ ! -f "worker/.env" ] && cp worker/.env.example worker/.env && echo "✅ Created worker/.env"
    [ ! -f "frontend/.env" ] && cp frontend/.env.example frontend/.env && echo "✅ Created frontend/.env"

    echo ""
    echo "🎉 Setup complete!"
    echo "   Edit the .env files to configure your environment"
    echo "   Then run: just dev"

# Start development environment with hot-reload
dev action="start":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{action}}" in
        start)
            echo "🚀 Starting development environment..."

            # Check for required env files
            if [ ! -f "backend/.env" ] || [ ! -f "worker/.env" ] || [ ! -f "frontend/.env" ]; then
                echo "❌ Environment files not found!"
                echo ""
                echo "   Run this first: just init"
                echo ""
                echo "   This will create .env files from the example templates."
                exit 1
            fi

            # Start infrastructure
            docker compose -f docker/docker-compose.infra.yml up -d

            # Wait for Postgres
            echo "⏳ Waiting for infrastructure..."
            timeout 30s bash -c 'until docker exec shipsec-postgres pg_isready -U shipsec >/dev/null 2>&1; do sleep 1; done' || true

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
            echo ""

            # Version check
            bun backend/scripts/version-check-summary.ts 2>/dev/null || true
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
        clean)
            echo "🧹 Cleaning development environment..."
            pm2 delete shipsec-frontend shipsec-backend shipsec-worker shipsec-test-worker 2>/dev/null || true
            docker compose -f docker/docker-compose.infra.yml down -v
            echo "✅ Development environment cleaned (PM2 stopped, infrastructure volumes removed)"
            ;;
        *)
            echo "Usage: just dev [start|stop|logs|status|clean]"
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
            echo ""

            # Version check
            bun backend/scripts/version-check-summary.ts 2>/dev/null || true
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
            echo ""

            # Version check
            bun backend/scripts/version-check-summary.ts 2>/dev/null || true
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
    @echo "Getting Started:"
    @echo "  just init       Set up dependencies and environment files"
    @echo ""
    @echo "Development (hot-reload):"
    @echo "  just dev          Start development environment"
    @echo "  just dev stop     Stop everything"
    @echo "  just dev logs     View application logs"
    @echo "  just dev status   Check service status"
    @echo "  just dev clean    Stop and remove all data"
    @echo ""
    @echo "Production (Docker):"
    @echo "  just prod          Start with cached images"
    @echo "  just prod build    Rebuild and start"
    @echo "  just prod stop     Stop production"
    @echo "  just prod logs     View production logs"
    @echo "  just prod status   Check production status"
    @echo "  just prod clean    Remove all data"
    @echo ""
    @echo "Infrastructure:"
    @echo "  just infra up      Start infrastructure only"
    @echo "  just infra down    Stop infrastructure"
    @echo "  just infra logs    View infrastructure logs"
    @echo "  just infra clean   Remove infrastructure data"
    @echo ""
    @echo "Utilities:"
    @echo "  just status        Show status of all services"
    @echo "  just db-reset      Reset database"
    @echo "  just build         Build images only"
