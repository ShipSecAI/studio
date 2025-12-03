#!/usr/bin/env bash
# install.sh - Interactive cross-platform bootstrap for ShipSecAI/studio
# - Works on macOS, Linux, and Windows (WSL / Git Bash / MSYS)
# - Asks before installing any tools (Docker, bun, pm2, just)
# - Asks before cloning the repo
# - Asks before trying to start Docker Desktop/daemon

set -euo pipefail
IFS=$'\n\t'

REPO_URL="https://github.com/ShipSecAI/studio"
REPO_DIR="studio"
REQUIRED_PORTS=(5433 7233 8081 9000 9001 3100)

# ---------- Colors & helpers ----------
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { printf "\n${GREEN}==> %s${NC}\n" "$1"; }
info() { printf "${CYAN}%s${NC}\n" "$1"; }
warn() { printf "${YELLOW}WARN:${NC} %s\n" "$1"; }
err()  { printf "${RED}ERROR:${NC} %s\n" "$1"; }
command_exists() { command -v "$1" >/dev/null 2>&1; }

ask_yes_no() {
  # Usage: ask_yes_no "Question" "default"
  # default: y or n
  local prompt default answer
  prompt="$1"
  default="${2:-n}"

  if [ "$default" = "y" ]; then
    prompt="$prompt [Y/n] "
  else
    prompt="$prompt [y/N] "
  fi

  read -r -p "$prompt" answer || answer=""
  answer="${answer:-$default}"

  case "$answer" in
    y|Y) return 0 ;;
    *)   return 1 ;;
  esac
}

# ---------- Detect platform ----------
OS_RAW="$(uname -s 2>/dev/null || echo Unknown)"
case "$OS_RAW" in
  Darwin) PLATFORM="macos" ;;
  Linux) PLATFORM="linux" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows-msys" ;;
  *) PLATFORM="unknown" ;;
esac
log "Platform detected: $PLATFORM"

# ---------- 1) Repo check / clone ----------
log "Repository check"
if [ -d .git ] || [ -d backend ] || [ -d frontend ] || [ -d worker ]; then
  info "Looks like you're already inside the project repo: $(pwd)"
else
  info "No repo detected in current directory."
  if ask_yes_no "Clone ShipSecAI/studio from GitHub into './$REPO_DIR'?" "y"; then
    if ! command_exists git; then
      err "git is required to clone the repo. Install git and re-run."
      exit 1
    fi
    if [ -d "$REPO_DIR" ]; then
      warn "Directory '$REPO_DIR' already exists, using it as repo folder."
    else
      git clone "$REPO_URL" "$REPO_DIR" || { err "git clone failed"; exit 1; }
    fi
    cd "$REPO_DIR"
    info "Now in $(pwd)"
  else
    err "Repo not present and cloning declined. Cannot continue."
    exit 1
  fi
fi

PROJECT_ROOT="$(pwd)"
info "Project root: $PROJECT_ROOT"

# ---------- 2) Docker helpers (install + start) ----------
install_docker_cli() {
  info "Starting Docker installation flow for $PLATFORM..."
  case "$PLATFORM" in
    macos)
      if ! command_exists brew; then
        warn "Homebrew not found. Please install Docker Desktop manually from https://www.docker.com/products/docker-desktop"
        return
      fi
      info "Using Homebrew to install Docker Desktop (GUI)..."
      brew install --cask docker || warn "brew --cask docker failed. You may need to install Docker Desktop manually."
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
        warn "No known package manager to install Docker automatically. Install it manually from Docker docs."
      fi
      ;;
    windows-msys)
      warn "On Windows, this script can try choco/winget for Docker Desktop, but it may need admin."
      if command_exists choco; then
        choco install -y docker-desktop || warn "choco failed to install Docker Desktop"
      elif command_exists winget; then
        winget install -e --id Docker.DockerDesktop || warn "winget failed to install Docker Desktop"
      else
        warn "No choco/winget found. Install Docker Desktop manually from https://www.docker.com/get-started"
      fi
      ;;
    *)
      warn "Platform unknown. Please install Docker manually from https://www.docker.com/get-started"
      ;;
  esac
}

start_docker_daemon() {
  case "$PLATFORM" in
    macos)
      info "Trying to start Docker Desktop on macOS..."
      open -a Docker >/dev/null 2>&1 || warn "Couldn't auto-open Docker.app. Start Docker Desktop manually."
      ;;
    windows-msys)
      info "Trying to start Docker Desktop on Windows..."
      WIN_DOCKER_EXE_PATH='C:\Program Files\Docker\Docker\Docker Desktop.exe'
      powershell.exe -NoProfile -Command "Try { Start-Process -FilePath '$WIN_DOCKER_EXE_PATH' -ErrorAction Stop } Catch { Exit 1 }" >/dev/null 2>&1 || \
        warn "Couldn't auto-start Docker Desktop. Start it manually."
      ;;
    linux)
      info "Trying to start docker service on Linux..."
      if command_exists systemctl; then
        sudo systemctl start docker 2>/dev/null || warn "systemctl start docker failed. Try: sudo systemctl start docker"
      elif command_exists service; then
        sudo service docker start 2>/dev/null || warn "service docker start failed"
      else
        warn "No systemctl/service available to start docker; start it manually."
      fi
      ;;
    *)
      warn "Don't know how to auto-start Docker on this platform. Start it manually."
      ;;
  esac
}

# ---------- 3) Docker flow (interactive) ----------
log "Docker CLI & daemon"
DOCKER_OK=false

if ! command_exists docker; then
  warn "docker CLI is not installed."
  if ask_yes_no "Do you want this script to attempt installing Docker now?" "n"; then
    install_docker_cli
  else
    warn "Docker will NOT be installed by this script. Infra-related steps may fail."
  fi
fi

if command_exists docker; then
  info "docker CLI: $(docker --version 2>/dev/null || echo 'version unknown')"

  if docker info >/dev/null 2>&1; then
    info "Docker daemon is running."
    DOCKER_OK=true
  else
    warn "Docker daemon is NOT running."
    if ask_yes_no "Do you want this script to try starting Docker now?" "y"; then
      start_docker_daemon
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
        warn "Docker is still not running. You may need to open Docker Desktop manually."
        DOCKER_OK=false
      fi
    else
      warn "Skipping Docker start. Infra that uses Docker may fail."
      DOCKER_OK=false
    fi
  fi

  if [ "$DOCKER_OK" = true ]; then
    info "Make sure Docker has at least ~8GB RAM allocated for this stack."
  fi
else
  warn "Docker CLI not available. Skipping infra steps that depend on it."
fi

# ---------- 4) Bun runtime (interactive) ----------
log "Bun runtime (bun.sh)"

if command_exists bun; then
  info "bun present: $(bun --version 2>/dev/null || echo 'unknown')"
else
  warn "bun runtime not found."
  if [ "$PLATFORM" = "macos" ] || [ "$PLATFORM" = "linux" ]; then
    if ask_yes_no "Install bun via the official bun.sh script now?" "n"; then
      if command_exists curl || command_exists wget; then
        if command_exists curl; then
          curl -fsSL https://bun.sh/install | bash || warn "bun install script failed."
        else
          wget -qO- https://bun.sh/install | bash || warn "bun install script failed."
        fi
        if [ -f "$HOME/.bun/bin/bun" ]; then
          export PATH="$HOME/.bun/bin:$PATH"
          info "Added ~/.bun/bin to PATH for this session."
        fi
        if command_exists bun; then
          info "bun installed: $(bun --version)"
        else
          warn "bun not available on PATH after install. You may need to restart your shell."
        fi
      else
        warn "curl/wget not found. Cannot run bun installer script."
      fi
    else
      warn "Skipping bun installation. If no bun is present, npm will be used where possible."
    fi
  else
    warn "Automatic bun install not configured for this platform. Install manually if desired."
  fi
fi

# ---------- 5) Node/npm & PM2 (interactive install) ----------
log "Node/npm & PM2"

NPM_PRESENT=false
if command_exists npm; then
  NPM_PRESENT=true
  info "npm present: $(npm --version 2>/dev/null || echo 'unknown')"
else
  warn "npm (Node.js) not found. PM2 global installation via npm won't be possible."
fi

if command_exists pm2; then
  info "pm2 present: $(pm2 --version 2>/dev/null || echo 'unknown')"
else
  warn "pm2 (process manager) is not installed."
  if [ "$NPM_PRESENT" = true ]; then
    if ask_yes_no "Install pm2 globally via 'npm install -g pm2'?" "n"; then
      if command_exists sudo && [ "$(id -u)" -ne 0 ]; then
        sudo npm install -g pm2 || warn "npm install -g pm2 failed."
      else
        npm install -g pm2 || warn "npm install -g pm2 failed."
      fi
    else
      warn "Skipping pm2 global install. Script will try using 'bunx pm2' (if bun exists) or skip PM2-based management."
    fi
  else
    warn "No npm found to install pm2. If bun is available, we'll try 'bunx pm2' later."
  fi
fi

# ---------- 6) just command runner (interactive) ----------
log "Checking 'just' command runner"

if command_exists just; then
  info "just present: $(just --version 2>/dev/null || echo 'unknown')"
else
  warn "'just' is not installed. It's used for infra commands like 'just infra-up'."
  if ask_yes_no "Attempt to install 'just' using your platform package manager?" "n"; then
    if [ "$PLATFORM" = "macos" ] && command_exists brew; then
      brew install just || warn "brew install just failed."
    elif command_exists pacman; then
      sudo pacman -S --noconfirm just || warn "pacman install just failed."
    elif command_exists apt-get; then
      if command_exists cargo; then
        cargo install just || warn "cargo install just failed."
      else
        warn "No cargo found. See https://github.com/casey/just for install options."
      fi
    elif [ "$PLATFORM" = "windows-msys" ]; then
      warn "On Windows, install 'just' via Scoop/Chocolatey or use WSL."
    else
      warn "Automatic install for 'just' not configured on this platform."
    fi
  else
    warn "Skipping 'just' installation. Infra steps using 'just' will be skipped."
  fi
fi

# ---------- 7) Port checks (no installs, just info) ----------
log "Checking required ports: ${REQUIRED_PORTS[*]}"
PORT_ISSUES=0
for p in "${REQUIRED_PORTS[@]}"; do
  if command_exists lsof; then
    if lsof -iTCP:"$p" -sTCP:LISTEN -P -n >/dev/null 2>&1; then
      warn "Port $p is already in use."
      PORT_ISSUES=$((PORT_ISSUES+1))
    fi
  elif command_exists ss; then
    if ss -lnt 2>/dev/null | awk '{print $4}' | grep -E ":$p\$" >/dev/null 2>&1; then
      warn "Port $p is already in use."
      PORT_ISSUES=$((PORT_ISSUES+1))
    fi
  else
    info "No lsof/ss available to check port $p; skipping."
  fi
done
if [ "$PORT_ISSUES" -gt 0 ]; then
  warn "$PORT_ISSUES required port(s) are in use. This may block services."
fi

# ---------- 8) Create .env from .env.example ----------
log "Ensuring .env files exist (backend, worker, frontend)"

for sub in backend worker frontend; do
  if [ -d "$sub" ]; then
    if [ -f "$sub/.env" ]; then
      info "$sub/.env already exists - leaving it untouched."
    else
      if [ -f "$sub/.env.example" ]; then
        cp "$sub/.env.example" "$sub/.env"
        info "Created $sub/.env from $sub/.env.example"
      else
        warn "No $sub/.env.example found - skipping."
      fi
    fi
  fi
done

# ---------- 9) Install dependencies (bun / npm) ----------
log "Installing dependencies (bun preferred, npm fallback)"

install_deps() {
  local dir="$1"
  if [ ! -d "$dir" ]; then return; fi

  pushd "$dir" >/dev/null
  info "Installing dependencies in $dir"

  if command_exists bun && [ -f package.json ]; then
    bun install || warn "bun install failed in $dir"
  elif command_exists npm && [ -f package.json ]; then
    npm install || warn "npm install failed in $dir"
  else
    warn "No bun/npm found or no package.json in $dir; skipping."
  fi

  popd >/dev/null
}

install_deps "."
install_deps "backend"
install_deps "worker"
install_deps "frontend"

# ---------- 10) Infra via just (if available & user agrees) ----------
if command_exists just && [ "$DOCKER_OK" = true ]; then
  log "Shared infrastructure (Postgres, Temporal, MinIO, Loki) via 'just'"

  if ask_yes_no "Run 'just infra-up' to start infra services now?" "y"; then
    just infra-up || warn "'just infra-up' failed; check Docker and just configuration."
    if ask_yes_no "Run 'just status' to check infra health?" "y"; then
      just status || warn "'just status' reported issues or failed."
    fi
  else
    warn "Skipping 'just infra-up'. You can run it later manually."
  fi
else
  warn "Either 'just' is not installed or Docker isn't running; skipping infra startup."
fi

# ---------- 11) Run migrations ----------
log "Running database migrations (if scripts exist)"
if command_exists bun && [ -f package.json ]; then
  bun run migrate || warn "bun run migrate failed."
elif command_exists bun && [ -f backend/package.json ]; then
  bun --cwd backend run migrate || warn "bun --cwd backend run migrate failed."
elif command_exists npm && [ -f package.json ]; then
  npm run migrate || warn "npm run migrate failed."
elif command_exists npm && [ -f backend/package.json ]; then
  npm --prefix backend run migrate || warn "backend migrations with npm failed."
else
  warn "No migrate script found or no bun/npm available; skipping migrations."
fi

# ---------- 12) Start services via PM2 ----------
log "Starting backend/worker/frontend via PM2 (pm2.config.cjs)"

if [ -f pm2.config.cjs ]; then
  if command_exists pm2; then
    pm2 start pm2.config.cjs || warn "pm2 start failed."
  elif command_exists bun; then
    warn "pm2 not installed globally. Will try transient 'bunx pm2'."
    bunx pm2 start pm2.config.cjs || warn "bunx pm2 start failed. Consider installing pm2 globally."
  else
    warn "No pm2 or bunx available to manage processes."
  fi
else
  warn "pm2.config.cjs not found. Skipping PM2 start."
fi

# ---------- 13) PM2 status/logs (if available) ----------
if command_exists pm2; then
  echo ""
  info "PM2 status:"
  pm2 status || true

  for name in backend worker frontend; do
    if pm2 pid "$name" >/dev/null 2>&1; then
      echo ""
      info "Last 50 lines for PM2 process '$name':"
      pm2 logs "$name" --lines 50 --nostream || pm2 logs "$name" --lines 50 || true
    fi
  done
else
  warn "pm2 not present, skipping PM2 status/logs."
fi

# ---------- 14) Dev hint & summary ----------
echo ""
info "To run frontend dev server directly:"
echo "  bun --cwd frontend dev"
echo "  # or"
echo "  (cd frontend && npm run dev)"

echo ""
printf "${GREEN}=== Quick endpoints (default) ===${NC}\n"
echo "Frontend builder -> http://localhost:5173"
echo "Backend API      -> http://localhost:3211"
echo "Temporal UI      -> http://localhost:8081"
echo "MinIO console    -> http://localhost:9001"
echo ""

if [ "${DOCKER_OK:-false}" = false ]; then
  warn "Docker is not running or not available. Infra components may not be up."
fi

echo ""
info "You can re-run individual steps manually if needed:"
echo "  - just infra-up / just status"
echo "  - bun run migrate  (or npm run migrate)"
echo "  - pm2 start pm2.config.cjs"
echo "  - bun --cwd frontend dev"
echo ""
echo "${GREEN}Interactive setup complete.${NC}"

exit 0
