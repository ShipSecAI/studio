# GitHub Security Workflows

This guide explains how to build robust security scanning workflows using the ShipSecAI GitHub component library.

## Components Overview

The library provides a set of composable components to handle the entire lifecycle of a security scan:

| Category    | Component                     | Purpose                                                        |
| ----------- | ----------------------------- | -------------------------------------------------------------- |
| **Context** | `github.pr.context`           | Fetches PR metadata and changed files for targeted scanning.   |
| **Setup**   | `github.repo.clone`           | Clones a repository into an isolated Docker volume.            |
| **Scan**    | `scanner.trufflehog`          | Scans for secrets.                                             |
| **Scan**    | `scanner.opengrep`            | Performs SAST analysis.                                        |
| **Process** | `security.findings.normalize` | Standardizes findings from any scanner.                        |
| **Report**  | `security.findings.markdown`  | Formats findings into a GitHub Markdown report.                |
| **Notify**  | `github.pr.comment`           | Posts the report as a PR comment.                              |
| **Status**  | `github.check.create/update`  | Reports status via GitHub Check Runs.                          |
| **Cleanup** | `github.repo.volume.cleanup`  | **CRITICAL:** Removes the Docker volume to prevent disk leaks. |

---

## Pattern 1: PR Comment Workflow

This is the most common pattern: identifying security issues in a Pull Request and commenting on them.

### Workflow Steps

1.  **Get PR Context**: Fetch changed files to filter results.
2.  **Create Check Run**: value="in_progress" to mark the PR as being scanned.
3.  **Clone Repository**: Clone the code into a volume.
4.  **Scan**: Run one or more scanners (TruffleHog, OpenGrep, etc.) on the volume.
5.  **Normalize**: specific scanner output -> standard format.
6.  **Format**: standard format -> Markdown table.
7.  **Comment**: Post the Markdown to the PR.
8.  **Update Check Run**: value="completed" (success/failure).
9.  **Cleanup**: Remove the volume.

### Example Configuration

#### 1. Get Context

- **Component**: `github.pr.context`
- **Inputs**: `installationId`, `owner`, `repo`, `pullNumber`
- **Output**: `changedFiles`, `headSha`

#### 2. Clone Repository

- **Component**: `github.repo.clone`
- **Inputs**: `owner`, `repo`, `ref` (use `headSha` from context)
- **Output**: `volumePath`, `volumeName`

#### 3. Scan (e.g., TruffleHog)

- **Component**: `scanner.trufflehog`
- **Inputs**: `volumePath`
- **Output**: `findings`

#### 4. Normalize & Filter

- **Component**: `security.findings.normalize`
- **Inputs**:
  - `rawFindings`: output from scanner
  - `changedFiles`: output from PR context
- **Params**: `filterToChangedFiles: true`
- **Output**: `findings` (normalized)

#### 5. Format Report

- **Component**: `security.findings.markdown`
- **Inputs**:
  - `findings`: normalized findings
  - `prContext`: output from PR context (for file links)
- **Params**: `grouping: severity`
- **Output**: `markdown`, `hasFindings`

#### 6. Post Comment

- **Component**: `github.pr.comment`
- **Inputs**: `owner`, `repo`, `prNumber`, `body` (markdown)
- **Condition**: Only if `hasFindings` is true

#### 7. Cleanup (Always Run)

- **Component**: `github.repo.volume.cleanup`
- **Inputs**: `volumeName` (from clone step)

---

## Pattern 2: Check Run Lifecycle

Use GitHub Check Runs to block merges on security failures.

1.  **Start**: Call `github.check.create`.
    - `status`: "in_progress"
    - `name`: "Security Scan"
    - **Result**: Save `checkRunId`.

2.  **Execute**: Run scans. Catch errors.

3.  **Finish**: Call `github.check.update`.
    - `checkRunId`: from step 1
    - `status`: "completed"
    - `conclusion`: "success" (no findings) or "failure" (findings found)
    - `output`: { title, summary, text } (can use formatted markdown)

---

## Best Practices

### 1. Always Clean Up Volumes

The `github.repo.clone` component creates substantial Docker volumes (repository size). If you do not run `github.repo.volume.cleanup`, the worker's disk will fill up.

- **Structure**: Place cleanup at the end of the workflow.
- **Reliability**: Ensure it runs even if previous steps fail (use "Always Run" or error handling paths).

### 2. Filter to Changed Files

Scanning the entire repository on every PR is slow and noisy.

- Use `github.pr.context` to get `changedFiles`.
- Pass this to `security.findings.normalize` with `filterToChangedFiles: true`.
- This ensures developers are only alerted about issues _they_ introduced.

### 3. Rate Limits

Be mindful of GitHub API rate limits when posting comments.

- The `findings-markdown` component truncates very long reports.
- Consider posting only a summary if findings > 50.

### 4. Security

- **Isolation**: Cloned repos live in isolated, read-only Docker volumes.
- **Secrets**: Tokens are handled securely via `github-auth` and not logged.
- **Validation**: All inputs are validated with Zod schemas.
