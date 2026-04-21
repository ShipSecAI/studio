# ShipSec Studio Worker

Temporal worker for component execution, agent steps, MCP runtime tasks, and long-running workflow activities.

## Development

```bash
bun install
bun --cwd worker run dev
```

Before committing:

```bash
bun --cwd worker run typecheck
bun --cwd worker run lint
bun --cwd worker run test
```

The worker expects its backing services to be reachable through configured environment variables.

## Read More

- [Architecture](../docs/architecture.mdx)
- [Component Development](../docs/development/component-development.mdx)
