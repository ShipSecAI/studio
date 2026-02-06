#!/usr/bin/env just

# ShipSec Studio - Development Environment
# Run `just` or `just help` to see available commands

default:
    @just help

# === Development (recommended for contributors) ===

# Default dev passwords for convenience (override with env vars for real security)
export OPENSEARCH_ADMIN_PASSWORD := env_var_or_default("OPENSEARCH_ADMIN_PASSWORD", "admin")
export OPENSEARCH_DASHBOARDS_PASSWORD := env_var_or_default("OPENSEARCH_DASHBOARDS_PASSWORD", "admin")

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
# Auto-detects auth mode: if CLERK_SECRET_KEY is set in backend/.env → secure mode (Clerk + OpenSearch Security)
# Otherwise → local auth mode (faster startup, no multi-tenant isolation)
dev action="start":
    #!/usr/bin/env bash
    set -euo pipefail

    # Auto-detect auth mode from backend/.env
    CLERK_KEY=""
    if [ -f "backend/.env" ]; then
        CLERK_KEY=$(grep -E '^CLERK_SECRET_KEY=' backend/.env | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs || true)
    fi

    if [ -n "$CLERK_KEY" ]; then
        SECURE_MODE=true
    else
        SECURE_MODE=false
    fi

    case "{{action}}" in
        start)
            # Check for required env files
            if [ ! -f "backend/.env" ] || [ ! -f "worker/.env" ] || [ ! -f "frontend/.env" ]; then
                echo "❌ Environment files not found!"
                echo ""
                echo "   Run this first: just init"
                echo ""
                echo "   This will create .env files from the example templates."
                exit 1
            fi

            if [ "$SECURE_MODE" = "true" ]; then
                echo "🔐 Starting development environment (Clerk auth detected)..."

                # Auto-generate certificates if they don't exist
                if [ ! -f "docker/certs/root-ca.pem" ]; then
                    echo "🔐 Generating TLS certificates..."
                    chmod +x docker/scripts/generate-certs.sh
                    docker/scripts/generate-certs.sh
                    echo "✅ Certificates generated"
                fi

                # Start infrastructure with security enabled
                # Note: dev-ports.yml exposes OpenSearch on localhost for backend tenant provisioning
                echo "🚀 Starting infrastructure with OpenSearch Security..."
                docker compose -f docker/docker-compose.infra.yml -f docker/docker-compose.dev-secure.yml -f docker/docker-compose.dev-ports.yml up -d

                # Wait for Postgres
                echo "⏳ Waiting for infrastructure..."
                timeout 30s bash -c 'until docker exec shipsec-postgres pg_isready -U shipsec >/dev/null 2>&1; do sleep 1; done' || true

                # Wait for OpenSearch to be healthy (security init takes longer)
                echo "⏳ Waiting for OpenSearch security initialization..."
                timeout 120s bash -c 'until docker exec shipsec-opensearch curl -sf -u admin:${OPENSEARCH_ADMIN_PASSWORD:-admin} --cacert /usr/share/opensearch/config/certs/root-ca.pem https://localhost:9200/_cluster/health >/dev/null 2>&1; do sleep 2; done' || true

                # Update git SHA and start PM2 with security enabled
                ./scripts/set-git-sha.sh || true
                SHIPSEC_ENV=development NODE_ENV=development OPENSEARCH_SECURITY_ENABLED=true NODE_TLS_REJECT_UNAUTHORIZED=0 \
                    pm2 startOrReload pm2.config.cjs --only shipsec-frontend,shipsec-backend,shipsec-worker --update-env

                echo ""
                echo "✅ Development environment ready (secure mode)"
                echo "   App:         http://localhost (via nginx)"
                echo "   API:         http://localhost/api"
                echo "   Analytics:   http://localhost/analytics (requires login)"
                echo "   Temporal UI: http://localhost:8081"
                echo ""
                echo "🔐 OpenSearch Security: ENABLED (multi-tenant isolation active)"
                echo "   OpenSearch admin: admin / ${OPENSEARCH_ADMIN_PASSWORD:-admin}"
                echo ""
                echo "💡 Direct ports (debugging): Frontend :5173, Backend :3211"
            else
                echo "🚀 Starting development environment (local auth)..."

                # Start infrastructure (no security, with dev ports for analytics)
                docker compose -f docker/docker-compose.infra.yml -f docker/docker-compose.dev-ports.yml up -d

                # Wait for Postgres
                echo "⏳ Waiting for infrastructure..."
                timeout 30s bash -c 'until docker exec shipsec-postgres pg_isready -U shipsec >/dev/null 2>&1; do sleep 1; done' || true

                # Update git SHA and start PM2
                ./scripts/set-git-sha.sh || true
                SHIPSEC_ENV=development NODE_ENV=development OPENSEARCH_SECURITY_ENABLED=false \
                    OPENSEARCH_URL=http://localhost:9200 \
                    pm2 startOrReload pm2.config.cjs --only shipsec-frontend,shipsec-backend,shipsec-worker --update-env

                echo ""
                echo "✅ Development environment ready (local auth)"
                echo "   App:         http://localhost (via nginx)"
                echo "   Analytics:   http://localhost/analytics"
                echo "   Temporal UI: http://localhost:8081"
                echo ""
                echo "💡 Direct ports (debugging): Frontend :5173, Backend :3211, OpenSearch :9200, Dashboards :5601"
                echo ""
                echo "💡 To enable Clerk auth + OpenSearch Security:"
                echo "   Set CLERK_SECRET_KEY in backend/.env, then restart"
            fi

            echo ""
            echo "💡 just dev logs   - View application logs"
            echo "💡 just dev stop   - Stop everything"
            echo "💡 just dev clean  - Stop and remove all data"
            echo ""

            # Version check
            bun backend/scripts/version-check-summary.ts 2>/dev/null || true
            ;;
        stop)
            echo "🛑 Stopping development environment..."
            pm2 delete shipsec-frontend shipsec-backend shipsec-worker shipsec-test-worker 2>/dev/null || true
            if [ "$SECURE_MODE" = "true" ]; then
                docker compose -f docker/docker-compose.infra.yml -f docker/docker-compose.dev-secure.yml -f docker/docker-compose.dev-ports.yml down
            else
                docker compose -f docker/docker-compose.infra.yml -f docker/docker-compose.dev-ports.yml down
            fi
            echo "✅ Stopped"
            ;;
        logs)
            pm2 logs
            ;;
        status)
            pm2 status
            if [ "$SECURE_MODE" = "true" ]; then
                docker compose -f docker/docker-compose.infra.yml -f docker/docker-compose.dev-secure.yml -f docker/docker-compose.dev-ports.yml ps
            else
                docker compose -f docker/docker-compose.infra.yml -f docker/docker-compose.dev-ports.yml ps
            fi
            ;;
        clean)
            echo "🧹 Cleaning development environment..."
            pm2 delete shipsec-frontend shipsec-backend shipsec-worker shipsec-test-worker 2>/dev/null || true
            if [ "$SECURE_MODE" = "true" ]; then
                docker compose -f docker/docker-compose.infra.yml -f docker/docker-compose.dev-secure.yml -f docker/docker-compose.dev-ports.yml down -v
            else
                docker compose -f docker/docker-compose.infra.yml -f docker/docker-compose.dev-ports.yml down -v
            fi
            echo "✅ Development environment cleaned (PM2 stopped, infrastructure volumes removed)"
            ;;
        *)
            echo "Usage: just dev [start|stop|logs|status|clean]"
            ;;
    esac

# === Production (Docker-based) ===

# Run production environment in Docker
# Auto-detects security mode: if TLS certs exist (docker/certs/root-ca.pem) → secure mode with multitenancy
# Otherwise → standard mode without OpenSearch Security
prod action="start":
    #!/usr/bin/env bash
    set -euo pipefail

    # Auto-detect security mode from TLS certificates
    if [ -f "docker/certs/root-ca.pem" ]; then
        SECURE_MODE=true
    else
        SECURE_MODE=false
    fi

    # Compose file selection based on mode
    if [ "$SECURE_MODE" = "true" ]; then
        COMPOSE_CMD="docker compose -f docker/docker-compose.infra.yml -f docker/docker-compose.prod.yml"
    else
        COMPOSE_CMD="docker compose -f docker/docker-compose.full.yml"
    fi

    case "{{action}}" in
        start)
            if [ "$SECURE_MODE" = "true" ]; then
                echo "🔐 Starting production environment (secure mode)..."

                # Check for required env vars in secure mode
                if [ -z "${OPENSEARCH_ADMIN_PASSWORD:-}" ] || [ -z "${OPENSEARCH_DASHBOARDS_PASSWORD:-}" ]; then
                    echo "❌ Required environment variables not set!"
                    echo ""
                    echo "   export OPENSEARCH_ADMIN_PASSWORD='your-secure-password'"
                    echo "   export OPENSEARCH_DASHBOARDS_PASSWORD='your-secure-password'"
                    exit 1
                fi

                $COMPOSE_CMD up -d
                echo ""
                echo "✅ Production environment ready (secure mode)"
                echo "   Analytics:   https://localhost/analytics (requires auth)"
                echo "   OpenSearch:  https://localhost:9200 (TLS enabled)"
                echo ""
                echo "💡 See docker/PRODUCTION.md for customer provisioning"
            else
                echo "🚀 Starting production environment..."
                $COMPOSE_CMD up -d
                echo ""
                echo "✅ Production environment ready"
                echo "   App:         http://localhost"
                echo "   API:         http://localhost/api"
                echo "   Analytics:   http://localhost/analytics"
                echo ""
                echo "🔒 All internal service ports are disabled (no direct access)"
                echo ""
                echo "💡 To enable security + multitenancy:"
                echo "   Run: just generate-certs"
            fi

            # Version check
            bun backend/scripts/version-check-summary.ts 2>/dev/null || true
            ;;
        stop)
            $COMPOSE_CMD down
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

            $COMPOSE_CMD up -d --build
            echo "✅ Production built and started"
            echo ""

            # Version check
            bun backend/scripts/version-check-summary.ts 2>/dev/null || true
            ;;
        logs)
            $COMPOSE_CMD logs -f
            ;;
        status)
            $COMPOSE_CMD ps
            ;;
        clean)
            $COMPOSE_CMD down -v
            docker system prune -f
            echo "✅ Production cleaned"
            ;;
        start-latest)
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
            $COMPOSE_CMD up -d

            echo ""
            echo "✅ ShipSec Studio $LATEST_TAG ready"
            echo "   App:         http://localhost"
            echo "   API:         http://localhost/api"
            echo "   Analytics:   http://localhost/analytics"
            echo ""
            echo "🔒 All internal service ports are disabled (no direct access)"
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
            DOCKER_BUILDKIT=1 docker compose -f docker/docker-compose.full.yml up -d
            echo ""
            echo "✅ Production environment ready"
            echo "   App:         http://localhost"
            echo "   API:         http://localhost/api"
            echo "   Analytics:   http://localhost/analytics"
            echo ""
            echo "🔒 All internal service ports are disabled (no direct access)"
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

# Generate TLS certificates for production
generate-certs:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🔐 Generating TLS certificates..."
    chmod +x docker/scripts/generate-certs.sh
    docker/scripts/generate-certs.sh
    echo ""
    echo "✅ Certificates generated in docker/certs/"
    echo ""
    echo "Next steps:"
    echo "  1. export OPENSEARCH_ADMIN_PASSWORD='your-secure-password'"
    echo "  2. export OPENSEARCH_DASHBOARDS_PASSWORD='your-secure-password'"
    echo "  3. just prod"

# Initialize or reinitialize OpenSearch security index
security-init *args:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🔐 Initializing OpenSearch Security..."
    chmod +x docker/scripts/security-init.sh
    docker/scripts/security-init.sh {{args}}

# Generate BCrypt password hash for OpenSearch internal users
hash-password password="":
    #!/usr/bin/env bash
    set -euo pipefail
    chmod +x docker/scripts/hash-password.sh
    if [ -n "{{password}}" ]; then
        docker/scripts/hash-password.sh "{{password}}"
    else
        docker/scripts/hash-password.sh
    fi

# === Infrastructure Only ===

# Manage infrastructure containers separately
infra action="up":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{action}}" in
        up)
            docker compose -f docker/docker-compose.infra.yml -f docker/docker-compose.dev-ports.yml up -d
            echo "✅ Infrastructure started (Postgres, Temporal, MinIO, Redis)"
            echo "   All ports bound to 127.0.0.1 (localhost only)"
            ;;
        down)
            docker compose -f docker/docker-compose.infra.yml -f docker/docker-compose.dev-ports.yml down
            echo "✅ Infrastructure stopped"
            ;;
        logs)
            docker compose -f docker/docker-compose.infra.yml -f docker/docker-compose.dev-ports.yml logs -f
            ;;
        clean)
            docker compose -f docker/docker-compose.infra.yml -f docker/docker-compose.dev-ports.yml down -v
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
    @echo "Development (hot-reload, auto-detects auth mode):"
    @echo "  just dev          Start dev (Clerk creds in .env → secure mode, otherwise local auth)"
    @echo "  just dev stop     Stop everything"
    @echo "  just dev logs     View application logs"
    @echo "  just dev status   Check service status"
    @echo "  just dev clean    Stop and remove all data"
    @echo ""
    @echo "Production (Docker, auto-detects security mode):"
    @echo "  just prod          Start prod (TLS certs present → secure mode, otherwise standard)"
    @echo "  just prod build    Rebuild and start"
    @echo "  just prod start-latest  Download latest release and start"
    @echo "  just prod stop     Stop production"
    @echo "  just prod logs     View production logs"
    @echo "  just prod status   Check production status"
    @echo "  just prod clean    Remove all data"
    @echo ""
    @echo "Security Management:"
    @echo "  just security-init      Initialize OpenSearch security index"
    @echo "  just security-init --force  Reinitialize (update config)"
    @echo "  just hash-password      Generate BCrypt hash for passwords"
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
