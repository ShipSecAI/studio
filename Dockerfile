# Optimized multi-stage Dockerfile for backend, worker, and frontend
#
# Key optimizations:
# 1. Per-target dependency installs — backend doesn't carry monaco-editor, frontend React libs, etc.
# 2. Package-manifest-only layers for bun install caching (code changes don't re-install deps)
# 3. Build tools (python3, make, g++) only in builder stages — not shipped to runtime
# 4. Frontend served by nginx:alpine (~30MB) instead of full bun runtime (~1.5GB)
# 5. Worker installs node + docker-cli only (the sole target that needs them)

# ============================================================================
# BUILDER BASE — shared base with native build tools for compilation
# ============================================================================
FROM oven/bun:1-slim AS builder-base

# Native modules (temporalio, node-pty) need these for compilation only
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ============================================================================
# DEPS — full workspace install (needed for frontend build which imports from all packages)
# ============================================================================
FROM builder-base AS deps

COPY bunfig.toml bun.lock package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/backend-client/package.json packages/backend-client/package.json
COPY packages/component-sdk/package.json packages/component-sdk/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY worker/package.json worker/package.json

RUN bun install --frozen-lockfile

# ============================================================================
# DEPS-BACKEND — only backend + worker + packages (no frontend deps like monaco, react, etc.)
# ============================================================================
FROM builder-base AS deps-backend

COPY bunfig.toml bun.lock package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/backend-client/package.json packages/backend-client/package.json
COPY packages/component-sdk/package.json packages/component-sdk/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY backend/package.json backend/package.json
COPY worker/package.json worker/package.json

# Strip "frontend" from the workspaces array so bun doesn't resolve its deps
# (can't use --frozen-lockfile with modified workspaces; bun.lock still guides resolution)
RUN bun -e '\
  const pkg = JSON.parse(require("fs").readFileSync("package.json", "utf8")); \
  pkg.workspaces = pkg.workspaces.filter(w => w !== "frontend"); \
  require("fs").writeFileSync("package.json", JSON.stringify(pkg, null, 2));'

RUN bun install

# ============================================================================
# DEPS-WORKER — only worker + packages (no frontend, no backend deps)
# ============================================================================
FROM builder-base AS deps-worker

COPY bunfig.toml bun.lock package.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/backend-client/package.json packages/backend-client/package.json
COPY packages/component-sdk/package.json packages/component-sdk/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY worker/package.json worker/package.json

# Strip frontend and backend from workspaces
# (can't use --frozen-lockfile with modified workspaces; bun.lock still guides resolution)
RUN bun -e '\
  const pkg = JSON.parse(require("fs").readFileSync("package.json", "utf8")); \
  pkg.workspaces = pkg.workspaces.filter(w => !["frontend", "backend"].includes(w)); \
  require("fs").writeFileSync("package.json", JSON.stringify(pkg, null, 2));'

RUN bun install

# ============================================================================
# SOURCE — add all source code on top of full deps (for frontend build)
# ============================================================================
FROM deps AS source

COPY packages/ packages/
COPY backend/ backend/
COPY frontend/ frontend/
COPY worker/ worker/

# ============================================================================
# SOURCE-BACKEND — source code overlaid on backend deps (preserves workspace node_modules symlinks)
# ============================================================================
FROM deps-backend AS source-backend

COPY packages/ packages/
COPY backend/ backend/
COPY worker/ worker/

# ============================================================================
# SOURCE-WORKER — source code overlaid on worker deps (preserves workspace node_modules symlinks)
# ============================================================================
FROM deps-worker AS source-worker

COPY packages/ packages/
COPY worker/ worker/

# ============================================================================
# FRONTEND BUILD — compile static assets
# ============================================================================
FROM source AS frontend-build

ARG VITE_AUTH_PROVIDER=local
ARG VITE_CLERK_PUBLISHABLE_KEY=""
ARG VITE_API_URL=http://localhost:3211
ARG VITE_BACKEND_URL=http://localhost:3211
ARG VITE_DEFAULT_ORG_ID=local-dev
ARG VITE_GIT_SHA=unknown
ARG VITE_PUBLIC_POSTHOG_KEY=""
ARG VITE_PUBLIC_POSTHOG_HOST=""
ARG VITE_OPENSEARCH_DASHBOARDS_URL=""

ENV VITE_AUTH_PROVIDER=${VITE_AUTH_PROVIDER}
ENV VITE_CLERK_PUBLISHABLE_KEY=${VITE_CLERK_PUBLISHABLE_KEY}
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}
ENV VITE_DEFAULT_ORG_ID=${VITE_DEFAULT_ORG_ID}
ENV VITE_GIT_SHA=${VITE_GIT_SHA}
ENV VITE_PUBLIC_POSTHOG_KEY=${VITE_PUBLIC_POSTHOG_KEY}
ENV VITE_PUBLIC_POSTHOG_HOST=${VITE_PUBLIC_POSTHOG_HOST}
ENV VITE_OPENSEARCH_DASHBOARDS_URL=${VITE_OPENSEARCH_DASHBOARDS_URL}

WORKDIR /app

# Build TypeScript declarations for workspace packages first (project references require this)
RUN bunx tsc --build packages/shared packages/backend-client

# Build production assets so Vite embeds the env vars
RUN cd frontend && bun run build

# ============================================================================
# FRONTEND SERVICE (nginx serving static files — ~30MB vs ~1.5GB)
# ============================================================================
FROM nginx:alpine AS frontend

# curl for compose healthcheck compatibility, gzip for pre-compressing assets
RUN apk add --no-cache curl gzip

COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html

# Pre-compress all static assets at build time so nginx serves them with zero CPU via gzip_static
RUN find /usr/share/nginx/html -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.svg' -o -name '*.json' \) \
    -exec gzip -9 -k {} \;

# High-performance static file serving config
RUN printf '\
worker_processes auto;\n\
\n\
events {\n\
    worker_connections 1024;\n\
}\n\
\n\
http {\n\
    include /etc/nginx/mime.types;\n\
    default_type application/octet-stream;\n\
\n\
    # Zero-copy file serving\n\
    sendfile on;\n\
    tcp_nopush on;\n\
    tcp_nodelay on;\n\
    keepalive_timeout 65;\n\
\n\
    # Cache open file descriptors and metadata\n\
    open_file_cache max=1000 inactive=60s;\n\
    open_file_cache_valid 30s;\n\
    open_file_cache_min_uses 2;\n\
\n\
    # Serve pre-compressed .gz files directly (zero CPU per request)\n\
    gzip_static on;\n\
\n\
    # Fallback dynamic gzip for non-pre-compressed files\n\
    gzip on;\n\
    gzip_vary on;\n\
    gzip_comp_level 4;\n\
    gzip_min_length 256;\n\
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;\n\
\n\
    server {\n\
        listen 8080;\n\
        root /usr/share/nginx/html;\n\
        index index.html;\n\
\n\
        # Hashed assets (Vite puts them in /assets/) — cache forever\n\
        location /assets/ {\n\
            expires 1y;\n\
            add_header Cache-Control "public, immutable";\n\
        }\n\
\n\
        # SPA fallback — serve index.html for all non-file routes\n\
        location / {\n\
            try_files $uri $uri/ /index.html;\n\
        }\n\
\n\
        # Health check\n\
        location = /health {\n\
            access_log off;\n\
            return 200 "ok\\n";\n\
            add_header Content-Type text/plain;\n\
        }\n\
    }\n\
}\n' > /etc/nginx/nginx.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]

# ============================================================================
# BACKEND SERVICE
# ============================================================================
FROM oven/bun:1-slim AS backend

WORKDIR /app

RUN groupadd -g 1001 shipsec && useradd -u 1001 -g shipsec -m shipsec

# Copy everything from source-backend (deps + workspace node_modules + source code)
COPY --from=source-backend --chown=shipsec:shipsec /app/node_modules ./node_modules
COPY --from=source-backend --chown=shipsec:shipsec /app/package.json ./package.json
COPY --from=source-backend --chown=shipsec:shipsec /app/bunfig.toml ./bunfig.toml
COPY --from=source-backend --chown=shipsec:shipsec /app/packages ./packages
COPY --from=source-backend --chown=shipsec:shipsec /app/backend ./backend
COPY --from=source-backend --chown=shipsec:shipsec /app/worker ./worker

ARG POSTHOG_API_KEY=""
ARG POSTHOG_HOST=""
ENV POSTHOG_API_KEY=${POSTHOG_API_KEY}
ENV POSTHOG_HOST=${POSTHOG_HOST}

USER shipsec
WORKDIR /app/backend

EXPOSE 3211

CMD ["sh", "-c", "bun run migration:push && bun src/main.ts"]

# ============================================================================
# WORKER SERVICE
# ============================================================================
FROM oven/bun:1-slim AS worker

WORKDIR /app

# Worker needs Node (tsx/SWC) and Docker CLI (DinD communication)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_current.x | bash - && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    chmod a+r /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends nodejs docker-ce-cli && \
    rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1001 shipsec && useradd -u 1001 -g shipsec -m shipsec

# Copy everything from source-worker (deps + workspace node_modules + source code)
COPY --from=source-worker --chown=shipsec:shipsec /app/node_modules ./node_modules
COPY --from=source-worker --chown=shipsec:shipsec /app/package.json ./package.json
COPY --from=source-worker --chown=shipsec:shipsec /app/bunfig.toml ./bunfig.toml
COPY --from=source-worker --chown=shipsec:shipsec /app/packages ./packages
COPY --from=source-worker --chown=shipsec:shipsec /app/worker ./worker

ARG POSTHOG_API_KEY=""
ARG POSTHOG_HOST=""
ENV POSTHOG_API_KEY=${POSTHOG_API_KEY}
ENV POSTHOG_HOST=${POSTHOG_HOST}

USER shipsec
WORKDIR /app/worker

# Run worker with Node + tsx (not bun, due to SWC binding issues)
CMD ["node", "--import", "tsx/esm", "src/temporal/workers/dev.worker.ts"]

# ============================================================================
# FRONTEND DEBUG SERVICE (non-minified for debugging)
# ============================================================================
FROM source AS frontend-debug

RUN groupadd -g 1001 shipsec && useradd -u 1001 -g shipsec -m shipsec
RUN chown -R shipsec:shipsec /app

ARG VITE_AUTH_PROVIDER=local
ARG VITE_CLERK_PUBLISHABLE_KEY=""
ARG VITE_API_URL=http://localhost:3211
ARG VITE_BACKEND_URL=http://localhost:3211
ARG VITE_DEFAULT_ORG_ID=local-dev
ARG VITE_GIT_SHA=unknown
ARG VITE_PUBLIC_POSTHOG_KEY=""
ARG VITE_PUBLIC_POSTHOG_HOST=""
ARG VITE_OPENSEARCH_DASHBOARDS_URL=""

ENV VITE_AUTH_PROVIDER=${VITE_AUTH_PROVIDER}
ENV VITE_CLERK_PUBLISHABLE_KEY=${VITE_CLERK_PUBLISHABLE_KEY}
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}
ENV VITE_DEFAULT_ORG_ID=${VITE_DEFAULT_ORG_ID}
ENV VITE_GIT_SHA=${VITE_GIT_SHA}
ENV VITE_PUBLIC_POSTHOG_KEY=${VITE_PUBLIC_POSTHOG_KEY}
ENV VITE_PUBLIC_POSTHOG_HOST=${VITE_PUBLIC_POSTHOG_HOST}
ENV VITE_OPENSEARCH_DASHBOARDS_URL=${VITE_OPENSEARCH_DASHBOARDS_URL}

USER shipsec
WORKDIR /app/frontend

EXPOSE 5173

# Run development server (non-minified) for debugging
CMD ["bun", "run", "dev", "--host", "0.0.0.0", "--port", "5173"]
