#!/usr/bin/env bash
set -euo pipefail

echo "📦 Installing ShipSec Studio dependencies..."

# Handle macOS-specific native module build requirements
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "🍎 Detected macOS - setting SDK path for native module compilation..."
  export SDKROOT=$(xcrun --show-sdk-path)
fi

# Run bun install
bun install

echo "✅ Installation complete!"
