# GCP Setup Scratchpad (commands log)

This file is a running log of shell commands executed for the GCP cloud setup. It is intentionally copy/paste friendly.

## 2026-02-09

### Local environment checks

```bash
cd /Users/betterclever/shipsec/studio-wt1 && git status --porcelain=v1 && git log -5 --oneline
cd /Users/betterclever/shipsec/studio-wt1 && command -v gcloud >/dev/null 2>&1 && gcloud --version | head -n 2 || echo 'gcloud:missing'
cd /Users/betterclever/shipsec/studio-wt1 && command -v gcloud >/dev/null 2>&1 && (gcloud auth list --format='value(account)' || true) && (gcloud config list --format='text(core.project,core.account,core.disable_usage_reporting,compute.region,compute.zone)' || true) && (gcloud projects list --format='table(projectId,name)' --limit=20 || true)
```

### Enable baseline APIs (project: `shipsec`)

```bash
gcloud services enable cloudresourcemanager.googleapis.com serviceusage.googleapis.com --project shipsec --quiet
gcloud services list --enabled --project shipsec --format='value(config.name)' 2>/dev/null | head -n 40
gcloud projects describe shipsec --format='yaml(projectId,name,parent,type,labels)' 2>/dev/null
gcloud organizations list --format='table(displayName,organizationId)' 2>/dev/null
gcloud billing projects describe shipsec --format='value(billingEnabled,billingAccountName)' 2>/dev/null
```

### Region defaults (GCP “most common” default)

```bash
gcloud config set project shipsec
gcloud config set compute/region us-central1
gcloud config set compute/zone us-central1-a
```

### Enable GKE + registry + secrets APIs

```bash
gcloud services enable container.googleapis.com artifactregistry.googleapis.com iam.googleapis.com secretmanager.googleapis.com --project shipsec --quiet
gcloud services list --enabled --project shipsec --format='value(config.name)' | rg '^container\\.googleapis\\.com$|^artifactregistry\\.googleapis\\.com$|^secretmanager\\.googleapis\\.com$|^iam\\.googleapis\\.com$' || true
```

### Artifact Registry (Docker)

```bash
gcloud artifacts repositories describe shipsec-studio --location=us-central1 --project shipsec --format='value(name)' 2>/dev/null || true
gcloud artifacts repositories create shipsec-studio --repository-format=docker --location=us-central1 --description='ShipSec Studio images' --project shipsec --quiet
gcloud auth configure-docker us-central1-docker.pkg.dev --quiet
```

### GKE cluster (Standard)

Failed attempt (invalid flag usage):
```bash
gcloud container clusters create shipsec-dev --zone us-central1-a --project shipsec --release-channel=regular --num-nodes=2 --machine-type=e2-standard-4 --disk-type=pd-balanced --disk-size=100 --enable-ip-alias --workload-pool=shipsec.svc.id.goog --enable-private-nodes=false --enable-master-authorized-networks --master-authorized-networks=0.0.0.0/0 --quiet
```

Actual cluster create (in progress / completed depending on timing):
```bash
gcloud container clusters create shipsec-dev --zone us-central1-a --project shipsec --release-channel=regular --num-nodes=2 --machine-type=e2-standard-4 --disk-type=pd-balanced --disk-size=100 --enable-ip-alias --workload-pool=shipsec.svc.id.goog --quiet
```

Cluster status check:
```bash
gcloud container clusters describe shipsec-dev --zone us-central1-a --project shipsec --format='yaml(status,endpoint,currentMasterVersion,currentNodeVersion,nodePools[].name,nodePools[].status)' 2>/dev/null || true
```

### kubectl auth plugin + credentials

```bash
gcloud components install gke-gcloud-auth-plugin --quiet
gcloud container clusters get-credentials shipsec-dev --zone us-central1-a --project shipsec --quiet
kubectl get nodes
```

### Project number (used for default compute service account)

```bash
gcloud projects describe shipsec --format='value(projectNumber)'
```

Terraform/OpenTofu note (Application Default Credentials):
```bash
gcloud auth application-default print-access-token >/dev/null 2>&1 && echo 'adc:present' || echo 'adc:missing'
```

### Live state check (2026-02-09T08:55:16Z)

```bash
gcloud config list --format='text(core.project,compute.region,compute.zone)'
gcloud container clusters describe shipsec-dev --zone us-central1-a --project shipsec --format='value(status,currentMasterVersion,currentNodeVersion,endpoint)'
kubectl config current-context
kubectl get ns
helm list -A
kubectl get pods -A -o wide
kubectl get svc -A -o wide
```

### Notes
- gcloud warning about missing resource tag `environment` is informational; does not block GKE.

## Debug (2026-02-09T08:59:44Z)

```bash
kubectl config current-context
kubectl -n shipsec-system get deploy,po,cm,secret -o wide
kubectl -n shipsec-workers get deploy,po -o wide
kubectl -n shipsec-system describe pod -l app.kubernetes.io/component=backend
kubectl -n shipsec-system describe pod -l app.kubernetes.io/component=frontend
kubectl -n shipsec-workers describe pod -l app.kubernetes.io/component=worker
kubectl -n shipsec-system logs -l app.kubernetes.io/component=backend --tail=200
kubectl -n shipsec-system logs -l app.kubernetes.io/component=backend --tail=200 --previous
kubectl -n shipsec-system logs -l app.kubernetes.io/component=frontend --tail=200
kubectl -n shipsec-system logs -l app.kubernetes.io/component=frontend --tail=200 --previous
kubectl -n shipsec-workers logs -l app.kubernetes.io/component=worker --tail=200
kubectl -n shipsec-workers logs -l app.kubernetes.io/component=worker --tail=200 --previous
```

### Redeploy (amd64 images) (2026-02-09T09:00:18Z)

```bash
bash deploy/scripts/gcp/install.sh
```

### Post-redeploy checks (2026-02-09T09:06:34Z)

```bash
kubectl -n shipsec-system get pods -o wide
kubectl -n shipsec-workers get pods -o wide
kubectl -n shipsec-system logs -l app.kubernetes.io/component=backend --tail=120
kubectl -n shipsec-workers logs -l app.kubernetes.io/component=worker --tail=120
kubectl -n shipsec-system logs -l app.kubernetes.io/component=frontend --tail=120
```

```bash
kubectl -n shipsec-system rollout status deploy/shipsec-frontend --timeout=180s
```

```bash
curl -fsS http://35.225.241.234:3211/api/v1/health || true
```

```bash
curl -fsS http://104.197.140.108:8080/ | head
```

```bash
curl -I http://104.197.140.108:8080/ || true
```

```bash
kubectl -n shipsec-system get deploy shipsec-backend shipsec-frontend -o jsonpath='{range .items[*]}{.metadata.name}{t}{.spec.template.spec.containers[0].image}{n}{end}'
```
