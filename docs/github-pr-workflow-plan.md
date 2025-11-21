# GitHub PR Workflow Trigger Plan

## Decision
- Use a GitHub App for PR-triggered automation and GitHub feedback (checks/statuses/comments).
- Keep the existing GitHub OAuth provider for optional user-scoped actions (impersonated comments, manual reruns), but it is not sufficient alone because it cannot receive webhooks or issue repo-scoped installation tokens.

## GitHub-facing experience
- Installable app: minimal permissions (`Metadata: read`, `Contents: read`, `Pull requests: read & write`, `Checks: write`, `Commit statuses: write`; optionally `Actions: read` for workflow file lookups). Webhook events: `pull_request` (opened, synchronize, reopened, ready_for_review), `pull_request_review`, `pull_request_review_comment`, `check_run`/`check_suite`; `push` to default branch if we want post-merge runs.
- Repo-local config: `.shipsec/workflows.yml` per repo with simple mapping to Studio workflows and filters. Example:
  ```yaml
  workflows:
    - on: pull_request.opened|synchronize
      workflow: shipsec-run-pr-sast
      filters:
        paths: ["src/**"]
      checks:
        block: false  # report-only by default
  ```
  Default behavior: if the file is absent, run a safe default workflow (e.g., PR hygiene + SAST) to avoid setup friction.
- UX: Connections page shows “Install GitHub App” CTA, installation status by repo/org, and last webhook receipt. Provide copy/paste webhook secret and app installation link.

## Central workflow brain in ShipSec Studio
- Webhook ingestion: single endpoint verifies `X-Hub-Signature-256`, maps installation id to workspace, and enqueues the event (no heavy work in the handler).
- Event normalization: produce a standard envelope with repo/owner, installation id, PR number, head/base SHA+branch, author, labels, touched files summary (lazy-loaded via app token), and dedupe key (`delivery id` + `head sha`).
- Dispatch: select workflow(s) from repo config (or default), start `shipsec-run-*` with inputs (commit, branch, files, author). Use idempotent run keys and per-repo concurrency guards to avoid double execution.
- GitHub feedback: create/update a `check_run` per workflow. Optional PR comment summarizing findings; keep non-blocking until policy toggles exist. Store links back to Studio run detail.
- Auth layering: use app installation tokens for automation; overlay a stored user OAuth token only when we need impersonated comments or elevated scopes.
- Observability & ops: log event→run mapping, emit metrics for queue/wait/run times, alert on webhook failures, and support redelivery replay. Keep run artifacts in existing storage and surface them in Studio.

## Milestones (keep it simple)
- M1: Create GitHub App, webhook endpoint with signature verification, enqueue PR opened/synchronize events, post a minimal check_run to prove the loop.
- M2: Implement repo config parsing, dispatch into the workflow engine, update checks on success/failure, and add idempotency/rate limiting.
- M3: UX polish (Connections card, install status, per-repo enable/disable), run history linking, and short docs for installation + sample configs.

## How it works end-to-end
1) Install + config (optional): Customer installs the ShipSec GitHub App on repos/orgs. If they add `.shipsec/workflows.yml`, it overrides defaults; otherwise we run the safe default workflow.  
2) Webhook in: GitHub sends `pull_request` (and related) events to our signed endpoint. We verify `X-Hub-Signature-256`, map installation → workspace, and enqueue the event (handler stays thin).  
3) Enrich + select: A worker pulls the event, fetches `.shipsec/workflows.yml` from the repo using the app token (falls back to default), and expands a standard envelope (repo, PR, head/base, files touched, author, labels, dedupe key). Matching workflows are selected based on event type and filters.  
4) Run workflows: For each selected entry, we start a `shipsec-run-*` workflow with an idempotent key (installation + repo + head SHA + workflow name) and per-repo concurrency guard. Activities pull code/context via the app token; optional user OAuth is only for impersonated actions.  
5) Report to GitHub: We open/update a `check_run` per workflow (queued → running → success/failure). Optional PR comment summarizes findings and links back to the Studio run detail. Blocking stays off until policy toggles are set.  
6) Observe + recover: We log event→run mapping, emit metrics (queue, start, finish), and keep artifacts/logs in Studio. Webhook redeliveries dedupe via delivery id + head SHA.

## Quick answers
- One app per org: A single GitHub App installation at the org level covers all selected repos; we do not need per-repo apps.  
- Webhook endpoint: Yes—our backend exposes one signed webhook endpoint for the app. It only verifies, maps, and enqueues; workers do the heavier work.  
- Repo config optional: `.shipsec/workflows.yml` is only needed for overrides; absence falls back to the default safe workflow.  

## GitHub trigger (no-code canvas)
- The webhook is the transport, but the canvas shows an explicit **GitHub PR Trigger** node (like Manual Trigger) so runs are clearly marked as GitHub-initiated.  
- The trigger node supplies event metadata (repo, PR number, head/base, author, labels, file list) into downstream nodes.  
- Typical chain: `[GitHub PR Trigger] → [Fetch repository snapshot] → [Component (e.g., trufflehog)] → [Summarize/format] → [Publish to GitHub checks/comments]`. The fetch step can be hidden/automatic; the trigger node remains visible for clarity and auditing.  

## Implementation plan (lean)
1) Backend (GitHub App + webhook)
   - Add config for `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`.
   - Create GitHub App client for installation tokens + HMAC verification.
   - Add `/webhooks/github/app` controller to verify signature and enqueue normalized events (thin handler).
   - Emit receipt logs/metrics (delivery id, event type, installation id, repo).
2) Event dispatch (worker entry)
   - Define a normalized envelope type (repo, owner, installation id, PR number, head/base, labels, files summary, delivery id, dedupe key).
   - Add dispatcher that fetches `.shipsec/workflows.yml` via installation token (fallback to default), selects matching workflows, builds idempotent key + per-repo concurrency guard, and starts workflows via the runner.
   - Map workflow names to Temporal entry points (e.g., `shipsec-run-pr-trufflehog`).
3) GitHub Trigger node (no-code surface)
   - Add a node type `github.pr.trigger` in the builder palette (visible) even though the transport is webhook-driven.
   - Inputs: none user-supplied; it receives `event` schema (repo, owner, prNumber, headSha, headBranch, baseBranch, author, labels, files?).
   - Outputs: passes event metadata downstream; marks the run as “triggered by GitHub”.
4) Repo fetch + execution
   - Provide a built-in “Fetch repository” action that uses the installation token to download the head commit tarball/zip and yields `workspacePath`.
   - Components (e.g., trufflehog) accept `workspacePath` and optional globs/limits; runner mounts the workspace into the container.
5) Feedback to GitHub
   - Service to create/update `check_run` per workflow (queued → in_progress → completed with conclusion + Studio URL).
   - Optional PR comment summarizing findings; keep non-blocking until policy toggles exist.
6) Observability + retries
   - Dedupe redeliveries via delivery id + head SHA; log event→run mapping; metrics for queue/start/finish/error.
   - Surface last webhook receipt and install status in Connections UI.

### Minimal GitHub Trigger node schema (proposed)
- **type**: `github.pr.trigger`
- **inputs**: none (system-provided)
- **outputs** (object):
  - `repository`: { `owner`: string; `name`: string }
  - `prNumber`: number
  - `head`: { `sha`: string; `ref`: string }
  - `base`: { `sha`: string; `ref`: string }
  - `author`: string
  - `labels`: string[]
  - `files`: optional array of { `path`: string; `status`: string }
  - `deliveryId`: string

### Example no-code flow (trufflehog on PR)
`[GitHub PR Trigger] → [Fetch repository] → [Trufflehog Scan] → [Summarize] → [Publish GitHub Check/Comment]`

### Quick demo path (no Redis/queues)
- Purpose: show end-to-end webhook → Temporal run in minutes for a demo. Not production-grade.
- What it does: webhook → signature verify → normalize envelope → in-memory dedupe → starts Temporal `minimalWorkflow` with the envelope as args (workflowId `github-demo-<dedupe>`). No config lookup, no repo fetch, no GitHub feedback.
- Requirements: Temporal reachable (env `TEMPORAL_ADDRESS`, default `localhost:7233`), GitHub App creds/env set, backend running.
- Run: start backend normally; install GitHub App webhook to `/api/v1/webhooks/github/app`; open a PR or resync to fire a webhook.
- Follow-ups after demo: replace in-memory dedupe with Redis/DB, add repo config resolution + actual workflow start, add check_run feedback, and remove the demo starter once proper dispatch is in place.

### New component for repo checkout (to feed scanners like trufflehog)
- `github.pr.checkout` (worker): inputs `repoFullName`, `ref` (branch or SHA), optional `token`, `depth` (default 1), `clean` (default false). It shallow-clones the PR head into an isolated temp dir and outputs `{ workspacePath, repoFullName, ref, commitSha }` for downstream components to consume. In pipelines, wire the GitHub trigger metadata into this node, then pass `workspacePath` to scanners. Clean=true deletes checkout after run (leave false when a downstream component needs the path).  
