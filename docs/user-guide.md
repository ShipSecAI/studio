# ShipSec Studio User Guide

## Table of Contents

1. [Getting Started](#getting-started)
2. [Home Page & Onboarding](#home-page--onboarding)
3. [Security Dashboard](#security-dashboard)
4. [Workflow Templates](#workflow-templates)
5. [Integrations](#integrations)
6. [Interface Overview](#interface-overview)
7. [Workflows](#workflows)
8. [Components](#components)
   - [Core Components](#core-components)
   - [AI Components](#ai-components)
   - [MCP Components](#mcp-components)
   - [Security Components](#security-components)
9. [Advanced Features](#advanced-features)
10. [Best Practices](#best-practices)

## Getting Started

### Installation

**One-Line Install (Recommended)**

```bash
curl -fsSL https://raw.githubusercontent.com/ShipSecAI/studio/main/install.sh | bash
```

This installer will:

- Check and install missing dependencies (docker, just, curl, jq, git)
- Start Docker if not running
- Clone the repository and start all services
- Guide you through any required setup steps

Once complete, visit **http://localhost** to access ShipSec Studio.

### Quick Start

1. **Login** to ShipSec Studio
2. **Complete the Getting Started checklist** on the Home page
3. **Browse Workflow Templates** for pre-built security workflows, or create a new workflow from scratch
4. **Add Components** from the left sidebar in the workflow builder
5. **Connect Components** by dragging between ports
6. **Configure Components** by clicking on them
7. **Run Workflow** using the Run button in the top bar

## Home Page & Onboarding

After logging in, you land on the **Home page** — an adaptive dashboard that guides you through setup and shows your security posture at a glance.

### Getting Started Checklist

The Home page includes a 5-step onboarding checklist:

1. **Connect GitHub** — Link your repositories for code scanning
2. **Connect AWS** — Connect your AWS account for cloud security auditing
3. **Run your first scan** — Trigger a scan to find vulnerabilities
4. **Enable a PR gate** — Block risky pull requests automatically
5. **Use a template** — Jump-start workflows with pre-built templates

As you complete steps, the Home page progressively reveals more features:

- **New users (0/5 complete):** Welcome banner + checklist + "What You'll Unlock" preview
- **In progress (1–4/5):** Quick Stats Row, Findings Trend Chart, Activity Heatmap, Needs Attention Card, Recent Activity Feed, Coverage Detail Card, Upcoming Scans
- **Fully onboarded (5/5):** All of the above + Security Score ring visualization

### Home Page Components

- **Quick Stats Row** — Total findings, repositories, scans, and integrations connected
- **Activity Heatmap** — 90-day heatmap showing findings or scan activity (toggleable)
- **Findings Trend Chart** — Time series visualization of finding trends
- **Needs Attention Card** — Critical and high findings grouped by category (Cloud, Code, Dependencies)
- **Recent Activity Feed** — Latest scan results, connected repos, and workflow runs
- **Coverage Detail Card** — Repository protection stats and PR gate coverage
- **Upcoming Scans** — Scheduled scan overview

## Security Dashboard

The Security Dashboard provides a unified view of all security findings across your infrastructure. Access it from the sidebar navigation.

### Views

The dashboard has multiple tabs for filtering findings by source:

| Tab                     | Description                                                     |
| ----------------------- | --------------------------------------------------------------- |
| **All Findings**        | Combined view across all scanners                               |
| **Cloud Security**      | AWS cloud posture findings from Prowler (with per-account tabs) |
| **Code Security**       | SAST and secret findings from OpenGrep, TruffleHog, etc.        |
| **Dependency Security** | Dependency vulnerability findings                               |
| **Container Security**  | Container image vulnerability findings                          |

### Features

- **Severity Cards** — Clickable Critical/High/Medium/Low counts to toggle severity filters
- **Time Series Chart** — Trend visualization with 7d, 14d, 30d, 90d range picker
- **Filter Bar** — Search + filter popovers for severity, scanner, repository, region, compliance, and more (filters vary by tab)
- **Sortable Data Table** — Paginated findings with columns for title, severity, status, first/last seen
- **Finding Detail Sheet** — Side panel with full finding details and status history (deep-linkable via `?finding=<id>`)
- **Empty State CTAs** — Context-specific prompts to connect integrations or run first scans

## Workflow Templates

Browse pre-built security workflows on the **Templates** page (`/templates`). Templates let you deploy common security automation patterns in one click.

### Available Templates

| Template                 | Description                                              |
| ------------------------ | -------------------------------------------------------- |
| **Secret Scan**          | Clone repo → TruffleHog → Normalize findings → Analytics |
| **Full Code Security**   | Comprehensive SAST scanning pipeline                     |
| **PR Security Gate**     | Block risky PRs with automated security checks           |
| **AI Code Review**       | AI-powered code analysis                                 |
| **Cloud Security Scan**  | AWS cloud posture assessment with Prowler                |
| **Attack Surface Recon** | Subdomain discovery and enumeration                      |
| **Container Image Scan** | Container vulnerability scanning with Trivy              |

### Using Templates

1. Browse templates on the `/templates` page — featured templates are highlighted
2. Click **View Details** to see the workflow DAG preview and tool logos
3. Click **Use Template** to create a new workflow from the template
4. Customize the workflow in the builder as needed

## Integrations

The **Integrations** page (`/integrations`) lets you connect external services to ShipSec Studio. Currently supported:

- **AWS** — Connect AWS accounts for cloud security scanning and credential resolution
- **Slack** — Send notifications and alerts to Slack channels

For detailed setup instructions, see [Integrations documentation](./integrations.md).

### Cloud Accounts

Manage connected AWS accounts at `/cloud/accounts`. From here you can:

- View all connected cloud accounts
- Trigger cloud security scans
- See scan history and findings per account

## Interface Overview

### Top Bar

- **Navigation**: Logo and workspace name
- **Controls**: Save, Run, and Stop workflow buttons
- **User Menu**: Account settings and logout

### Sidebar

- **Component Palette**: Browse and search components
- **Component Categories**: Organized by function (Core, AI, MCP, Security)
- **Recent Components**: Quick access to frequently used components

### Canvas

- **Workspace**: Visual workflow editor with drag-and-drop functionality
- **Nodes**: Represent components with input/output ports
- **Edges**: Show connections between components
- **Grid**: Background grid for alignment

### Bottom Panel

- **Logs**: Real-time execution logs
- **Results**: Output data and results
- **History**: Previous workflow executions

## Workflows

### Creating a Workflow

1. Click **New Workflow** from the Workflows page, or use a **Template** from the Templates page
2. Name your workflow
3. Drag components from the sidebar to the canvas
4. Connect components by dragging from output ports to input ports
5. Configure components by clicking on them
6. Save your workflow with Ctrl+S or the Save button

### Running a Workflow

1. Click the "Run" button in the top bar
2. Choose execution parameters:
   - Timeout duration
   - Retry settings
   - Resource limits
3. Monitor execution in real-time via the logs panel
4. View results in the Results panel when complete

### Saving and Sharing

1. **Save Locally**: Workflows are saved to your workspace
2. **Export**: Export workflows as JSON for version control
3. **Share**: Generate shareable links for collaboration
4. **Templates**: Save workflows as templates for reuse

## Components

### Core Components

#### Start Node

- **Purpose**: Workflow entry point
- **Output**: `data` - Workflow execution context
- **Use**: Always required at the beginning of workflows

#### End Node

- **Purpose**: Workflow exit point
- **Input**: `data` - Final workflow data
- **Use**: Required to complete workflows

#### HTTP Request

- **Purpose**: Make HTTP requests to external APIs
- **Configuration**:
  - Method (GET, POST, PUT, DELETE)
  - URL with variable substitution
  - Headers and authentication
  - Request body
- **Output**: Response data and status

#### Filesystem

- **Purpose**: Read and write files
- **Operations**:
  - Read file contents
  - Write data to files
  - List directory contents
- **Use**: Data persistence and file operations

### AI Components

#### AI Agent

- **Purpose**: LLM-powered analysis and decision making
- **Configuration**:
  - System prompt
  - Model selection (GPT-4, Claude, etc.)
  - Temperature and max tokens
  - Context window management
- **Ports**:
  - `tools` - Connect MCP tools for enhanced capabilities
  - `context` - Additional context data
  - `instructions` - Runtime instructions
- **Use**: Natural language processing, analysis, content generation

#### Prompt Template

- **Purpose**: Create dynamic prompts with variables
- **Features**:
  - Variable substitution
  - Conditional logic
  - Template composition
- **Use**: Reusable prompt patterns with dynamic content

### MCP Components

#### MCP Library

- **Purpose**: Centralized MCP server management
- **Features**:
  - Multi-server selection from library
  - Automatic tool registration
  - Health status monitoring
- **Configuration**:
  - Select servers from available list
  - View tool counts and health status
- **Output**: `tools` (contract: `mcp.tool`) - Connect to AI Agent
- **Use**: Enable multiple MCP servers without individual nodes

**Example Usage**:

1. Drag MCP Library to canvas
2. Select AWS CloudTrail + CloudWatch servers
3. Connect "tools" port to AI Agent "tools" port
4. AI Agent can now query AWS services

### Security Components

#### Nuclei Scanner

- **Purpose**: Vulnerability scanning with Nuclei
- **Configuration**:
  - Template selection
  - Target URLs/IPs
  - Rate limiting
  - Output formats
- **Use**: Web application vulnerability scanning

#### Prowler Scan

- **Purpose**: AWS cloud security posture management
- **Features**:
  - Single-account AWS security scanning
  - Org-wide multi-account scanning (discovers and scans all member accounts)
  - Normalized ASFF findings with severity, resource ID, and remediation
  - Analytics-ready output for dashboards
- **Configuration**:
  - Scan mode (AWS account or multi-cloud overview)
  - Org scan toggle with member role name, concurrency, and error handling
  - Recommended flag presets (severity filter, ignore exit codes)
  - Custom CLI flags
- **Use**: AWS CSPM, compliance scanning, org-wide security posture assessment

#### TruffleHog

- **Purpose**: Secret detection in code
- **Features**:
  - Git repository scanning
  - Multiple secret detection engines
  - false positive reduction
- **Use**: CI/CD pipeline security, code review

#### Trivy Scanner

- **Purpose**: Container image and filesystem vulnerability scanning
- **Features**:
  - Container image scanning (public and private registries)
  - Filesystem and IaC misconfiguration scanning
  - ECR and private registry authentication support
  - Severity filtering and multiple scanner types (vuln, misconfig, secret, license)
- **Configuration**:
  - Scan type: filesystem, config, or image
  - Image reference (e.g., `nginx:latest`, ECR images)
  - Registry credentials or AWS credentials for private registries
  - Severity filter, scanner selection, timeout
- **Use**: Container security, dependency scanning, IaC security

## Advanced Features

### Human-in-the-Loop

Pause workflows for human intervention:

1. Add **Approval** component to workflow
2. Configure approver and timeout
3. Workflow pauses until approval granted
4. Continue execution after approval

### Scheduling

Set up recurring workflows:

1. Add **Schedule** component to workflow
2. Configure CRON expression
3. Set retention policies
4. Enable/disable schedule as needed

### API Integration

Trigger workflows via REST API:

```bash
curl -X POST http://localhost:3000/api/v1/workflows/run \
  -H "Content-Type: application/json" \
  -d '{"workflowId": "workflow-123", "params": {}}'
```

### Error Handling

Configure error handling strategies:

1. **Retry Logic**: Set retry attempts and delays
2. **Fallback Nodes**: Alternative paths for failures
3. **Error Notifications**: Email/webhook alerts
4. **Circuit Breakers**: Prevent cascading failures

## Best Practices

### Workflow Design

1. **Keep Workflows Focused**: Single responsibility per workflow
2. **Use Descriptive Names**: Clear naming for components and workflows
3. **Plan for Failure**: Implement proper error handling
4. **Document Complex Logic**: Add comments for complex workflows

### Component Selection

1. **Start Simple**: Use basic components before advanced ones
2. **Reusability**: Create templates for common patterns
3. **Performance**: Consider resource-intensive operations
4. **Security**: Validate inputs and handle sensitive data properly

### Security Considerations

1. **Credential Management**: Use environment variables, not hardcoded values
2. **Least Privilege**: Grant minimal required permissions
3. **Audit Trails**: Enable logging for compliance
4. **Network Isolation**: Separate development and production environments

### Performance Optimization

1. **Parallel Execution**: Use parallel branches for independent operations
2. **Batch Processing**: Process large datasets in chunks
3. **Timeout Settings**: Set appropriate timeouts for long operations
4. **Resource Limits**: Configure CPU/memory limits for containers

## Troubleshooting

### Common Issues

**Workflow Won't Start**

- Check all required components are connected
- Verify input ports have data
- Look for configuration errors

**Components Not Connecting**

- Ensure output contracts match input contracts
- Check port types (data, control, trigger)
- Verify component compatibility

**Performance Issues**

- Check for infinite loops
- Monitor resource usage
- Reduce concurrent operations

### Debug Commands

```bash
# Check service status
docker ps

# View logs
bun --cwd backend run logs

# Test MCP servers
curl http://localhost:3000/api/v1/mcp-servers
```

## Resources

- **Documentation**: [Full Documentation](https://docs.shipsec.ai)
- **Community**: [Discord Server](https://discord.gg/fmMA4BtNXC)
- **GitHub**: [Repository](https://github.com/ShipSecAI/studio)
- **Examples**: [Workflow Examples](./workflows/)

## Support

For issues and questions:

1. Check the [Troubleshooting](#troubleshooting) section
2. Search existing issues on GitHub
3. Join Discord for community support
4. Create a new issue with detailed reproduction steps
