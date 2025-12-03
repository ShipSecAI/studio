#!/usr/bin/env bash
# install.sh - Cross-platform bootstrap for ShipSecAI/studio
# Usage:
#   ./install.sh [--skip-clone] [--force-docker] [--skip-infra] [-h|--help]

set -euo pipefail
IFS=$'\n\t'

# ---------- Config ----------
REPO_URL="https://github.com/ShipSecAI/studio"
REPO_DIR="studio"
REQUIRED_PORTS=(5433 7233 8081 9000 9001 3100)

# Defaults for flags
SKIP_CLONE=false
FORCE_DOCKER=false
SKIP_INFRA=false

# ---------- Parse args ----------
show_help() {
  cat <<EOF
Usage: $0 [--skip-clone] [--force-docker] [--skip-infra] [-h|--help]

Flags:
  --skip-clone    : don't auto-clone the repo if not already inside it (exit if not present)
  --force-docker  : attempt to start Docker Desktop/daemon even if docker cli appears present
  --skip-infra    : skip running 'just infra-up' and 'just status'
  -h, --help      : show this help
EOF
}

while [ "${#:-0}" -gt 0 ] && [ "${1:-}" != "" ]; do
  case "$1" in
    --skip-clone) SKIP_CLONE=true; shift ;;
    --force-docker) FORCE_DOCKER=true; shift ;;
    --skip-infra) SKIP_INFRA=true; shift ;;
    -h|--help) show_help; exit 0 ;;
    *) echo "Unknown flag: $1"; show_help; exit 1 ;;
  esac
done

# ---------- Colors & helpers ----------
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'
log() { printf "\n${GREEN}==> %s${NC}\n" "$1"; }
info() { printf "${CYAN}%s${NC}\n" "$1"; }
warn() { printf "${YELLOW}WARN:${NC} %s\n" "$1"; }
err() { printf "${RED}ERROR:${NC} %s\n" "$1"; }
command_exists() { command -v "$1" >/dev/null 2>&1; }

# Detect platform
OS_RAW="$(uname -s 2>/dev/null || echo Unknown)"
case "$OS_RAW" in
  Darwin) PLATFORM="macos" ;;
  Linux) PLATFORM="linux" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows-msys" ;;
  *) PLATFORM="unknown" ;;
esac
log "Platform detected: $PLATFORM"

# ---------- Repo check / clone ----------
log "Repository check"
if [ -d .git ] || [ -d backend ] || [ -d frontend ] || [ -d worker ]; then
  info "Repo looks present in current dir: $(pwd)"
else
  if [ "$SKIP_CLONE" = true ]; then
    err "Repo not found and --skip-clone specified. Aborting."
    exit 1
  fi
  if ! command_exists git; then
    err "git required to clone the repo. Install git and re-run."
    exit 1
  fi
  info "Cloning repository from $REPO_URL into '$REPO_DIR'..."
  if [ -d "$REPO_DIR" ]; then
    warn "Target folder '$REPO_DIR' already exists - will attempt to use it."
  else
    git clone "$REPO_URL" "$REPO_DIR" || { err "git clone failed"; exit 1; }
  fi
  cd "$REPO_DIR"
  info "Now in $(pwd)"
fi

PROJECT_ROOT="$(pwd)"
info "Project root: $PROJECT_ROOT"

# ---------- Docker CLI install helper ----------
install_docker_cli() {
  info "Attempting to install Docker for $PLATFORM..."
  case "$PLATFORM" in
    macos)
      if command_exists brew; then
        # Prefer Desktop for UX
        brew install --cask docker || brew install docker || warn "brew failed to install Docker"
      else
        warn "Homebrew not found. Install Docker Desktop from https://www.docker.com/products/docker-desktop"
      fi
      ;;
    linux)
      if command_exists apt-get; then
        sudo apt-get update -y || true
        sudo apt-get install -y docker.io docker-compose-plugin || warn "apt-get failed to install docker"
      elif command_exists dnf; then
        sudo dnf install -y docker docker-compose || warn "dnf failed to install docker"
      elif command_exists yum; then
        sudo yum install -y docker docker-compose || warn "yum failed to install docker"
      elif command_exists pacman; then
        sudo pacman -S --noconfirm docker docker-compose || warn "pacman failed to install docker"
      elif command_exists zypper; then
        sudo zypper install -y docker docker-compose || warn "zypper failed to install docker"
      else
        warn "No known package manager to install Docker on this Linux. Install manually from docs."
      fi
      ;;
    windows-msys)
      warn "Attempting best-effort Docker Desktop install via Chocolatey / winget (may require admin)."
      if command_exists choco; then
        choco install -y docker-desktop || warn "choco failed to install Docker Desktop"
      elif command_exists winget; then
        winget install -e --id Docker.DockerDesktop || warn "winget failed to install Docker Desktop"
      else
        warn "No choco/winget found. Install Docker Desktop manually from https://www.docker.com/get-started"
      fi
      ;;
    *)
      warn "Unsupported platform for auto Docker install. Install manually from https://www.docker.com/get-started"
      ;;
  esac
}

# ---------- Docker check + auto-start ----------
log "Docker check & auto-start"

start_docker_desktop() {
  case "$PLATFORM" in
    macos)
      info "Attempting to start Docker Desktop on macOS..."
      open -a Docker >/dev/null 2>&1 || warn "Could not open Docker.app automatically. Start Docker Desktop manually."
      ;;
    windows-msys)
      info "Attempting to start Docker Desktop on Windows..."
      WIN_DOCKER_EXE_PATH='C:\Program Files\Docker\Docker\Docker Desktop.exe'
      powershell.exe -NoProfile -Command "Try { Start-Process -FilePath '$WIN_DOCKER_EXE_PATH' -ErrorAction Stop } Catch { Exit 1 }" >/dev/null 2>&1 || \
      warn "Could not auto-start Docker Desktop. Open it manually."
      ;;
    linux)
      info "Attempting to start Docker daemon on Linux..."
      if command_exists systemctl; then
        sudo systemctl start docker 2>/dev/null || warn "systemctl start docker failed. Try: sudo systemctl start docker"
      elif command_exists service; then
        sudo service docker start 2>/dev/null || warn "service docker start failed"
      else
        warn "No systemctl/service to auto-start docker. Start it manually."
      fi
      ;;
    *)
      warn "Platform not recognized for auto-start; please start Docker manually."
      ;;
  esac
}

DOCKER_OK=false

if ! command_exists docker; then
  warn "docker CLI not found."
  install_docker_cli

  if command_exists docker; then
    info "Docker CLI installed successfully: $(docker --version 2>/dev/null || echo 'unknown version')"
  else
    err "Docker CLI still not found after attempted install. You must install Docker manually from https://www.docker.com/get-started"
    DOCKER_OK=false
  fi
fi

if command_exists docker; then
  info "docker CLI present: $(docker --version 2>/dev/null || echo 'unknown')"

  if [ "$FORCE_DOCKER" = true ]; then
    info "--force-docker set — attempting to (re)start Docker Desktop/daemon"
    start_docker_desktop
  fi

  if docker info >/dev/null 2>&1; then
    info "Docker daemon is running."
    DOCKER_OK=true
  else
    warn "Docker daemon is NOT running. Attempting to start..."
    start_docker_desktop

    ATTEMPTS=30
    while ! docker info >/dev/null 2>&1 && [ $ATTEMPTS -gt 0 ]; do
      sleep 2
      ATTEMPTS=$((ATTEMPTS - 1))
      info "Waiting for Docker to start... ($ATTEMPTS attempts left)"
    done

    if docker info >/dev/null 2>&1; then
      info "Docker daemon is now running."
      DOCKER_OK=true
    else
      err "Docker daemon still not running. Open Docker Desktop / start docker service manually."
      DOCKER_OK=false
    fi
  fi

  if [ "$DOCKER_OK" = true ]; then
    info "Ensure Docker has >= 8GB RAM allocated for the infra stack."
  fi
fi

# ---------- Bun runtime ----------
log "Bun runtime check"
if command_exists bun; then
  info "bun present: $(bun --version 2>/dev/null || echo 'unknown')"
else
  info "bun not found — attempting install (macOS/Linux)"
  if [ "$PLATFORM" = "macos" ] || [ "$PLATFORM" = "linux" ]; then
    if command_exists curl || command_exists wget; then
      if command_exists curl; then
        curl -fsSL https://bun.sh/install | bash || warn "bun install script failed. Install manually: https://bun.sh"
      else
        wget -qO- https://bun.sh/install | bash || warn "bun install script failed. Install manually: https://bun.sh"
      fi
      if [ -f "$HOME/.bun/bin/bun" ]; then
        export PATH="$HOME/.bun/bin:$PATH"
        info "Added ~/.bun/bin to PATH for this session."
      fi
      if command_exists bun; then
        info "bun installed: $(bun --version)"
      else
        warn "bun not available after install. You may need to restart your shell."
      fi
    else
      warn "curl/wget not found; cannot auto-install bun."
    fi
  else
    warn "Automatic bun install unsupported on this platform. Install manually if needed."
  fi
fi

# ---------- Node/npm & PM2 ----------
log "Node/npm & PM2 check"
NPM_PRESENT=false
if command_exists npm; then
  NPM_PRESENT=true
  info "npm present: $(npm --version 2>/dev/null || echo 'unknown')"
fi

if command_exists pm2; then
  info "pm2 present: $(pm2 --version 2>/dev/null || echo 'unknown')"
else
  info "pm2 not found. Attempting install via npm (if available)."
  if [ "$NPM_PRESENT" = true ]; then
    if command_exists sudo && [ "$(id -u)" -ne 0 ]; then
      sudo npm install -g pm2 || warn "npm install -g pm2 failed"
    else
      npm install -g pm2 || warn "npm install -g pm2 failed"
    fi
  else
    if command_exists bun; then
      info "npm missing but bun exists — we'll use bunx pm2 when needed."
    else
      warn "Neither npm nor bun available — can't install pm2 automatically."
    fi
  fi
fi

# ---------- just command ----------
log "Checking 'just' command runner"
if command_exists just; then
  info "just present: $(just --version 2>/dev/null || echo 'unknown')"
else
  info "'just' not found — attempting best-effort install"
  if command_exists brew && [ "$PLATFORM" = "macos" ]; then
    brew install just || warn "brew failed to install just"
  elif command_exists pacman; then
    sudo pacman -S --noconfirm just || warn "pacman failed to install just"
  elif command_exists apt-get; then
    if command_exists cargo; then
      cargo install just || warn "cargo install just failed"
    else
      warn "Install Rust/cargo to get 'just', or follow https://github.com/casey/just"
    fi
  elif [ "$PLATFORM" = "windows-msys" ]; then
    warn "Install 'just' via Scoop/Chocolatey or use WSL for better support."
  else
    warn "Could not auto-install just on this platform."
  fi
fi

# ---------- Port checks ----------
log "Checking required ports: ${REQUIRED_PORTS[*]}"
PORT_ISSUES=0
for p in "${REQUIRED_PORTS[@]}"; do
  if command_exists lsof; then
    if lsof -iTCP:"$p" -sTCP:LISTEN -P -n >/dev/null 2>&1; then
      warn "Port $p is in use."
      PORT_ISSUES=$((PORT_ISSUES+1))
    fi
  elif command_exists ss; then
    if ss -lnt 2>/dev/null | awk '{print $4}' | grep -E ":$p\$" >/dev/null 2>&1; then
      warn "Port $p is in use."
      PORT_ISSUES=$((PORT_ISSUES+1))
    fi
  else
    info "No lsof/ss available to check port $p; skipping."
  fi
done
if [ "$PORT_ISSUES" -gt 0 ]; then
  warn "$PORT_ISSUES required port(s) are already in use. This may block services."
fi

# ---------- Create .env from examples ----------
log "Creating .env files from .env.example (safe copy)"
for sub in backend worker frontend; do
  if [ -d "$sub" ]; then
    if [ -f "$sub/.env" ]; then
      info "$sub/.env exists - skipping"
    else
      if [ -f "$sub/.env.example" ]; then
        cp "$sub/.env.example" "$sub/.env"
        info "Copied $sub/.env.example -> $sub/.env"
      else
        warn "$sub/.env.example missing - skipping $sub"
      fi
    fi
  fi
done

# ---------- Install dependencies ----------
log "Installing dependencies (bun preferred, npm fallback)"

install_deps() {
  local dir="$1"
  if [ ! -d "$dir" ]; then return; fi
  pushd "$dir" >/dev/null
  info "Installing in $dir"
  if command_exists bun; then
    if [ -f bun.lockb ] || [ -f package.json ]; then
      bun install || warn "bun install failed in $dir"
    fi
  elif command_exists npm && [ -f package.json ]; then
    npm install || warn "npm install failed in $dir"
  else
    warn "No bun/npm available to install deps in $dir"
  fi
  popd >/dev/null
}

install_deps "."
install_deps "backend"
install_deps "worker"
install_deps "frontend"

# ---------- Infra bring-up ----------
if [ "$SKIP_INFRA" = true ]; then
  info "--skip-infra set - skipping 'just infra-up' and 'just status'"
else
  log "Bringing up shared infra via 'just infra-up' (Postgres, Temporal, MinIO, Loki)"
  if command_exists just; then
    if [ "$DOCKER_OK" = false ]; then
      warn "Docker not running/available — 'just infra-up' will likely fail."
    fi
    just infra-up || warn "'just infra-up' failed; check Docker and just configuration."
    info "Running 'just status'"
    just status || warn "'just status' reported issues."
  else
    warn "'just' not installed — run 'just infra-up' manually once just is installed."
  fi
fi

# ---------- Run migrations ----------
log "Running migrations"
if command_exists bun; then
  if [ -f package.json ]; then
    bun run migrate || warn "bun run migrate failed"
  elif [ -f backend/package.json ]; then
    bun --cwd backend run migrate || warn "backend migrations failed"
  else
    warn "No package.json found to run migrations"
  fi
elif command_exists npm; then
  if [ -f package.json ]; then
    npm run migrate || warn "npm run migrate failed"
  elif [ -f backend/package.json ]; then
    npm --prefix backend run migrate || warn "backend migrations failed"
  else
    warn "No migrate script found"
  fi
else
  warn "Neither bun nor npm available — skipping migrations"
fi

# ---------- Start with PM2 ----------
log "Starting backend/worker/frontend with PM2 (pm2.config.cjs)"
if [ -f pm2.config.cjs ]; then
  if command_exists pm2; then
    pm2 start pm2.config.cjs || warn "pm2 start failed"
  elif command_exists bun; then
    info "pm2 not installed globally — trying bunx pm2"
    bunx pm2 start pm2.config.cjs || warn "bunx pm2 failed — install pm2 with 'npm i -g pm2'"
  else
    warn "pm2 not installed and no bun to run bunx pm2."
  fi
else
  warn "pm2.config.cjs not present — skipping pm2 start"
fi

# ---------- PM2 status/logs ----------
if command_exists pm2; then
  echo ""
  info "PM2 status:"
  pm2 status || true
  for name in backend worker frontend; do
    if pm2 pid "$name" >/dev/null 2>&1; then
      echo ""
      info "Recent logs for $name:"
      pm2 logs "$name" --lines 50 --nostream || pm2 logs "$name" --lines 50 || true
    fi
  done
else
  warn "pm2 not available — cannot show process status/logs"
fi

# ---------- Dev-run hint ----------
echo ""
info "Frontend dev: bun --cwd frontend dev  OR  (cd frontend && npm run dev)"

# ---------- Summary ----------
echo ""
printf "${GREEN}=== Quick summary / endpoints ===${NC}\n"
echo "Frontend builder -> http://localhost:5173"
echo "Backend API      -> http://localhost:3211"
echo "Temporal UI      -> http://localhost:8081"
echo "MinIO console    -> http://localhost:9001"
echo ""

if [ "${DOCKER_OK:-false}" = false ]; then
  warn "Docker is not running or not available. Infra may not be up. Open Docker and re-run relevant steps if needed."
else
  info "Docker is running — ensure >= 8GB RAM assigned."
fi

echo ""
info "Useful commands:"
echo "  docker ps"
echo "  just --list"
echo "  pm2 status"
echo ""
echo "${GREEN}Install script finished.${NC}"

exit 0