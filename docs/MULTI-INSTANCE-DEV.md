# Multi-Instance Development Stack

ShipSec Studio now supports running multiple independent development instances simultaneously. This is useful for:

- Testing feature branches in parallel without interference
- Running multiple workflows concurrently
- Isolating different development environments
- Testing upgrade scenarios

## Quick Start

```bash
# Start instance 0 (default)
just dev

# Start instance 1
just dev 1 start

# Start instance 2
just dev 2

# View logs for instance 1
just dev 1 logs

# Stop instance 1
just dev 1 stop

# Stop all instances at once
just dev stop all
```

## Architecture

Each instance is completely isolated:

- **Docker Containers**: Each instance gets its own named project (`shipsec-dev-N`)
- **Ports**: Instance N uses `base_port + N*100`
- **PM2 Apps**: Instance-specific naming (`shipsec-backend-N`, `shipsec-worker-N`, etc.)
- **Temporal**: Isolated namespaces and task queues per instance
- **Databases**: Separate PostgreSQL databases (but same container for simplicity)

### Port Allocation

Instance numbers map to port offsets as follows:

| Service          | Base | Instance 0 | Instance 1 | Instance 2 | Instance 5 |
| ---------------- | ---- | ---------- | ---------- | ---------- | ---------- |
| Frontend         | 5173 | 5173       | 5273       | 5373       | 5673       |
| Backend          | 3211 | 3211       | 3311       | 3411       | 3711       |
| Temporal Client  | 7233 | 7233       | 7333       | 7433       | 7733       |
| Temporal UI      | 8081 | 8081       | 8181       | 8281       | 8581       |
| PostgreSQL       | 5433 | 5433       | 5533       | 5633       | 5933       |
| MinIO API        | 9000 | 9000       | 9100       | 9200       | 9500       |
| MinIO Console    | 9001 | 9001       | 9101       | 9201       | 9501       |
| Redis            | 6379 | 6379       | 6479       | 6579       | 6879       |
| Loki             | 3100 | 3100       | 3200       | 3300       | 3600       |
| Redpanda         | 9092 | 9092       | 9192       | 9292       | 9592       |
| Redpanda Console | 8082 | 8082       | 8182       | 8282       | 8582       |

## Directory Structure

Instance configurations are stored in `.instances/`:

```
.instances/
├── instance-0/
│   ├── backend.env                     # Instance-specific backend config
│   ├── worker.env                      # Instance-specific worker config
│   ├── frontend.env                    # Instance-specific frontend config
│   └── docker-compose.override.yml     # Port mappings for this instance
├── instance-1/
│   └── ...
└── instance-N/
    └── ...
```

Each instance directory contains:

1. **Environment Files**: Copies of root `.env` files with port numbers adjusted
2. **Docker Compose Override**: Port mappings for Docker containers

These are auto-generated and can be safely deleted (they'll be recreated on next run).

## Command Reference

### Starting Instances

```bash
# Start instance 0 (default, same as 'just dev')
just dev 0 start

# Start instance 1 with explicit action
just dev 1 start

# Start instance 2 (start is default if only instance number given)
just dev 2
```

### Stopping Instances

```bash
# Stop instance 0
just dev 0 stop

# Stop instance 1
just dev 1 stop

# Stop all instances at once
just dev stop all
```

### Viewing Status and Logs

```bash
# Check status of instance 0
just dev 0 status

# Check status of instance 1
just dev 1 status

# Check status of all instances
just dev status all

# View logs for instance 0
just dev 0 logs

# View logs for instance 1
just dev 1 logs

# View logs for all instances
just dev logs all
```

### Cleaning Up

```bash
# Clean instance 0 (remove volumes and app configs)
just dev 0 clean

# Clean instance 1
just dev 1 clean

# Clean all instances
just dev stop all   # First stop all
```

## Implementation Details

### Initialization

When you run `just dev 1`, the system:

1. Checks if `.instances/instance-1/` exists
2. If not, creates the directory and initializes:
   - Copies root `.env` files to instance-specific paths
   - Replaces port numbers in env files to match instance offsets
   - Generates `docker-compose.override.yml` with port mappings
3. Validates configuration
4. Displays instance-specific information

### Docker Compose Integration

Docker Compose uses project names for isolation:

```bash
# Instance 0
docker compose -f docker/docker-compose.infra.yml \
  --project-name=shipsec-dev-0 \
  -f .instances/instance-0/docker-compose.override.yml \
  up -d

# Instance 1
docker compose -f docker/docker-compose.infra.yml \
  --project-name=shipsec-dev-1 \
  -f .instances/instance-1/docker-compose.override.yml \
  up -d
```

This ensures containers, volumes, and networks are isolated by project name.

### PM2 Integration

PM2 apps are named with instance numbers:

- `shipsec-frontend-0`, `shipsec-frontend-1`, etc.
- `shipsec-backend-0`, `shipsec-backend-1`, etc.
- `shipsec-worker-0`, `shipsec-worker-1`, etc.

PM2 configuration is generated dynamically based on `SHIPSEC_INSTANCE` environment variable.

### Temporal Isolation

Each instance uses isolated Temporal namespaces and task queues:

- Instance 0: Namespace `shipsec-dev-0`, Queue `shipsec-dev-0`
- Instance 1: Namespace `shipsec-dev-1`, Queue `shipsec-dev-1`
- Instance N: Namespace `shipsec-dev-N`, Queue `shipsec-dev-N`

This ensures workflows and activities don't interfere between instances.

## Best Practices

1. **Use instance 0 for primary development**: This matches the original single-instance behavior.

2. **Use higher instances for testing**: Instance 1-9 for parallel testing, feature branches, etc.

3. **Monitor port usage**: Use `netstat -tuln | grep 3211` to check which instances are running.

4. **Clean up unused instances**: Run `just dev N clean` to remove volumes and configurations.

5. **Check logs before stopping**: If you need to debug why something stopped, check logs before cleaning.

## Troubleshooting

### Port conflicts

If you get "port already in use" errors, check what's running:

```bash
# Check all instances
just dev status all

# Check specific service (e.g., backend on 3211)
lsof -i :3211
```

### Instance won't start

```bash
# Check status
just dev 1 status

# Check logs
just dev 1 logs

# Re-initialize
just dev 1 clean
just dev 1 start
```

### Docker containers won't stop

```bash
# Force stop via Docker
docker compose -f docker/docker-compose.infra.yml \
  --project-name=shipsec-dev-1 \
  kill

# Clean volumes
docker compose -f docker/docker-compose.infra.yml \
  --project-name=shipsec-dev-1 \
  down -v
```

## Technical Architecture

### Instance Manager Script

`scripts/dev-instance-manager.sh` handles:

- Port calculation based on instance number
- Environment file copying and modification
- Docker Compose override generation
- Instance information display

Commands:

- `init N` - Initialize instance
- `info N` - Display instance information
- `ports N` - Output port variables
- `project-name N` - Output Docker Compose project name

### PM2 Configuration

`pm2.config.cjs` reads `SHIPSEC_INSTANCE` environment variable and:

- Generates instance-specific app names
- Calculates dynamic ports
- Resolves instance-specific env files
- Configures Temporal namespaces/queues
- Sets up Kafka client IDs

### Justfile Implementation

The `dev` command in `justfile`:

- Parses arguments (instance number and action)
- Calls instance manager for setup
- Manages Docker Compose with project isolation
- Manages PM2 with instance-specific filtering
- Provides unified interface for all operations

## Environment Variables

When running `just dev N`, these are set:

- `SHIPSEC_INSTANCE=N` - Instance identifier
- `SHIPSEC_ENV=development` - Environment mode
- `NODE_ENV=development` - Node environment
- `PORT=<instance-port>` - Backend port for this instance
- `VITE_API_URL=http://localhost:<instance-port>` - Frontend API URL
- `TEMPORAL_NAMESPACE=shipsec-dev-N` - Temporal namespace
- `TEMPORAL_TASK_QUEUE=shipsec-dev-N` - Temporal task queue
- `TERMINAL_REDIS_URL=redis://localhost:<instance-port>` - Redis URL
- `LOG_KAFKA_BROKERS=localhost:<instance-port>` - Kafka brokers

## Limitations and Future Improvements

Current limitations:

- PostgreSQL database is shared across instances (isolation at namespace level, not database level)
- MinIO storage is shared (you can use Loki tenant IDs for separation if needed)
- Redis is shared (keys should be instance-aware to avoid collisions)

Future improvements:

- Separate PostgreSQL databases per instance (using `CREATE DATABASE` with instance prefix)
- Instance-aware key prefixing for Redis
- MinIO buckets per instance
- Better cleanup utilities
- Instance cloning/templates for quick setup
