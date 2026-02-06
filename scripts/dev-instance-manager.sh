#!/usr/bin/env bash
# Multi-instance dev stack manager for ShipSec Studio
# Handles isolated Docker containers and PM2 processes per instance

set -euo pipefail

# Configuration
INSTANCES_DIR=".instances"

# Base port mappings (plain variables for bash 3.2 compatibility on macOS)
BASE_PORT_FRONTEND=5173
BASE_PORT_BACKEND=3211

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Helper functions
log_info() {
  echo -e "${BLUE}ℹ${NC} $*"
}

log_success() {
  echo -e "${GREEN}✅${NC} $*"
}

log_warn() {
  echo -e "${YELLOW}⚠️${NC} $*"
}

log_error() {
  echo -e "${RED}❌${NC} $*"
}

get_instance_dir() {
  local instance=$1
  echo "$INSTANCES_DIR/instance-$instance"
}

get_port() {
  local port_name=$1
  local instance=$2
  local base_port=""

  case "$port_name" in
    FRONTEND) base_port=$BASE_PORT_FRONTEND ;;
    BACKEND)  base_port=$BASE_PORT_BACKEND ;;
    *)
      log_error "Unknown port: $port_name"
      return 1
      ;;
  esac

  # Port offset: instance N uses base_port + N*100
  echo $((base_port + instance * 100))
}

ensure_instance_dir() {
  local instance=$1
  local inst_dir=$(get_instance_dir "$instance")
  
  if [ ! -d "$inst_dir" ]; then
    mkdir -p "$inst_dir"
    log_info "Created instance directory: $inst_dir"
  fi
}

copy_env_files() {
  local instance=$1
  local inst_dir=$(get_instance_dir "$instance")
  local root_env=".env"

  # Read KEY from repo root .env (first match). Prints empty string if missing.
  get_root_env_value() {
    local key=$1
    if [ ! -f "$root_env" ]; then
      echo ""
      return 0
    fi
    # Keep everything after the first '=' (values can contain '=')
    rg -m1 "^${key}=" "$root_env" 2>/dev/null | sed -E "s/^${key}=//" || true
  }

  # Append KEY=VALUE to dest if KEY is not already present.
  ensure_env_key() {
    local dest=$1
    local key=$2
    local value=$3
    if [ -z "$value" ]; then
      return 0
    fi
    if rg -q "^${key}=" "$dest" 2>/dev/null; then
      return 0
    fi
    echo "${key}=${value}" >> "$dest"
  }
  
  # Copy and modify .env files for this instance
  for app_dir in backend worker frontend; do
    local src_file="$app_dir/.env"
    if [ -f "$src_file" ]; then
      local dest="$inst_dir/${app_dir}.env"
      cp "$src_file" "$dest"
      
      # Ensure each instance points at its own Postgres database.
      # Backend uses quoted DATABASE_URL, worker typically does not.
      if [ "$app_dir" = "backend" ] || [ "$app_dir" = "worker" ]; then
        sed -i.bak -E \
          -e "s|(DATABASE_URL=.*\\/)(shipsec)(\"?)$|\\1shipsec_instance_${instance}\\3|" \
          "$dest"
      fi

      # Ensure secrets/internal auth keys exist for dev processes. These live in repo root `.env`.
      # Keep instance env self-contained so backend/worker don't need to load root `.env` (which
      # contains a default DATABASE_URL and would break isolation).
      if [ "$app_dir" = "backend" ] || [ "$app_dir" = "worker" ]; then
        ensure_env_key "$dest" "INTERNAL_SERVICE_TOKEN" "$(get_root_env_value INTERNAL_SERVICE_TOKEN)"
        ensure_env_key "$dest" "SECRET_STORE_MASTER_KEY" "$(get_root_env_value SECRET_STORE_MASTER_KEY)"
      fi
      
      rm -f "$dest.bak"
      log_success "Created $dest"
    fi
  done
}

get_docker_compose_project_name() {
  local instance=$1
  echo "shipsec-dev-$instance"
}

validate_instance_setup() {
  local instance=$1
  local inst_dir=$(get_instance_dir "$instance")
  
  # Check that all required env files exist
  for env_file in backend worker frontend; do
    if [ ! -f "$inst_dir/${env_file}.env" ]; then
      log_error "Missing $inst_dir/${env_file}.env"
      return 1
    fi
  done
  
  log_success "Instance $instance configuration validated"
  return 0
}

show_instance_info() {
  local instance=$1
  
  echo ""
  echo -e "${BLUE}=== Instance $instance ===${NC}"
  echo "Directory:  $(get_instance_dir "$instance")"
  echo ""
  echo "Ports:"
  echo "  Frontend:    http://localhost:$(get_port FRONTEND $instance)"
  echo "  Backend:     http://localhost:$(get_port BACKEND $instance)"
  echo "  Temporal UI: http://localhost:8081"
  echo ""
  echo "Database:    postgresql://shipsec:shipsec@localhost:5433/shipsec_instance_$instance"
  echo "MinIO API:   http://localhost:9000"
  echo "MinIO UI:    http://localhost:9001"
  echo "Redis:       redis://localhost:6379"
  echo ""
}

initialize_instance() {
  local instance=$1
  
  log_info "Initializing instance $instance..."
  ensure_instance_dir "$instance"
  copy_env_files "$instance"
  
  if validate_instance_setup "$instance"; then
    show_instance_info "$instance"
    log_success "Instance $instance initialized successfully"
    return 0
  else
    log_error "Instance $instance initialization failed"
    return 1
  fi
}

# Main command handler
main() {
  local command=${1:-help}
  local instance=${2:-0}
  
  case "$command" in
    init)
      initialize_instance "$instance"
      ;;
    info)
      show_instance_info "$instance"
      ;;
    ports)
      echo "FRONTEND=$(get_port FRONTEND $instance)"
      echo "BACKEND=$(get_port BACKEND $instance)"
      ;;
    project-name)
      get_docker_compose_project_name "$instance"
      ;;
    *)
      log_error "Unknown command: $command"
      echo "Usage: $0 {init|info|ports|project-name} [instance]"
      exit 1
      ;;
  esac
}

main "$@"
