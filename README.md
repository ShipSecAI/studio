<div align="center">
  <img src="docs/media/splash.png" alt="ShipSec AI" width="800">
</div>

<p align="center">
  <img src="https://img.shields.io/github/v/release/ShipSecAI/studio?color=blue&label=version" alt="Version">
  <a href="https://github.com/ShipSecAI/studio/tree/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-green" alt="License"></a>
  <a href="https://discord.gg/fmMA4BtNXC"><img src="https://img.shields.io/discord/1175402031123447818?color=5865F2&label=discord&logo=discord&logoColor=white" alt="Discord"></a>
</p>

# ShipSec Studio
**Open-Source Security Workflow Orchestration Platform.**

> ShipSec is currently in active development. We are optimizing the platform for stable production use and high-performance security operations.

ShipSec Studio provides a visual DSL and runtime for building, executing, and monitoring automated security workflows. It decouples security logic from infrastructure management, providing a durable and isolated environment for running security tooling at scale.


<div align="center">
  <a href="https://youtu.be/7uyv43VforM">
    <img src="https://img.youtube.com/vi/7uyv43VforM/maxresdefault.jpg" alt="ShipSec Studio Demo" width="600">
  </a>
  <p><em>Watch the platform in action on YouTube.</em></p>
</div>

---

### 🏗️ Core Pillars

*   **Durable, resumable workflows** powered by Temporal.io for stateful execution across failures.
*   **Isolated security runtimes** using ephemeral containers with per-run volume management.
*   **Unified telemetry streams** delivering terminal output, events, and logs via a low-latency SSE pipeline.
*   **Visual no-code builder** that compiles complex security graphs into an executable DSL.

---

## 🚀 Deployment Options

### 1. Shipsec Self-Host with Docker (Recommended)

The easiest way to run ShipSec Studio on your own infrastructure:

#### One-Line Install

```bash
curl -fsSL https://raw.githubusercontent.com/ShipSecAI/studio/main/install.sh | bash
```

This installer will:
- Check and install missing dependencies (docker, just, curl, jq, git)
- Start Docker if not running
- Clone the repository and start all services
- Guide you through any required setup steps

Once complete, visit **http://localhost:8090** to access ShipSec Studio.

### 2. ShipSec Cloud (Preview)
The fastest way to test ShipSec Studio without managing infrastructure.
- **Try it out:** [studio.shipsec.ai](https://studio.shipsec.ai)
- **Note:** ShipSec Studio is under active development. The cloud environment is a technical preview for evaluation and sandbox testing.

### 3. Self-Host (Docker)
For teams requiring data residency and air-gapped security orchestrations. This setup runs the full stack (Frontend, Backend, Worker, and Infrastructure).

**Prerequisites:**
- **[docker](https://www.docker.com/)** - For running the application and security components
- **[just](https://github.com/casey/just)** - Command runner for simplified workflows
- **curl** and **jq** - For fetching release information

```bash
# Clone and start the latest stable release
git clone https://github.com/ShipSecAI/studio.git
cd studio
just prod start-latest
```
Access the studio at `http://localhost:8090`.

---

## 🛠️ Capabilities

### Integrated Tooling
Native support for industry-standard security tools including:
- **Discovery**: `Subfinder`, `DNSX`, `Naabu`, `HTTPx`
- **Vulnerability**: `Nuclei`, `TruffleHog`
- **Utility**: `JSON Transform`, `Logic Scripts`, `HTTP Requests`

### Advanced Orchestration
- **Human-in-the-Loop**: Pause workflows for approvals, form inputs, or manual validation before continuing.
- **AI-Driven Analysis**: Leverage LLM nodes and MCP providers for intelligent results interpretation.
- **Native Scheduling**: Integrated CRON support for recurring security posture and compliance monitoring.
- **API First**: Trigger and monitor any workflow execution via a comprehensive REST API.

---

## 🏛️ Architecture Overview

ShipSec Studio is designed for enterprise-grade durability and horizontal scalability.

- **Management Plane (Backend)**: NestJS service handling DSL compilation, secret management (AES-256-GCM), and identity.
- **Orchestration Plane (Temporal)**: Manages workflow state, concurrency, and persistent wait states.
- **Execution Plane (Worker)**: Stateless agents that pull tasks from Temporal and execute tool-bound activities in isolated runtimes.
- **Monitoring (SSE/Loki)**: Real-time telemetry pipeline for deterministic execution visibility.

Learn more about our design decisions and system components in the **[Architecture Deep-dive](/docs/architecture.mdx)**.

---

## 🤝 Community & Support

- 💬 **[Discord](https://discord.gg/fmMA4BtNXC)** — Real-time support and community discussion.
- 🗣️ **[GitHub Discussions](https://github.com/ShipSecAI/studio/discussions)** — Technical RFCs and feature requests.
- 📚 **[Documentation](https://docs.shipsec.ai)** — Full guides on component development and deployment.

---

## ✍️ Contributing

We welcome contributions to the management plane, worker logic, or new security components.
See [CONTRIBUTING.md](CONTRIBUTING.md) for architectural guidelines and setup instructions.

---

## License

ShipSec Studio is licensed under the **Apache License 2.0**.

<div align="center">
  <p>Engineered for security teams by the ShipSec AI team.</p>
</div>

