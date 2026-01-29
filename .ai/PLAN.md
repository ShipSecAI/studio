# MCP AWS Servers Plan (CloudTrail + CloudWatch)

Goal: Make AWS CloudTrail + CloudWatch MCP servers usable locally via OpenCode and the MCP Gateway, with a standardized MCP-node lifecycle (start → register → cleanup), and UI support through tool-mode nodes.

---

## E2E Debug Ladder (Manual → Full)

This is the incremental pipeline to isolate failures quickly.

### Stage 0 — Image Sanity
Goal: Ensure proxy images contain `uvx` and boot correctly.

Commands:
```
docker run --rm shipsec/mcp-aws-cloudtrail:latest sh -lc "uvx --help"
docker run --rm shipsec/mcp-aws-cloudwatch:latest sh -lc "uvx --help"
```

Pass: `uvx` help output.

---

### Stage 1 — Proxy Health Endpoint
Goal: Container boots and proxy HTTP server responds.

Commands:
```
docker run --rm -p 8081:8080 \
  -e AWS_ACCESS_KEY_ID=$TEST_AWS_ACCESS_KEY_ID \
  -e AWS_SECRET_ACCESS_KEY=$TEST_AWS_SECRET_ACCESS_KEY \
  -e AWS_SESSION_TOKEN=$TEST_AWS_SESSION_TOKEN \
  -e AWS_REGION=$TEST_AWS_REGION \
  shipsec/mcp-aws-cloudtrail:latest
```
Then:
```
curl http://localhost:8081/health
```

Pass: JSON `{ status: "ok", toolCount: ... }`.

---

### Stage 2 — MCP Protocol (Direct)
Goal: MCP initialize + tools/list via HTTP to the proxy.

Commands:
```
curl -s http://localhost:8081/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}'

curl -s http://localhost:8081/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

Pass: `result.tools` present.

---

### Stage 3 — Workflow Registration
Goal: Tool-mode node registers local MCP in Redis.

Run a workflow with a single tool-mode AWS MCP node and ensure:
- `registerLocalMcpActivity` invoked
- Redis key `mcp:run:{runId}:tools` has entry with containerId

---

### Stage 4 — Gateway Discovery
Goal: Gateway exposes MCP tools via `toolName__tool`.

Use MCP client to hit `/mcp/gateway` with session token for the run.
Pass: `tools/list` returns `aws_cloudtrail_mcp__*`.

---

### Stage 5 — OpenCode Tool Call
Goal: OpenCode uses gateway tools successfully.

Run OpenCode with tool connected to AWS MCP node; verify it calls at least one tool.

---

### Stage 6 — Cleanup
Goal: Workflow finalize stops containers and cleans Redis.

Pass: `docker ps` doesn’t show MCP container; Redis entry deleted.

This plan is split into commit-sized phases. No code changes beyond the plan should happen until you approve.

---

## Constraints and Principles
- MCP server nodes are tool-mode only.
- MCP servers are long-lived per workflow run (start once, expose tools, cleanup on finalize).
- All MCP servers exposed to agents must be HTTP (stdio is wrapped with proxy).
- AWS credentials are provided via a credential bundle input (or equivalent).

---

## Commit Plan

### Commit 1 — MCP lifecycle helper (worker)
Scope: Standardize MCP node lifecycle with shared helper utilities.
- Create a shared helper (e.g., `worker/src/components/core/mcp-runtime.ts`):
  - `runMcpServerInToolMode(...)` to start container, inject env, return endpoint/containerId.
  - `registerMcpServer(...)` wrapper (call `registerLocalMcpActivity`).
  - `assertToolModeOnly(context)` guard.
- Update `core.mcp.server` to call the helper and enforce tool-mode.
- Keep current stdio proxy support (already added) as a supported mode.

Artifacts:
- Helper module added.
- `core.mcp.server` uses helper and rejects non-tool mode.

---

### Commit 2 — AWS MCP proxy images (docker)
Scope: Build derived images that include AWS MCP stdio servers.
- Add `docker/mcp-aws-cloudtrail/`:
  - Dockerfile builds from `shipsec/mcp-stdio-proxy` and installs CloudTrail MCP (e.g., `uvx awslabs-cloudtrail-mcp-server`).
- Add `docker/mcp-aws-cloudwatch/`:
  - Dockerfile builds from same base and installs CloudWatch MCP.
- Document build commands and expected env vars.

Artifacts:
- New docker folders + README for each image.

---

### Commit 3 — AWS MCP components (tool-mode only)
Scope: Add two components that encapsulate AWS MCP lifecycle.
- `worker/src/components/security/aws-cloudtrail-mcp.ts`
- `worker/src/components/security/aws-cloudwatch-mcp.ts`

Each component:
- Runner: docker, image points to the new AWS proxy image.
- Parameters:
  - `region`
  - `mcpPort` (default 8080)
  - optional `extraArgs` (array)
- Inputs:
  - `awsCredentials` (credential bundle: accessKeyId, secretAccessKey, sessionToken)
- Execute:
  - Assert tool-mode only.
  - Start container with env: AWS creds + region + MCP_COMMAND/MCP_ARGS.
  - Register with gateway via activity.
  - Output: endpoint + containerId (for debug)

Artifacts:
- New components registered in index.
- Optional unit tests for components (basic config validation).

---

### Commit 4 — UI tool-mode safeguards + AWS MCP visibility
Scope: UI clarity and guardrails.
- Add “tool-mode only” badge or warning for MCP server components.
- Update component metadata / docs to reflect tool-mode only behavior.
- Ensure AWS MCP components appear in the palette under `security` (or a new `mcp` category if desired).

Artifacts:
- UI hints in config panel / node rendering.

---

## Lint & Typecheck Instructions
Run after each commit (or at least after Commit 4):

```bash
bun --cwd worker run lint
bun --cwd worker run typecheck
bun --cwd backend run lint
bun --cwd backend run typecheck
bun --cwd frontend run lint
bun --cwd frontend run typecheck
```

If only worker changes are made in a commit, it is acceptable to run just the worker checks for that commit and the full set at the end.

---

## Manual Validation (you will run)
1. Build the AWS proxy images.
2. In UI, add AWS CloudTrail MCP node and set tool mode.
3. Connect to OpenCode tools port.
4. Run workflow and verify tools show up in the gateway.
5. Confirm containers stop after workflow completes.

---

## Open Questions to Resolve Before Coding
- Should AWS MCP components live under `security` or a new `mcp` category?
- Do we want a single generic “AWS MCP” component with a server selector, or separate components?
- What is the final “credential bundle” schema in the UI?

---

## Implementation Order (after plan approval)
1) Commit 1
2) Commit 2
3) Commit 3
4) Commit 4
