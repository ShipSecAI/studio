# Repository Guidelines

## Project Structure & Module Organization
- Bun workspace monorepo: `frontend/` (React + Vite UI), `backend/` (NestJS API + Temporal client), `worker/` (Temporal activities), and `packages/` for shared SDKs.
- Frontend features live in `frontend/src/features`; shared UI sits in `frontend/src/components`; state lives in `frontend/src/store`. Tests stay alongside code under `__tests__`.
- Backend modules follow NestJS (`backend/src/modules/*`), with integration suites under `backend/src/**/__tests__` and schema definitions in `backend/src/db`.
- Worker logic stays in `worker/src/temporal`; reusable component helpers live in `worker/src/components`.
- Specs and runbooks live in `docs/` (notably `docs/execution-contract.md`) and `.ai/` for observability work—update both when contracts change.

## Build, Test, and Development Commands
- `bun install` — install workspace dependencies.
- `docker compose up -d` — bring up Temporal, Postgres, MinIO, and Loki.
- Always timebox commands; pick a realistic limit (e.g., `timeout 30s <cmd>` for logs, `timeout 2m <cmd>` for tests) so shells never hang indefinitely. On macOS install GNU coreutils (`brew install coreutils`) and use `gtimeout`, or wrap commands manually with `sleep`/`kill` if `timeout` is unavailable.
- `pm2 start pm2.config.cjs` — run backend API and worker (use `timeout 5s pm2 logs backend --lines 50` to inspect).
- `bun --cwd frontend dev` and `bun --cwd backend run dev` — start frontend and API locally.
- `bun run test`, `bun run lint`, `bun run typecheck` — monorepo test, lint, and type gates; target runs via `bun --cwd backend run migration:smoke` when narrowing failures.

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
- Reference issues or milestones in the PR body, summarise behaviour changes, and attach screenshots or trace snippets for UI/observability updates.
- Confirm linters and tests pass (`bun run test`, targeted smoke checks) and call out any gaps or blockers explicitly.

## ShipSec Studio Agent Playbook (Reference)

### 1. Mission
- Deliver reliable, observable workflow automation for security reconnaissance in line with `.ai/claude-spec.md`.
- Move the repository toward the observability roadmap in `.ai/implementation-plan.md` while preserving existing behaviour and data integrity.
- Keep humans in the loop: surface assumptions, blockers, and validation gaps promptly.

### 0. Capability Check
- Identify whether your execution environment exposes CORE Memory (Codex CLI tool `corememory__*`).
- **If CORE is available:** follow the memory-first workflow below.
- **If CORE is unavailable:** rely on `.ai` docs, recent git history, and open issues for context; keep a written trail in repo docs or the PR description so teammates inherit your findings.

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

### 8. When Blocked
- Capture the issue, attempted approaches, and uncertainties in the response.
- Suggest concrete follow-ups (information needed, commands to rerun, potential fixes).
- CORE-enabled agents: store the blocker in CORE Memory.  
  Non-CORE agents: record the blocker in a shared doc or ticket so the next teammate can resume quickly.
