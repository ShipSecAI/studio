# Version Check Client

ShipSec Studio performs a version compatibility check whenever the backend boots. The backend calls `https://version.shipsec.ai/api/version/check` and reacts according to the server response.

## When it runs

- **Backend bootstrap** – `backend/src/main.ts` invokes the version check before Nest starts listening. Any path that launches the backend (PM2, Docker, `bun --cwd backend run dev`, etc.) hits the endpoint once during startup.
- **CLI startup summary** – At the end of `just dev`, `just prod`, and `just prod build` commands, a colored version status box is displayed.

If the endpoint reports `is_supported=false`, the backend logs an error and continues in fail-open mode. `should_upgrade=true` prints a warning without blocking. Network failures log a warning and allow the workflow to continue (fail-open).

## Configuration

| Variable | Purpose |
| --- | --- |
| `SHIPSEC_VERSION_CHECK_DISABLED` | Set to `1` or `true` to skip the check. |
| `SHIPSEC_VERSION_CHECK_URL` | Override the base URL (default: `https://version.shipsec.ai`). |
| `SHIPSEC_VERSION_CHECK_TIMEOUT_MS` | HTTP timeout in milliseconds (default: `5000`). |

## CLI output semantics

| Outcome | Behaviour | CLI Display |
| --- | --- | --- |
| Supported | Backend logs confirmation and continues startup. | Green box with ✅ UP TO DATE |
| Upgrade available | Backend logs a warning mentioning the latest version and upgrade URL. | Yellow box with ⚠️ UPDATE AVAILABLE |
| Unsupported | Backend logs an error and continues in fail-open mode (still urging upgrade). | Red box with ❌ UNSUPPORTED VERSION |
| Error / offline | Backend logs a warning but continues (fail-open). | Gray box with ⚠️ VERSION CHECK SKIPPED |

Watch backend logs for `[version-check]` entries to see the exact decision path.

## Running manually

You can run the version check summary script directly:

```bash
bun backend/scripts/version-check-summary.ts
```
