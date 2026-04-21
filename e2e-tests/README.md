# E2E Tests

End-to-end tests for Studio workflows, APIs, and UI flows.

## Test Tiers

| Tier     | Directory   | Description                                                  |
| -------- | ----------- | ------------------------------------------------------------ |
| Core     | `core/`     | Backend + worker behavior with minimal external dependencies |
| Pipeline | `pipeline/` | Agent/tool pipeline tests that require API keys              |
| Cloud    | `cloud/`    | Real cloud-provider integration tests                        |

## Prerequisites

Run E2E against a Studio environment that is already up and reachable.

For source development, that usually means:

```bash
just dev
```

against the instance you want to test.

## Running

```bash
bun run test:e2e
bun run test:e2e:core
bun run test:e2e:pipeline
bun run test:e2e:cloud
```

## Environment File

```bash
cp e2e-tests/.env.e2e.example e2e-tests/.env.e2e
```

Then fill only the values needed for the tier you plan to run.
