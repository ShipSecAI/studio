# GCP Infra (Terraform/OpenTofu)

This directory is intended for the **private** repo only.

Goals:

- Provision GCP infrastructure (network, GKE, Artifact Registry) with sane defaults.
- Keep app deployment (Helm) separate from infrastructure provisioning.
- Support a fast `dev` environment and a safer `prod` environment.

## Layout

- `infra/gcp/bootstrap/`: creates a GCS bucket for Terraform state (run once per project).
- `infra/gcp/envs/dev/`: fast dev cluster (zonal, public nodes by default).
- `infra/gcp/envs/prod/`: production-ready baseline (regional, private nodes, Cloud NAT, node pool split).

## Prereqs

- `gcloud` authenticated to the right project
- Application Default Credentials for Terraform/OpenTofu:

```bash
gcloud auth application-default login
gcloud config set project shipsec
```

## Quickstart (recommended)

1. Bootstrap state bucket:

```bash
cd infra/gcp/bootstrap
terraform init
terraform apply -var project_id=shipsec -var region=us-central1
```

2. Create `dev` cluster:

```bash
cd infra/gcp/envs/dev
terraform init -backend-config="bucket=shipsec-tfstate" -backend-config="prefix=infra/gcp/dev"
terraform apply -var project_id=shipsec -var region=us-central1 -var zone=us-central1-a
```

3. Fetch kube credentials:

```bash
gcloud container clusters get-credentials shipsec-dev --zone us-central1-a --project shipsec
kubectl get nodes
```

## Notes

- `prod` uses private nodes and Cloud NAT by default. That is closer to real production, but costs more.
- Artifact Registry is created in the chosen region for pushing images.
