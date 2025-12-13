# Simple multi-stage Dockerfile for backend and worker

# ============================================================================
# BASE STAGE
# ============================================================================
FROM oven/bun:latest AS base
# Install system deps
RUN apt-get update && \
    apt-get install -y ca-certificates curl gnupg lsb-release python3 make g++ && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    chmod a+r /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" > /etc/apt/sources.list.d/docker.list && \
    curl -fsSL https://deb.nodesource.com/setup_current.x | bash - && \
    apt-get update && \
    apt-get install -y nodejs docker-ce-cli && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create user
RUN groupadd -g 1001 shipsec && useradd -u 1001 -g shipsec -m shipsec

# Copy all files
COPY --chown=shipsec:shipsec bun.lock package.json bunfig.toml ./
COPY --chown=shipsec:shipsec packages/ packages/
COPY --chown=shipsec:shipsec backend/ backend/
COPY --chown=shipsec:shipsec frontend/ frontend/
COPY --chown=shipsec:shipsec worker/ worker/

# Install ALL dependencies (no filtering)
RUN bun install --frozen-lockfile

# ============================================================================
# BACKEND SERVICE
# ============================================================================
FROM base AS backend

# Switch to user
USER shipsec

# Set working directory for backend
WORKDIR /app/backend

# Expose port
EXPOSE 3211

# Run migrations first, then start backend
CMD ["sh", "-c", "bun run migration:push && bun src/main.ts"]

# ============================================================================
# WORKER SERVICE
# ============================================================================
FROM base AS worker

# Switch to user
USER shipsec

# Set working directory for worker
WORKDIR /app/worker

# Run worker with Node + tsx (not bun, due to SWC binding issues)
CMD ["node", "--import", "tsx/esm", "src/temporal/workers/dev.worker.ts"]

# ============================================================================
# FRONTEND SERVICE
# ============================================================================
FROM base AS frontend

# Frontend build-time configuration
ARG VITE_AUTH_PROVIDER=local
ARG VITE_CLERK_PUBLISHABLE_KEY=""
ARG VITE_API_URL=http://localhost:3211
ARG VITE_BACKEND_URL=http://localhost:3211
ARG VITE_DEFAULT_ORG_ID=local-dev
ARG VITE_GIT_SHA=unknown
ARG VITE_PUBLIC_POSTHOG_KEY=""
ARG VITE_PUBLIC_POSTHOG_HOST=""

ENV VITE_AUTH_PROVIDER=${VITE_AUTH_PROVIDER}
ENV VITE_CLERK_PUBLISHABLE_KEY=${VITE_CLERK_PUBLISHABLE_KEY}
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}
ENV VITE_DEFAULT_ORG_ID=${VITE_DEFAULT_ORG_ID}
ENV VITE_GIT_SHA=${VITE_GIT_SHA}
ENV VITE_PUBLIC_POSTHOG_KEY=${VITE_PUBLIC_POSTHOG_KEY}
ENV VITE_PUBLIC_POSTHOG_HOST=${VITE_PUBLIC_POSTHOG_HOST}

# Set working directory for frontend
USER shipsec
WORKDIR /app/frontend

# Build production assets ahead of time so Vite embeds the env vars
RUN bun run build

# Expose port
EXPOSE 8080

# Serve the built bundle with Vite preview
CMD ["bun", "run", "preview", "--host", "0.0.0.0", "--port", "8080"]

# ============================================================================
# FRONTEND DEBUG SERVICE (non-minified for debugging)
# ============================================================================
FROM base AS frontend-debug

# Frontend build-time configuration
ARG VITE_AUTH_PROVIDER=local
ARG VITE_CLERK_PUBLISHABLE_KEY=""
ARG VITE_API_URL=http://localhost:3211
ARG VITE_BACKEND_URL=http://localhost:3211
ARG VITE_DEFAULT_ORG_ID=local-dev
ARG VITE_GIT_SHA=unknown
ARG VITE_PUBLIC_POSTHOG_KEY=""
ARG VITE_PUBLIC_POSTHOG_HOST=""

ENV VITE_AUTH_PROVIDER=${VITE_AUTH_PROVIDER}
ENV VITE_CLERK_PUBLISHABLE_KEY=${VITE_CLERK_PUBLISHABLE_KEY}
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}
ENV VITE_DEFAULT_ORG_ID=${VITE_DEFAULT_ORG_ID}
ENV VITE_GIT_SHA=${VITE_GIT_SHA}
ENV VITE_PUBLIC_POSTHOG_KEY=${VITE_PUBLIC_POSTHOG_KEY}
ENV VITE_PUBLIC_POSTHOG_HOST=${VITE_PUBLIC_POSTHOG_HOST}

# Set working directory for frontend
USER shipsec
WORKDIR /app/frontend

# Ensure shipsec user can write to node_modules for Vite cache
USER root
RUN chown -R shipsec:shipsec /app/frontend/node_modules
USER shipsec

# Expose port
EXPOSE 5173

# Run development server (non-minified) for debugging
CMD ["bun", "run", "dev", "--host", "0.0.0.0", "--port", "5173"]
