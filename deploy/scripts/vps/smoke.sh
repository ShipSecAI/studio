#!/usr/bin/env bash
set -euo pipefail

SYSTEM_NS="${SYSTEM_NS:-shipsec-system}"
KUBE_CONTEXT="${KUBE_CONTEXT:-kind-shipsec}"

echo "[shipsec] Pods:"
kubectl --context "${KUBE_CONTEXT}" get pods -A

echo "[shipsec] Waiting for core deployments..."
kubectl --context "${KUBE_CONTEXT}" wait --namespace "${SYSTEM_NS}" --for=condition=available deployment/shipsec-backend --timeout=240s
kubectl --context "${KUBE_CONTEXT}" wait --namespace "${SYSTEM_NS}" --for=condition=available deployment/shipsec-frontend --timeout=240s
kubectl --context "${KUBE_CONTEXT}" wait --namespace "${SYSTEM_NS}" --for=condition=available deployment/shipsec-temporal --timeout=300s
kubectl --context "${KUBE_CONTEXT}" wait --namespace "${SYSTEM_NS}" --for=condition=available deployment/shipsec-temporal-ui --timeout=240s
kubectl --context "${KUBE_CONTEXT}" wait --namespace "${SYSTEM_NS}" --for=condition=available deployment/shipsec-redis --timeout=240s
kubectl --context "${KUBE_CONTEXT}" wait --namespace "${SYSTEM_NS}" --for=condition=ready pod -l app.kubernetes.io/component=postgres --timeout=300s
kubectl --context "${KUBE_CONTEXT}" wait --namespace "${SYSTEM_NS}" --for=condition=ready pod -l app.kubernetes.io/component=minio --timeout=300s
kubectl --context "${KUBE_CONTEXT}" wait --namespace "${SYSTEM_NS}" --for=condition=ready pod -l app.kubernetes.io/component=redpanda --timeout=300s

echo "[shipsec] Waiting for DinD..."
kubectl --context "${KUBE_CONTEXT}" wait --namespace shipsec-workloads --for=condition=available deployment/shipsec-dind --timeout=300s

echo "[shipsec] OK (deployments/pods Ready). To verify HTTP endpoints, use port-forward as printed by install.sh."
