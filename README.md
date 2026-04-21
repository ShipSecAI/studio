<div align="center">
  <img src="docs/media/splash.png" alt="ShipSec Studio" width="800">
</div>

<p align="center">
  <img src="https://img.shields.io/github/v/release/ShipSecAI/studio?color=blue&label=version" alt="Version">
  <a href="https://github.com/ShipSecAI/studio/tree/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-green" alt="License"></a>
  <a href="https://discord.gg/fmMA4BtNXC"><img src="https://img.shields.io/discord/1175402031123447818?color=5865F2&label=discord&logo=discord&logoColor=white" alt="Discord"></a>
</p>

# ShipSec Studio

**The harness for agent-native security workflow orchestration.**

ShipSec Studio is an open-source platform for building, running, observing, and governing security workflows that combine agents, MCP tools, scanners, APIs, and human approvals in one durable execution system.

The public repo is aimed at **self-hosted, usually single-tenant deployments**. If you want a managed experience, ShipSec Cloud is the hosted offering, but the open-source product is fully usable on its own infrastructure.

## Why Studio

- **Agent-native by design**: wire AI agents, prompts, MCP tools, and traditional security components into one workflow.
- **Durable execution**: retries, resumability, schedules, webhooks, and subworkflows are backed by Temporal.
- **Human-in-the-loop controls**: pause for approvals, forms, or operator decisions without losing workflow state.
- **Full run visibility**: terminal output, logs, events, artifacts, and replayable execution history.
- **Reusable security automation**: templates for code security, cloud security, ASM, reporting, and investigations.

## Core Primitives

- **Workflows**: visual graphs that compile into executable security automations
- **Agents**: tool-using AI steps, chat sessions, and skill-enabled runs
- **Tools**: MCP servers, security scanners, HTTP integrations, credential resolvers
- **Human steps**: approvals, forms, and manual branching
- **Observability**: traces, logs, terminal streams, artifacts, and audit records

## Docker Quickstart

The simplest public self-hosted path is:

```bash
just quickstart
```

This starts a single-tenant self-hosted stack from public images and applies backend migrations automatically on startup.

Endpoints:

- App: `http://localhost:8080`
- API: `http://localhost:8080/api`
- Temporal UI: `http://localhost:8081`

Details: [docker/QUICKSTART.md](docker/QUICKSTART.md)

## Development

For contributors and local source development:

```bash
just init
just dev
```

This uses the shared infra + PM2 development path documented in [docs/installation.mdx](docs/installation.mdx) and [docs/MULTI-INSTANCE-DEV.md](docs/MULTI-INSTANCE-DEV.md).

## OSS vs ShipSec Cloud

The public repo supports the core product directly:

- self-hosted workflows
- local auth or external auth
- direct provider configuration
- AI via model/base URL/API key
- integrations via user-managed credentials or apps

ShipSec Cloud offers a managed deployment and a smoother setup experience for hosted users. Public docs mention that product shape, but do not rely on private implementation details.

## Capabilities

- Workflow builder and reusable workflow templates
- Chat and agent-driven execution
- MCP server library and tool discovery
- Code security, PR protection, and GitHub scans
- Cloud accounts, cloud inventory, and cloud scans
- Attack surface management (domains, assets, scans)
- Report templates, artifacts, and audit logs
- Schedules, webhooks, and API-driven execution

## Learn More

- [Introduction](docs/index.mdx)
- [Quickstart](docs/quickstart.mdx)
- [Installation](docs/installation.mdx)
- [Deployment Model](docs/deployment-model.mdx)
- [OSS vs ShipSec Cloud](docs/oss-vs-cloud.mdx)
- [Architecture](docs/architecture.mdx)
- [Components](docs/components/overview.mdx)

## Community

- Discord: https://discord.gg/fmMA4BtNXC
- Discussions: https://github.com/ShipSecAI/studio/discussions
- Docs: https://docs.shipsec.ai
