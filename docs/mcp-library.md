# MCP Library

The MCP Library is the easiest way to make MCP tools available inside Studio workflows and agent flows.

Instead of wiring individual MCP servers by hand in every workflow, you can select registered servers from the library and expose their tools to downstream components.

## What It Does

The MCP Library component gives you:

- multi-server selection
- tool registration for selected servers
- a simple way to hand tools to AI agents
- a reusable entry point for tool-enabled workflows

## Typical Usage

1. Add the MCP Library component to a workflow
2. Select one or more available servers
3. Connect its `tools` output to an AI-capable component
4. Use those tools during workflow execution

## Where It Fits

The MCP Library belongs to the broader agent-native harness model:

- workflows define the execution graph
- MCP servers provide tool surfaces
- agents consume those tools
- Studio handles observability and orchestration around the run

## Common Use Cases

- cloud investigation workflows
- log and metrics exploration
- filesystem-backed tool execution
- multi-tool AI agents

## OSS Expectations

In the open-source product, you manage the MCP server configuration yourself.

That usually means:

- registering or configuring servers in your own deployment
- choosing which ones are available to workflows
- connecting them into agent or workflow steps

## Related Docs

- [Integrations](./integrations.md)
- [Components Overview](/components/overview)
- [OSS vs ShipSec Cloud](/oss-vs-cloud)
