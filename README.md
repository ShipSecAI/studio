<div align="center">
  <img src="docs/media/splash.png" alt="ShipSec AI">
</div>

<p align="center">
  <img src="https://img.shields.io/badge/status-stable-blue.svg" alt="Status">
  <a href="https://github.com/ShipSecAI/studio/tree/main/LICENSE"><img src="https://img.shields.io/badge/License-Apache%202-green.svg" alt="License"></a>
  <a href="https://shipsec.ai"><img src="https://img.shields.io/badge/website-shipsec.ai-blue.svg" alt="Website"></a>
  <img src="https://img.shields.io/badge/Security-Automation-orange" alt="Security Automation">
  <img src="https://img.shields.io/badge/Live-Observability-blue" alt="Live Observability">
  <img src="https://img.shields.io/badge/Component-Catalog-4CAF50" alt="Component Catalog">
</p>
<p align="center">
  <a href="https://discord.gg/fmMA4BtNXC"><img src="https://img.shields.io/badge/Discord-Join%20Chat-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://github.com/ShipSecAI/studio/discussions"><img src="https://img.shields.io/badge/GitHub-Discussions-181717?logo=github&logoColor=white" alt="Discussions"></a>
  <a href="https://twitter.com/shipsecai"><img src="https://img.shields.io/badge/Twitter-Follow-1DA1F2?logo=X&logoColor=white" alt="Twitter"></a>
</p>


# ShipSec Studio

The no-code security automation studio for security teams. Design reliable and reusable security workflows.

ShipSec Studio is a security workflow orchestration platform that combines the power of visual programming with enterprise-grade reliability. Unlike traditional automation tools that require complex scripting, ShipSec Studio lets you build security workflows through an intuitive canvas while maintaining the robustness your team needs.

## Demo

<div align="center">
  <a href="https://youtu.be/7uyv43VforM">
    <img src="https://img.youtube.com/vi/7uyv43VforM/maxresdefault.jpg" alt="ShipSec Studio Demo" width="600">
  </a>
  <p><em>Click to watch the demo (hosted on <a href="https://www.youtube.com/@hackingsimplifiedas">Hacking Simplified</a> YouTube)</em></p>
</div>

## Why ShipSec Studio?

🎨 **Visual Workflow Builder** : Design security automations with drag-and-drop, no coding required

⚡ **Real-Time Execution** : Watch workflows run live with streaming logs and progress indicators

🧩 **Pre-Built Security Components** : Subfinder, DNSX, HTTPx, Nuclei, and more ready to use

🔒 **Enterprise Reliability** : Built on Temporal for durable, resumable workflow executions

🛡️ **Secure by Default** : Encrypted secrets, role-based access, and audit trails

💻 **Run Anywhere** : Cloud hosted or self-hosted on your own infrastructure

📅 **Scheduled Workflows** : Schedule your scans to run at specific times or intervals

🔗 **Codify Your Workflows** : Trigger workflows via a simple POST request, through cURL, python etc.

## Quick Start

Get started with ShipSec Studio in minutes:

### Option 1: Use the Hosted Platform

1. **Sign up** at [studio.shipsec.ai](https://studio.shipsec.ai)
2. **Create your first workflow** using the visual builder
3. **Run a scan** with pre-built components like Subfinder, Nuclei, or HTTPx
4. **View results** in real-time as the workflow executes

### Option 2: Self-Host with Docker (Recommended)

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

#### Manual Installation

If you prefer to install manually:

**Prerequisites:**
- **[docker](https://www.docker.com/)** - For running the application and security components
- **[just](https://github.com/casey/just)** - Command runner for simplified workflows
- **curl** and **jq** - For fetching release information

**Steps:**

```bash
# Clone the repository
git clone https://github.com/ShipSecAI/studio.git
cd studio

# Download the latest release and start
just prod start-latest

# Visit http://localhost:8090 to access ShipSec Studio
```

This command automatically:
- Fetches the latest release version from GitHub
- Pulls pre-built Docker images from GHCR
- Starts the full stack (frontend, backend, worker, and infrastructure)

#### Other Commands

```bash
just prod stop      # Stop the environment
just prod logs      # View logs
just prod status    # Check status
just prod clean     # Remove all data
```

### Option 3: Development Setup

For contributors who want to modify the source code:

#### Prerequisites

- **[bun.sh](https://bun.sh)** - Fast JavaScript runtime and package manager
- **[docker](https://www.docker.com/)** - For running security components in isolated containers
- **[just](https://github.com/casey/just)** - Command runner for simplified development workflows

#### Setup

```bash
# Clone the repository
git clone https://github.com/ShipSecAI/studio.git
cd studio

# Initialize (installs dependencies and creates environment files)
just init

# Start development environment with hot-reload
just dev

# Visit http://localhost:5173 to access ShipSec Studio
```

### Your First Workflow

1. **Open the Workflow Builder** from the dashboard
2. **Add a Manual Trigger node** for manual execution
3. **Add a Subfinder node** for subdomain discovery
4. **Run the workflow** and watch real-time execution

🎉 **Congratulations!** You've just run your first security workflow in ShipSec Studio.

## 🔎 System Architecture

<div align="center">
  <img src="./docs/media/shipsec-studio-arch-diagram.png" alt="System Architecture">
</div>

## 🔥 Latest Updates

- Dec 11, 2025 - **Execution Canvas Improvements** - Enhanced drag-and-drop experience
- Dec 10, 2025 - **Modernized Documentation** - Updated terminology and cleaner structure
- Dec 9, 2025 - **Backend Version Check** - Automatic compatibility verification on startup
- Dec 8, 2025 - **Workflow Scheduling** - Schedule workflows to run at specific times or intervals


## Documentation

📚 **Complete documentation** is available at **[docs.shipsec.ai](https://docs.shipsec.ai)**

- Getting Started Guides
- Component Development
- API Reference
- Architecture Overview
- And much more...

## Community

Join the ShipSec community to get help, share ideas, and stay updated:

- 💬 **[Discord](https://discord.gg/fmMA4BtNXC)** — Chat with the team and community
- 🗣️ **[Discussions](https://github.com/ShipSecAI/studio/discussions)** — Ask questions and share ideas
- 🐛 **[Issues](https://github.com/ShipSecAI/studio/issues)** — Report bugs or request features
- 🐦 **[Twitter](https://twitter.com/shipsecai)** — Follow for updates and announcements

## Contributing

We're excited that you're interested in ShipSec Studio! Whether you're fixing bugs, adding features, improving docs, or sharing ideas — every contribution helps make security automation more accessible.

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

ShipSec Studio is licensed under the [Apache License 2.0](LICENSE).

<div align="center">
  <p>Built with ❤️ by the ShipSec AI team</p>
</div>
