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
just dev               # Start everything
just dev stop          # Stop
just dev logs          # View logs
just help              # All commands
```

**URLs**: Frontend http://localhost:5173 | Backend http://localhost:3211 | Temporal http://localhost:8081

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
- TypeScript, 2-space indent
- Conventional commits with DCO: `git commit -s -m "feat: ..."`
- Tests alongside code in `__tests__/` folders

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
