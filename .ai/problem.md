# MCP Local Tool Discovery Failing via Gateway

## Goal
Get AWS CloudTrail/CloudWatch MCP tools discoverable via the MCP Gateway in a workflow tool-mode run (local dev).

## Current Status
- MCP proxy images build and run locally.
- Containers start successfully with dynamic host ports and respond to `/mcp` when hit directly.
- Tool registry entries are written in Redis for each run (type `local-mcp`).
- Gateway `tools/list` via `/api/v1/mcp/gateway` still returns empty list for the run.

## What Works (Direct Container)
Example container (host port random):
- `curl -H 'Accept: application/json, text/event-stream' -H 'Mcp-Session-Id: stdio-proxy' ... http://localhost:<port>/mcp` works
- Manual `initialize` then `tools/list` returns 5 CloudTrail tools.

## Current Failure (Gateway)
Gateway tries to fetch tools from external source via `StreamableHTTPClientTransport`.
Errors from backend:
- “The socket connection was closed unexpectedly”
- “Bad Request: Server not initialized”
- “Invalid Request: Server already initialized” (fixed by unique session IDs)

## Root Cause Hypothesis
Gateway’s StreamableHTTP client isn’t reliably completing the MCP initialize flow against the proxy, likely due to:
- Session handling (Mcp-Session-Id headers, initialize sequencing)
- GET SSE requirement of the MCP Streamable HTTP spec (client may be expecting SSE and disconnecting)
- Timing: gateway initializes before MCP registers tools and/or before proxy is fully ready

## What We Tried
1) **Proxy image rebuilds**
- Switched base to `node:20-slim` (glibc) to speed builds.
- Installed MCP packages at build using `uv pip install --system`.
- Corrected MCP binary names (`awslabs.cloudtrail-mcp-server`, `awslabs.cloudwatch-mcp-server`).

2) **Dynamic ports**
- `worker/src/components/core/mcp-runtime.ts` now chooses a free host port and sets `ENDPOINT` to `http://localhost:<port>/mcp`.

3) **Gateway debugging**
- Added heavy logs in `backend/src/mcp/mcp-gateway.service.ts`.
- Added refresh flow in `InternalMcpController` → `McpGatewayService.refreshServersForRun` so tools can be registered after gateway initialization.

4) **Session handling fixes**
- `StreamableHTTPClientTransport` now includes `Mcp-Session-Id` header in request init.
- Per-attempt unique session IDs generated to avoid “already initialized”.

5) **Direct client test**
- A Node script using `StreamableHTTPClientTransport` + `Mcp-Session-Id` works when run outside gateway (manual test). This indicates the proxy is healthy.

## Evidence
Gateway logs show:
- First `initialize` occurs before tools are registered → registry returns 0 tools.
- Refresh is called after register-local → registry returns 1 local-mcp source.
- Gateway tries to fetch tools from endpoint (e.g. `http://localhost:<port>/mcp`).
- Fails with socket closed or server-not-initialized errors despite container working via curl.

## Suspected Remaining Issues
- `StreamableHTTPClientTransport` may still be opening GET SSE without required `Mcp-Session-Id`, or closing prematurely.
- `Client.connect()` does **not** send initialize if transport sessionId is set. We set header only, so initialization should happen. However GET SSE may happen first and fail, causing socket close.
- The proxy expects `/mcp` POST initialize before `/tools/list`. Gateway may be POSTing `tools/list` before initialize completes.
- Gateway is running multiple connects per attempt; retries may be stepping on the same session or receiving server-side invalid request.

## Next Suggested Debug Steps
1) Force the client to explicitly initialize:
   - Call `client.request({ method: 'initialize', ... })` instead of relying on `connect()`.
   - Or remove the custom `sessionId` / header usage and let the SDK handle init.

2) Disable SSE connection in `StreamableHTTPClientTransport`:
   - The proxy does not implement GET SSE (returns 400 unless initialized). Consider overriding transport or using fetch-based transport without SSE.

3) Test gateway transport outside of Nest:
   - Create a small Node script that mirrors gateway’s exact `StreamableHTTPClientTransport` usage (with headers), and see if it fails.

4) Check for concurrency issues:
   - The gateway refresh can be called while the initial server is still being connected, causing initialize collisions.

## PTY Issue (side thread)
`node-pty` rebuild fails due to TypeScript errors pulled from repo types. PTY spawn fails (`posix_spawnp failed`). We avoided PTY for MCP by using detached docker. This is separate from MCP gateway issues.

## Current Local Command to Repro
```
set -a; source .env; set +a; INTERNAL_SERVICE_TOKEN=local-internal-token node /tmp/mcp-stage3-4.js
```
This script:
- creates workflow
- runs it
- generates MCP token
- initializes gateway
- tries tools/list (retries)

## Key Files
- `backend/src/mcp/mcp-gateway.service.ts`
- `backend/src/mcp/internal-mcp.controller.ts`
- `worker/src/components/core/mcp-runtime.ts`
- `worker/src/components/security/aws-cloudtrail-mcp.ts`
- `docker/mcp-aws-cloudtrail/Dockerfile`
- `/tmp/mcp-stage3-4.js`

