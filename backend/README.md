# ShipSec Studio Backend

NestJS API server for workflows, integrations, auth, storage metadata, traces, templates, and runtime control surfaces.

## Development

```bash
bun install
bun --cwd backend run dev
```

Before committing:

```bash
bun --cwd backend run typecheck
bun --cwd backend run lint
bun --cwd backend run test
```

The backend expects its dependencies to be reachable through configured environment variables.

## Common Tasks

Generate OpenAPI:

```bash
bun --cwd backend run generate:openapi
```

Run migrations:

```bash
bun --cwd backend run migration:migrate
```

Generate migration SQL:

```bash
bun --cwd backend run migration:generate
```

## Read More

- [Architecture](../docs/architecture.mdx)
- [Installation](../docs/installation.mdx)
- [Self-Hosting](../docs/self-hosting.mdx)
