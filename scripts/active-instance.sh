#!/usr/bin/env bash
# Workspace-scoped "active instance" selector for multi-instance dev & tests.
#
# Usage:
#   ./scripts/active-instance.sh get
#   ./scripts/active-instance.sh set 5
#
# Behavior:
# - Uses .shipsec-instance in repo root
# - Instance must be an integer 0-9

set -euo pipefail

FILE=".shipsec-instance"
CMD="${1:-get}"

die() {
  echo "❌ $*" 1>&2
  exit 1
}

is_digit() {
  [[ "$1" =~ ^[0-9]+$ ]]
}

case "$CMD" in
  get)
    if [ -n "${SHIPSEC_INSTANCE:-}" ]; then
      echo "${SHIPSEC_INSTANCE}"
      exit 0
    fi
    if [ -f "$FILE" ]; then
      val="$(tr -d '[:space:]' < "$FILE" || true)"
      if [ -n "$val" ]; then
        echo "$val"
        exit 0
      fi
    fi
    echo "0"
    ;;
  set)
    val="${2:-}"
    [ -n "$val" ] || die "Missing instance number. Example: ./scripts/active-instance.sh set 5"
    is_digit "$val" || die "Instance must be a number (0-9). Got: $val"
    if [ "$val" -lt 0 ] || [ "$val" -gt 9 ]; then
      die "Instance must be 0-9. Got: $val"
    fi
    echo "$val" > "$FILE"
    echo "✅ Active instance set to $val"
    ;;
  *)
    die "Unknown command: $CMD (expected: get|set)"
    ;;
esac

