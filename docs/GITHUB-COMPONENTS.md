# GitHub & Security Component Reference

Complete reference for all GitHub integration, scanner, and security processing components.

## GitHub Components

### `github.repo.clone` — Clone Repository

Clones a GitHub repository into an isolated Docker volume for scanning.

|            |                                  |
| ---------- | -------------------------------- |
| **Slug**   | `github-clone-repo`              |
| **Runner** | Docker (creates isolated volume) |

**Inputs:**

| Port             | Type   | Required | Description                                    |
| ---------------- | ------ | -------- | ---------------------------------------------- |
| `installationId` | number | No       | GitHub App installation ID (for private repos) |
| `repository`     | string | No       | Repository in `owner/repo` format              |
| `branch`         | string | No       | Branch to clone                                |
| `ref`            | string | No       | Specific commit SHA to checkout                |

**Config:**

| Param        | Type            | Default | Description                    |
| ------------ | --------------- | ------- | ------------------------------ |
| `repository` | string          | —       | Repository name (`owner/repo`) |
| `branch`     | string          | —       | Branch to clone                |
| `ref`        | string          | —       | Commit SHA or tag              |
| `depth`      | number (1–1000) | `1`     | Clone depth (1 = shallow)      |
| `submodules` | boolean         | `false` | Recursively clone submodules   |

**Outputs:**

| Port             | Type   | Description                               |
| ---------------- | ------ | ----------------------------------------- |
| `volumePath`     | string | Path inside container (`/workspace/repo`) |
| `volumeName`     | string | Docker volume name (pass to scanners)     |
| `repository`     | string | Cloned repository name                    |
| `branch`         | string | Branch that was cloned                    |
| `commitSha`      | string | Checked-out commit SHA                    |
| `cloneUrl`       | string | Public HTTPS clone URL                    |
| `installationId` | number | Passed through for downstream use         |

**Notes:**

- Public repos clone without authentication.
- Private repos require `installationId` to fetch a GitHub App installation token.
- Volumes are automatically cleaned up when the workflow finishes (success or failure).

---

### `github.pr.context` — Get PR Context

Fetches pull request metadata and changed files.

|          |                     |
| -------- | ------------------- |
| **Slug** | `github-pr-context` |

**Inputs:**

| Port             | Type   | Required | Description                |
| ---------------- | ------ | -------- | -------------------------- |
| `installationId` | number | Yes      | GitHub App installation ID |
| `owner`          | string | Yes      | Repository owner           |
| `repo`           | string | Yes      | Repository name            |
| `pullNumber`     | number | Yes      | PR number                  |

**Outputs:**

| Port                   | Type     | Description                                 |
| ---------------------- | -------- | ------------------------------------------- |
| `title`                | string   | PR title                                    |
| `author`               | string   | PR author username                          |
| `baseBranch`           | string   | Target branch                               |
| `headBranch`           | string   | Source branch                               |
| `headSha`              | string   | Head commit SHA                             |
| `baseSha`              | string   | Base commit SHA                             |
| `changedFiles`         | string[] | List of changed file paths                  |
| `changedFilesDetailed` | object[] | Detailed file info with additions/deletions |
| `additions`            | number   | Total lines added                           |
| `deletions`            | number   | Total lines deleted                         |
| `changedFileCount`     | number   | Number of changed files                     |
| `cloneUrl`             | string   | Public HTTPS clone URL                      |
| `state`                | string   | PR state: open, closed, merged              |
| `isDraft`              | boolean  | Whether the PR is a draft                   |
| `labels`               | string[] | PR labels                                   |

**Notes:**

- `changedFiles` is commonly wired to scanner normalize components to filter findings to PR-only changes.
- `headSha` should be used as the `ref` for `github.repo.clone` to scan the PR's exact code.

---

### `github.pr.comment` — Post PR Comment

Posts or updates a comment on a pull request.

|          |                     |
| -------- | ------------------- |
| **Slug** | `github-pr-comment` |

**Inputs:**

| Port                | Type   | Required | Description                           |
| ------------------- | ------ | -------- | ------------------------------------- |
| `installationId`    | number | No       | GitHub App installation ID            |
| `owner`             | string | Yes      | Repository owner                      |
| `repo`              | string | Yes      | Repository name                       |
| `prNumber`          | number | Yes      | PR number                             |
| `body`              | string | Yes      | Markdown content to post              |
| `existingCommentId` | number | No       | Update existing comment (upsert mode) |

**Outputs:**

| Port         | Type   | Description                |
| ------------ | ------ | -------------------------- |
| `commentId`  | number | Created/updated comment ID |
| `commentUrl` | string | URL to the comment         |

**Notes:**

- When `existingCommentId` is provided, the component attempts a PATCH. If the comment was deleted, it falls back to creating a new one.
- Wire the `markdown` output from `security.findings.markdown` to `body` for formatted reports.

---

### `github.check.create` — Create Check Run

Creates a GitHub Check Run on a commit.

|          |                       |
| -------- | --------------------- |
| **Slug** | `github-check-create` |

**Inputs:**

| Port             | Type   | Required | Description                                             |
| ---------------- | ------ | -------- | ------------------------------------------------------- |
| `installationId` | number | No       | GitHub App installation ID                              |
| `owner`          | string | Yes      | Repository owner                                        |
| `repo`           | string | Yes      | Repository name                                         |
| `headSha`        | string | Yes      | Commit SHA to attach the check to                       |
| `name`           | string | Yes      | Check run name (e.g., "Security Scan")                  |
| `status`         | enum   | No       | `queued`, `in_progress`, `completed`                    |
| `conclusion`     | enum   | No       | `success`, `failure`, `neutral`, `cancelled`, `skipped` |
| `output`         | object | No       | `{ title, summary, text }`                              |

**Outputs:**

| Port         | Type   | Description          |
| ------------ | ------ | -------------------- |
| `checkRunId` | number | Created check run ID |

**Notes:**

- Create with `status: "in_progress"` at the start of a scan.
- Wire `checkRunId` to `github.check.update` to finalize the check.

---

### `github.check.update` — Update Check Run

Updates an existing GitHub Check Run.

|          |                       |
| -------- | --------------------- |
| **Slug** | `github-check-update` |

**Inputs:**

| Port             | Type   | Required | Description                          |
| ---------------- | ------ | -------- | ------------------------------------ |
| `installationId` | number | No       | GitHub App installation ID           |
| `owner`          | string | Yes      | Repository owner                     |
| `repo`           | string | Yes      | Repository name                      |
| `checkRunId`     | number | Yes      | Check run ID from create step        |
| `status`         | enum   | No       | `queued`, `in_progress`, `completed` |
| `conclusion`     | enum   | No       | Required when `status=completed`     |
| `output`         | object | No       | `{ title, summary, text }`           |

**Outputs:**

| Port         | Type   | Description          |
| ------------ | ------ | -------------------- |
| `checkRunId` | number | Updated check run ID |

---

## Scanner Components

### `scanner.opengrep` — OpenGrep SAST Scanner

Static application security testing (SAST) using OpenGrep with 2000+ community rules.

|            |                                      |
| ---------- | ------------------------------------ |
| **Slug**   | `opengrep-scanner`                   |
| **Runner** | Docker (`ghcr.io/opengrep/opengrep`) |

**Inputs:**

| Port           | Type     | Required | Description                   |
| -------------- | -------- | -------- | ----------------------------- |
| `volumeName`   | string   | Yes      | Docker volume from clone step |
| `changedFiles` | string[] | No       | Filter scan to specific files |

**Config:**

| Param            | Type     | Default | Description                                                                |
| ---------------- | -------- | ------- | -------------------------------------------------------------------------- |
| `ruleset`        | enum     | `auto`  | `auto`, `p/default`, `p/security-audit`, `p/owasp-top-ten`, `p/cwe-top-25` |
| `severityFilter` | string[] | —       | `ERROR`, `WARNING`, `INFO`                                                 |
| `excludePaths`   | string[] | —       | Glob patterns to exclude                                                   |
| `timeout`        | number   | `300`   | Seconds (60–1800)                                                          |
| `jobs`           | number   | `4`     | Parallel jobs (1–16)                                                       |

**Outputs:**

| Port           | Type     | Description             |
| -------------- | -------- | ----------------------- |
| `findings`     | object[] | Standardized findings   |
| `findingCount` | number   | Total findings          |
| `rawOutput`    | string   | Raw scanner JSON output |

**Finding shape:** `{ rule_id, severity, file, line, message, snippet }`

---

### `scanner.trufflehog` — TruffleHog Secret Scanner

Scans repositories for 800+ types of exposed secrets, API keys, and credentials.

|            |                                       |
| ---------- | ------------------------------------- |
| **Slug**   | `trufflehog-scanner`                  |
| **Runner** | Docker (`trufflesecurity/trufflehog`) |

**Inputs:**

| Port           | Type     | Required | Description                   |
| -------------- | -------- | -------- | ----------------------------- |
| `volumeName`   | string   | Yes      | Docker volume from clone step |
| `changedFiles` | string[] | No       | Filter scan to specific files |

**Config:**

| Param              | Type     | Default | Description                                  |
| ------------------ | -------- | ------- | -------------------------------------------- |
| `onlyVerified`     | boolean  | `false` | Only report verified secrets                 |
| `includeDetectors` | string[] | —       | e.g., `AWS`, `Github`, `Slack`, `PrivateKey` |
| `excludeDetectors` | string[] | —       | Detectors to skip                            |
| `maxDepth`         | number   | `50`    | Git history depth (1–100)                    |
| `concurrency`      | number   | `8`     | Parallel threads (1–20)                      |

**Outputs:**

| Port            | Type     | Description              |
| --------------- | -------- | ------------------------ |
| `findings`      | object[] | Standardized findings    |
| `findingCount`  | number   | Total findings           |
| `verifiedCount` | number   | Verified secret count    |
| `rawOutput`     | string   | Raw scanner JSONL output |

**Finding shape:** `{ type, file, line, severity, secret_type, snippet }`

---

### `scanner.trivy` — Trivy Security Scanner

Comprehensive scanner for vulnerabilities, misconfigurations, and secrets in filesystems, containers, and IaC.

|            |                          |
| ---------- | ------------------------ |
| **Slug**   | `trivy-scanner`          |
| **Runner** | Docker (`aquasec/trivy`) |

**Inputs:**

| Port         | Type   | Required | Description                   |
| ------------ | ------ | -------- | ----------------------------- |
| `volumeName` | string | Yes      | Docker volume from clone step |

**Config:**

| Param            | Type     | Default      | Description                                          |
| ---------------- | -------- | ------------ | ---------------------------------------------------- |
| `scanType`       | enum     | `filesystem` | `filesystem`, `config`, `image`                      |
| `imageRef`       | string   | —            | Container image ref (required for `image` scan type) |
| `severityFilter` | string[] | —            | `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `UNKNOWN`       |
| `scanners`       | string[] | —            | `vuln`, `misconfig`, `secret`, `license`             |
| `ignoreUnfixed`  | boolean  | `false`      | Skip vulnerabilities without fixes                   |
| `timeout`        | number   | `300`        | Seconds (60–1800)                                    |

**Outputs:**

| Port           | Type     | Description             |
| -------------- | -------- | ----------------------- |
| `findings`     | object[] | Standardized findings   |
| `findingCount` | number   | Total findings          |
| `rawOutput`    | string   | Raw scanner JSON output |

**Finding shape:** `{ type, target, vulnerability_id, severity, description }`

---

### `scanner.dependency` — Dependency Scanner

Scans project dependencies for known vulnerabilities using safedep/vet.

|            |                                |
| ---------- | ------------------------------ |
| **Slug**   | `dependency-scanner`           |
| **Runner** | Docker (`ghcr.io/safedep/vet`) |

**Inputs:**

| Port         | Type   | Required | Description                   |
| ------------ | ------ | -------- | ----------------------------- |
| `volumeName` | string | Yes      | Docker volume from clone step |

**Config:**

| Param               | Type     | Default | Description                                                |
| ------------------- | -------- | ------- | ---------------------------------------------------------- |
| `failOnVuln`        | boolean  | `false` | Fail if vulnerabilities found                              |
| `severityThreshold` | enum     | `high`  | `critical`, `high`, `medium`, `low`                        |
| `ecosystems`        | string[] | —       | `npm`, `pypi`, `cargo`, `go`, `maven`, `nuget`, `rubygems` |

**Outputs:**

| Port           | Type     | Description            |
| -------------- | -------- | ---------------------- |
| `findings`     | object[] | Standardized findings  |
| `findingCount` | number   | Total findings         |
| `packageCount` | number   | Total packages scanned |
| `rawOutput`    | string   | Raw scanner output     |

**Finding shape:** `{ package, version, vulnerability_id, severity, fixed_version, description }`

---

## Security Processing Components

### `security.findings.normalize` — Normalize Security Findings

Converts raw scanner output into a standardized format for unified processing.

|          |                               |
| -------- | ----------------------------- |
| **Slug** | `security-findings-normalize` |

**Inputs:**

| Port           | Type     | Required | Description                               |
| -------------- | -------- | -------- | ----------------------------------------- |
| `rawFindings`  | object[] | Yes      | Raw findings from any scanner             |
| `changedFiles` | string[] | No       | File list for filtering (from PR context) |

**Config:**

| Param                  | Type    | Default | Description                                                                  |
| ---------------------- | ------- | ------- | ---------------------------------------------------------------------------- |
| `scannerType`          | enum    | `auto`  | `trufflehog`, `opengrep`, `dependency`, `trivy`, `nuclei`, `prowler`, `auto` |
| `filterToChangedFiles` | boolean | `true`  | Only include findings in changed files                                       |

**Outputs:**

| Port            | Type     | Description                                    |
| --------------- | -------- | ---------------------------------------------- |
| `findings`      | object[] | Normalized findings                            |
| `summary`       | object   | `{ critical, high, medium, low, info, total }` |
| `findingCount`  | number   | Total after normalization                      |
| `filteredCount` | number   | Count removed by filtering                     |

**Normalized finding shape:**

```
{
  scanner, finding_hash, severity, asset_key,
  rule_id, title, description, file, line,
  snippet, metadata
}
```

**Notes:**

- Auto-detects scanner type from finding shape.
- `finding_hash` (16-char SHA) enables cross-scanner deduplication.
- Wire `changedFiles` from `github.pr.context` and set `filterToChangedFiles: true` to only show findings in PR-modified files.

---

### `security.findings.markdown` — Format Findings as Markdown

Converts normalized findings into rich Markdown reports for PR comments.

|          |                              |
| -------- | ---------------------------- |
| **Slug** | `security-findings-markdown` |

**Inputs:**

| Port        | Type     | Required | Description                                      |
| ----------- | -------- | -------- | ------------------------------------------------ |
| `findings`  | object[] | Yes      | Normalized findings                              |
| `prContext` | object   | No       | `{ owner, repo, pullNumber, headSha, cloneUrl }` |

**Config:**

| Param         | Type    | Default                   | Description                        |
| ------------- | ------- | ------------------------- | ---------------------------------- |
| `title`       | string  | `"Security Scan Results"` | Report heading                     |
| `grouping`    | enum    | `scanner`                 | `scanner`, `severity`, `none`      |
| `maxFindings` | number  | `20`                      | Maximum findings to display (1–50) |
| `showScanner` | boolean | `false`                   | Show scanner name per finding      |
| `logoUrl`     | string  | —                         | Logo image URL for report header   |

**Outputs:**

| Port          | Type    | Description                |
| ------------- | ------- | -------------------------- |
| `markdown`    | string  | Formatted Markdown report  |
| `hasFindings` | boolean | Whether any findings exist |

**Notes:**

- Includes severity badges, collapsible details, and file links.
- When `prContext` is provided, findings link to the exact file and line in the PR.
- Truncates long reports to stay within GitHub's comment size limits.
