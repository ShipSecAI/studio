# Getting Started

ShipSec Studio is a security automation platform for building and running reconnaissance workflows.

## Prerequisites

- Docker Desktop (≥8GB RAM)
- Bun runtime ([bun.sh](https://bun.sh))

## Quick Start

1. **Clone repository**
   ```bash
   git clone <repo-url>
   cd studio
   ```

2. **Setup everything**
   ```bash
   just init
   ```

3. **Start development environment**
   ```bash
   just dev
   ```

4. **Open ShipSec Studio**
   - Frontend: http://localhost:5173

## What `just init` Does

The `just init` command automatically:
- Installs project dependencies with Bun
- Creates environment files from examples (backend/.env, worker/.env, frontend/.env)

## What `just dev` Does

The `just dev` command automatically:
- Checks that environment files exist (prompts to run `just init` if missing)
- Starts Docker infrastructure (Postgres, Temporal, MinIO, Loki)
- Waits for services to be ready
- Runs database migrations
- Starts backend, worker, and frontend with hot-reload

## Your First Workflow

Create a simple DNS reconnaissance workflow.

### Steps

1. **Open ShipSec Studio**
   - Go to http://localhost:5173
   - Sign in or create account

2. **Create New Workflow**
   - Click "New Workflow"
   - Name: "DNS Recon"
   - Description: "Basic DNS enumeration"

3. **Add Components**
   - Drag "Manual Trigger" to canvas
   - Drag "DNSX" component to canvas
   - Connect trigger output to DNSX input

4. **Configure DNSX**
   - Click DNSX component
   - Set "Domains" input: `["example.com"]`
   - Configure options as needed

5. **Save and Run**
   - Click "Save"
   - Click "Run"
   - Watch execution in real-time

### Expected Output

DNSX will enumerate DNS records for example.com and display results in the execution timeline.

## Troubleshooting

### macOS: Native Module Errors

```bash
export SDKROOT=$(xcrun --show-sdk-path)
bun install
```

### Services Not Starting

```bash
# Check status
just dev status

# Restart everything
just dev stop
just dev
```

### Database Connection Failed

```bash
# Run migrations manually
bun run migrate

# Check database logs
just infra logs
```

### PM2 Processes Failing

```bash
# Check environment files
ls -la */.env

# Restart everything
just dev stop
just dev

# Check logs
just dev logs
```

### Frontend Not Loading

```bash
# Check if dev server is running
just dev status

# Start manually if needed
bun --cwd frontend dev
```

### Getting Help

- Check [GitHub Issues](https://github.com/shipsecai/studio/issues) for similar problems
- Review logs with `just dev logs` for error details
- Ensure all prerequisites are met

## Detailed Setup (Optional)

If you need more control over the setup process:

### Manual Infrastructure Setup

```bash
# Start infrastructure only
just infra up

# Check status
just status

# View infrastructure logs
just infra logs
```

### Manual Application Startup

```bash
# Start applications only
pm2 start pm2.config.cjs

# Check status
pm2 status

# View logs
pm2 logs
```

### Service URLs

- Frontend: http://localhost:5173
- Backend API: http://localhost:3211
- Temporal UI: http://localhost:8081
- MinIO Console: http://localhost:9001

## Next Steps

- Explore the [component catalog](docs/components/)
- Learn about [workflow execution](docs/execution-contract.md)
- Set up [production deployment](docs/architecture/deployment.md)