# Docker Execution Plans for ShipSec Studio

This guide explains the Docker execution architecture for component workflows, captures the adopted configuration (Plan B), and documents the alternative and long-term options for reference.

## Current State (Plan B Adopted)
- The worker image now includes the Docker CLI (copied from `docker:27-cli`).
- A dedicated Docker-in-Docker sidecar container (`shipsec-dind`) runs the daemon; the worker talks to it via `DOCKER_HOST=tcp://dind:2375`.
- The sidecar stores layers in a named volume (`docker_data`) so images persist across restarts and can be pruned explicitly.
- No host Docker socket is mounted, reducing the blast radius for user-supplied components.
- Future hardening will focus on locking down the sidecar (auth, quotas, regular pruning) and building the remote runner service for multi-tenant SaaS isolation.

## TL;DR
- Components such as Subfinder and DNSX shell out to `docker run` through the SDK’s docker runner (`packages/component-sdk/src/runner.ts`).
- Prior failures (`spawn docker ENOENT`) came from missing Docker CLI / daemon inside the worker container.
- Plan B fixes this by running a sibling Docker daemon and wiring the worker CLI to it.
- Keep Plan A (host socket mount) and Plan C (embedded binaries) as fallbacks; Plan D (remote runner service) remains the strategic target for SaaS hardened deployments.

## How It Works Today
- Components register their runner config in `worker/src/components/**`. Security scanners use the docker runner with ProjectDiscovery images.
- `runComponentInDocker` (packages/component-sdk/src/runner.ts) spawns the Docker CLI, streams stdout/err, and enforces timeouts.
- The Temporal worker (`worker/src/temporal/workers/dev.worker.ts`) executes components inside activities; logs and progress flow back to the workflow/UI.

Key references:
- Docker runner implementation: `packages/component-sdk/src/runner.ts`
- Subfinder component: `worker/src/components/security/subfinder.ts`
- DNSX component: `worker/src/components/security/dnsx.ts`
- Worker container definition: `docker/docker-compose.full.yml`
- Worker image: `Dockerfile`

---

## Plan B — Docker-in-Docker Sidecar *(Implemented)*
Run a dedicated Docker daemon next to the worker and point the worker’s Docker CLI at it. This avoids giving the worker direct control over the host daemon while preserving existing component contracts.

### Repository Changes

**Dockerfile**

```dockerfile
FROM docker:27-cli AS dockercli

FROM base AS worker
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
USER shipsec
WORKDIR /app/worker
CMD ["node", "--loader", "tsx", "src/temporal/workers/dev.worker.ts"]
```

**docker/docker-compose.full.yml**

```yaml
  dind:
    image: docker:27-dind
    container_name: shipsec-dind
    privileged: true
    command: ["--host=tcp://0.0.0.0:2375", "--storage-driver=overlay2"]
    environment:
      - DOCKER_TLS_CERTDIR=
    volumes:
      - docker_data:/var/lib/docker
    healthcheck:
      test: ["CMD", "docker", "info"]
      interval: 30s
      timeout: 10s
      retries: 5
    restart: unless-stopped

  worker:
    environment:
      - DOCKER_HOST=tcp://dind:2375
    depends_on:
      dind:
        condition: service_healthy

volumes:
  docker_data:
```

### Operational Notes
- The sidecar opens an unauthenticated TCP endpoint on the compose network. Only internal services can reach it; for production, add an auth proxy or mutual TLS.
- Schedule regular pruning (`docker system prune -af`) inside `shipsec-dind`, or replace the persistent volume with a tmpfs for stateless runs.
- Monitor daemon health via the existing healthcheck; expose metrics/logs if needed.
- Evaluate the rootless variant (`docker:27-dind-rootless`) once iptables/cgroup requirements are understood.

### Validation Checklist
- `docker version` and `docker run --rm busybox:1.36 echo ok` succeed inside `shipsec-worker`.
- Subfinder/DNSX workflows complete without `spawn docker ENOENT` and emit results.
- Loki/trace logs show docker runner progress events for each node.

---

## Plan A — Docker-Outside-of-Docker *(Fallback Alternative)*
Mount the host Docker socket into the worker container and install the Docker CLI there. This is the quickest path but grants the worker full host daemon control, which is risky in a SaaS context.

Pros
- Minimal repo changes; matches the initial runner assumptions.

Cons
- Host-level privileges and potential data exfiltration if untrusted components run arbitrary `docker run` commands.
- Requires tight allowlists, AppArmor/SELinux profiles, or sandboxing to mitigate abuse.

Use this plan only for trusted single-tenant environments or local dev scenarios.

---

## Plan C — Inline Binaries *(Not Pursued)*
Bundle ProjectDiscovery binaries directly into the worker image and execute them without Docker. This would simplify runtime deployment but increases image size and maintenance overhead. It also removes the isolation boundary that per-tool containers provide.

Kept here as an escape hatch if container execution is ever restricted in certain environments.

---

## Plan D — Remote Runner Service *(Long-Term Target)*
Build a dedicated runner microservice that exposes an authenticated API for launching containers. Components switch their runner to `kind: 'remote'`, and the service enforces policy across all tenants.

### Why
- Stronger tenant isolation: the worker never gains direct Docker access.
- Centralised policy enforcement: image allowlists, resource quotas, logging, and audit live in one place.
- Horizontal scalability: multiple runner instances can share a backend (Kubernetes, Nomad, ECS, etc.).

### Design Sketch
- **API**: `POST /run` with payload `{ image, command, env, stdin, network, timeout }`; returns `{ stdout, stderr, exitCode, logs }`.
- **Transport**: mutual TLS or signed tokens for authentication; optional streaming via WebSockets/Server-Sent Events for real-time logs.
- **Execution backend**: Docker, containerd, or a serverless runtime. The runner mounts only per-request scratch storage and wipes it after completion.
- **SDK work**: implement the `remote` branch in `runComponentWithRunner` to call the service, stream progress, and surface errors consistent with current UX.
- **Migration path**: components remain unchanged except for switching `runner.kind`. Run Plan B and Plan D side-by-side while migrating tenants.

---

## Next Steps
1. Harden the DIND sidecar: restrict network exposure, add periodic pruning, and monitor resource usage.
2. Prototype the remote runner service and extend the SDK to support `kind: 'remote'`.
3. Document operational runbooks (prune cadence, health checks, alerting) for SaaS deployment.

---

## Appendix: Useful References
- Docker runner implementation: `packages/component-sdk/src/runner.ts`
- Subfinder component: `worker/src/components/security/subfinder.ts`
- DNSX component: `worker/src/components/security/dnsx.ts`
- Worker bootstrap: `worker/src/temporal/workers/dev.worker.ts`
- Compose configuration: `docker/docker-compose.full.yml`
- Image definition: `Dockerfile`
