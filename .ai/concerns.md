# Production Roadmap Concerns

**Review Date:** 2025-02-03
**Reviewed By:** Architect Agent (Opus)
**Source:** `.ai/production-roadmap.md`

This document catalogs all concerns raised during the architectural review of the ShipSec Studio Kubernetes manifests roadmap, organized by severity.

---

## Executive Summary

The roadmap is well-structured with a clear phased approach, but has **critical security gaps around DinD execution**, missing observability components, and incomplete migration paths. The phased approach is sound, but Phase 2 (DinD "productionize") carries significant risk that needs mitigation.

**Recommendation:** Address all 5 Critical Issues before starting Phase 0.

---

## Critical Issues (Must Fix Before Starting)

### 1. DinD Security Model is Fundamentally Unsafe for Production

**Location:** `.ai/production-roadmap.md:179-254` (Phase 0 §3.4 and Phase 2)

**Issue:** The roadmap acknowledges DinD as "temporary" but lacks concrete exit criteria. Running `privileged: true` containers in production is a critical security vulnerability.

**Evidence from codebase:**
- `worker/src/utils/isolated-volume.ts:196-246` - Worker spawns docker commands directly
- `worker/src/temporal/activities/mcp.activity.ts:80-143` - Container cleanup via `docker rm -f`
- All components assume `kind: 'docker'` runner (100+ references in codebase)

**Root Cause:** The entire worker execution model is built around CLI docker commands, not a proper abstraction layer.

**Risk:**
- Privileged containers can escape to host kernel
- No resource isolation between tenants
- No audit trail for container exec
- Docker socket exposure creates host compromise vector

**Recommendation:**
1. Block Phase 2 execution until Workload Runner (Phase 3) has working K8s Job backend
2. Add explicit security milestone: "No DinD in production before [date]"
3. Document that Phase 2 is for trusted single-tenant ONLY with customer-signed waiver
4. Add prominent security warning to Phase 0 §3.4

---

### 2. Missing RBAC and ServiceAccount Design

**Location:** `.ai/production-roadmap.md:282-286` (Phase 3 §6.2)

**Issue:** RBAC changes are mentioned but not designed. No specification of actual permissions needed.

**Missing:**
- No specification of actual permissions needed
- No mention of ServiceAccount per component/tenant
- No audit of current worker permissions
- No plan for migration from DinD to K8s Jobs without downtime

**Evidence:** Grep for `ServiceAccount`, `ClusterRole`, `RoleBinding` returned 0 results in codebase.

**Risk:** Workers with excessive permissions can:
- Create resources outside their namespace
- Access secrets across tenants
- Modify deployment state

**Recommendation:**
1. Create `deploy/helm/shipsec/templates/rbac.yaml` with least-privilege roles
2. Add serviceAccount per deployment (backend, worker, runner)
3. Document permission matrix in Phase 0 §3.3
4. Update Phase 3 §6.2 with explicit permission migration path

---

### 3. NetworkPolicy Design is Incomplete

**Location:** `.ai/production-roadmap.md:229-233` (Phase 1 §4.2)

**Issue:** NetworkPolicies are mentioned but lack specificity.

**Missing:**
- No policy for `shipsec-system` namespace
- No policy for worker-to-infra communication
- No policy for frontend-to-backend
- No consideration for DB/Redis/Temporal internal traffic
- "document CNI requirements" is vague - which CNIs tested?

**Evidence from compose** (`docker/docker-compose.full.yml`):
- Backend needs: postgres (5432), temporal (7233), minio (9000), redis (6379), loki (3100), redpanda (9092)
- Worker needs: All of above + dind (2375)
- Frontend needs: backend (3211)

**Risk:**
- Default-deny will break everything without careful allow rules
- Cross-namespace pod communication may fail
- DNS blocking breaks Kubernetes service discovery

**Recommendation:**
1. Add detailed NetworkPolicy matrix to Phase 1 §4.2
2. Create `deploy/helm/shipsec/templates/networkpolicy.yaml` with:
   - `shipsec-system` policy (allow all intra-namespace)
   - `shipsec-workers` policy (allow to system, workloads)
   - `shipsec-workloads` policy (DNS + HTTPS only)
3. Test with Calico and Cilium explicitly

---

### 4. No Migration Path from Compose to Helm

**Location:** `.ai/production-roadmap.md:108-130` (Section 2)

**Issue:** The roadmap says "Source of truth: docker-compose.full.yml" but provides no migration verification.

**Evidence:**
- Compose has 47 environment variables across backend/worker/frontend
- Many are interdependent (e.g., `MINIO_ENDPOINT` + `MINIO_PORT`)
- No validation that Helm values produce equivalent runtime behavior

**Risk:**
- Silent config drift between Compose and Helm deployments
- Dev environment works but Helm breaks
- Migration debugging becomes nightmare

**Recommendation:**
1. Add "Compose-to-Helm Parity Tests" to Phase 0 success criteria
2. Create test that spins up both compose and Helm, runs identical workflow, compares results
3. Add `deploy/scripts/verify-parity.sh` script

---

### 5. Missing Secret Management for Cloud Deployments

**Location:** `.ai/production-roadmap.md:306-307` (Phase 4 §7.1)

**Issue:** External Secrets mentioned but not architected.

**Missing:**
- Which secret stores supported? (AWS Secrets Manager? GCP Secret Manager? Azure Key Vault? HashiCorp Vault?)
- How are secret rotations handled?
- What about local development without external secret store?
- No mention of secret generation/validation

**Evidence from compose** (`docker/docker-compose.full.yml:180-200`):
- Hardcoded secrets everywhere (`shipsec:shipsec`, `minioadmin:minioadmin`)
- No secret injection pattern

**Risk:**
- Production deployments ship with default secrets
- Secret rotation causes downtime
- Developers can't test secret management locally

**Recommendation:**
1. Choose External Secrets Operator before Phase 1
2. Add `deploy/helm/shipsec/templates/external-secret.yaml` template
3. Document secret naming convention in Section 2
4. Provide local dev fallback (sealed-secrets or env-based)

---

## Medium Concerns (Should Address)

### 6. Resource Limits are Undefined

**Location:** `.ai/production-roadmap.md:30-31` and `227-228`

**Issue:** Success criteria mention "resource requests/limits everywhere" but provide no guidance.

**Evidence:** No resource constraints in compose files.

**Risk:**
- No cost predictability
- Noisy neighbor problems
- OOM kills disrupt workflows

**Recommendation:**
1. Add resource profile matrix to Phase 0:
   - `backend`: 512Mi/1CPU (request), 2Gi/2CPU (limit)
   - `worker`: 1Gi/1CPU (request), 4Gi/4CPU (limit)
   - `dind`: 2Gi/2CPU (request), 8Gi/4CPU (limit) [documented as dangerous]
2. Create `values/resource-profiles.yaml` with dev/staging/prod variants

---

### 7. Health Check Probes are Not Specified

**Location:** `.ai/production-roadmap.md:170-175`

**Issue:** Backend and worker need probes but no specification.

**Evidence from compose** (`docker/docker-compose.full.yml:290-294`):
```yaml
healthcheck:
  test: ["CMD", "node", "-e", "process.exit(0)"]
```

This is a useless healthcheck - it always passes.

**Risk:**
- Dead pods receive traffic
- Kubernetes can't self-heal
- Rolling deployments break

**Recommendation:**
1. Define HTTP endpoints: `/healthz`, `/readyz` for backend
2. Worker healthcheck should verify Temporal connection
3. Add startup probes (worker takes time to connect to Temporal)
4. Document probe intervals/thresholds

---

### 8. Missing Database Migration Strategy

**Location:** `.ai/production-roadmap.md:39-47` (Section 0, infra deps)

**Issue:** Postgres is deployed but no mention of migrations.

**Evidence from Dockerfile** (`Dockerfile:56`):
```dockerfile
CMD ["sh", "-c", "bun run migration:push && bun src/main.ts"]
```

Migrations run on backend startup. This breaks Kubernetes rolling updates because:
- Multiple pods run migrations simultaneously
- No way to run migrations separately from app startup
- Migration failures cause crash loops

**Risk:**
- Schema corruption from concurrent migrations
- Downtime during deployments
- No rollback strategy

**Recommendation:**
1. Add `migrations` Job to Helm chart with pre-install hook
2. Use Temporal for migration orchestration (backend already depends on it)
3. Document rollback procedure in Phase 4

---

### 9. No Observability/Logging Architecture

**Location:** `.ai/production-roadmap.md:163-164` (Kafka/Loki optional)

**Issue:** Loki is optional but critical for debugging distributed workflows.

**Evidence from codebase:**
- `worker/src/adapters/loki-log.adapter.ts` exists
- `worker/src/adapters/kafka-log.adapter.ts` exists
- Backend sends to both Loki and Kafka

**Missing:**
- No log aggregation strategy
- No trace correlation (workflow ID → logs)
- No alerting on log patterns
- No log retention policy

**Risk:**
- Debugging production workflows is impossible
- No security audit trail
- Compliance failures

**Recommendation:**
1. Make Loki required for production (add to Phase 1 success criteria)
2. Add trace ID injection (Temporal workflow ID → all logs)
3. Define log retention (e.g., 30 days)
4. Add log-based alerting rules

---

### 10. Terminal Streaming Architecture is Not Production-Ready

**Location:** `.ai/production-roadmap.md:125-126` (Redis for terminal streams)

**Issue:** Redis Streams used for terminal output but no HA strategy.

**Evidence from codebase:**
- `worker/src/adapters/terminal-stream.adapter.ts:24-67` - Uses Redis Streams XADD/XREAD
- No mention of Redis Sentinel or Cluster for HA

**Risk:**
- Single Redis failure = all terminal streams lost
- No persistence (Redis Streams can evaporate)
- Scaling issues with pub/sub

**Recommendation:**
1. Document Redis HA requirements (Sentinel minimum)
2. Consider alternative: direct WebSocket from worker to frontend
3. Add stream persistence to object store

---

## Nice-to-Have Improvements

### 11. Add Helm Chart Testing CI

**Location:** Throughout roadmap

**Suggestion:** Add GitHub Actions workflow to test Helm charts:

```yaml
- helm lint
- helm template --debug
- kind cluster create
- helm install test
- kubectl wait --for=condition=ready
- smoke tests
```

---

### 12. Add Cost Estimation for Phase 4

**Location:** `.ai/production-roadmap.md:314-315` (Stage 3: Cost controls)

**Suggestion:** Before Phase 4, provide TCO calculator:
- GKE node costs per tier
- Cloud SQL/Memorystore pricing
- Egress costs (security tools download large datasets)
- Storage costs (GCS, artifact registry)

---

### 13. Document Multi-Region Strategy

**Location:** `.ai/production-roadmap.md:297-305` (Phase 4 GCP infra)

**Suggestion:** Add multi-region consideration:
- Can a single GKE cluster serve multiple regions?
- How are workflows scheduled across regions?
- What about data residency requirements?

---

## Questions/Clarifications Needed

### 14. What is the "Workload Runner" Architecture?

**Location:** `.ai/production-roadmap.md:263-286` (Phase 3)

**Questions:**
- Is Runner a separate service or in-process with worker?
- What is the API contract between Runner and worker?
- How does Runner authenticate to Kubernetes?
- Can Runner be deployed separately from worker (scale independently)?

**Evidence of ambiguity:** Section 6.1 says "Runner Deployment + Service" but section 6.2 says "Worker no longer needs kube permissions" - implies Runner is separate, but no architecture diagram.

---

### 15. How Does K8s Job Execution Handle Volumes?

**Location:** `.ai/production-roadmap.md:276-279` (backends: dind, k8sJob)

**Questions:**
- Current codebase uses Docker volumes extensively (`isolated-volume.ts`)
- How do K8s Jobs provide input files to containers?
- ConfigMap volume limits (1MB) - what about larger inputs?
- How are output artifacts retrieved from completed Jobs?

**Evidence:** `isolated-volume.ts` creates Docker volumes, writes files via `docker run -i`, then bind mounts. K8s Jobs can't do this pattern.

**Recommended Solution:** Use GCS (or object store) as the transfer layer:
1. Upload inputs to object store before Job
2. Init container downloads inputs to emptyDir
3. Tool container reads from emptyDir, writes outputs
4. Sidecar container uploads outputs to object store
5. Skip RWX PVC (Filestore) - too expensive ($208/month minimum for 1 TB)

---

### 16. What Happens to Existing Customers During DinD→K8s Job Migration?

**Location:** `.ai/production-roadmap.md:243-260` (Phase 2 → Phase 3 transition)

**Questions:**
- Are running workflows aborted during migration?
- How do you validate K8s Job backend before cutting over?
- Can you run DinD and K8s Job backends simultaneously for A/B testing?
- What is the rollback plan if K8s Jobs fail?

---

### 17. How Does "Generic Cloud" Support Different Object Stores?

**Location:** `.ai/production-roadmap.md:126` (objectStore requirement)

**Questions:**
- Compose uses MinIO (S3-compatible)
- GCP uses GCS
- What about Azure Blob?
- How is the object store backend abstracted?

**Evidence:** `worker/src/adapters/artifact.adapter.ts` exists but no interface definition for pluggable backends.

**Recommended Solution:** Create an abstraction layer:
```typescript
interface ObjectStore {
  upload(bucket: string, key: string, data: Buffer): Promise<void>;
  download(bucket: string, key: string): Promise<Buffer>;
  delete(bucket: string, key: string): Promise<void>;
  list(bucket: string, prefix: string): Promise<string[]>;
  getSignedUrl(bucket: string, key: string, expiry: number): Promise<string>;
}
```

---

## Risk Areas Summary

| Risk | Severity | Impact | Mitigation |
|------|----------|--------|------------|
| DinD in production | **CRITICAL** | Host compromise, tenant isolation failure | Block until K8s Job backend works |
| Undefined RBAC | **HIGH** | Privilege escalation | Design least-privilege roles before Phase 1 |
| NetworkPolicy gaps | **HIGH** | Pod communication breaks | Test policies with Calico/Cilium |
| Secret management missing | **HIGH** | Secrets leaked in git | Choose External Secrets operator now |
| No migration tests | **MEDIUM** | Deployment failures | Add parity tests to Phase 0 |
| Resource limits undefined | **MEDIUM** | Cost overruns, OOM | Define profiles in Phase 0 |
| Healthcheck gaps | **MEDIUM** | Self-healing breaks | Define HTTP endpoints before Phase 1 |
| Migration strategy unclear | **MEDIUM** | Deployment downtime | Separate migrations from app startup |
| Observability optional | **LOW-MEDIUM** | Debugging impossible | Make Loki required for Phase 1 |
| Terminal streaming HA | **LOW-MEDIUM** | Data loss | Document Redis HA requirements |
| Volume handling (K8s Jobs) | **MEDIUM** | Architecture blocker | Use object store as transfer layer; skip RWX PVC |

---

## Next Steps (Priority Order)

### Do These Before Starting Phase 0

1. **Add Compose-to-Helm parity tests** - Without this, you'll deploy broken configs
2. **Design RBAC/ServiceAccount architecture** - Without this, creating security hole
3. **Define NetworkPolicy matrix** - Without this, pods won't communicate
4. **Choose External Secrets Operator** - Without this, secrets leak
5. **Add DinD security warning + blocking criteria** - Without this, privileged containers go to prod

### Do These Soon After Starting

6. Define resource profile matrix
7. Specify health check endpoints
8. Design database migration strategy
9. Make Loki required (not optional)
10. Document Redis HA requirements

### Address During Phase 3/4

11. Design Workload Runner architecture
12. Plan volume handling for K8s Jobs (use object store)
13. Define object store abstraction layer
14. Plan DinD→K8s Job migration strategy

---

## References

- `/Users/betterclever/shipsec/studio-wt1/.ai/production-roadmap.md:1-329` - Full roadmap
- `/Users/betterclever/shipsec/studio-wt1/docker/docker-compose.full.yml:1-308` - Current deployment config
- `/Users/betterclever/shipsec/studio-wt1/Dockerfile:1-153` - Container build process
- `/Users/betterclever/shipsec/studio-wt1/worker/src/utils/isolated-volume.ts:1-544` - Volume management (Docker-specific)
- `/Users/betterclever/shipsec/studio-wt1/worker/src/temporal/activities/mcp.activity.ts:80-143` - Container cleanup
- `/Users/betterclever/shipsec/studio-wt1/worker/src/temporal/activities/run-component.activity.ts:1-150` - Component execution entry point
- `/Users/betterclever/shipsec/studio-wt1/package.json:1-58` - Project structure
