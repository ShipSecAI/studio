# Multi-Instance Development

This guide is for contributors running multiple local Studio instances from source.

If you are self-hosting the product, use the Docker quickstart and self-hosting docs instead.

## Purpose

Multi-instance development lets you run multiple app instances on one machine while sharing the same local runtime services.

That is useful for:

- multiple worktrees
- side-by-side branch testing
- E2E runs against a chosen instance
- local regression checking without tearing down your primary session

## Model

- one shared local runtime-services layer
- many app instances started through PM2
- isolation via instance-specific ports, databases, and Temporal namespaces

## Instance Resolution

Studio resolves the active instance in this order:

1. `SHIPSEC_INSTANCE`
2. `.shipsec-instance`
3. default `0`

## Typical Commands

```bash
just instance show
just instance use 4
just dev
```

Useful helpers:

```bash
just instance-init 4
just instance-env init 4
just instance-env update 4
just instance-env copy 4 5
just instance-env show 5
```

## What Changes Per Instance

- frontend port
- backend port
- database name
- Temporal namespace
- worker backend URL

## Ports

Base formula:

- frontend: `5173 + N*100`
- backend: `3211 + N*100`

Examples:

| Instance | Frontend | Backend |
| -------- | -------- | ------- |
| `0`      | `5173`   | `3211`  |
| `1`      | `5273`   | `3311`  |
| `4`      | `5573`   | `3611`  |

Shared runtime services keep fixed ports.

## Env Files

Per-instance env files live under:

- `.instances/instance-N/backend.env`
- `.instances/instance-N/worker.env`
- `.instances/instance-N/frontend.env`

The helper commands initialize and update these files so instance-specific ports and URLs stay aligned.

## Running Tests Against An Instance

Example:

```bash
SHIPSEC_INSTANCE=4 bun run test:e2e
```

Or persist the instance first:

```bash
just instance use 4
bun run test:e2e
```

## Operational Notes

- `just dev stop` stops the active instance’s PM2 apps
- shared runtime services may remain available for other instances
- instance `0` is the default shared local baseline

## Related Docs

- [Installation](/installation)
- [Command Reference](/command-reference)
- [Development / Multi-Instance Dev](/development/multi-instance-dev)
