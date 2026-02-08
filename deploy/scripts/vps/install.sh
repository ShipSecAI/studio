#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

SYSTEM_NS="${SYSTEM_NS:-shipsec-system}"
WORKERS_NS="${WORKERS_NS:-shipsec-workers}"
WORKLOADS_NS="${WORKLOADS_NS:-shipsec-workloads}"
KUBE_CONTEXT="${KUBE_CONTEXT:-kind-shipsec}"
KIND_CLUSTER_NAME="${KIND_CLUSTER_NAME:-shipsec}"

if command -v kind >/dev/null 2>&1; then
  if ! kind get clusters 2>/dev/null | grep -q "^${KIND_CLUSTER_NAME}$"; then
    echo "[shipsec] Creating kind cluster: ${KIND_CLUSTER_NAME}"
    kind create cluster --name "${KIND_CLUSTER_NAME}" --wait 180s
  fi
fi

echo "[shipsec] Creating namespaces (idempotent)..."
kubectl --context "${KUBE_CONTEXT}" get namespace "${SYSTEM_NS}" >/dev/null 2>&1 || kubectl --context "${KUBE_CONTEXT}" create namespace "${SYSTEM_NS}"
kubectl --context "${KUBE_CONTEXT}" get namespace "${WORKERS_NS}" >/dev/null 2>&1 || kubectl --context "${KUBE_CONTEXT}" create namespace "${WORKERS_NS}"
kubectl --context "${KUBE_CONTEXT}" get namespace "${WORKLOADS_NS}" >/dev/null 2>&1 || kubectl --context "${KUBE_CONTEXT}" create namespace "${WORKLOADS_NS}"

IMAGE_OVERRIDES=()
if [[ "${SHIPSEC_BUILD_IMAGES:-0}" == "1" ]]; then
  echo "[shipsec] Building images locally (SHIPSEC_BUILD_IMAGES=1)..."
  cd "${ROOT_DIR}"
  docker build -t shipsec-backend:dev --target backend .
  docker build -t shipsec-worker:dev --target worker .
  docker build -t shipsec-frontend:dev --target frontend .

  if command -v kind >/dev/null 2>&1; then
    echo "[shipsec] Loading images into kind..."
    kind load docker-image shipsec-backend:dev --name "${KIND_CLUSTER_NAME}"
    kind load docker-image shipsec-worker:dev --name "${KIND_CLUSTER_NAME}"
    kind load docker-image shipsec-frontend:dev --name "${KIND_CLUSTER_NAME}"
  fi

  IMAGE_OVERRIDES+=("--set" "backend.image.repository=shipsec-backend")
  IMAGE_OVERRIDES+=("--set" "backend.image.tag=dev")
  IMAGE_OVERRIDES+=("--set" "backend.image.pullPolicy=IfNotPresent")
  IMAGE_OVERRIDES+=("--set" "worker.image.repository=shipsec-worker")
  IMAGE_OVERRIDES+=("--set" "worker.image.tag=dev")
  IMAGE_OVERRIDES+=("--set" "worker.image.pullPolicy=IfNotPresent")
  IMAGE_OVERRIDES+=("--set" "frontend.image.repository=shipsec-frontend")
  IMAGE_OVERRIDES+=("--set" "frontend.image.tag=dev")
  IMAGE_OVERRIDES+=("--set" "frontend.image.pullPolicy=IfNotPresent")
fi

echo "[shipsec] Installing infra chart (in-cluster deps for VPS test)..."
helm upgrade --install shipsec-infra "${ROOT_DIR}/deploy/helm/shipsec-infra" \
  --namespace "${SYSTEM_NS}" \
  --kube-context "${KUBE_CONTEXT}" \
  --values "${ROOT_DIR}/deploy/helm/shipsec-infra/values.yaml" \
  --values "${ROOT_DIR}/deploy/helm/shipsec-infra/values/vps.yaml"

echo "[shipsec] Installing app chart (DinD enabled for now)..."
helm upgrade --install shipsec "${ROOT_DIR}/deploy/helm/shipsec" \
  --namespace "${SYSTEM_NS}" \
  --kube-context "${KUBE_CONTEXT}" \
  --values "${ROOT_DIR}/deploy/helm/shipsec/values.yaml" \
  --values "${ROOT_DIR}/deploy/helm/shipsec/values/vps.yaml" \
  --values "${ROOT_DIR}/deploy/helm/shipsec/values/dind.yaml" \
  "${IMAGE_OVERRIDES[@]}"

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
