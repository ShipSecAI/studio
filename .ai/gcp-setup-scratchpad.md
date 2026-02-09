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
