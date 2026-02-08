#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

SYSTEM_NS="${SYSTEM_NS:-shipsec-system}"
WORKERS_NS="${WORKERS_NS:-shipsec-workers}"
WORKLOADS_NS="${WORKLOADS_NS:-shipsec-workloads}"

echo "[shipsec] Creating namespaces (idempotent)..."
kubectl get namespace "${SYSTEM_NS}" >/dev/null 2>&1 || kubectl create namespace "${SYSTEM_NS}"
kubectl get namespace "${WORKERS_NS}" >/dev/null 2>&1 || kubectl create namespace "${WORKERS_NS}"
kubectl get namespace "${WORKLOADS_NS}" >/dev/null 2>&1 || kubectl create namespace "${WORKLOADS_NS}"

echo "[shipsec] Installing infra chart (in-cluster deps for VPS test)..."
helm upgrade --install shipsec-infra "${ROOT_DIR}/deploy/helm/shipsec-infra" \
  --namespace "${SYSTEM_NS}" \
  --values "${ROOT_DIR}/deploy/helm/shipsec-infra/values.yaml" \
  --values "${ROOT_DIR}/deploy/helm/shipsec-infra/values/vps.yaml"

echo "[shipsec] Installing app chart (DinD enabled for now)..."
helm upgrade --install shipsec "${ROOT_DIR}/deploy/helm/shipsec" \
  --namespace "${SYSTEM_NS}" \
  --values "${ROOT_DIR}/deploy/helm/shipsec/values.yaml" \
  --values "${ROOT_DIR}/deploy/helm/shipsec/values/vps.yaml" \
  --values "${ROOT_DIR}/deploy/helm/shipsec/values/dind.yaml"

cat <<'EOF'

[shipsec] Install complete.

Recommended access pattern on a VPS (simple, no LB/Ingress required):

1) Backend:
   kubectl -n shipsec-system port-forward svc/shipsec-backend 3211:3211

2) Frontend:
   kubectl -n shipsec-system port-forward svc/shipsec-frontend 8090:8080

3) Temporal UI:
   kubectl -n shipsec-system port-forward svc/shipsec-temporal-ui 8081:8081

4) MinIO console:
   kubectl -n shipsec-system port-forward svc/shipsec-minio 9001:9001

Then SSH tunnel from your laptop:
  ssh -L 3211:localhost:3211 -L 8090:localhost:8090 -L 8081:localhost:8081 -L 9001:localhost:9001 clevervps

EOF

