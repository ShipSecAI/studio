# ShipSec Studio: K8s Manifests Roadmap (OrbStack Local → Generic Cloud → GCP Private Repo)

**What this doc is:** an end-to-end, agent-executable checklist to create and evolve Kubernetes manifests/Helm charts for ShipSec Studio.  
**Companion doc (architecture + runner/streaming details):** `.ai/gcp-production-architecture.md`  
**Order of operations:** ship a working **local OrbStack Kubernetes** deployment first, then make the charts **cloud-generic**, then add **GCP-specific infra automation** in the private `shipsec-studio-cloud` repo.  
**Initial execution mode:** **DinD** (temporary) so we can ship early; the manifest surface is values-driven so we can later switch to a **K8s Job runner** without rewriting workflow logic.

---

## 0) Success Criteria (“done” means)

### Local (OrbStack K8s)

- [ ] `helm install` brings up:
  - [ ] backend API
  - [ ] Temporal worker(s)
  - [ ] frontend
  - [ ] infra deps in-cluster (at least: Postgres, Temporal, Redis, object store; Kafka/Loki optional)
  - [ ] DinD runner pool (privileged) + worker configured with `DOCKER_HOST`
- [ ] Developer can:
  - [ ] open UI, create a workflow/run
  - [ ] see terminal output streaming
  - [ ] see run results persisted

### Generic cloud (open-source)

- [ ] Helm chart supports:
  - [ ] local/in-cluster infra (for dev/self-host)
  - [ ] external/managed infra (for cloud) via values
- [ ] Includes:
  - [ ] resource requests/limits everywhere
  - [ ] probes everywhere (backend + worker at minimum)
  - [ ] NetworkPolicies baseline
  - [ ] Pod Security Admission labels (where feasible)
  - [ ] docs for “deploy on any Kubernetes”

### GCP integration (private cloud repo)

- [ ] Terraform/Pulumi provisions:
  - [ ] VPC + private GKE + Cloud NAT
  - [ ] Cloud SQL + Memorystore + GCS + Artifact Registry
  - [ ] Gateway/Cloud Armor
  - [ ] Workload Identity bindings
- [ ] Environment overlays + GitOps / CI deploy pipeline

---

## 1) Open-source repo layout (what the agent creates)

Create these paths in `shipsec-studio`:

```
deploy/
  README.md
  helm/
    shipsec/
      Chart.yaml
      values.yaml
      templates/
        _helpers.tpl
        namespace.yaml
        configmap.yaml
        secret.local.yaml
        backend.deployment.yaml
        backend.service.yaml
        worker.deployment.yaml
        frontend.deployment.yaml
        frontend.service.yaml
        dind.deployment.yaml
        dind.service.yaml
        networkpolicy.*.yaml
      values/
        local-orbstack.yaml
        cloud-generic.yaml
        dind.yaml
        no-dind.yaml
    shipsec-infra/
      Chart.yaml
      values.yaml
      templates/
        postgres.*.yaml
        temporal.*.yaml
        redis.*.yaml
        minio.*.yaml
        kafka.*.yaml
        loki.*.yaml
      values/
        local-orbstack.yaml
  scripts/
    orbstack/
      install.sh
      uninstall.sh
      smoke.sh
docs/
  deployment/
    kubernetes-local-orbstack.mdx
    kubernetes-generic-cloud.mdx
```

Notes:

- `shipsec` is “the app chart”. `shipsec-infra` is “local deps chart”. Cloud deployments typically disable `shipsec-infra`.
- `secret.local.yaml` is explicitly local/dev-only; cloud uses External Secrets in the private repo.

---

## 2) Configuration mapping (compose → Helm values)

**Source of truth:** `docker/docker-compose.full.yml`.

### Checklist: create `deploy/README.md`

- [ ] Extract every env var used by backend/worker/frontend from compose.
- [ ] Classify each as **secret** vs **non-secret**.
- [ ] Define Helm values keys (single canonical mapping).
- [ ] Document defaults for:
  - [ ] local OrbStack
  - [ ] generic cloud (external endpoints)

### Required value groups (minimum)

- `backend.env` / `worker.env` / `frontend.env` (non-secret)
- `secrets.*` (local-only) OR `existingSecretName` (cloud)
- `database.url`
- `temporal.address`, `temporal.namespace`, `temporal.taskQueue`
- `redis.url` (terminal streams)
- `objectStore` (S3-compatible for OSS; GCS in private repo)
- `kafka.*` (optional; must be disable-able)
- `loki.url` (optional; can be stdout-only)
- `execution.dind.enabled` + `execution.dind.dockerHost`

---

## 3) Phase 0 — Local OrbStack Kubernetes (minimum viable)

### Goal

Get a working deployment on OrbStack K8s that matches today’s Compose behavior closely enough to run workflows.

### 3.1 Namespaces

- [ ] Create templates (or `kubectl create namespace`) for:
  - [ ] `shipsec-system`
  - [ ] `shipsec-workers`
  - [ ] `shipsec-workloads`

### 3.2 shipsec-infra chart (local deps)

Local deps should be “boring and good enough”, not HA.

- [ ] Postgres
  - [ ] StatefulSet + Service + PVC
  - [ ] user/db/password from local Secret
- [ ] Temporal (dev)
  - [ ] Use a dev-friendly Temporal chart/config
  - [ ] Expose frontend to cluster (service)
- [ ] Redis
  - [ ] StatefulSet or Deployment + Service
- [ ] MinIO (optional if you already support filesystem mode; otherwise required)
  - [ ] StatefulSet + Service + PVC
- [ ] Kafka/Redpanda (optional)
  - [ ] gated behind `kafka.enabled`
  - [ ] default OFF if product works without ingest services (`ENABLE_INGEST_SERVICES=false`)
- [ ] Loki (optional)
  - [ ] gated behind `loki.enabled`

### 3.3 shipsec chart (app)

- [ ] Backend
  - [ ] Deployment + Service
  - [ ] readiness/liveness probes
  - [ ] resource requests/limits
- [ ] Worker
  - [ ] Deployment
  - [ ] readiness/liveness (or at least liveness + startup check)
  - [ ] resource requests/limits
- [ ] Frontend
  - [ ] Deployment + Service

### 3.4 DinD for local execution (temporary)

**Objective:** match current behavior: worker runs docker tool containers via `DOCKER_HOST`.

- [ ] DinD Deployment (privileged)
  - [ ] `privileged: true`
  - [ ] PVC for `/var/lib/docker`
  - [ ] expose `2375` via ClusterIP Service
- [ ] Worker values:
  - [ ] `DOCKER_HOST=tcp://<dind-service>.<ns>.svc.cluster.local:2375`
- [ ] Label the DinD templates clearly as “NOT PRODUCTION SAFE”

### 3.5 Local UX scripts

- [ ] `deploy/scripts/orbstack/install.sh`
  - [ ] create namespaces
  - [ ] install `shipsec-infra` with `values/local-orbstack.yaml`
  - [ ] install `shipsec` with `values/local-orbstack.yaml` + `values/dind.yaml`
- [ ] `deploy/scripts/orbstack/smoke.sh`
  - [ ] assert all pods Ready
  - [ ] curl backend health endpoint
  - [ ] curl frontend (or check service reachable)

### 3.6 Local docs

- [ ] `docs/deployment/kubernetes-local-orbstack.mdx`
  - [ ] prerequisites
  - [ ] install steps
  - [ ] common failures (image pull, ports, PVC pending)

---

## 4) Phase 1 — Generic cloud support (open-source)

### Goal

Make the Helm charts deployable on any Kubernetes by toggling “in-cluster infra” vs “external endpoints”.

### 4.1 Values toggles (must exist)

- [ ] In `shipsec-infra`:
  - [ ] `postgres.enabled`, `temporal.enabled`, `redis.enabled`, `minio.enabled`, `kafka.enabled`, `loki.enabled`
- [ ] In `shipsec`:
  - [ ] accept external endpoints when infra is disabled
  - [ ] accept `existingSecretName` for secrets

### 4.2 Security baseline (cloud-generic)

- [ ] Enforce requests/limits for all non-DinD pods
- [ ] Apply `securityContext` for app pods (non-root; drop caps; read-only rootfs where possible)
- [ ] NetworkPolicies:
  - [ ] default-deny in `shipsec-workloads`
  - [ ] allow DNS egress
  - [ ] allow HTTPS egress (document CNI requirements)

### 4.3 Documentation

- [ ] `docs/deployment/kubernetes-generic-cloud.mdx`
  - [ ] “bring your own DB/Redis/object-store/Temporal” section
  - [ ] sample `values/cloud-generic.yaml`
  - [ ] upgrade + rollback notes

---

## 5) Phase 2 — DinD “productionize only enough” (still open-source/generic)

### Goal

Keep DinD viable for early customers while minimizing blast radius until K8s Job execution is ready.

### 5.1 Manifest requirements (DinD in cloud)

- [ ] DinD runs on isolated nodes (taints/tolerations documented)
- [ ] Separate namespace for DinD + strict NetworkPolicy
- [ ] Tight resource limits for the DinD daemon pod
- [ ] Operational docs: “DinD is temporary; do not use for high-trust multi-tenancy”

### 5.2 Exit criteria

- [ ] Can onboard 2–3 clients with bounded risk and bounded spend
- [ ] Charts support a later execution backend swap without rewriting workflows

---

## 6) Phase 3 — Add Workload Runner (open-source) and switch execution engine later

### Goal

Decouple “workflow orchestration” from “container execution”.

### 6.1 Workload Runner v1 (minimal)

- [ ] Runner Deployment + Service in `shipsec-workers`
- [ ] Internal API:
  - [ ] `POST /executions`
  - [ ] `GET /executions/:id`
  - [ ] `POST /executions/:id/cancel`
- [ ] Backends:
  - [ ] `dind` (initial)
  - [ ] `k8sJob` (later)
- [ ] Terminal streaming:
  - [ ] tail logs → push chunks to Redis Streams `terminal:<runId>`

### 6.2 RBAC changes

- [ ] Worker no longer needs kube “create job/pod” permissions
- [ ] Runner gets namespace-scoped Role/RoleBinding for `shipsec-workloads`

---

## 7) Phase 4 — GCP integration (private `shipsec-studio-cloud`)

### Goal

Automate the “real production” GCP setup while keeping open-source charts cloud-generic.

### 7.1 What stays OSS vs what moves to private repo

- [ ] OSS (`shipsec-studio`) keeps:
  - [ ] Helm charts (`deploy/helm/shipsec`, `deploy/helm/shipsec-infra`)
  - [ ] `values/cloud-generic.yaml` patterns (no cloud resources)
  - [ ] local/self-host docs + DinD warnings
- [ ] Private (`shipsec-studio-cloud`) adds:
  - [ ] Terraform/OpenTofu (or Pulumi) for GCP provisioning + security defaults
  - [ ] managed service wiring (Cloud SQL, Memorystore, GCS, Secret Manager)
  - [ ] ingress + TLS + WAF + budgets/alerts
  - [ ] opinionated node pools for execution isolation (DinD now; K8s Jobs later)
  - [ ] deployment pipeline (GitHub Actions + `helm upgrade` or GitOps)

### 7.2 Private repo structure (recommended)

- [ ] `infra/gcp/modules/`:
  - [ ] `project/` (APIs, IAM, budgets, tags)
  - [ ] `network/` (VPC, subnets, secondary ranges, Cloud NAT, firewall)
  - [ ] `gke/` (cluster + node pools)
  - [ ] `artifact-registry/`
  - [ ] `cloudsql/`
  - [ ] `memorystore/`
  - [ ] `gcs/`
  - [ ] `secrets/` (Secret Manager + IAM)
  - [ ] `external-secrets/` (ESO install + Workload Identity bindings)
  - [ ] `ingress/` (Gateway/Ingress, certs, Cloud Armor, DNS)
- [ ] `infra/gcp/envs/`:
  - [ ] `dev/` (fast, cheap, may be zonal)
  - [ ] `staging/` (private nodes, realistic)
  - [ ] `prod/` (private nodes, hardened defaults)
- [ ] Remote state:
  - [ ] GCS bucket for state + object versioning
  - [ ] documented state locking strategy (and CI serialism)

### 7.3 GCP prerequisites (agent checklist)

- [ ] Choose region/zone defaults:
  - [ ] `us-central1` (recommended default for GCP footprint)
  - [ ] dev zone: `us-central1-a`
- [ ] Billing enabled
- [ ] Enable APIs:
  - [ ] `container.googleapis.com`
  - [ ] `artifactregistry.googleapis.com`
  - [ ] `secretmanager.googleapis.com`
  - [ ] `iam.googleapis.com`
  - [ ] baseline: `cloudresourcemanager.googleapis.com`, `serviceusage.googleapis.com`
- [ ] Budget + alerts (email at minimum)
- [ ] (Optional) project environment tag (some org policies expect it)

### 7.4 Network (private-by-default target)

- [ ] VPC per environment (early recommendation)
- [ ] Subnet(s) in region + secondary ranges for Pods/Services (VPC-native / IP alias)
- [ ] Cloud NAT + reserved static egress IP(s) (for customer allowlists)
- [ ] Private Google Access enabled on subnets
- [ ] Firewall: no public SSH; only required LB/health-check traffic

### 7.5 GKE cluster + node pools (tie this to the DinD plan)

- [ ] Cluster:
  - [ ] Standard (not Autopilot) for privileged DinD flexibility
  - [ ] release channel `regular`
  - [ ] Workload Identity enabled (`<project>.svc.id.goog`)
  - [ ] staging/prod: private nodes
- [ ] Minimum viable node pool split:
  - [ ] `system` pool: backend/worker/control workloads
  - [ ] `exec` pool: DinD only (taints + tolerations)
  - [ ] (Later) `workloads` pool: K8s Job runner pods
- [ ] DinD scheduling rules:
  - [ ] `shipsec-dind` tolerates `exec` taint
  - [ ] everything else does not tolerate `exec`

### 7.6 Artifact Registry + image build rules

- [ ] Artifact Registry repo per environment (or shared per region)
- [ ] Enforce AMD64 builds for GKE nodes:
  - [ ] CI uses `docker buildx build --platform linux/amd64 --push`
  - [ ] tags are unique (timestamp/content hash) to avoid arch/tag collisions
- [ ] (Optional later) vulnerability scanning + signing

### 7.7 Managed services wiring (replace `shipsec-infra` in cloud)

- [ ] Cloud SQL (Postgres) with private IP
- [ ] Memorystore (Redis) with private endpoint
- [ ] GCS bucket(s) for artifacts with lifecycle/retention
- [ ] Helm overlays:
  - [ ] disable `shipsec-infra` in cloud
  - [ ] set external endpoints via values

### 7.8 Secrets (Secret Manager + External Secrets Operator)

- [ ] Install External Secrets Operator
- [ ] Workload Identity mappings (KSA -> GSA) with least privilege
- [ ] secret naming convention (env + service prefix)
- [ ] app chart uses `existingSecretName` in cloud

### 7.9 Ingress + TLS + WAF

- [ ] dev: Services `LoadBalancer` is fine for speed
- [ ] staging/prod:
  - [ ] Gateway API or Ingress with Google LB controller
  - [ ] managed certificates
  - [ ] Cloud Armor policy (rate limit + baseline)

### 7.10 GCP rollout stages

- [ ] Stage 0: Fast dev cluster (zonal, minimal hardening, ship now)
- [ ] Stage 1: Managed data plane live (Cloud SQL/Memorystore/GCS), apps deployed
- [ ] Stage 2: Execution hardening (Runner + K8s Jobs / gVisor), DinD minimized
- [ ] Stage 3: Cost controls (egress budgets/alerts, caching, per-tenant concurrency/resource classes)

---

## 8) Final “agent order” (one-pass execution list)

- [ ] Write `deploy/README.md` (env + secrets mapping from compose)
- [ ] Create `deploy/helm/shipsec-infra` (local deps)
- [ ] Create `deploy/helm/shipsec` (backend/worker/frontend) + values overlays
- [ ] Add DinD templates + `values/dind.yaml`
- [ ] Add OrbStack scripts + local OrbStack doc
- [ ] Add cloud-generic values + cloud-generic doc
- [ ] (Later) add Workload Runner chart bits + RBAC tightening
- [ ] (Private repo) implement GCP Terraform + env overlays + GitOps/pipeline
