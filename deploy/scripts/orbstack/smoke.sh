#!/usr/bin/env bash
set -euo pipefail

SYSTEM_NS="${SYSTEM_NS:-shipsec-system}"

echo "[shipsec] Pods:"
kubectl get pods -A

echo "[shipsec] Waiting for backend to be Ready..."
kubectl wait --namespace "${SYSTEM_NS}" --for=condition=available deployment/shipsec-backend --timeout=180s

echo "[shipsec] Checking backend health..."
curl -fsS http://localhost:3211/health >/dev/null

echo "[shipsec] OK"

