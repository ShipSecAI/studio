# GitHub Security Workflows

This guide explains how to build security scanning workflows using the ShipSec GitHub component library, with tutorials and sample workflow descriptions.

> **Related docs:**
>
> - [Setup Guide](./GITHUB-SETUP.md) — Install and configure the GitHub App
> - [Component Reference](./GITHUB-COMPONENTS.md) — Detailed API for each component

## Components Overview

| Category    | Component                     | Purpose                                                        |
| ----------- | ----------------------------- | -------------------------------------------------------------- |
| **Context** | `github.pr.context`           | Fetches PR metadata and changed files for targeted scanning.   |
| **Setup**   | `github.repo.clone`           | Clones a repository into an isolated Docker volume.            |
| **Scan**    | `scanner.opengrep`            | Performs SAST analysis (2000+ rules).                          |
| **Scan**    | `scanner.trufflehog`          | Scans for secrets and credentials (800+ detectors).            |
| **Scan**    | `scanner.trivy`               | Vulnerability, misconfiguration, and IaC scanning.             |
| **Scan**    | `scanner.dependency`          | Dependency vulnerability scanning.                             |
| **Process** | `security.findings.normalize` | Standardizes findings from any scanner.                        |
| **Report**  | `security.findings.markdown`  | Formats findings into a GitHub Markdown report.                |
| **Notify**  | `github.pr.comment`           | Posts the report as a PR comment.                              |
| **Status**  | `github.check.create/update`  | Reports status via GitHub Check Runs.                          |
| **Cleanup** | `github.repo.volume.cleanup`  | **CRITICAL:** Removes the Docker volume to prevent disk leaks. |

---

## Tutorial 1: Basic Repository Scan

The simplest workflow — clone a repo, scan it, and log findings.

**Goal:** Run OpenGrep SAST on a repository and see the results.

### Steps

```
Entry Point → Clone Repo → OpenGrep Scanner → Normalize Findings → Console Log
```

1. **Entry Point** — provide `repository` (e.g., `owner/repo`).
2. **Clone** — `github.repo.clone` with `depth: 1` (shallow clone).
3. **Scan** — `scanner.opengrep` reads the cloned volume.
4. **Normalize** — `security.findings.normalize` converts raw output to standard format.
5. **Log** — `core.console.log` outputs findings for review.

**Wire connections:**

- Entry Point `repository` → Clone `repository`
- Clone `volumeName` → OpenGrep `volumeName`
- OpenGrep `findings` → Normalize `rawFindings`

**Sample:** [`01-opengrep-repo-scan.json`](./samples/01-opengrep-repo-scan.json)

---

## Tutorial 2: PR Security Scan with Formatted Comments

The production-ready pattern — scan a PR's changes and post a formatted Markdown comment.

**Goal:** On every PR, run SAST + secret scanning, filter to changed files only, and post a clean report.

### Steps

```
Entry Point
    ├─→ PR Context ─→ Clone Repo ─┬─→ OpenGrep ─→ Normalize ─→ Markdown ─→ PR Comment
    │                              └─→ TruffleHog ─→ Normalize ─→ Markdown ─→ PR Comment
    └─→ ...
```

1. **Entry Point** — accepts `owner`, `repo`, `prNumber`, `installationId`.
2. **PR Context** — `github.pr.context` fetches changed files and head SHA.
3. **Clone** — `github.repo.clone` clones at the PR's `headSha`.
4. **Scan (parallel)** — run `scanner.opengrep` and `scanner.trufflehog` in parallel on the same volume.
5. **Normalize (each)** — `security.findings.normalize` with `filterToChangedFiles: true` and `changedFiles` from PR context.
6. **Format (each)** — `security.findings.markdown` with `grouping: severity`, wiring `prContext` for file links.
7. **Comment (each)** — `github.pr.comment` posts each report.

**Key config:**

- Normalize: `filterToChangedFiles: true` — only show findings in PR-modified files
- Markdown: `maxFindings: 25`, `grouping: severity`

**Sample:** [`04-pr-security-scan.json`](./samples/04-pr-security-scan.json)

---

## Tutorial 3: Check Run Integration

Use GitHub Check Runs to show scan status in the PR UI and optionally block merges.

**Goal:** Create a check run, run scans, update the check with results and annotations.

### Steps

```
Entry Point → PR Context ─┬─→ Create Check (OpenGrep) ─→ Clone ─→ OpenGrep ─→ Update Check
                           └─→ Create Check (TruffleHog) ─→ Clone ─→ TruffleHog ─→ Update Check
```

1. **Create Check Runs** — `github.check.create` with `status: "in_progress"` and a descriptive `name`.
2. **Clone & Scan** — same as before.
3. **Update Check Runs** — `github.check.update` with `status: "completed"` and:
   - `conclusion: "success"` if no findings
   - `conclusion: "failure"` if findings exceed threshold
   - `output.summary`: markdown summary table
   - `output.text`: detailed findings

**Notes:**

- Check runs appear in the PR's "Checks" tab.
- Configure branch protection rules to require check runs before merge.
- The `ScanResultSyncService` also adds finding annotations (up to 50) automatically.

**Sample:** [`05-pr-security-check-run.json`](./samples/05-pr-security-check-run.json)

---

## Tutorial 4: AI Code Review

Use an AI agent to review PR code changes and post intelligent feedback.

**Goal:** Review PR diffs with an AI model that catches logic errors, patterns, and issues scanners miss.

### Steps

```
Entry Point → Clone Repo → PR Context → OpenCode AI Agent → PR Comment
```

1. **Clone** — `github.repo.clone` with `depth: 0` (full history for context).
2. **PR Context** — fetch changed files with detailed additions/deletions.
3. **AI Review** — `core.ai.opencode` receives PR diffs and produces a structured review.
4. **Comment** — post the AI-generated Markdown review to the PR.

**Sample:** [`07-ai-code-review.json`](./samples/07-ai-code-review.json)

---

## Tutorial 5: Unified AI Security Review

The most comprehensive workflow — combine automated scanners with AI intelligence in a single report.

**Goal:** Run SAST + secret scanning, feed results to an AI agent alongside PR diffs, and post a unified report.

### Steps

```
Entry Point → Clone Repo → PR Context
                         → OpenGrep ──┐
                         → TruffleHog ─┤
                                       └─→ AI Agent (all inputs) → PR Comment
```

1. **Clone** — full history clone.
2. **PR Context** — changed files for the AI agent.
3. **Scan (parallel)** — OpenGrep and TruffleHog in parallel.
4. **AI Review** — OpenCode agent receives:
   - `supplementaryA`: OpenGrep raw JSON output
   - `supplementaryB`: TruffleHog raw JSONL output
   - PR diffs in the main context
5. **AI produces:** a single unified report covering SAST findings, secret findings, and independent code review observations.
6. **Comment** — single unified PR comment.

**Key advantage:** The AI agent can:

- Assess true vs. false positives from scanner output
- Cross-reference findings with PR diffs for relevance
- Identify issues scanners miss (logic errors, race conditions, etc.)
- Produce a single actionable report instead of multiple comments

**Sample:** [`08-unified-ai-security-review.json`](./samples/08-unified-ai-security-review.json)

---

## Tutorial 6: Automatic PR Triggers

Set up trigger rules to automatically run scans on every PR without manual intervention.

**Goal:** Configure the system to scan every PR in your organization automatically.

### Steps

1. Create a scanning workflow (e.g., sample 04 or 08).
2. Go to **GitHub > Trigger Rules > Create**.
3. Configure:
   ```
   Name: PR Security Scan
   Repository Pattern: *            (all repos, or org/* for a specific org)
   Event: pull_request
   Actions: opened, synchronize, reopened
   Workflow: <select your workflow>
   Post PR Comment: ✓
   Create Check Run: ✓
   Post PR Review: □              (enable for inline review comments)
   Fail On: high                  (check fails on high/critical findings)
   ```
4. Save. New PRs now trigger scans automatically.

**Sample trigger config:** [`07-opengrep-pr-trigger.json`](./samples/07-opengrep-pr-trigger.json)

### Inline PR Reviews

When `Post PR Review` is enabled on a trigger rule:

1. After the scan completes, the system maps findings to PR diff lines.
2. Findings that fall within the diff are posted as **inline review comments** on the exact lines.
3. Findings outside the diff are summarized in the review body.
4. The review includes a severity summary table and actionable details.

This gives developers security feedback exactly where they need it — inline with their code changes.

---

## Sample Workflow Reference

All sample workflow JSON files are in `docs/samples/`. Import them via the workflow editor.

| File                                     | Name                           | Scanners              | AI  | Output                | Use Case                                          |
| ---------------------------------------- | ------------------------------ | --------------------- | --- | --------------------- | ------------------------------------------------- |
| `01-opengrep-repo-scan.json`             | OpenGrep Repo Scan             | OpenGrep              | No  | Console log           | Quick baseline SAST scan of a full repository     |
| `02-trufflehog-secret-scan.json`         | TruffleHog Secret Scan         | TruffleHog            | No  | Console log           | One-off secret audit of repository history        |
| `03-security-scan-with-pr-comments.json` | Security Scan with PR Comments | OpenGrep + TruffleHog | No  | Raw PR comments       | Quick raw scanner output posted to PRs            |
| `04-pr-security-scan.json`               | PR Security Scan               | OpenGrep + TruffleHog | No  | Formatted PR comments | Production PR scanning with formatted reports     |
| `05-pr-security-check-run.json`          | PR Security Check Run          | OpenGrep + TruffleHog | No  | GitHub Checks         | PR scanning with GitHub Checks UI integration     |
| `06-opengrep-pr-repo-scan.json`          | OpenGrep PR Scanner            | OpenGrep              | No  | Raw PR comment        | Focused SAST-only PR scan with severity filtering |
| `07-ai-code-review.json`                 | AI Code Review                 | None                  | Yes | AI PR comment         | AI-powered code review for logic/quality issues   |
| `07-opengrep-pr-trigger.json`            | OpenGrep PR Trigger            | OpenGrep              | No  | Auto-trigger config   | Trigger rule config for automatic PR scanning     |
| `08-unified-ai-security-review.json`     | Unified AI Security Review     | OpenGrep + TruffleHog | Yes | Unified PR comment    | Best-in-class: scanners + AI in one report        |

### Choosing a Workflow

- **Starting out?** Use `01` or `02` to verify scanning works.
- **PR feedback?** Use `04` for formatted comments or `05` for check runs.
- **AI review?** Use `07` for code review only, or `08` for scanners + AI combined.
- **Automatic?** Pair any workflow with a trigger rule (see `07-opengrep-pr-trigger.json`).

---

## Workflow Patterns

### Pattern 1: PR Comment Workflow

The most common pattern: scan a PR and post findings as comments.

1. **Get PR Context** → changed files for filtering.
2. **Create Check Run** → mark PR as "in progress".
3. **Clone Repository** → code into a Docker volume.
4. **Scan** → one or more scanners in parallel.
5. **Normalize** → scanner output → standard format.
6. **Format** → standard format → Markdown.
7. **Comment** → post to PR.
8. **Update Check Run** → "completed" with conclusion.
9. **Cleanup** → remove the volume.

### Pattern 2: Check Run Lifecycle

Use GitHub Check Runs for native PR status integration.

1. **Start**: `github.check.create` with `status: "in_progress"`.
2. **Execute**: Run scans.
3. **Finish**: `github.check.update` with `status: "completed"` and `conclusion`.

### Pattern 3: AI-Augmented Scanning

Feed scanner output to an AI agent for intelligent analysis.

1. **Scan** → run automated scanners.
2. **AI Agent** → receives raw output + PR diffs.
3. **Agent produces** → unified report with true/false positive assessment.
4. **Comment** → single comprehensive PR comment.

---

## Best Practices

### 1. Always Clean Up Volumes

The `github.repo.clone` component creates Docker volumes. If you skip `github.repo.volume.cleanup`, the worker's disk will fill up.

- Place cleanup at the end of every workflow that clones.
- Ensure it runs even if previous steps fail.

### 2. Filter to Changed Files

Scanning entire repositories on every PR is slow and noisy.

- Wire `changedFiles` from `github.pr.context` to `security.findings.normalize`.
- Set `filterToChangedFiles: true`.
- Developers only see issues they introduced.

### 3. Use Shallow Clones for Scanners

- Set `depth: 1` for SAST scanners (OpenGrep) — they only need current code.
- Set `depth: 0` (full history) for TruffleHog — it scans git history for secrets.
- Set `depth: 0` for AI review — more context helps the AI.

### 4. Rate Limits

- The `findings-markdown` component truncates long reports automatically.
- Consider `maxFindings: 20` to keep comments readable.
- Use check run annotations for detailed per-finding reporting.

### 5. Security

- **Isolation**: Cloned repos live in isolated Docker volumes.
- **Secrets**: Tokens are handled securely via `github-auth` and never logged.
- **Validation**: All inputs are validated with Zod schemas.
