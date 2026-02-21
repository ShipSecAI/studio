#!/usr/bin/env bash
# Manage per-instance env files for local multi-instance development.
#
# Usage:
#   ./scripts/instance-env.sh init [N] [--force]
#   ./scripts/instance-env.sh update [N]
#   ./scripts/instance-env.sh copy SOURCE DEST [--force]
#   ./scripts/instance-env.sh show [N]

set -euo pipefail

APPS=(backend worker frontend)
BASE_BACKEND_PORT=3211
BASE_FRONTEND_PORT=5173
BASE_DB_NAME="shipsec"
BASE_TEMPORAL_NS="shipsec-dev"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTANCES_DIR="$ROOT_DIR/.instances"

log_info() { echo "[info] $*"; }
log_ok() { echo "[ok]   $*"; }
log_warn() { echo "[warn] $*"; }
log_err() { echo "[err]  $*" >&2; }

fail() {
  log_err "$*"
  exit 1
}

validate_instance() {
  local instance="$1"
  [[ "$instance" =~ ^[0-9]+$ ]] || fail "Instance must be a number 0-9. Got: $instance"
  [ "$instance" -ge 0 ] && [ "$instance" -le 9 ] || fail "Instance must be 0-9. Got: $instance"
}

instance_dir() {
  echo "$INSTANCES_DIR/instance-$1"
}

get_backend_port() {
  echo $((BASE_BACKEND_PORT + $1 * 100))
}

get_frontend_port() {
  echo $((BASE_FRONTEND_PORT + $1 * 100))
}

get_db_name() {
  if [ "$1" -eq 0 ]; then
    echo "$BASE_DB_NAME"
  else
    echo "${BASE_DB_NAME}_instance_$1"
  fi
}

get_temporal_ns() {
  if [ "$1" -eq 0 ]; then
    echo "$BASE_TEMPORAL_NS"
  else
    echo "${BASE_TEMPORAL_NS}-$1"
  fi
}

get_db_url() {
  echo "postgresql://shipsec:shipsec@localhost:5433/$(get_db_name "$1")"
}

get_studio_api_url() {
  echo "http://localhost:$(get_backend_port "$1")/api/v1"
}

get_vite_api_url() {
  echo "http://localhost:$(get_backend_port "$1")"
}

resolve_source_env() {
  local app="$1"
  local env_path="$ROOT_DIR/$app/.env"
  local example_path="$ROOT_DIR/$app/.env.example"

  if [ -f "$env_path" ]; then
    echo "$env_path"
  elif [ -f "$example_path" ]; then
    echo "$example_path"
  else
    echo ""
  fi
}

set_var() {
  local file="$1"
  local key="$2"
  local value="$3"

  if grep -qE "^${key}=" "$file" 2>/dev/null; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file"
    rm -f "${file}.bak"
  else
    printf '\n%s=%s\n' "$key" "$value" >>"$file"
  fi
}

apply_instance_vars() {
  local file="$1"
  local instance="$2"
  local app="$3"

  set_var "$file" "DATABASE_URL" "$(get_db_url "$instance")"
  set_var "$file" "TEMPORAL_NAMESPACE" "$(get_temporal_ns "$instance")"
  set_var "$file" "TEMPORAL_TASK_QUEUE" "$(get_temporal_ns "$instance")"

  case "$app" in
    backend)
      set_var "$file" "PORT" "$(get_backend_port "$instance")"
      ;;
    worker)
      set_var "$file" "STUDIO_API_BASE_URL" "$(get_studio_api_url "$instance")"
      ;;
    frontend)
      set_var "$file" "VITE_API_URL" "$(get_vite_api_url "$instance")"
      ;;
    *)
      fail "Unknown app: $app"
      ;;
  esac
}

show_summary() {
  local instance="$1"

  echo "Backend port:  $(get_backend_port "$instance")"
  echo "Frontend port: $(get_frontend_port "$instance")"
  echo "Database:      $(get_db_name "$instance")"
  echo "Temporal NS:   $(get_temporal_ns "$instance")"
  echo "API URL:       $(get_vite_api_url "$instance")"
  echo "Studio API:    $(get_studio_api_url "$instance")"
}

parse_init_args() {
  local instance=""
  local force="false"

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --force)
        force="true"
        ;;
      *)
        if [ -z "$instance" ]; then
          instance="$1"
        else
          fail "Unexpected argument: $1"
        fi
        ;;
    esac
    shift
  done

  if [ -z "$instance" ]; then
    instance="0"
  fi

  printf '%s %s\n' "$instance" "$force"
}

cmd_init() {
  local parsed
  parsed="$(parse_init_args "$@")"
  local instance
  local force
  instance="$(echo "$parsed" | awk '{print $1}')"
  force="$(echo "$parsed" | awk '{print $2}')"

  validate_instance "$instance"

  local dir
  dir="$(instance_dir "$instance")"
  mkdir -p "$dir"

  log_info "Initializing env files for instance $instance"

  for app in "${APPS[@]}"; do
    local dest="$dir/$app.env"

    if [ -f "$dest" ] && [ "$force" = "false" ]; then
      log_warn "$app.env already exists (use --force to overwrite)"
      continue
    fi

    local src
    src="$(resolve_source_env "$app")"
    if [ -z "$src" ]; then
      log_warn "No source found for $app (.env or .env.example)"
      continue
    fi

    cp "$src" "$dest"
    apply_instance_vars "$dest" "$instance" "$app"
    if [ "$force" = "true" ]; then
      log_ok "$app.env overwritten"
    else
      log_ok "$app.env created"
    fi
  done

  log_info "Env files path: $dir"
  show_summary "$instance"
}

cmd_update() {
  local instance="${1:-0}"
  [ "$#" -le 1 ] || fail "Usage: ./scripts/instance-env.sh update [N]"
  validate_instance "$instance"

  local dir
  dir="$(instance_dir "$instance")"

  for app in "${APPS[@]}"; do
    local file="$dir/$app.env"
    [ -f "$file" ] || fail "Missing $file. Run: ./scripts/instance-env.sh init $instance"
  done

  for app in "${APPS[@]}"; do
    local file="$dir/$app.env"
    apply_instance_vars "$file" "$instance" "$app"
    log_ok "$app.env updated"
  done

  show_summary "$instance"
}

cmd_copy() {
  local src="${1:-}"
  local dest="${2:-}"
  local force="false"

  [ -n "$src" ] && [ -n "$dest" ] || fail "Usage: ./scripts/instance-env.sh copy SOURCE DEST [--force]"

  if [ "${3:-}" = "--force" ]; then
    force="true"
  elif [ "${3:-}" != "" ]; then
    fail "Unexpected argument: ${3}"
  fi

  validate_instance "$src"
  validate_instance "$dest"
  [ "$src" != "$dest" ] || fail "Source and destination must be different"

  local src_dir
  local dest_dir
  src_dir="$(instance_dir "$src")"
  dest_dir="$(instance_dir "$dest")"

  for app in "${APPS[@]}"; do
    [ -f "$src_dir/$app.env" ] || fail "Missing source file: $src_dir/$app.env"
  done

  mkdir -p "$dest_dir"

  for app in "${APPS[@]}"; do
    local target="$dest_dir/$app.env"

    if [ -f "$target" ] && [ "$force" = "false" ]; then
      log_warn "$app.env already exists in destination (use --force to overwrite)"
      continue
    fi

    cp "$src_dir/$app.env" "$target"
    apply_instance_vars "$target" "$dest" "$app"
    log_ok "$app.env copied"
  done

  log_info "Copied from instance $src to $dest"
  show_summary "$dest"
}

cmd_show() {
  local instance="${1:-0}"
  [ "$#" -le 1 ] || fail "Usage: ./scripts/instance-env.sh show [N]"
  validate_instance "$instance"

  local dir
  dir="$(instance_dir "$instance")"

  for app in "${APPS[@]}"; do
    if [ -f "$dir/$app.env" ]; then
      log_ok "$app.env exists"
    else
      log_warn "$app.env missing"
    fi
  done

  show_summary "$instance"
}

usage() {
  cat <<'USAGE'
Instance Env Manager

Commands:
  init [N] [--force]         Create .instances/instance-N/{backend,worker,frontend}.env
  update [N]                 Patch only instance-specific variables
  copy SOURCE DEST [--force] Copy env files between instances, then re-scope values
  show [N]                   Show file presence and effective instance values

Notes:
  - Instance defaults to 0.
  - Source templates are app/.env (preferred) or app/.env.example.
USAGE
}

main() {
  local cmd="${1:-}"
  shift || true

  case "$cmd" in
    init)
      cmd_init "$@"
      ;;
    update)
      cmd_update "$@"
      ;;
    copy)
      cmd_copy "$@"
      ;;
    show)
      cmd_show "$@"
      ;;
    -h|--help|help|"")
      usage
      ;;
    *)
      fail "Unknown command: $cmd"
      ;;
  esac
}

main "$@"
