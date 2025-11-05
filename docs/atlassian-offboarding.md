# Atlassian Offboarding Workflow

This guide explains how to build a workflow that removes Atlassian Cloud users
using the **Atlassian Offboarding** component. The goal is to revoke all access
for a set of users when an offboarding request lands in ShipSec.

## Prerequisites

- Atlassian Cloud organization ID (UUID). You can find it in the admin portal
  under **Settings → Organization settings**.
- Atlassian Admin API bearer token with permission to manage users.
- ShipSec secret containing the bearer token (recommended). The secret UUID is
  needed by the workflow.

## Recommended Workflow

```
Manual Trigger / Webhook
        ↓
Secret Fetch ──┐
               ├─→ Atlassian Offboarding ─→ Console Log / Notify
Input builder ─┘
```

1. **Manual Trigger / Webhook** – receives the list of users to offboard (for
   example from HR automation).
2. **Secret Fetch** – resolves the Atlassian bearer token stored in ShipSec
   secrets.
3. **Atlassian Offboarding** – searches for each email username and removes the
   matching accounts from the organization.
4. **Console Log / Notify** – surfaces the structured results through logs,
   Slack, email, or ticketing integration.

## Atlassian Offboarding Inputs

| Input             | Type        | Description                                                                 |
| ----------------- | ----------- | --------------------------------------------------------------------------- |
| `emailUsernames`  | `list<text>`| Comma or newline separated list of usernames (portion before `@`).         |
| `orgId`           | `text`      | Atlassian organization UUID.                                               |
| `accessToken`     | `secret`    | Direct bearer token (optional, secret connection preferred).               |
| `accessTokenSecretId` | `text` | UUID of the ShipSec secret containing the bearer token.                     |
| `limit`           | `number`    | Optional search limit (default `20`).                                      |

> **Tip:** Connect `Secret Fetch.secret` to `accessToken` so credentials are
> masked. Provide `emailUsernames` via manual trigger input or transform.

## Outputs

- `results` – Array of `{ emailUsername, accountId, status, message }`.
  Status is `deleted`, `not_found`, or `error`.
- `summary` – Counts of requested, found, deleted, and failed users.
- `searchRaw` – Raw API payload for audit/debug (optional to log).

## Error Handling

- Missing or invalid access token throws a descriptive error before deletion.
- API errors for individual users return `status: "error"` with a message in
  the results array so the workflow continues processing the rest.

## Component Setup in the UI

1. **Add Secret Fetch**
   - Drag the *Secret Fetch* component to the canvas.
   - Set `Secret ID` to the UUID of your Atlassian bearer token secret.
   - (Optional) leave `Version` empty to use the active secret.

2. **Add Atlassian Offboarding**
   - Place the *Atlassian Offboarding* component next to Secret Fetch.
   - Connect `Secret Fetch → secret` to `Atlassian Offboarding → accessToken`.
   - Enter your Atlassian `orgId` in the parameters panel (UUID format).
   - Provide email usernames via:
     - Manual Trigger input (one per line) wired to `emailUsernames`, or
     - A JSON/List builder before the offboarding component.
   - Optionally set `limit` (default 20) to control search batch size.

3. **Review Results**
   - Connect `Atlassian Offboarding → results` to a *Console Log* or
     notification component to inspect deletions.
   - Connect `summary` to downstream reporting/alerting if needed.

## Testing Checklist

- Run with a dry-run list in a sandbox org first.
- Confirm the secret ID resolves via Secret Fetch (look for progress logs).
- Verify the `summary` totals match the expected offboarded users.
- Optionally send `summary.failed > 0` into an alerting component.

With these steps you can integrate Atlassian user offboarding into broader
ShipSec automation flows while keeping credentials safe and audit-ready.***
