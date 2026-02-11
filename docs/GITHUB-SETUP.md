# GitHub Integration Setup Guide

This guide walks you through setting up the ShipSec GitHub App integration from scratch.

## Prerequisites

- A running ShipSec backend (NestJS) and worker (Temporal)
- Docker installed (required for repository cloning and scanning)
- A GitHub account with permission to create GitHub Apps

## Step 1: Create a GitHub App

1. Go to **GitHub Settings > Developer settings > GitHub Apps > New GitHub App**
   - Or navigate directly to: `https://github.com/settings/apps/new`

2. Fill in the app settings:

   | Field              | Value                                         |
   | ------------------ | --------------------------------------------- |
   | **App name**       | ShipSec Security Scanner (or your preference) |
   | **Homepage URL**   | Your ShipSec instance URL                     |
   | **Webhook URL**    | `https://<your-domain>/api/v1/github/webhook` |
   | **Webhook secret** | Generate a random secret string               |

3. Set the required **permissions**:

   | Permission        | Access       | Purpose                      |
   | ----------------- | ------------ | ---------------------------- |
   | **Contents**      | Read-only    | Clone repositories           |
   | **Pull requests** | Read & write | Post PR comments and reviews |
   | **Checks**        | Read & write | Create/update check runs     |
   | **Metadata**      | Read-only    | List repositories            |

4. Subscribe to **events**:
   - Pull request
   - Push
   - Installation
   - Repository

5. Click **Create GitHub App**.

6. After creation, note down:
   - **App ID** (shown at the top of the app settings page)
   - **Client ID** and **Client secret** (under "OAuth credentials")

7. Generate a **private key**:
   - Scroll to "Private keys" section
   - Click "Generate a private key"
   - A `.pem` file will download

## Step 2: Configure Environment Variables

### Backend (`backend/.env`)

```bash
# GitHub App configuration
GITHUB_APP_ID="<your-app-id>"
GITHUB_APP_PRIVATE_KEY="<base64-encoded-private-key>"
GITHUB_APP_WEBHOOK_SECRET="<your-webhook-secret>"

# Optional: OAuth credentials (for user-level flows)
GITHUB_APP_CLIENT_ID="<client-id>"
GITHUB_APP_CLIENT_SECRET="<client-secret>"

# Optional: GitHub Enterprise overrides
# GITHUB_API_URL="https://github.example.com/api/v3"
# GITHUB_URL="https://github.example.com"
```

**Encoding the private key:**

```bash
# Base64-encode the PEM file
cat <your-app>.pem | base64 -w 0
# Paste the output as GITHUB_APP_PRIVATE_KEY value
```

The backend also accepts raw PEM format (with `-----BEGIN RSA PRIVATE KEY-----` markers), but base64 encoding is recommended to avoid multiline env var issues.

### Frontend

No additional frontend configuration is needed. The GitHub page auto-detects whether the backend has GitHub configured via `GET /api/v1/github/status`.

## Step 3: Install the GitHub App

1. Start your ShipSec instance (`just dev` or equivalent).

2. Navigate to the **GitHub** page in the ShipSec UI (sidebar > GitHub).

3. Click **Install GitHub App**. This opens GitHub's installation flow.

4. Select the organization or personal account to install on.

5. Choose repository access:
   - **All repositories** — scans all repos in the account
   - **Only select repositories** — pick specific repos

6. Click **Install**. GitHub redirects back to ShipSec with the `installation_id`.

7. ShipSec automatically:
   - Registers the installation
   - Syncs all accessible repositories
   - Shows connected repositories in the UI

### Linking an Existing Installation

If the app is already installed on GitHub but not connected in ShipSec:

1. Go to `https://github.com/settings/installations` (or org settings)
2. Find your app installation and copy the URL (e.g., `https://github.com/settings/installations/12345678`)
3. In ShipSec's GitHub page, paste the URL into the "Already installed?" input field
4. Click **Link Existing Installation**

## Step 4: Create Trigger Rules

Trigger rules define when and how security scans run automatically.

1. Go to **GitHub > Trigger Rules** tab.
2. Click **Create Trigger Rule**.
3. Configure:

   | Field                  | Description                    | Example                                 |
   | ---------------------- | ------------------------------ | --------------------------------------- |
   | **Name**               | Human-readable rule name       | "PR Security Scan"                      |
   | **Repository Pattern** | Glob pattern for repos         | `*` (all), `org/*`, `org/specific-repo` |
   | **Event**              | GitHub event type              | `pull_request`, `push`                  |
   | **Actions**            | PR actions to trigger on       | `opened`, `synchronize`, `reopened`     |
   | **Branches**           | Branch filter (push only)      | `main`, `release/*`                     |
   | **Workflow**           | Workflow to execute            | Select from dropdown                    |
   | **Post PR Comment**    | Post scan results as comment   | Enabled by default                      |
   | **Create Check Run**   | Show status in GitHub Checks   | Enabled by default                      |
   | **Post PR Review**     | Post inline review comments    | Disabled by default                     |
   | **Fail On**            | Severity threshold for failure | `high` (fails on high or critical)      |

4. Click **Save**.

### Fail-On Threshold

The `failOn` setting determines when a check run reports "failure":

| Setting    | Check fails when scan finds...        |
| ---------- | ------------------------------------- |
| `critical` | Any critical finding                  |
| `high`     | Any high or critical finding          |
| `medium`   | Any medium, high, or critical finding |
| `low`      | Any low or above finding              |
| `info`     | Any finding at all                    |
| `none`     | Never fails (always reports success)  |

## Step 5: Run a Manual Scan

To test the integration without waiting for a PR:

1. Go to **GitHub > Repositories** tab.
2. Find a repository and click the **Run Scan** button.
3. Select a workflow from the picker.
4. Optionally specify a branch (defaults to the repo's default branch).
5. Click **Run**. The scan appears in the **Scans** tab.

## Step 6: Verify Webhook Delivery

1. Go to your GitHub App settings > **Advanced** tab.
2. Check **Recent Deliveries** to see incoming webhooks.
3. Each delivery shows request/response details and status codes.
4. A `200` response confirms ShipSec received and processed the webhook.

## Architecture Overview

```
GitHub ──webhook──> Backend ──trigger──> Temporal Worker
                      │                       │
                      │ poll (30s)             │ run workflow
                      │<──────────────────────>│
                      │                        │
                      │ sync results           ├─ clone repo
                      │<───────────────────────├─ run scanners
                      │                        ├─ normalize findings
                      │ update GitHub          ├─ format markdown
                      ├─ check run             └─ post PR comment
                      ├─ PR comment
                      └─ PR review (inline)
```

### Key flows:

1. **Webhook → Trigger → Scan**: GitHub sends a webhook, backend matches trigger rules, starts a Temporal workflow.
2. **Polling sync**: `ScanResultSyncService` polls running scans every 30 seconds, syncs results when workflows complete.
3. **GitHub updates**: On completion, the backend updates check runs (with annotations), posts PR comments, and optionally posts inline PR reviews.

## Troubleshooting

### "GitHub App is not configured"

- Ensure `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` are set in `backend/.env`.
- Restart the backend after changing env vars.

### Webhooks not arriving

- Check the webhook URL is publicly accessible (use ngrok for local dev).
- Verify the webhook secret matches between GitHub and `GITHUB_APP_WEBHOOK_SECRET`.
- Check GitHub App settings > Advanced > Recent Deliveries for errors.

### "Missing authentication" on API calls

- Ensure frontend and backend auth providers match (both `clerk` or both `local`).
- For local auth: login with admin credentials (default: `admin`/`admin`).

### Check runs not appearing

- Verify the GitHub App has **Checks: Read & write** permission.
- Ensure the trigger rule has `createCheckRun: true`.
- Check backend logs for GitHub API errors.

### Inline reviews not posting

- Enable `postPrReview: true` on the trigger rule.
- Inline reviews only work for findings that map to lines within the PR diff.
- Findings outside the diff are listed in the review body summary instead.
