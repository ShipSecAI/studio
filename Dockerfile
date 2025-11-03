# Simple multi-stage Dockerfile for backend and worker

# ============================================================================
# BASE STAGE
# ============================================================================
FROM oven/bun:latest AS base
# Install system deps
RUN apt-get update && \
    apt-get install -y ca-certificates python3 make g++ && \
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
CMD ["node", "--loader", "tsx", "src/temporal/workers/dev.worker.ts"]

# ============================================================================
# FRONTEND SERVICE
# ============================================================================
FROM base AS frontend

# Set working directory for frontend
WORKDIR /app/frontend

# Expose port
EXPOSE 8080

# Serve frontend with dev server
CMD ["bun", "run", "dev", "--host", "0.0.0.0", "--port", "8080"]