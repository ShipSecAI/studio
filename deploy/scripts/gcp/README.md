# GCP (GKE) quickstart

This is the "fast path" to get ShipSec Studio running on GKE Standard in `us-central1`.

It intentionally keeps dependencies **in-cluster** for the first cloud pass.

## Prereqs

- `gcloud`, `kubectl`, `helm`, `docker`
- A GKE Standard cluster already created (we used `shipsec-dev` in `us-central1-a`)
- Artifact Registry repo `shipsec-studio` in `us-central1`

## Install

```bash
bash deploy/scripts/gcp/install.sh
```

Override defaults:

```bash
PROJECT_ID=shipsec REGION=us-central1 ZONE=us-central1-a CLUSTER_NAME=shipsec-dev IMAGE_TAG=dev1 bash deploy/scripts/gcp/install.sh
```

## Smoke

```bash
bash deploy/scripts/gcp/smoke.sh
```

## Notes

- This path uses DinD (privileged) for now. Treat it as trusted-tenant only.
- Frontend is built with `VITE_API_URL` pointing to the backend LoadBalancer IP.
- If you build from an Apple Silicon machine, you must push `linux/amd64` images to GKE nodes. Otherwise pods will crash with `exec format error`. `install.sh` enforces `--platform linux/amd64` and uses a unique `IMAGE_TAG` by default.

## kubectl setup (on your machine)

```bash
gcloud components install gke-gcloud-auth-plugin --quiet
gcloud config set project shipsec
gcloud config set compute/region us-central1
gcloud config set compute/zone us-central1-a
gcloud container clusters get-credentials shipsec-dev --zone us-central1-a --project shipsec
kubectl config current-context
kubectl get nodes
```
