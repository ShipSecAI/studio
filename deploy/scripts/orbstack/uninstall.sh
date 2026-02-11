#!/usr/bin/env bash
set -euo pipefail

SYSTEM_NS="${SYSTEM_NS:-shipsec-system}"

echo "[shipsec] Uninstalling app chart..."
helm uninstall shipsec --namespace "${SYSTEM_NS}" || true

echo "[shipsec] Uninstalling infra chart..."
helm uninstall shipsec-infra --namespace "${SYSTEM_NS}" || true

echo "[shipsec] Done."

