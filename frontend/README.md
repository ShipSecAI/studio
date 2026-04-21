# ShipSec Studio Frontend

React + Vite UI for workflows, agents, templates, observability, and security operations.

## Development

```bash
bun install
bun --cwd frontend run dev
```

Before committing:

```bash
bun --cwd frontend run typecheck
bun --cwd frontend run lint
bun --cwd frontend run test
```

## State Model

- TanStack Query for server state
- Zustand for client-only UI state
- local component state for narrow UI concerns

## Read More

- [Architecture](../docs/architecture.mdx)
- [frontend/docs/state.md](./docs/state.md)
- [frontend/docs/performance.md](./docs/performance.md)
