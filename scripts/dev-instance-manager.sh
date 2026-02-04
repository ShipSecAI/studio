#!/usr/bin/env bash
# Multi-instance dev stack manager for ShipSec Studio
# Handles isolated Docker containers and PM2 processes per instance

set -euo pipefail

# Configuration
INSTANCES_DIR=".instances"

# Base port mappings
declare -A BASE_PORTS=(
  [FRONTEND]=5173
  [BACKEND]=3211
  [TEMPORAL_CLIENT]=7233
  [TEMPORAL_UI]=8081
  [POSTGRES]=5433
  [MINIO_API]=9000
  [MINIO_CONSOLE]=9001
  [REDIS]=6379
  [LOKI]=3100
  [REDPANDA]=9092
  [REDPANDA_UI]=8082
)

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
  local base_port="${BASE_PORTS[$port_name]}"
  
  if [[ -z "$base_port" ]]; then
    log_error "Unknown port: $port_name"
    return 1
  fi
  
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
  
  # Copy and modify .env files for this instance
  for app_dir in backend worker frontend; do
    local src_file="$app_dir/.env"
    if [ -f "$src_file" ]; then
      local dest="$inst_dir/${app_dir}.env"
      cp "$src_file" "$dest"
      
      # Modify port references in env files
      sed -i.bak \
        -e "s|:5173|:$(get_port FRONTEND $instance)|g" \
        -e "s|:3211|:$(get_port BACKEND $instance)|g" \
        -e "s|:7233|:$(get_port TEMPORAL_CLIENT $instance)|g" \
        -e "s|:8081|:$(get_port TEMPORAL_UI $instance)|g" \
        -e "s|:5433|:$(get_port POSTGRES $instance)|g" \
        -e "s|:9000|:$(get_port MINIO_API $instance)|g" \
        -e "s|:9001|:$(get_port MINIO_CONSOLE $instance)|g" \
        -e "s|:6379|:$(get_port REDIS $instance)|g" \
        -e "s|:3100|:$(get_port LOKI $instance)|g" \
        -e "s|:9092|:$(get_port REDPANDA $instance)|g" \
        -e "s|:8082|:$(get_port REDPANDA_UI $instance)|g" \
        "$dest"
      
      # For backend: update database URL to instance-specific database
      if [ "$app_dir" = "backend" ]; then
        sed -i.bak \
          -e "s|/shipsec\"|/shipsec_instance_$instance\"|g" \
          "$dest"
        rm -f "$dest.bak"
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

create_docker_compose_override() {
  local instance=$1
  local inst_dir=$(get_instance_dir "$instance")
  local override_file="$inst_dir/docker-compose.override.yml"
  
  # Create docker-compose override for port mappings
  cat > "$override_file" << EOF
# Instance $instance Docker Compose Override
# Auto-generated - do not edit manually
version: '3.8'

services:
  postgres:
    ports:
      - "$(get_port POSTGRES $instance):5432"
  
  temporal:
    ports:
      - "$(get_port TEMPORAL_CLIENT $instance):7233"
  
  temporal-ui:
    ports:
      - "$(get_port TEMPORAL_UI $instance):8080"
  
  minio:
    ports:
      - "$(get_port MINIO_API $instance):9000"
      - "$(get_port MINIO_CONSOLE $instance):9001"
  
  redis:
    ports:
      - "$(get_port REDIS $instance):6379"
  
  loki:
    ports:
      - "$(get_port LOKI $instance):3100"
  
  redpanda:
    ports:
      - "$(get_port REDPANDA $instance):9092"
  
  redpanda-console:
    ports:
      - "$(get_port REDPANDA_UI $instance):8080"
EOF
  
  log_success "Created docker-compose override: $override_file"
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
  local project=$(get_docker_compose_project_name "$instance")
  
  echo ""
  echo -e "${BLUE}=== Instance $instance ===${NC}"
  echo "Project:    $project"
  echo "Directory:  $(get_instance_dir "$instance")"
  echo ""
  echo "Ports:"
  echo "  Frontend:    http://localhost:$(get_port FRONTEND $instance)"
  echo "  Backend:     http://localhost:$(get_port BACKEND $instance)"
  echo "  Temporal UI: http://localhost:$(get_port TEMPORAL_UI $instance)"
  echo ""
  echo "Database:    postgres://shipsec:shipsec@localhost:$(get_port POSTGRES $instance)/shipsec"
  echo "MinIO API:   http://localhost:$(get_port MINIO_API $instance)"
  echo "MinIO UI:    http://localhost:$(get_port MINIO_CONSOLE $instance)"
  echo "Redis:       redis://localhost:$(get_port REDIS $instance)"
  echo ""
}

initialize_instance() {
  local instance=$1
  
  log_info "Initializing instance $instance..."
  ensure_instance_dir "$instance"
  copy_env_files "$instance"
  create_docker_compose_override "$instance"
  
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
      echo "TEMPORAL_CLIENT=$(get_port TEMPORAL_CLIENT $instance)"
      echo "TEMPORAL_UI=$(get_port TEMPORAL_UI $instance)"
      echo "POSTGRES=$(get_port POSTGRES $instance)"
      echo "MINIO_API=$(get_port MINIO_API $instance)"
      echo "MINIO_CONSOLE=$(get_port MINIO_CONSOLE $instance)"
      echo "REDIS=$(get_port REDIS $instance)"
      echo "LOKI=$(get_port LOKI $instance)"
      echo "REDPANDA=$(get_port REDPANDA $instance)"
      echo "REDPANDA_UI=$(get_port REDPANDA_UI $instance)"
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
