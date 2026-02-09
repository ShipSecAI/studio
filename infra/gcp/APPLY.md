# Apply Guide (Terraform)

This repo uses `terraform` locally. (OpenTofu works too, but is not assumed to be installed.)

## 0) Auth (required)

Terraform's GCP provider uses Application Default Credentials (ADC) by default.

```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project shipsec
gcloud config set compute/region us-central1
gcloud config set compute/zone us-central1-a
```

Verify:

```bash
gcloud auth application-default print-access-token >/dev/null && echo adc:present
```

### Non-interactive fallback (recommended in CI)

If you can't use ADC (for example in headless sessions), you can use a short-lived token:

```bash
export TF_VAR_access_token="$(gcloud auth print-access-token)"
```

## 1) Bootstrap Terraform state bucket (run once)

Pick a globally unique bucket name, then:

```bash
cd infra/gcp/bootstrap
terraform init
terraform apply \
  -var project_id=shipsec \
  -var region=us-central1 \
  -var state_bucket_name=shipsec-tfstate
```

## 2) Dev environment (fast)

```bash
cd infra/gcp/envs/dev
terraform init \
  -backend-config="bucket=shipsec-tfstate" \
  -backend-config="prefix=infra/gcp/dev"

terraform apply \
  -var project_id=shipsec \
  -var region=us-central1 \
  -var zone=us-central1-a \
  -var cluster_name=shipsec-dev
```

Get credentials:

```bash
gcloud container clusters get-credentials shipsec-dev --zone us-central1-a --project shipsec
kubectl get nodes
```

## 3) Prod environment (baseline)

`prod` creates a regional cluster with private nodes and Cloud NAT, plus separate node pools:

- `system-pool`: backend/worker/control plane pods
- `exec-pool`: execution workloads (tainted `shipsec.io/exec=true:NoSchedule`)

```bash
cd infra/gcp/envs/prod
terraform init \
  -backend-config="bucket=shipsec-tfstate" \
  -backend-config="prefix=infra/gcp/prod"

terraform apply \
  -var project_id=shipsec \
  -var region=us-central1 \
  -var cluster_name=shipsec-prod
```

Then fetch credentials:

```bash
gcloud container clusters get-credentials shipsec-prod --region us-central1 --project shipsec
kubectl get nodes
```

## Notes

- If your org policies require it, add a project `environment` tag. It's not required for GKE itself.
- This file intentionally does not include any credentials, service account keys, or secrets.
