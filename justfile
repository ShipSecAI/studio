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
# Usage: just dev [instance] [action]
# Examples: just dev, just dev 1, just dev 2 start, just dev 1 logs, just dev stop all
dev *args:
    #!/usr/bin/env bash
    set -euo pipefail
    
    # Parse arguments: instance can be 0-9, action is start/stop/logs/status/clean
    INSTANCE="0"
    ACTION="start"
    
    # Process arguments
    for arg in {{args}}; do
        case "$arg" in
            [0-9])
                INSTANCE="$arg"
                ;;
            start|stop|logs|status|clean|all)
                ACTION="$arg"
                ;;
            *)
                echo "❌ Unknown argument: $arg"
                echo "Usage: just dev [instance] [action]"
                echo "  instance: 0-9 (default: 0)"
                echo "  action:   start|stop|logs|status|clean|all"
                exit 1
                ;;
        esac
    done
    
    # Handle special case: dev stop all
    if [ "$ACTION" = "all" ] && [ "$INSTANCE" = "stop" ]; then
        ACTION="stop"
        INSTANCE="all"
    fi
    
    # Handle "just dev stop" as "just dev 0 stop"
    if [ "$ACTION" = "stop" ] && [ "$INSTANCE" = "0" ] && [ -z "{{args}}" ]; then
        true  # Keep defaults
    fi
    
    # Get ports for this instance
    eval "$(./scripts/dev-instance-manager.sh ports "$INSTANCE")"
    COMPOSE_PROJECT_NAME=$(./scripts/dev-instance-manager.sh project-name "$INSTANCE")
    INSTANCE_DIR=".instances/instance-$INSTANCE"
    
    case "$ACTION" in
        start)
            echo "🚀 Starting development environment (instance $INSTANCE)..."
            
            # Initialize instance if needed
            if [ ! -d "$INSTANCE_DIR" ]; then
                ./scripts/dev-instance-manager.sh init "$INSTANCE"
            fi
            
            # Check for required env files
            if [ ! -f "$INSTANCE_DIR/backend.env" ] || [ ! -f "$INSTANCE_DIR/worker.env" ] || [ ! -f "$INSTANCE_DIR/frontend.env" ]; then
                echo "❌ Environment files not found in $INSTANCE_DIR!"
                echo ""
                echo "   Attempting to initialize instance $INSTANCE..."
                ./scripts/dev-instance-manager.sh init "$INSTANCE"
            fi
            
            # Check for original env files if instance is 0
            if [ "$INSTANCE" = "0" ] && { [ ! -f "backend/.env" ] || [ ! -f "worker/.env" ] || [ ! -f "frontend/.env" ]; }; then
                echo "❌ Environment files not found!"
                echo ""
                echo "   Run this first: just init"
                echo ""
                echo "   This will create .env files from the example templates."
                exit 1
            fi
            
            # Start infrastructure with Docker Compose project isolation
            echo "⏳ Starting infrastructure (instance $INSTANCE)..."
            docker compose -f docker/docker-compose.infra.yml \
                --project-name="$COMPOSE_PROJECT_NAME" \
                -f "$INSTANCE_DIR/docker-compose.override.yml" \
                up -d
            
            # Wait for Postgres
            echo "⏳ Waiting for infrastructure..."
            POSTGRES_CONTAINER="${COMPOSE_PROJECT_NAME}-postgres-1"
            timeout 30s bash -c "until docker exec $POSTGRES_CONTAINER pg_isready -U shipsec >/dev/null 2>&1; do sleep 1; done" || true
            
            # Prepare PM2 environment variables
            export SHIPSEC_INSTANCE="$INSTANCE"
            export SHIPSEC_ENV=development
            export NODE_ENV=development
            export TERMINAL_REDIS_URL="redis://localhost:$REDIS"
            export LOG_KAFKA_BROKERS="localhost:$REDPANDA"
            export EVENT_KAFKA_BROKERS="localhost:$REDPANDA"
            
            # Update git SHA and start PM2 with instance-specific config
            ./scripts/set-git-sha.sh || true
            
            # Use instance-specific PM2 app names
            pm2 startOrReload pm2.config.cjs \
                --only "shipsec-frontend-$INSTANCE,shipsec-backend-$INSTANCE,shipsec-worker-$INSTANCE" \
                --update-env --merge
            
            echo ""
            echo "✅ Development environment ready (instance $INSTANCE)"
            ./scripts/dev-instance-manager.sh info "$INSTANCE"
            echo ""
            echo "💡 just dev $INSTANCE logs   - View application logs"
            echo "💡 just dev $INSTANCE stop   - Stop this instance"
            echo ""
            
            # Version check
            bun backend/scripts/version-check-summary.ts 2>/dev/null || true
            ;;
        stop)
            if [ "$INSTANCE" = "all" ]; then
                echo "🛑 Stopping all development environments..."
                
                # Stop all PM2 apps
                pm2 delete shipsec-frontend-{0,1,2,3,4,5,6,7,8,9} 2>/dev/null || true
                pm2 delete shipsec-backend-{0,1,2,3,4,5,6,7,8,9} 2>/dev/null || true
                pm2 delete shipsec-worker-{0,1,2,3,4,5,6,7,8,9} 2>/dev/null || true
                pm2 delete shipsec-test-worker 2>/dev/null || true
                
                # Stop all Docker Compose projects
                for i in {0..9}; do
                    project="shipsec-dev-$i"
                    docker compose -f docker/docker-compose.infra.yml \
                        --project-name="$project" \
                        down 2>/dev/null || true
                done
                
                echo "✅ All development environments stopped"
            else
                echo "🛑 Stopping development environment (instance $INSTANCE)..."
                
                # Stop PM2 apps for this instance
                pm2 delete "shipsec-frontend-$INSTANCE" 2>/dev/null || true
                pm2 delete "shipsec-backend-$INSTANCE" 2>/dev/null || true
                pm2 delete "shipsec-worker-$INSTANCE" 2>/dev/null || true
                
                # Stop Docker containers for this instance
                docker compose -f docker/docker-compose.infra.yml \
                    --project-name="$COMPOSE_PROJECT_NAME" \
                    down
                
                echo "✅ Instance $INSTANCE stopped"
            fi
            ;;
        logs)
            if [ "$INSTANCE" = "all" ]; then
                echo "📋 Viewing logs for all instances..."
                pm2 logs
            else
                echo "📋 Viewing logs for instance $INSTANCE..."
                pm2 logs "shipsec-frontend-$INSTANCE|shipsec-backend-$INSTANCE|shipsec-worker-$INSTANCE"
            fi
            ;;
        status)
            if [ "$INSTANCE" = "all" ]; then
                echo "📊 Status of all instances:"
                echo ""
                echo "=== PM2 Services ==="
                pm2 status 2>/dev/null || echo "(PM2 not running)"
                echo ""
                echo "=== Docker Containers ==="
                for i in {0..9}; do
                    project="shipsec-dev-$i"
                    docker compose -f docker/docker-compose.infra.yml \
                        --project-name="$project" \
                        ps 2>/dev/null || true
                done
            else
                echo "📊 Status of instance $INSTANCE:"
                echo ""
                pm2 status 2>/dev/null | grep -E "shipsec-(frontend|backend|worker)-$INSTANCE|error" || echo "(Instance $INSTANCE not running in PM2)"
                echo ""
                docker compose -f docker/docker-compose.infra.yml \
                    --project-name="$COMPOSE_PROJECT_NAME" \
                    ps
            fi
            ;;
        clean)
            echo "🧹 Cleaning instance $INSTANCE..."
            
            # Stop PM2 apps
            pm2 delete "shipsec-frontend-$INSTANCE" 2>/dev/null || true
            pm2 delete "shipsec-backend-$INSTANCE" 2>/dev/null || true
            pm2 delete "shipsec-worker-$INSTANCE" 2>/dev/null || true
            
            # Remove Docker volumes
            docker compose -f docker/docker-compose.infra.yml \
                --project-name="$COMPOSE_PROJECT_NAME" \
                down -v
            
            # Remove instance directory
            rm -rf "$INSTANCE_DIR"
            
            echo "✅ Instance $INSTANCE cleaned (PM2 stopped, infrastructure volumes removed)"
            ;;
        *)
            echo "Usage: just dev [instance] [action]"
            echo "  instance: 0-9 (default: 0)"
            echo "  action:   start|stop|logs|status|clean"
            exit 1
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
    @echo "Development (hot-reload, multi-instance support):"
    @echo "  just dev                Start instance 0 (default)"
    @echo "  just dev 1              Start instance 1"
    @echo "  just dev 2 start        Explicitly start instance 2"
    @echo "  just dev 1 stop         Stop instance 1"
    @echo "  just dev 2 logs         View instance 2 logs"
    @echo "  just dev 0 status       Check instance 0 status"
    @echo "  just dev 1 clean        Stop and remove instance 1 data"
    @echo "  just dev stop all       Stop all instances at once"
    @echo "  just dev status all     Check status of all instances"
    @echo ""
    @echo "  Note: Each instance uses isolated Docker containers + PM2 processes"
    @echo "        Instance N uses base_port + N*100 (e.g., instance 0 uses 5173, instance 1 uses 5273)"
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
