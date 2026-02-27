#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKER_DIR="${ROOT_DIR}/worker"

if ! command -v node >/dev/null 2>&1; then
  echo "⚠️  node not found; skipping node-pty check"
  exit 0
fi

NODE_VERSION="$(node -v)"
NODE_ABI="$(node -p "process.versions.modules")"

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

resolve_node_pty_dir() {
  local node_pty_package_json
  node_pty_package_json="$(node -e "try { process.stdout.write(require.resolve('node-pty/package.json', { paths: ['${WORKER_DIR}'] })); } catch { process.exit(1); }")" || {
    echo "⚠️  node-pty package not found in worker dependency tree"
    return 1
  }
  dirname "${node_pty_package_json}"
}

rebuild_pty() {
  if ! command -v npm >/dev/null 2>&1; then
    echo "⚠️  npm not found; cannot rebuild node-pty"
    return 1
  fi

  local node_pty_dir
  node_pty_dir="$(resolve_node_pty_dir)" || return 1

  (
    cd "${node_pty_dir}"
    npm exec --yes --package=node-gyp node-gyp rebuild >/dev/null 2>&1
  )
}

if check_pty; then
  echo "✅ node-pty healthy for ${NODE_VERSION} (ABI ${NODE_ABI})"
  exit 0
fi

echo "🔧 Rebuilding node-pty native bindings..."
rebuild_pty || true

if check_pty; then
  echo "✅ node-pty repaired and healthy"
else
  echo "⚠️  node-pty still failing; worker will fall back to stdio (PTY disabled at runtime)"
fi
