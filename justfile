#!/usr/bin/env just

default:
    @just help

# Initialize environment files from examples
init:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🔧  Setting up ShipSec Studio..."
    if [ ! -d "node_modules" ]; then
        echo "📦  Installing dependencies..."
        bun install
        echo "✅  Dependencies installed"
    else
        echo "✅  Dependencies already installed"
    fi

    [ ! -f "backend/.env" ] && cp backend/.env.example backend/.env && echo "✅  Created backend/.env"
    [ ! -f "worker/.env" ] && cp worker/.env.example worker/.env && echo "✅  Created worker/.env"
    [ ! -f "frontend/.env" ] && cp frontend/.env.example frontend/.env && echo "✅  Created frontend/.env"

    echo ""
    echo "🎉  Setup complete!"
    echo "   Provide runtime services separately, then run: just dev"

# Start/stop app processes only. Runtime services are expected to be provided externally.
dev action="start":
    #!/usr/bin/env bash
    set -euo pipefail

    if [ -n "${SHIPSEC_INSTANCE:-}" ]; then
        INST="${SHIPSEC_INSTANCE}"
    elif [ -f ".shipsec-instance" ]; then
        INST="$(tr -d '[:space:]' < .shipsec-instance || true)"
        INST="${INST:-0}"
    else
        INST="0"
    fi
    export SHIPSEC_INSTANCE="$INST"

    PM2_APPS="shipsec-frontend-${INST},shipsec-backend-${INST},shipsec-worker-${INST}"

    case "{{action}}" in
        start)
            if [ ! -f "backend/.env" ] || [ ! -f "worker/.env" ] || [ ! -f "frontend/.env" ]; then
                echo "❌  Environment files not found. Run: just init"
                exit 1
            fi

            ./scripts/instance-env.sh init "$INST" --force

            INST_DIR=".instances/instance-${INST}"
            BE_ENV="${INST_DIR}/backend.env"; [ ! -f "$BE_ENV" ] && BE_ENV="backend/.env"
            WK_ENV="${INST_DIR}/worker.env";  [ ! -f "$WK_ENV" ] && WK_ENV="worker/.env"
            FE_ENV="${INST_DIR}/frontend.env"; [ ! -f "$FE_ENV" ] && FE_ENV="frontend/.env"

            echo "🔍  Validating environment variables..."
            bun --env-file="$BE_ENV" backend/scripts/validate-env.ts
            bun --env-file="$WK_ENV" worker/scripts/validate-env.ts
            bun --env-file="$FE_ENV" frontend/scripts/validate-env.ts

            echo "🗄️  Running database migrations against configured DATABASE_URL..."
            bun --env-file="$BE_ENV" --cwd=backend run migration:migrate

            ./scripts/set-git-sha.sh || true
            SHIPSEC_INSTANCE="$INST" SHIPSEC_ENV=development NODE_ENV=development \
                pm2 startOrReload pm2.config.cjs --only "$PM2_APPS" --update-env

            echo ""
            echo "✅  Studio app processes started for instance ${INST}"
            echo "   Runtime services must already be available via your configured envs."
            ;;
        stop)
            pm2 delete shipsec-frontend-${INST} shipsec-backend-${INST} shipsec-worker-${INST} 2>/dev/null || true
            echo "✅  Stopped instance ${INST}"
            ;;
        logs)
            pm2 logs shipsec-frontend-${INST} shipsec-backend-${INST} shipsec-worker-${INST}
            ;;
        status)
            pm2 status
            ;;
        clean)
            pm2 delete shipsec-frontend-${INST} shipsec-backend-${INST} shipsec-worker-${INST} 2>/dev/null || true
            echo "✅  Cleared PM2 app processes for instance ${INST}"
            ;;
        *)
            echo "Usage: just dev [start|stop|logs|status|clean]"
            exit 1
            ;;
    esac

status:
    #!/usr/bin/env bash
    set -euo pipefail
    pm2 status 2>/dev/null || echo "PM2 not running"

db-reset:
    @echo "Database reset helpers tied to runtime orchestration were removed from the public repo."
    @echo "Reset your database using your own runtime setup, then run: bun --cwd backend run migration:migrate"
    @exit 1

build:
    @echo "Build published images with the root Dockerfile, for example:"
    @echo "  docker build --target backend -t ghcr.io/shipsecai/studio-backend:latest ."

instance action="show" value="":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{action}}" in
        show)
            ./scripts/active-instance.sh get
            ;;
        use)
            if [ -z "{{value}}" ]; then
                echo "Usage: just instance use <0-9>"
                exit 1
            fi
            ./scripts/active-instance.sh set "{{value}}"
            ;;
        *)
            echo "Usage: just instance [show|use <0-9>]"
            exit 1
            ;;
    esac

instance-init instance="":
    #!/usr/bin/env bash
    set -euo pipefail
    INST="{{instance}}"
    if [ -z "$INST" ]; then
        INST="$(./scripts/active-instance.sh get)"
    fi
    ./scripts/instance-env.sh init "$INST"

instance-env +args:
    #!/usr/bin/env bash
    set -euo pipefail
    ./scripts/instance-env.sh {{args}}

help:
    @echo "ShipSec Studio"
    @echo ""
    @echo "Setup:"
    @echo "  just init                  Install deps and create env files"
    @echo ""
    @echo "Source Development:"
    @echo "  just dev                   Start app processes from source"
    @echo "  just dev stop              Stop app processes"
    @echo "  just dev logs              View PM2 logs"
    @echo "  just dev status            Check PM2 status"
    @echo "  just dev clean             Remove PM2 app processes"
    @echo ""
    @echo "Multi-Instance:"
    @echo "  just instance show"
    @echo "  just instance use N"
    @echo "  just instance-init [N]"
    @echo "  just instance-env init [N] [--force]"
    @echo "  just instance-env update [N]"
    @echo "  just instance-env copy SRC DEST"
    @echo "  just instance-env show [N]"
    @echo ""
    @echo "Utilities:"
    @echo "  just status                Show PM2 status"
    @echo "  just build                 Show image build hint"
