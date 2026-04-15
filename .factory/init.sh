#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

bun install
SHIPSEC_INSTANCE=2 just instance-env init 2 >/dev/null
SHIPSEC_INSTANCE=2 just instance-env show 2 >/dev/null
