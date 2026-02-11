# Kubernetes Deployment (Local First)

This folder contains the first draft Helm charts to run ShipSec Studio on Kubernetes.

Primary target for this draft:

- Local Kubernetes on OrbStack
- DinD enabled (temporary) so docker-based components can run via `DOCKER_HOST`

## Quick Start (OrbStack)

1. Ensure OrbStack Kubernetes is running.
2. Run:

```bash
./deploy/scripts/orbstack/install.sh
./deploy/scripts/orbstack/smoke.sh
```

## Access (Local Defaults)

- Backend: `http://localhost:3211/health`
- Frontend: `http://localhost:8090`
- Temporal UI: `http://localhost:8081`
- MinIO Console: `http://localhost:9001`

## Notes

- This draft uses `temporalio/auto-setup` for local/dev parity with `docker/docker-compose.full.yml`. Do not treat this as a production Temporal deployment.
- DinD is enabled only to match the current execution model. It is not a production security model.

