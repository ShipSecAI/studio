#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-shipsec}"
ZONE="${ZONE:-us-central1-a}"
CLUSTER_NAME="${CLUSTER_NAME:-shipsec-dev}"
KUBE_CONTEXT="gke_${PROJECT_ID}_${ZONE}_${CLUSTER_NAME}"

SYSTEM_NS="${SYSTEM_NS:-shipsec-system}"

echo "[shipsec] Pods:"
kubectl --context "${KUBE_CONTEXT}" get pods -A

echo "[shipsec] Waiting for core deployments..."
kubectl --context "${KUBE_CONTEXT}" wait --namespace "${SYSTEM_NS}" --for=condition=available deployment/shipsec-backend --timeout=300s
kubectl --context "${KUBE_CONTEXT}" wait --namespace "${SYSTEM_NS}" --for=condition=available deployment/shipsec-frontend --timeout=300s
kubectl --context "${KUBE_CONTEXT}" wait --namespace "${SYSTEM_NS}" --for=condition=available deployment/shipsec-temporal --timeout=420s
kubectl --context "${KUBE_CONTEXT}" wait --namespace "${SYSTEM_NS}" --for=condition=available deployment/shipsec-temporal-ui --timeout=300s
kubectl --context "${KUBE_CONTEXT}" wait --namespace "${SYSTEM_NS}" --for=condition=available deployment/shipsec-redis --timeout=300s
kubectl --context "${KUBE_CONTEXT}" wait --namespace "${SYSTEM_NS}" --for=condition=ready pod -l app.kubernetes.io/component=postgres --timeout=420s
kubectl --context "${KUBE_CONTEXT}" wait --namespace "${SYSTEM_NS}" --for=condition=ready pod -l app.kubernetes.io/component=minio --timeout=420s
kubectl --context "${KUBE_CONTEXT}" wait --namespace "${SYSTEM_NS}" --for=condition=ready pod -l app.kubernetes.io/component=redpanda --timeout=420s

echo "[shipsec] Waiting for DinD..."
kubectl --context "${KUBE_CONTEXT}" wait --namespace shipsec-workloads --for=condition=available deployment/shipsec-dind --timeout=420s

echo "[shipsec] Services:"
kubectl --context "${KUBE_CONTEXT}" --namespace "${SYSTEM_NS}" get svc -o wide

