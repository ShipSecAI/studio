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

# Initialize production environment with secure secrets
# Creates docker/.env with auto-generated secrets if not present
prod-init:
    #!/usr/bin/env bash
    set -euo pipefail
    ENV_FILE="docker/.env"

    echo "🔧 Initializing production environment..."

    # Create docker/.env if it doesn't exist
    if [ ! -f "$ENV_FILE" ]; then
        echo "📝 Creating $ENV_FILE..."
        touch "$ENV_FILE"
    fi

    # Source existing env file to check for existing values
    set -a
    [ -f "$ENV_FILE" ] && source "$ENV_FILE"
    set +a

    UPDATED=false

    # Generate INTERNAL_SERVICE_TOKEN if not set
    if [ -z "${INTERNAL_SERVICE_TOKEN:-}" ]; then
        TOKEN=$(openssl rand -hex 32)
        echo "INTERNAL_SERVICE_TOKEN=$TOKEN" >> "$ENV_FILE"
        echo "🔑 Generated INTERNAL_SERVICE_TOKEN"
        UPDATED=true
    else
        echo "✅ INTERNAL_SERVICE_TOKEN already set"
    fi

    # Generate SECRET_STORE_MASTER_KEY if not set (exactly 32 characters, raw string)
    if [ -z "${SECRET_STORE_MASTER_KEY:-}" ]; then
        KEY=$(openssl rand -base64 24 | head -c 32)
        echo "SECRET_STORE_MASTER_KEY=$KEY" >> "$ENV_FILE"
        echo "🔑 Generated SECRET_STORE_MASTER_KEY"
        UPDATED=true
    else
        echo "✅ SECRET_STORE_MASTER_KEY already set"
    fi

    if [ "$UPDATED" = true ]; then
        echo ""
        echo "✅ Secrets generated and saved to $ENV_FILE"
        echo "⚠️  Keep this file secure and never commit it to git!"
    fi

    echo ""
    echo "📋 Current configuration in $ENV_FILE:"
    echo "   Run 'cat $ENV_FILE' to view"
    echo ""
    echo "💡 Next steps:"
    echo "   1. Edit $ENV_FILE to add other required variables (CLERK keys, etc.)"
    echo "   2. Run 'just prod start-latest' to start with latest release"

# Run production environment in Docker
prod action="start":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{action}}" in
        start)
            echo "🚀 Starting production environment..."
            # Use --env-file if docker/.env exists
            ENV_FLAG=""
            [ -f "docker/.env" ] && ENV_FLAG="--env-file docker/.env"
            docker compose $ENV_FLAG -f docker/docker-compose.full.yml up -d
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

            # Auto-detect git version: prioritize tag, then SHA, then "dev"
            GIT_TAG=$(git describe --exact-match --tags 2>/dev/null || echo "")
            if [ -n "$GIT_TAG" ]; then
                export GIT_SHA="$GIT_TAG"
                echo "📌 Building with tag: $GIT_SHA"
            else
                export GIT_SHA=$(git rev-parse --short=7 HEAD 2>/dev/null || echo "dev")
                echo "📌 Building with commit: $GIT_SHA"
            fi

            # Use --env-file if docker/.env exists
            ENV_FLAG=""
            [ -f "docker/.env" ] && ENV_FLAG="--env-file docker/.env"
            docker compose $ENV_FLAG -f docker/docker-compose.full.yml up -d --build
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
        start-latest)
            # Auto-initialize secrets if docker/.env doesn't exist
            if [ ! -f "docker/.env" ]; then
                echo "⚠️  docker/.env not found, running prod-init..."
                just prod-init
            fi

            echo "🔍 Fetching latest release information from GitHub API..."
            if ! command -v curl &> /dev/null || ! command -v jq &> /dev/null; then
                echo "❌ curl or jq is not installed. Please install them first."
                exit 1
            fi
            
            LATEST_TAG=$(curl -s https://api.github.com/repos/ShipSecAI/studio/releases | jq -r '.[0].tag_name')
            
            # Strip leading 'v' if present (v0.1-rc2 -> 0.1-rc2)
            LATEST_TAG="${LATEST_TAG#v}"
            
            if [ "$LATEST_TAG" == "null" ] || [ -z "$LATEST_TAG" ]; then
                echo "❌ Could not find any releases. Please check the repository at https://github.com/ShipSecAI/studio/releases"
                exit 1
            fi
            
            echo "📦 Found latest release: $LATEST_TAG"
            
            echo "📥 Pulling matching images from GHCR..."
            docker pull ghcr.io/shipsecai/studio-backend:$LATEST_TAG
            docker pull ghcr.io/shipsecai/studio-frontend:$LATEST_TAG
            docker pull ghcr.io/shipsecai/studio-worker:$LATEST_TAG
            
            echo "🚀 Starting production environment with version $LATEST_TAG..."
            export SHIPSEC_TAG=$LATEST_TAG
            # Use --env-file if docker/.env exists
            ENV_FLAG=""
            [ -f "docker/.env" ] && ENV_FLAG="--env-file docker/.env"
            docker compose $ENV_FLAG -f docker/docker-compose.full.yml up -d

            echo ""
            echo "✅ ShipSec Studio $LATEST_TAG ready"
            echo "   Frontend:    http://localhost:8090"
            echo "   Backend:     http://localhost:3211"
            echo "   Temporal UI: http://localhost:8081"
            echo ""
            echo "💡 Note: Using images tagged as $LATEST_TAG"
            ;;
        *)
            echo "Usage: just prod [start|start-latest|stop|build|logs|status|clean]"
            ;;
    esac

# === Production Images (GHCR-based) ===

# Run production environment using prebuilt GHCR images
prod-images action="start":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{action}}" in
        start)
            # Auto-initialize secrets if docker/.env doesn't exist
            if [ ! -f "docker/.env" ]; then
                echo "⚠️  docker/.env not found, running prod-init..."
                just prod-init
            fi

            echo "🚀 Starting production environment with GHCR images..."

            # Check if images exist locally, pull if needed
            echo "🔍 Checking for local images..."
            if ! docker images --format "{{{{.Repository}}}}:{{{{.Tag}}}}" | grep -q "ghcr.io/shipsecai/studio-frontend"; then
                echo "📥 Pulling GHCR images..."
                docker pull ghcr.io/shipsecai/studio-frontend:latest || echo "⚠️  Frontend image not found, will build locally"
            else
                echo "✅ Frontend image found locally"
            fi
            if ! docker images --format "{{{{.Repository}}}}:{{{{.Tag}}}}" | grep -q "ghcr.io/shipsecai/studio-backend"; then
                docker pull ghcr.io/shipsecai/studio-backend:latest || echo "⚠️  Backend image not found, will build locally"
            else
                echo "✅ Backend image found locally"
            fi
            if ! docker images --format "{{{{.Repository}}}}:{{{{.Tag}}}}" | grep -q "ghcr.io/shipsecai/studio-worker"; then
                docker pull ghcr.io/shipsecai/studio-worker:latest || echo "⚠️  Worker image not found, will build locally"
            else
                echo "✅ Worker image found locally"
            fi

            # Start with GHCR images, fallback to local build
            # Use --env-file if docker/.env exists
            ENV_FLAG=""
            [ -f "docker/.env" ] && ENV_FLAG="--env-file docker/.env"
            DOCKER_BUILDKIT=1 docker compose $ENV_FLAG -f docker/docker-compose.full.yml up -d
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
        build-test)
            echo "🔨 Building test images with PostHog analytics..."
            if [ -z "${POSTHOG_API_KEY:-}" ] || [ -z "${POSTHOG_HOST:-}" ]; then
                echo "❌ POSTHOG_API_KEY and POSTHOG_HOST must be set in your environment for this command"
                exit 1
            fi

            # Build with PostHog keys (debug version - non-minified)
            DOCKER_BUILDKIT=1 docker build \
                --target frontend-debug \
                --build-arg VITE_PUBLIC_POSTHOG_KEY=$POSTHOG_API_KEY \
                --build-arg VITE_PUBLIC_POSTHOG_HOST=$POSTHOG_HOST \
                -t ghcr.io/shipsecai/studio-frontend:latest \
                .

            DOCKER_BUILDKIT=1 docker build \
                --target backend \
                --build-arg POSTHOG_API_KEY=$POSTHOG_API_KEY \
                --build-arg POSTHOG_HOST=$POSTHOG_HOST \
                -t ghcr.io/shipsecai/studio-backend:latest \
                .

            DOCKER_BUILDKIT=1 docker build \
                --target worker \
                --build-arg POSTHOG_API_KEY=$POSTHOG_API_KEY \
                --build-arg POSTHOG_HOST=$POSTHOG_HOST \
                -t ghcr.io/shipsecai/studio-worker:latest \
                .

            echo "✅ Test images built with PostHog analytics"
            echo "   Run: just prod-images start"
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
            echo "Usage: just prod-images [start|stop|build-test|logs|status|clean]"
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
    @echo "  just prod-init     Generate secrets in docker/.env (run once)"
    @echo "  just prod          Start with cached images"
    @echo "  just prod build    Rebuild and start"
    @echo "  just prod start-latest  Download latest release and start"
    @echo "  just prod stop     Stop production"
    @echo "  just prod logs     View production logs"
    @echo "  just prod status   Check production status"
    @echo "  just prod clean    Remove all data"
    @echo "  just prod-images   Start with GHCR images (uses cache)"
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
