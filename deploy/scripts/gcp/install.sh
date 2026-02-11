#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

PROJECT_ID="${PROJECT_ID:-shipsec}"
REGION="${REGION:-us-central1}"
ZONE="${ZONE:-us-central1-a}"
CLUSTER_NAME="${CLUSTER_NAME:-shipsec-dev}"
KUBE_CONTEXT="gke_${PROJECT_ID}_${ZONE}_${CLUSTER_NAME}"

SYSTEM_NS="${SYSTEM_NS:-shipsec-system}"
WORKERS_NS="${WORKERS_NS:-shipsec-workers}"
WORKLOADS_NS="${WORKLOADS_NS:-shipsec-workloads}"

AR_REPO="${AR_REPO:-shipsec-studio}"
GIT_SHA="$(git -C "${ROOT_DIR}" rev-parse --short HEAD)"
# Default tag includes a timestamp to avoid amd64/arm64 tag collisions and to
# ensure GKE nodes pull the new image.
IMAGE_TAG="${IMAGE_TAG:-${GIT_SHA}-$(date +%Y%m%d%H%M%S)}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[shipsec] Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd gcloud
require_cmd kubectl
require_cmd helm
require_cmd docker

echo "[shipsec] Configuring gcloud defaults..."
gcloud config set project "${PROJECT_ID}" >/dev/null
gcloud config set compute/region "${REGION}" >/dev/null
gcloud config set compute/zone "${ZONE}" >/dev/null

echo "[shipsec] Fetching GKE credentials..."
gcloud container clusters get-credentials "${CLUSTER_NAME}" --zone "${ZONE}" --project "${PROJECT_ID}" >/dev/null

echo "[shipsec] Ensuring Artifact Registry pull permissions for nodes..."
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
NODE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${NODE_SA}" \
  --role="roles/artifactregistry.reader" \
  --quiet >/dev/null || true

echo "[shipsec] Configuring docker auth for Artifact Registry..."
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet >/dev/null

BACKEND_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/backend:${IMAGE_TAG}"
WORKER_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/worker:${IMAGE_TAG}"
FRONTEND_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/frontend:${IMAGE_TAG}"

echo "[shipsec] Building + pushing backend/worker images (linux/amd64)..."
cd "${ROOT_DIR}"
docker buildx build --platform linux/amd64 --target backend -t "${BACKEND_IMAGE}" --push .
docker buildx build --platform linux/amd64 --target worker -t "${WORKER_IMAGE}" --push .

echo "[shipsec] Creating namespaces (idempotent)..."
kubectl --context "${KUBE_CONTEXT}" get namespace "${SYSTEM_NS}" >/dev/null 2>&1 || kubectl --context "${KUBE_CONTEXT}" create namespace "${SYSTEM_NS}"
kubectl --context "${KUBE_CONTEXT}" get namespace "${WORKERS_NS}" >/dev/null 2>&1 || kubectl --context "${KUBE_CONTEXT}" create namespace "${WORKERS_NS}"
kubectl --context "${KUBE_CONTEXT}" get namespace "${WORKLOADS_NS}" >/dev/null 2>&1 || kubectl --context "${KUBE_CONTEXT}" create namespace "${WORKLOADS_NS}"

echo "[shipsec] Installing infra chart (in-cluster deps, fast path)..."
helm upgrade --install shipsec-infra "${ROOT_DIR}/deploy/helm/shipsec-infra" \
  --namespace "${SYSTEM_NS}" \
  --kube-context "${KUBE_CONTEXT}" \
  --values "${ROOT_DIR}/deploy/helm/shipsec-infra/values.yaml" \
  --values "${ROOT_DIR}/deploy/helm/shipsec-infra/values/gke-dev.yaml"

echo "[shipsec] Installing app chart (backend/worker first; frontend later)..."
helm upgrade --install shipsec "${ROOT_DIR}/deploy/helm/shipsec" \
  --namespace "${SYSTEM_NS}" \
  --kube-context "${KUBE_CONTEXT}" \
  --values "${ROOT_DIR}/deploy/helm/shipsec/values.yaml" \
  --values "${ROOT_DIR}/deploy/helm/shipsec/values/gke-dev.yaml" \
  --values "${ROOT_DIR}/deploy/helm/shipsec/values/dind.yaml" \
  --set "frontend.enabled=false" \
  --set "backend.image.repository=${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/backend" \
  --set "backend.image.tag=${IMAGE_TAG}" \
  --set "backend.image.pullPolicy=IfNotPresent" \
  --set "worker.image.repository=${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/worker" \
  --set "worker.image.tag=${IMAGE_TAG}" \
  --set "worker.image.pullPolicy=IfNotPresent"

echo "[shipsec] Waiting for backend service external IP..."
BACKEND_IP=""
for _ in $(seq 1 60); do
  BACKEND_IP="$(kubectl --context "${KUBE_CONTEXT}" -n "${SYSTEM_NS}" get svc shipsec-backend -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
  if [[ -n "${BACKEND_IP}" ]]; then
    break
  fi
  sleep 5
done

if [[ -z "${BACKEND_IP}" ]]; then
  echo "[shipsec] Backend LoadBalancer IP not assigned yet. You can check:" >&2
  echo "  kubectl --context ${KUBE_CONTEXT} -n ${SYSTEM_NS} get svc shipsec-backend -o wide" >&2
  exit 1
fi

echo "[shipsec] Backend external IP: ${BACKEND_IP}"

echo "[shipsec] Building + pushing frontend image (linux/amd64; VITE_API_URL points to backend LB)..."
docker buildx build --platform linux/amd64 \
  --target frontend \
  -t "${FRONTEND_IMAGE}" \
  --build-arg "VITE_API_URL=http://${BACKEND_IP}:3211" \
  --build-arg "VITE_BACKEND_URL=http://${BACKEND_IP}:3211" \
  --push \
  .

echo "[shipsec] Enabling frontend deployment..."
helm upgrade --install shipsec "${ROOT_DIR}/deploy/helm/shipsec" \
  --namespace "${SYSTEM_NS}" \
  --kube-context "${KUBE_CONTEXT}" \
  --values "${ROOT_DIR}/deploy/helm/shipsec/values.yaml" \
  --values "${ROOT_DIR}/deploy/helm/shipsec/values/gke-dev.yaml" \
  --values "${ROOT_DIR}/deploy/helm/shipsec/values/dind.yaml" \
  --set "frontend.enabled=true" \
  --set "backend.image.repository=${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/backend" \
  --set "backend.image.tag=${IMAGE_TAG}" \
  --set "backend.image.pullPolicy=IfNotPresent" \
  --set "worker.image.repository=${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/worker" \
  --set "worker.image.tag=${IMAGE_TAG}" \
  --set "worker.image.pullPolicy=IfNotPresent" \
  --set "frontend.image.repository=${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/frontend" \
  --set "frontend.image.tag=${IMAGE_TAG}" \
  --set "frontend.image.pullPolicy=IfNotPresent"

echo "[shipsec] Done. Check services:"
echo "  kubectl --context ${KUBE_CONTEXT} -n ${SYSTEM_NS} get svc -o wide"
