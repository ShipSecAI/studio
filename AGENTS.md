# ShipSec Studio

Security workflow orchestration platform. Visual builder + Temporal for reliability.

## Stack

- `frontend/` — React + Vite
- `backend/` — NestJS API
- `worker/` — Temporal activities + components
- `packages/` — Shared code (component-sdk, backend-client)

## Development

```bash
just init              # First time setup
just dev               # Start the active instance (default: 0)
just dev stop          # Stop the active instance (does NOT stop shared infra)
just dev stop all      # Stop all instances + shared infra
just dev logs          # View logs for the active instance
just help              # All commands
```

**Active instance**:

```bash
just instance show     # Print active instance number
just instance use 5    # Set active instance for this workspace
```

**URLs**:

- Frontend: `http://localhost:${5173 + instance*100}`
- Backend: `http://localhost:${3211 + instance*100}`
- Temporal UI (shared): http://localhost:8081

Full details: `docs/MULTI-INSTANCE-DEV.md`

### After Backend Route Changes

```bash
bun --cwd backend run generate:openapi
bun --cwd packages/backend-client run generate
```

### Testing

```bash
bun run test           # All tests
bun run typecheck      # Type check
bun run lint           # Lint
```

### Database

```bash
just db-reset                              # Reset database
bun --cwd backend run migration:push       # Push schema
bun --cwd backend run db:studio            # View data
```

## Rules

1. TypeScript, 2-space indent
2. Conventional commits with DCO: `git commit -s -m "feat: ..."`
3. Tests alongside code in `__tests__/` folders
4. **E2E Tests**: Mandatory for significant features. Place in `e2e-tests/` folder.
5. **GitHub CLI**: Use `gh` for all GitHub operations (issues, PRs, actions, releases). Never use browser automation for GitHub tasks.

---

## Architecture

Full details: **`docs/architecture.mdx`**

```
Frontend ←→ Backend ←→ Temporal ←→ Worker
                                      ↓
                            Component Execution
                                      ↓
              Terminal(Redis) | Events(Kafka) | Logs(Loki)
                                      ↓
                          Frontend (SSE/WebSocket)
```

### Component Runners

- **inline** — TypeScript code (HTTP calls, transforms, file ops)
- **docker** — Containers (security tools: Subfinder, DNSX, Nuclei)
- **remote** — External executors (future: K8s, ECS)

### Real-time Streaming

- Terminal: Redis Streams → SSE → xterm.js
- Events: Kafka → WebSocket
- Logs: Loki + PostgreSQL

---

<skills_system priority="1">

<usage>
When tasks match a skill, load it: `cat .claude/skills/<name>/SKILL.md`
</usage>

<available_skills>
<skill>
<name>component-development</name>
<description>Creating components (inline/docker). Dynamic ports, retry policies, PTY patterns, IsolatedContainerVolume.</description>
<location>project</location>
</skill>
</available_skills>

</skills_system>
