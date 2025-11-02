# Dev Environment and Temporal Worker Bundling

This repo runs a Temporal worker that bundles workflow code at startup using the Temporal TypeScript SDK. Some environments (notably macOS on Apple Silicon) run into native binding issues with `@swc/core` when webpack tries to transpile `.ts` files via `swc-loader`.

## What changed

- The worker now forces webpack to use `ts-loader` for `.ts` files instead of `swc-loader` via a `webpackConfigHook` in `worker/src/temporal/workers/dev.worker.ts`.
- PM2 runs the worker with Node + `tsx` (not Bun) to avoid SWC-native resolution paths during bundling. See `pm2.config.cjs`.

These changes remove the dependency on SWC native binaries for development bundling, fixing “Failed to load native binding” errors on macOS and other platforms with stricter code-signing.

## Why this approach

- Robust: `ts-loader` relies on TypeScript’s compiler without native addons. Works cross-platform without extra system tweaks.
- Minimal impact: Only the webpack rule for `.ts` files is swapped at bundle time; no changes to workflow code or runtime behavior.
- Familiar tooling: Stays within Temporal’s built-in webpack bundler and keeps source maps and ergonomics.

## Alternatives considered

- Pinning a specific `@swc/core` native binary and exporting `SWC_BINARY_PATH` — brittle on macOS due to code signing; varies by machine and package manager.
- Forcing WASI/WASM fallback for SWC — still introduces extra moving parts and does not help webpack’s `swc-loader` configuration.
- Pre-bundling workflows and shipping a static bundle (`WorkerOptions.workflowBundle`) — viable, but adds a separate build step and reduces dev feedback.
- Dockerizing x86-only for development — workable but heavier; developers on ARM macOS would pay the QEMU emulation tax and lose native speed.

Using `ts-loader` is the simplest, least hacky solution that “just works” after `git clone && bun install`.

## How to run

Prereqs:

- Bun installed (`bun@1.1.20+`).
- Docker for the infra (Temporal, Postgres, MinIO, Loki).

Commands:

- Install: `bun install`
- Start infra + apps: `docker compose -p shipsec up -d && pm2 startOrReload pm2.config.cjs --only shipsec-frontend,shipsec-backend,shipsec-worker --time`
- Tail worker logs (timeboxed): `timeout 5s pm2 logs shipsec-worker --lines 80`

## Troubleshooting

- If you still see SWC binding errors, ensure PM2 picked up env and script changes: `pm2 startOrReload pm2.config.cjs --only shipsec-worker --update-env`.
- To run the worker directly (bypassing PM2): `node ./node_modules/.bin/tsx worker/src/temporal/workers/dev.worker.ts`.

