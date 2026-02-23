#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKER_DIR="${ROOT_DIR}/worker"
CACHE_DIR="${ROOT_DIR}/.cache"

if ! command -v node >/dev/null 2>&1; then
  echo "⚠️  node not found; skipping node-pty check"
  exit 0
fi

mkdir -p "${CACHE_DIR}"

NODE_VERSION="$(node -v)"
NODE_ABI="$(node -p "process.versions.modules")"
MARKER_FILE="${CACHE_DIR}/node-pty-ok-${NODE_VERSION}-abi${NODE_ABI}"

check_pty() {
  (
    cd "${WORKER_DIR}"
    node - <<'JS'
const pty = require('node-pty');
try {
  const proc = pty.spawn('/usr/bin/true', [], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: process.env,
  });
  proc.onExit(({ exitCode }) => process.exit(exitCode === 0 ? 0 : 1));
} catch {
  process.exit(1);
}
JS
  )
}

if [ -f "${MARKER_FILE}" ] && check_pty; then
  echo "✅ node-pty healthy for ${NODE_VERSION} (ABI ${NODE_ABI})"
  exit 0
fi

if check_pty; then
  touch "${MARKER_FILE}"
  echo "✅ node-pty healthy for ${NODE_VERSION} (ABI ${NODE_ABI})"
  exit 0
fi

echo "⚠️  node-pty health check failed for ${NODE_VERSION} (ABI ${NODE_ABI})"

# During bun postinstall we must not recurse into bun install.
if [ "${npm_lifecycle_event:-}" = "postinstall" ]; then
  echo "⚠️  Skipping auto-repair during postinstall; run 'bun install' once more or start with 'just dev' to auto-heal."
  exit 0
fi

echo "🔧 Attempting auto-repair via bun install..."
(
  cd "${ROOT_DIR}"
  bun install >/dev/null 2>&1 || true
)

if check_pty; then
  touch "${MARKER_FILE}"
  echo "✅ node-pty repaired and healthy"
else
  echo "⚠️  node-pty still failing; worker will fall back to stdio (PTY disabled at runtime)"
fi
