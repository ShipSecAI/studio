#!/usr/bin/env bash
# Instance environment manager for multi-instance dev setups.
#
# Usage:
#   ./scripts/instance-env.sh init [N] [--force]
#   ./scripts/instance-env.sh update [N]
#   ./scripts/instance-env.sh copy [SOURCE] [DEST] [--force]
#   ./scripts/instance-env.sh show [N]
#
# Instance 0 keeps default values (no port offset, default DB name).

set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}info${NC}  $*"; }
log_success() { echo -e "${GREEN}ok${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}warn${NC}  $*"; }
log_error()   { echo -e "${RED}err${NC}   $*"; }
log_skip()    { echo -e "${DIM}skip${NC}  $*"; }
log_step()    { echo -e "${CYAN}>>>${NC}   ${BOLD}$*${NC}"; }

# ── Constants ───────────────────────────────────────────────────────
APPS=(backend worker frontend)
BASE_BACKEND_PORT=3211
BASE_FRONTEND_PORT=5173
BASE_DB_NAME="shipsec"
BASE_TEMPORAL_NS="shipsec-dev"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTANCES_DIR="$ROOT_DIR/.instances"

# ── Helpers ─────────────────────────────────────────────────────────

die() { log_error "$@"; exit 1; }

validate_instance() {
  local n="$1"
  [[ "$n" =~ ^[0-9]+$ ]] || die "Instance must be a number (0-9). Got: $n"
  [ "$n" -ge 0 ] && [ "$n" -le 9 ] || die "Instance must be 0-9. Got: $n"
}

instance_dir() { echo "$INSTANCES_DIR/instance-$1"; }

# Compute instance-specific values
get_backend_port()    { echo $(( BASE_BACKEND_PORT + $1 * 100 )); }
get_frontend_port()   { echo $(( BASE_FRONTEND_PORT + $1 * 100 )); }
get_db_name()         { if [ "$1" -eq 0 ]; then echo "$BASE_DB_NAME"; else echo "${BASE_DB_NAME}_instance_$1"; fi; }
get_temporal_ns()     { if [ "$1" -eq 0 ]; then echo "$BASE_TEMPORAL_NS"; else echo "${BASE_TEMPORAL_NS}-$1"; fi; }
get_db_url()          { echo "postgresql://shipsec:shipsec@localhost:5433/$(get_db_name "$1")"; }
get_studio_api_url()  { echo "http://localhost:$(get_backend_port "$1")/api/v1"; }
get_vite_api_url()    { echo "http://localhost:$(get_backend_port "$1")"; }

# Pick source file: prefer .env, fall back to .env.example
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

# Apply instance-specific substitutions to an env file in-place.
# Only touches the known instance-scoped variables; everything else is preserved.
apply_instance_vars() {
  local file="$1"
  local n="$2"
  local app="$3"

  local db_url; db_url="$(get_db_url "$n")"
  local backend_port; backend_port="$(get_backend_port "$n")"
  local temporal_ns; temporal_ns="$(get_temporal_ns "$n")"

  # Helper: set KEY=VALUE in file. If key exists, replace its value. If not, skip.
  set_var() {
    local key="$1" val="$2" target="$3"
    if grep -qE "^${key}=" "$target" 2>/dev/null; then
      # Use | as sed delimiter to avoid issues with / in URLs
      sed -i.bak "s|^${key}=.*|${key}=${val}|" "$target"
      rm -f "${target}.bak"
    fi
  }

  # Common vars (backend + worker both have these)
  set_var "DATABASE_URL" "$db_url" "$file"
  set_var "TEMPORAL_NAMESPACE" "$temporal_ns" "$file"
  set_var "TEMPORAL_TASK_QUEUE" "$temporal_ns" "$file"

  case "$app" in
    backend)
      set_var "PORT" "$backend_port" "$file"
      ;;
    worker)
      set_var "STUDIO_API_BASE_URL" "$(get_studio_api_url "$n")" "$file"
      ;;
    frontend)
      set_var "VITE_API_URL" "$(get_vite_api_url "$n")" "$file"
      ;;
  esac
}

# ── Commands ────────────────────────────────────────────────────────

cmd_init() {
  local n="${1:-0}"
  local force=false
  [ "${2:-}" = "--force" ] && force=true

  validate_instance "$n"

  local dir; dir="$(instance_dir "$n")"
  mkdir -p "$dir"

  log_step "Initializing env files for instance ${BOLD}$n${NC}"
  echo ""

  for app in "${APPS[@]}"; do
    local dest="$dir/$app.env"

    if [ -f "$dest" ] && [ "$force" = false ]; then
      log_skip "$app.env already exists ${DIM}(use --force to overwrite)${NC}"
      continue
    fi

    local src; src="$(resolve_source_env "$app")"
    if [ -z "$src" ]; then
      log_warn "No source found for $app (checked .env and .env.example)"
      continue
    fi

    local src_label="${src#$ROOT_DIR/}"
    cp "$src" "$dest"
    apply_instance_vars "$dest" "$n" "$app"

    if [ "$force" = true ] && [ -f "$dest" ]; then
      log_success "$app.env ${YELLOW}overwritten${NC} from ${DIM}$src_label${NC}"
    else
      log_success "$app.env created from ${DIM}$src_label${NC}"
    fi
  done

  echo ""
  log_info "Instance $n env files at: ${DIM}$dir/${NC}"
  cmd_show_summary "$n"
}

cmd_update() {
  local n="${1:-0}"
  validate_instance "$n"

  local dir; dir="$(instance_dir "$n")"

  log_step "Updating instance-specific vars for instance ${BOLD}$n${NC}"
  echo ""

  local missing=false
  for app in "${APPS[@]}"; do
    local file="$dir/$app.env"
    if [ ! -f "$file" ]; then
      log_error "$app.env not found"
      missing=true
    fi
  done

  if [ "$missing" = true ]; then
    echo ""
    die "Missing env files. Run first: ${BOLD}./scripts/instance-env.sh init $n${NC}"
  fi

  for app in "${APPS[@]}"; do
    local file="$dir/$app.env"
    apply_instance_vars "$file" "$n" "$app"
    log_success "$app.env updated"
  done

  echo ""
  cmd_show_summary "$n"
}

cmd_copy() {
  local src_n="${1:-}"
  local dest_n="${2:-}"
  local force=false
  [ "${3:-}" = "--force" ] && force=true

  [ -n "$src_n" ] && [ -n "$dest_n" ] || die "Usage: instance-env.sh copy SOURCE DEST [--force]"

  validate_instance "$src_n"
  validate_instance "$dest_n"
  [ "$src_n" != "$dest_n" ] || die "Source and destination must be different"

  local src_dir; src_dir="$(instance_dir "$src_n")"
  local dest_dir; dest_dir="$(instance_dir "$dest_n")"

  log_step "Copying env files: instance ${BOLD}$src_n${NC} -> instance ${BOLD}$dest_n${NC}"
  echo ""

  # Verify source exists
  for app in "${APPS[@]}"; do
    [ -f "$src_dir/$app.env" ] || die "Source $app.env not found at $src_dir/"
  done

  mkdir -p "$dest_dir"

  for app in "${APPS[@]}"; do
    local dest="$dest_dir/$app.env"

    if [ -f "$dest" ] && [ "$force" = false ]; then
      log_skip "$app.env already exists at destination ${DIM}(use --force to overwrite)${NC}"
      continue
    fi

    cp "$src_dir/$app.env" "$dest"
    apply_instance_vars "$dest" "$dest_n" "$app"

    if [ "$force" = true ]; then
      log_success "$app.env copied and ${YELLOW}overwritten${NC}"
    else
      log_success "$app.env copied"
    fi
  done

  echo ""
  log_info "API keys, secrets, and feature flags preserved from instance $src_n"
  log_info "Instance-specific vars (ports, DB, Temporal) updated for instance $dest_n"
  echo ""
  cmd_show_summary "$dest_n"
}

cmd_show() {
  local n="${1:-0}"
  validate_instance "$n"
  local dir; dir="$(instance_dir "$n")"

  log_step "Instance ${BOLD}$n${NC} configuration"
  echo ""

  # File status
  for app in "${APPS[@]}"; do
    if [ -f "$dir/$app.env" ]; then
      log_success "$app.env ${DIM}exists${NC}"
    else
      log_warn "$app.env ${RED}missing${NC}"
    fi
  done

  echo ""
  cmd_show_summary "$n"
}

# Compact summary of instance-specific values
cmd_show_summary() {
  local n="$1"
  echo -e "  ${DIM}Backend port:${NC}     $(get_backend_port "$n")"
  echo -e "  ${DIM}Frontend port:${NC}    $(get_frontend_port "$n")"
  echo -e "  ${DIM}Database:${NC}         $(get_db_name "$n")"
  echo -e "  ${DIM}Temporal NS:${NC}      $(get_temporal_ns "$n")"
  echo -e "  ${DIM}API URL:${NC}          $(get_vite_api_url "$n")"
  echo -e "  ${DIM}Studio API:${NC}       $(get_studio_api_url "$n")"
}

# ── Usage ───────────────────────────────────────────────────────────

usage() {
  echo -e "${BOLD}Instance Env Manager${NC}"
  echo ""
  echo -e "  ${CYAN}init${NC}   [N] [--force]          Generate env files from .env (or .env.example)"
  echo -e "  ${CYAN}update${NC} [N]                    Patch instance-specific vars in existing files"
  echo -e "  ${CYAN}copy${NC}   [SOURCE] [DEST] [--force]  Copy env from one instance to another"
  echo -e "  ${CYAN}show${NC}   [N]                    Display current instance config"
  echo ""
  echo -e "  Instance 0 keeps default values (no offset)."
  echo -e "  Each instance N gets port +N*100, DB suffix, and Temporal namespace."
}

# ── Main ────────────────────────────────────────────────────────────

CMD="${1:-}"
shift || true

case "$CMD" in
  init)   cmd_init "$@" ;;
  update) cmd_update "$@" ;;
  copy)   cmd_copy "$@" ;;
  show)   cmd_show "$@" ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    die "Unknown command: $CMD (see --help)"
    ;;
esac
