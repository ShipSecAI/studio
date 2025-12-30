# E2E Tests

End-to-end tests for workflow execution with real backend, worker, and infrastructure.

## Prerequisites

Local development environment must be running:
```bash
docker compose -p shipsec up -d
pm2 start pm2.config.cjs
```

## Running Tests

```bash
bun test:e2e
```

Tests are skipped if services aren't available. Set `RUN_E2E=true` to enable.
