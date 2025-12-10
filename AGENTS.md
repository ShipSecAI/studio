# Repository Guidelines

## Project Structure & Module Organization
- Bun workspace monorepo: `frontend/` (React + Vite UI), `backend/` (NestJS API + Temporal client), `worker/` (Temporal activities), and `packages/` for shared SDKs.
- Frontend features live in `frontend/src/features`; shared UI sits in `frontend/src/components`; state lives in `frontend/src/store`. Tests stay alongside code under `__tests__`.
- Backend modules follow NestJS (`backend/src/modules/*`), with integration suites under `backend/src/**/__tests__` and schema definitions in `backend/src/db`.
- Worker logic stays in `worker/src/temporal`; reusable component helpers live in `worker/src/components`.
- Specs and runbooks live in `docs/` (notably `docs/execution-contract.md`) and `.ai/` for observability work—update both when contracts change.

## Build, Test, and Development Commands
- `bun install` — install workspace dependencies.
- `docker compose -p shipsec up -d` — bring up Temporal, Postgres, MinIO, and Loki (fixed project name for consistent up/down across directories).
- Always timebox commands; pick a realistic limit (e.g., `timeout 30s <cmd>` for logs, `timeout 2m <cmd>` for tests) so shells never hang indefinitely. On macOS install GNU coreutils (`brew install coreutils`) and use `gtimeout`, or wrap commands manually with `sleep`/`kill` if `timeout` is unavailable.
- `pm2 start pm2.config.cjs` — run backend API and worker (inspect with `timeout 5s pm2 logs backend --nostream --lines 200` so the command exits on its own).
- `bun --cwd frontend dev` and `bun --cwd backend run dev` — start frontend and API locally.
- `bun run test`, `bun run lint`, `bun run typecheck` — monorepo test, lint, and type gates; target runs via `bun --cwd backend run migration:smoke` when narrowing failures.
- **OpenAPI + backend client workflow:** whenever backend routes change, regenerate the spec with `bun --cwd backend run generate:openapi`, then rebuild the typed client via `bun --cwd packages/backend-client run generate`. Do not hand-edit the client—always go spec → generator → import.

## Coding Style & Naming Conventions
- TypeScript everywhere with ESM modules and two-space indentation; keep import order stable and skip extra semicolons.
- Reuse `@shipsec/shared` Zod schemas for contracts. Workflow/run identifiers keep the `shipsec-run-*` shape.
- React files use PascalCase components and colocated hooks. Backend services/controllers follow NestJS naming (`*.service.ts`, `*.controller.ts`).
- Run `bun run lint` (ESLint + Prettier) before submitting; frontend also enforces Tailwind utility ordering via `tailwind-merge`.

## Testing Guidelines
- Unit tests belong near the code (`__tests__` folders, `*.spec.ts`/`*.test.ts`). Mirror existing patterns when expanding coverage.
- Run `bun run test` before opening a PR. For backend integration suites, export Temporal services then use `RUN_BACKEND_INTEGRATION=true bun --cwd backend test`.
- When adding workflows or trace handling, confirm schemas against `docs/execution-contract.md` and add fixtures covering new fields.
- Document manual validation steps (e.g., workflow run IDs, Loki log checks) in the PR description.

## Commit & Pull Request Guidelines
- Follow Conventional Commit-style subjects (`feat:`, `fix:`, `docs:`) in imperative voice; include context on the scope touched.
- Sign off every commit for DCO compliance (`git commit -s` or `--signoff` on amendments).
- Reference issues or milestones in the PR body, summarise behaviour changes, and attach screenshots or trace snippets for UI/observability updates.
- Confirm linters and tests pass (`bun run test`, targeted smoke checks) and call out any gaps or blockers explicitly.

## ShipSec Studio Agent Playbook (Reference)

### 1. Mission
- Deliver reliable, observable workflow automation for security reconnaissance in line with `.ai/claude-spec.md`.
- Move the repository toward the observability roadmap in `.ai/implementation-plan.md` while preserving existing behaviour and data integrity.
- Keep humans in the loop: surface assumptions, blockers, and validation gaps promptly.

### 0. Capability Check
- Identify whether your execution environment exposes CORE Memory (Codex CLI `memory` tool suite).
- **If CORE is available:** immediately switch to the “CORE Memory Protocol” section below and follow it verbatim.
- **If CORE is unavailable:** skip the CORE-specific block and rely on `.ai` docs, recent git history, and open issues for context; keep a written trail in repo docs or the PR description so teammates inherit your findings.

### CORE Memory Protocol (CORE-enabled agents only)
`trigger: always_on` — apply this section only when the CLI exposes CORE Memory. Agents that start without CORE should continue with the standard instructions; do **not** assume memory state exists.

⚠️ **CRITICAL: READ THIS FIRST – MANDATORY MEMORY PROTOCOL** ⚠️  
CORE Memory preserves project context, so every CORE-enabled session must follow the exact startup and shutdown sequences below.

#### Mandatory startup sequence (run before any response)
1. **Step 1 – `memory_search` (required first action):**
   - Always search before replying to the user to pull prior discussions, decisions, and preferences related to the current topic.
   - Extra triggers: the user references prior work (“previously”, “before”, etc.), you are working in the CORE project, or the task likely has history.
   - Ask yourself which context is missing and craft a full semantic query (complete sentences, not keyword fragments).

2. **Query patterns (pick the one that fits best):**
   - **Entity-centric:** `[Person/Project] + [relationship/attribute] + [context]` (e.g., “Manoj's preferences for API design and error handling”).
   - **Multi-entity relationship:** `[Entity1] + [relationship] + [Entity2] + [context]` (e.g., “Manoj and Harshith discussions about BFS search implementation”).
   - **Semantic question:** fully phrased questions about requirements or causes (e.g., “What causes BFS search to return empty results?”).
   - **Concept exploration:** `[concept] + related/connected + [domain/context]` (e.g., “concepts related to semantic relevance in knowledge graph search”).
   - **Temporal:** `[temporal marker] + [topic] + [context]` (e.g., “recent changes to search implementation and reranking logic”).

#### Mandatory shutdown sequence (run after you finish helping)
1. **Final step – `memory_ingest` (required last action):**
   - Capture the conversation summary before ending the session.
   - Include `spaceId` from your initial `memory_get_space` call so the note lands in the right project bucket.

2. **What to store (conceptual, no raw code/logs):**
   - **From the user:** request, context, goals, constraints, and any blockers mentioned.
   - **From the assistant:** solution details, reasoning, trade-offs, alternative approaches, and methodologies used.
   - Emphasize technical explanations, decisions, and insights that will help in future sessions.
   - Exclude code snippets, file dumps, CLI commands, or raw logs.

3. **Quality check before storing:**
   - Would someone understand the project context and decisions from this memory alone?
   - Does it capture key reasoning and outcomes?

#### Protocol summary
1. **First action:** `memory_search` with a well-formed semantic query relevant to the user’s request.
2. **Respond:** perform the requested work.
3. **Final action:** `memory_ingest` with the session summary (and `spaceId`).

### 2. Core Operating Loop
1. **Gather context**  
   - With CORE Memory: run a search before answering any user message to pull history, decisions, and preferences.  
   - Without CORE Memory: review relevant `.ai` docs, recent commits, and any prior notes in the repository before proceeding.
2. **Study context**: skim `.ai` documents and recent code touching the task. Default references:
   - `.ai/claude-spec.md` for system architecture and APIs.
   - `.ai/visual-execution-notes.md` and `.ai/implementation-plan.md` for observability status and runbook details.
   - Other `.ai/*.md` files as needed (component SDK, worker architecture, marketplace notes).
3. **Plan** the work when it is more than a trivial change. Plans must have multiple steps, at most one active step, and be updated as progress is made. Skip planning only for straightforward tasks.
4. **Execute carefully**:
   - Prefer `rg` for search; use `["bash","-lc", "<cmd>"]` with `workdir` set on all shell calls.
   - Use `apply_patch` for handcrafted edits to single files; avoid it for large auto-generated diffs.
   - Keep edits ASCII unless the file already uses other characters.
   - Never undo or overwrite unrelated user changes; avoid destructive commands (`git reset --hard`, `rm -rf`, etc.).
5. **Validate** results via targeted tests or reasoning. Default test commands:
   - `bun run test`
   - `bun run --filter backend test`
   - `bun run lint`, `bun run typecheck`
   - Backend integration suites may need services started with Docker + PM2 (see §5).
6. **Document & Store**  
   - CORE-enabled agents: ingest a summary into CORE Memory capturing the interaction and any follow-ups.  
   - Non-CORE agents: append findings to an appropriate repo log (e.g., `.ai/visual-execution-notes.md`, issue tracker, or PR summary) so the next contributor has continuity.

### 3. Coding Standards
- Align with repository architecture: Temporal workflows orchestrate component activities; components are registered via the ShipSec SDK (`.ai/component-sdk.md`).
- Uphold observability contract schemas from `@shipsec/shared` and `docs/execution-contract.md`.
- Keep commits (when requested) small and reviewable. Do not create commits unless the user asks.
- Add concise comments only when logic is non-obvious.
- Maintain consistent import/order/style with existing code; prefer existing utilities over new dependencies.

### 4. Communication & Delivery
- Final responses must be concise, reference touched files (`path:line`), and highlight risks or follow-ups.
- Present findings before summaries when performing reviews.
- Offer practical next actions (tests, docs, PR steps) when they naturally follow from the work.
- State clearly when something could not be validated or requires human attention.

### 5. Environment & Tooling Notes
- Infrastructure stack: Temporal, Postgres, MinIO, Loki (Phase 5+) started via `docker compose up -d`.
- Runtime processes: use `pm2` (`pm2 start`, `pm2 status`, `timeout 5s pm2 logs ...`) with orphan Bun processes cleaned before restarting.
- Worker separation and task-queue strategy described in `.ai/temporal-worker-architecture.md` and `.ai/worker-implementation-example.md`.
- Live execution experience depends on trace streaming (Phase 6) and UI updates described in `.ai/visual-execution-notes.md`.

### 6. Observability Roadmap Snapshot
- Phase 0–7 complete; Phase 8 (metrics + regression suite) not started.
- Trace + Loki pipeline (Phase 5) and live streaming (Phase 6) are active; ensure new work preserves these contracts.
- Backlog items for the execution timeline remain open (see `.ai/implementation-plan.md` Phase 8 checklist).

### 7. Document Map
- `.ai/bounty-hunter-painpoints.md`: user persona & pain points.
- `.ai/component-sdk.md`: component interfaces, runner configuration, execution context.
- `.ai/file-storage-implementation.md`: artifact storage strategy (S3/MinIO expectations).
- `.ai/implementation-plan.md`: observability phases, required tests, environment runbook.
- `.ai/sample-workflow-dsl.md`: DSL structure for workflow definitions.
- `.ai/shipsec-differentiators.md`: positioning vs competitors.
- `.ai/temporal-worker-architecture.md`: task queue strategy and worker specialization.
- `.ai/tracecat-temporal-overview.md`: external comparison insights.
- `.ai/visual-execution-notes.md`: audit findings, infrastructure status, UX expectations.
- `.ai/worker-implementation-example.md`: end-to-end worker example with logging & progress emission.

### 8. Component Development (CRITICAL: Read Before Creating Components)

**⚠️ ALWAYS READ EXISTING DOCUMENTATION FIRST ⚠️**

Before creating ANY Docker component:
1. **READ `docs/component-development.md` COMPLETELY** — Contains critical PTY compatibility requirements and patterns
2. **CHECK existing components** — Look at similar components (dnsx, nuclei, httpx) for reference patterns
3. **NEVER assume patterns** — Docker/PTY behavior is counterintuitive; documented patterns prevent hours of debugging

**Common mistake:** Skipping documentation and implementing direct patterns that hang or buffer in PTY mode. This wastes significant time debugging issues that are already solved and documented.

**When creating or modifying Docker-based components, you MUST follow the file system access patterns and PTY compatibility guidelines documented below.**

#### Required Reading (in order)
1. **`docs/component-development.md`** — **START HERE!** PTY compatibility patterns (shell wrapper vs direct binary), Docker entrypoint requirements, and decision tree
2. **`.ai/component-sdk.md`** — Authoritative component interface, runner config, and **File System Access Pattern** section
3. **`worker/src/components/security/dnsx.ts:615-662`** — Reference implementation: shell wrapper pattern + isolated volumes
4. **`worker/src/components/security/nuclei.ts`** — Reference implementation: direct binary + `-stream` flag (distroless pattern)

#### MANDATORY Pattern: IsolatedContainerVolume

**ALL Docker components requiring file input/output MUST use `IsolatedContainerVolume`:**

```typescript
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

async execute(input, context) {
  const tenantId = (context as any).tenantId ?? 'default-tenant';
  const volume = new IsolatedContainerVolume(tenantId, context.runId);

  try {
    // Write input files
    await volume.initialize({
      'targets.txt': targets.join('\n'),
      'config.json': JSON.stringify(config)
    });

    // Configure runner with volume
    const runnerConfig: DockerRunnerConfig = {
      kind: 'docker',
      image: 'tool:latest',
      command: buildCommandArgs(input),
      volumes: [volume.getVolumeConfig('/inputs', true)]  // read-only
    };

    const result = await runComponentWithRunner(runnerConfig, ...);
    return result;

  } finally {
    await volume.cleanup();  // MANDATORY - always cleanup
  }
}
```

#### Why This Pattern is REQUIRED

❌ **NEVER use direct file mounts** (broken in DinD, security risk):
```typescript
// WRONG - DO NOT DO THIS
const tempDir = await mkdtemp(path.join(tmpdir(), 'input-'));
await writeFile(path.join(tempDir, 'file.txt'), data);
volumes: [{ source: tempDir, target: '/inputs' }]  // FAILS in Docker-in-Docker
```

✅ **ALWAYS use IsolatedContainerVolume** (DinD compatible, tenant isolated):
- Works in Docker-in-Docker environments (named volumes vs file mounts)
- Enforces multi-tenant isolation (`tenant-{tenantId}-run-{runId}-{timestamp}`)
- Automatic cleanup prevents data leakage
- Audit trail via volume labels
- Path validation prevents security exploits

#### Component Creation Checklist

When creating a new Docker component:

- [ ] Read `.ai/component-sdk.md` File System Access Pattern section
- [ ] Import `IsolatedContainerVolume` from `../../utils/isolated-volume`
- [ ] Create volume with tenant ID and run ID
- [ ] Use `volume.initialize()` to write input files
- [ ] Mount volume with `volume.getVolumeConfig('/path', readOnly)`
- [ ] Put cleanup in `finally` block (MANDATORY)
- [ ] Add logging for volume creation and cleanup
- [ ] Test volume creation, usage, and cleanup
- [ ] Verify no orphaned volumes after execution

#### Pattern Variations

**Input files only** (most common):
```typescript
const volume = new IsolatedContainerVolume(tenantId, context.runId);
try {
  await volume.initialize({ 'domains.txt': domains.join('\n') });
  volumes: [volume.getVolumeConfig('/inputs', true)]
  // ... run component ...
} finally {
  await volume.cleanup();
}
```

**Input + output files**:
```typescript
const volume = new IsolatedContainerVolume(tenantId, context.runId);
try {
  await volume.initialize({ 'config.yaml': yamlConfig });
  volumes: [volume.getVolumeConfig('/data', false)]  // read-write
  // ... run component ...
  const outputs = await volume.readFiles(['results.json']);
  return JSON.parse(outputs['results.json']);
} finally {
  await volume.cleanup();
}
```

**Multiple volumes** (separate input/output):
```typescript
const inputVol = new IsolatedContainerVolume(tenantId, `${runId}-in`);
const outputVol = new IsolatedContainerVolume(tenantId, `${runId}-out`);
try {
  await inputVol.initialize({ 'data.csv': csvData });
  await outputVol.initialize({});
  volumes: [
    inputVol.getVolumeConfig('/inputs', true),
    outputVol.getVolumeConfig('/outputs', false)
  ]
  // ... run component ...
} finally {
  await Promise.all([inputVol.cleanup(), outputVol.cleanup()]);
}
```

#### Reference Documentation

- **Component SDK**: `.ai/component-sdk.md` — Interface and file system pattern
- **Development Guide**: `docs/component-development.md` — Full patterns and security
- **API Reference**: `worker/src/utils/README.md` — IsolatedContainerVolume API
- **Architecture**: `docs/ISOLATED_VOLUMES.md` — How it works, security model
- **Migration Tracking**: `worker/src/utils/COMPONENTS_TO_MIGRATE.md` — Components needing updates
- **Working Example**: `worker/src/components/security/dnsx.ts:615-662`

#### Security Guarantees

Using IsolatedContainerVolume ensures:
- **Tenant Isolation**: Volume names include tenant ID to prevent cross-tenant access
- **No Collisions**: Timestamp in name prevents concurrent execution conflicts
- **Path Safety**: Filenames validated (blocks `..` and `/` prefixes)
- **Automatic Cleanup**: Finally blocks guarantee volume removal
- **Audit Trail**: Volumes labeled with `studio.managed=true` for tracking
- **DinD Compatible**: Named volumes work in nested Docker scenarios

#### Common Mistakes to Avoid

1. ❌ Using `mkdtemp` + `writeFile` + file mounts (broken in DinD)
2. ❌ Forgetting `finally` block for cleanup (causes volume leaks)
3. ❌ Using read-write mounts when read-only is sufficient (security risk)
4. ❌ Hardcoding tenant ID instead of getting from context
5. ❌ Not logging volume creation/cleanup (makes debugging harder)
6. ❌ Skipping validation that volumes are cleaned up (check `docker volume ls`)

#### Testing Requirements

After implementing file-based component:
- Component executes successfully
- Volume is created with correct naming pattern
- Files are written to volume and accessible to container
- Volume is cleaned up after successful execution
- Volume is cleaned up on error/exception
- No orphaned volumes remain (`docker volume ls --filter "label=studio.managed=true"`)
- Logs show volume creation and cleanup messages

### 9. When Blocked
- Capture the issue, attempted approaches, and uncertainties in the response.
- Suggest concrete follow-ups (information needed, commands to rerun, potential fixes).
- CORE-enabled agents: store the blocker in CORE Memory.
  Non-CORE agents: record the blocker in a shared doc or ticket so the next teammate can resume quickly.

## MDFiler

### DNSX Resolver Component (`worker/src/components/security/dnsx.ts`)
- Container: docker runner locks to `projectdiscovery/dnsx:latest` with `sh -c` entrypoint, `bridge` networking, and an explicit `$HOME` to keep dnsx happy in ephemeral containers.
- Input marshaling: the shell stub reads the JSON payload from stdin, extracts `domains`, `recordTypes`, `resolvers`, `retryCount`, and `rateLimit` via `sed`, and materialises them into temp files. Record types default to `A`, resolver lines are written to a file only when provided, and every temp file is cleaned with `trap`.
- Runtime flags: record type switches are mapped manually (`A` → `-a`, `AAAA` → `-aaaa`, etc.), retry and rate limit parameters are appended when they are ≥1, and dnsx is always invoked with `-json -resp -silent` so we get NDJSON back for parsing.
- Error surfacing: non-zero dnsx exits funnel stderr into a JSON object with `__error__` flag so the TypeScript layer can bubble the message without crashing the workflow.
- Raw output handling: `execute` always awaits `runComponentWithRunner`; if the runner hands back an object (the docker helper occasionally serialises JSON), we stringify it before parsing and coerce `undefined/null` to an empty string.
- Parsing + normalisation: NDJSON lines are validated with `dnsxLineSchema`. We derive a canonical `answers` map per record, coerce TTLs that arrive as strings, and dedupe record types/resolvers by combining requested values with what dnsx actually returned.
- Fallback path: when the output is not valid JSON, we emit synthetic result rows keyed by the raw line, attach the raw output, and report a friendly parse error so downstream steps can still show “something” instead of silently failing.
- Runner contract: `workflow-runner.ts` must call `component.execute` (not `runComponentWithRunner` directly) so this normalisation logic always runs; calling the runner directly bypasses the parsing guardrails and breaks downstream consumers.
- Telemetry: we log the domain counts up front, emit progress events (`Running dnsx for … domains`), and propagate any parse errors through the `errors` array for Loki/search indexing.
- Validation: unit tests mock the runner to cover structured JSON, raw fallback, and runner metadata; the integration test executes dnsx in Docker with a 180s timeout, so keep the daemon available when running locally.

## Design Iteration Protocol
- When the user explicitly says **"Design Iteration Mode"**, follow this workflow:  
  1. Audit the current UI (code + screenshot) and list concrete visual/UX issues before changing anything.  
  2. Implement three alternative layouts/variants of the component in question (A/B/C).  
  3. Expose a temporary debug selector (dropdown/tabs, etc.) near the component so the user can live-switch between the variants.  
  4. Leave the selector in place until the user picks a winner, then remove the extras and clean up.  
- Only engage this process when the user uses the exact phrase above; otherwise, do normal single-path design tweaks.
