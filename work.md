# Work Item 1: Cloudflare Version Check Service (Edge API)

**Owner:** Infra / Backend (Cloudflare + PostHog)
**Goal:** Provide a stateless, publicly accessible version-check API that binaries can call.

---

## 1. Responsibilities

* Expose `GET /api/version/check` on a Cloudflare Worker.
* Validate query parameters.
* Determine version status based on internal config.
* Return a JSON response with version info.
* Send telemetry to **PostHog**.
* Stay backward-compatible for clients (don’t randomly change the contract).

---

## 2. Public API Contract (source of truth)

**Endpoint**

`GET https://version.shipsec.ai/api/version/check`

**Query parameters**

Required:

* `app` – e.g. `studio`
* `version` – client version string, e.g. `1.3.0`

Optional:

* `platform` – e.g. `macos`, `windows`, `linux`
* `arch` – e.g. `arm64`, `x64`
* `workspace` – workspace ID, e.g. `ws_123`
* `instance` – instance/installation ID, e.g. `inst_abc`

**Headers used (read-only)**

* `User-Agent`
* `CF-Connecting-IP` (or `X-Forwarded-For` fallback)

**Successful response (200)**

```json
{
  "latest_version": "1.4.0",
  "min_supported_version": "1.2.0",
  "is_supported": true,
  "should_upgrade": true,
  "upgrade_url": "https://shipsec.ai/download/studio"
}
```

**Error responses**

* `400` – missing required params:

  ```json
  { "error": "Missing required params: app, version" }
  ```

* `400` – unknown app/platform/arch:

  ```json
  { "error": "Unknown app/platform/arch" }
  ```

* `404` – any non-`/api/version/check` path.

> **This contract must be documented and treated as stable.**
> Binary team will rely on it.

---

## 3. Cloudflare Worker Implementation

### 3.1 Core logic

* Parse query params (`app`, `version`, `platform`, `arch`, `workspace`, `instance`).
* Lookup version config for `(app, platform, arch)` in an internal registry:

  * `latest_version`
  * `min_supported_version`
  * `upgrade_url`
* Use a simple semver comparator to compute:

  * `is_supported = version >= min_supported_version`
  * `should_upgrade = version < latest_version`
* Build JSON response (as per contract above).

### 3.2 Version configuration (MVP)

* Start with a hardcoded registry:

  ```ts
  const VERSION_REGISTRY = {
    "studio": {
      latest_version: "1.4.0",
      min_supported_version: "1.2.0",
      upgrade_url: "https://shipsec.ai/download/studio"
    }
  };
  ```

* *Nice to have (later)*:

  * Move to KV or your own internal admin endpoint.
  * Support more specific keys like `studio:macos:arm64`.

### 3.3 Telemetry (PostHog)

On each request, the Worker should:

* Construct `distinct_id`:

  * Prefer `instance` param.
  * Else `workspace`.
  * Else IP.

* Send a `version_check` event to PostHog:

  * **Event name**: `version_check`
  * **Properties**:

    * `app`
    * `version`
    * `platform`
    * `arch`
    * `workspace_id`
    * `instance_id`
    * `user_agent`
    * `$ip` (from `CF-Connecting-IP`)
    * `is_supported`
    * `should_upgrade`
  * **Groups**:

    * `workspace` group keyed by `workspace_id` (if present).

* Use `ctx.waitUntil(...)` so PostHog call does not block the response.

* Log but ignore PostHog failures (do NOT fail the API if analytics fails).

### 3.4 Infra setup

* Domain: e.g. `version.shipsec.ai` → Cloudflare.
* Route: `https://version.shipsec.ai/*` → this Worker.
* Secrets / env vars:

  * `POSTHOG_HOST`
  * `POSTHOG_API_KEY`
* Optional: basic rate-limiting per IP.

### 3.5 Acceptance Criteria (for this work item)

* Curl to `GET /api/version/check` with valid params returns **200** and correct fields.
* Invalid params return appropriate **400**.
* `version_check` events show up in PostHog with the expected properties.
* API contract documented (URL, params, response fields, error cases).

---

# Work Item 2: Binary-side Version Check Client

**Owner:** Desktop/Binary team
**Goal:** Make each binary call the `/api/version/check` API on startup and react appropriately to the response.

---

## 1. Responsibilities

* Implement a client-side “version check” flow **inside the binary**.
* Call the Cloudflare endpoint with correct query params.
* Handle:

  * Happy path (supported, maybe upgrade).
  * Forced upgrade (not supported).
  * Network / API failures.
* Surface UX (banner/modals/logs) based on `is_supported` and `should_upgrade`.
* Keep concerns separated:

  * **This work item does not implement the server / Worker** – just consumes it.

---

## 2. When & how often to call

Minimum:

* On **every startup** of the binary.

Optional/ideal:

* Also on a **daily** or **every N hours** timer if the app stays open long.

Behaviour:

* Fail gracefully if the API is unreachable (no hard crash).
* Cache last known response to avoid spamming if you add periodic checks.

---

## 3. Request format (client responsibilities)

The binary must:

1. Read its own metadata:

   * `app` – e.g. `studio`
   * `version` – the current app version string
   * `platform` – OS name
   * `arch` – CPU architecture
   * `workspace_id` – if known
   * `instance_id` – unique per installation/machine (generated, persisted locally)

2. Call:

   ```text
   GET https://version.shipsec.ai/api/version/check
     ?app=<app>
     &version=<version>
     &platform=<platform>
     &arch=<arch>
     &workspace=<workspace_id>
     &instance=<instance_id>
   ```

3. Add default headers (most HTTP clients already add `User-Agent`, but not required from binary; Worker reads what it gets).

---

## 4. Response handling

**On 200 OK:**

* Parse JSON:

  * `latest_version`
  * `min_supported_version`
  * `is_supported`
  * `should_upgrade`
  * `upgrade_url`

* Behaviour:

  1. If `is_supported === false`

     * Show a **blocking or very prominent** message:

       * “Your version is no longer supported. Please update to continue.”
     * Offer “Download/Update” button linking to `upgrade_url`.
     * Optionally exit app after message (depending on UX choice).

  2. If `is_supported === true` and `should_upgrade === true`

     * Show **non-blocking** upgrade prompt:

       * Toast/banner: “A newer version (X.Y.Z) is available. You’re on A.B.C.”
       * Button: “Download update” → `upgrade_url`.
     * Don’t block usage.

  3. If `is_supported === true` and `should_upgrade === false`

     * Optionally do nothing, or log “version OK”.

* Cache:

  * Optionally store last response (for debugging/support and to avoid redundant UI prompts).

**On 4xx or 5xx:**

* Do **not** block app usage.
* Log something like:

  * “Version check failed (status 500). Proceeding with current version.”
* Maybe show nothing to user (or a small non-intrusive log-level warning in dev builds).

**On network errors (timeout, DNS, offline):**

* Same as above: fail open, allow app to run.
* Maybe schedule a retry after some time if the app stays alive.

---

## 5. Configurability / Flags

Binary should ideally support:

* Internal config/flags to:

  * **Disable version check** (for dev builds).
  * Point to a different base URL (staging vs prod):

    * e.g. `VERSION_CHECK_URL` env or config.
* Logging:

  * Log **request+response** in debug mode (without leaking any secrets, if present).

---

## 6. Acceptance Criteria (for this work item)

* On startup, binary calls the API with correct params (can be verified with logs or proxy).
* When API returns:

  * `is_supported=false`: user sees a clear “must upgrade” flow.
  * `is_supported=true, should_upgrade=true`: user sees an upgrade suggestion but can keep using.
  * `is_supported=true, should_upgrade=false`: no unnecessary noise.
* When API is down/unreachable:

  * App still starts and works normally.
  * No user-hostile behaviour; errors are logged but not blocking.
* Version check logic is behind a **config flag** that can be toggled for local dev/testing.
* Code is structured so the “version check client” is a separate module/class that can be reused across platforms if needed.

---

This split should make it very clear:

* **Work Item 1 (Cloudflare)**: define and serve the contract, plus analytics.
* **Work Item 2 (Binary)**: consume that contract and drive UX/behaviour based on it.

You can paste each section as a separate Linear/GitHub issue with labels like `Infra` and `Desktop`.
