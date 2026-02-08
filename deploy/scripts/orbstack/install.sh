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

echo "[shipsec] Installing infra chart..."
helm upgrade --install shipsec-infra "${ROOT_DIR}/deploy/helm/shipsec-infra" \
  --namespace "${SYSTEM_NS}" \
  --values "${ROOT_DIR}/deploy/helm/shipsec-infra/values/local-orbstack.yaml"

echo "[shipsec] Installing app chart..."
helm upgrade --install shipsec "${ROOT_DIR}/deploy/helm/shipsec" \
  --namespace "${SYSTEM_NS}" \
  --values "${ROOT_DIR}/deploy/helm/shipsec/values/local-orbstack.yaml" \
  --values "${ROOT_DIR}/deploy/helm/shipsec/values/dind.yaml"

echo "[shipsec] Done."

