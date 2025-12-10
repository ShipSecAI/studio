#!/usr/bin/env bash
# install.sh - Interactive bootstrap for ShipSecAI/studio
# Works on macOS, Linux, and Windows (WSL / Git Bash / MSYS)
# Matches README flow:
#   1) just init
#   2) just dev

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

# ---------- 1) Repo detection / clone ----------
log "Repository check"

IN_REPO=false
if [ -d .git ] || [ -f justfile ] || [ -f Justfile ]; then
  IN_REPO=true
else
  # common case: user runs from parent folder that already has ./studio
  if [ -d "$REPO_DIR" ] && [ -d "$REPO_DIR/.git" -o -f "$REPO_DIR/justfile" -o -f "$REPO_DIR/Justfile" ]; then
    info "Detected existing repo in ./$REPO_DIR"
    if ask_yes_no "Use './$REPO_DIR' and cd into it?" "y"; then
      cd "$REPO_DIR"
      IN_REPO=true
    fi
  fi
fi

if [ "$IN_REPO" = false ]; then
  info "No repo detected in current directory."
  if ask_yes_no "Clone ShipSecAI/studio into './$REPO_DIR' now?" "y"; then
    if ! command_exists git; then
      err "git is required to clone the repo. Please install git and rerun."
      exit 1
    fi
    if [ -d "$REPO_DIR" ]; then
      warn "Directory '$REPO_DIR' already exists, using it as repo folder."
    else
      git clone "$REPO_URL" "$REPO_DIR" || { err "git clone failed"; exit 1; }
    fi
    cd "$REPO_DIR"
  else
    err "Cannot continue without the repository. Exiting."
    exit 1
  fi
fi

PROJECT_ROOT="$(pwd)"
info "Project root: $PROJECT_ROOT"

# ---------- 2) Docker helpers ----------
install_docker_cli() {
  info "Attempting Docker install for $PLATFORM..."
  case "$PLATFORM" in
    macos)
      if command_exists brew; then
        brew install --cask docker || warn "brew failed to install Docker Desktop."
      else
        warn "Homebrew not found. Install Docker Desktop manually: https://www.docker.com/products/docker-desktop"
      fi
      ;;
    linux)
      if command_exists apt-get; then
        sudo apt-get update -y || true
        sudo apt-get install -y docker.io docker-compose-plugin || warn "apt-get failed to install docker."
      elif command_exists dnf; then
        sudo dnf install -y docker docker-compose || warn "dnf failed to install docker."
      elif command_exists yum; then
        sudo yum install -y docker docker-compose || warn "yum failed to install docker."
      elif command_exists pacman; then
        sudo pacman -S --noconfirm docker docker-compose || warn "pacman failed to install docker."
      elif command_exists zypper; then
        sudo zypper install -y docker docker-compose || warn "zypper failed to install docker."
      else
        warn "No known package manager. Install Docker manually from the official docs."
      fi
      ;;
    windows-msys)
      warn "On Windows, attempting Docker Desktop via choco/winget (may require admin)."
      if command_exists choco; then
        choco install -y docker-desktop || warn "choco failed to install Docker Desktop."
      elif command_exists winget; then
        winget install -e --id Docker.DockerDesktop || warn "winget failed to install Docker Desktop."
      else
        warn "No choco/winget found. Install Docker Desktop manually: https://www.docker.com/get-started"
      fi
      ;;
    *)
      warn "Unknown platform; install Docker manually: https://www.docker.com/get-started"
      ;;
  esac
}

start_docker_daemon() {
  case "$PLATFORM" in
    macos)
      info "Trying to start Docker Desktop..."
      open -a Docker >/dev/null 2>&1 || warn "Couldn't auto-open Docker.app. Start Docker Desktop manually."
      ;;
    windows-msys)
      info "Trying to start Docker Desktop (Windows)..."
      WIN_DOCKER_EXE_PATH='C:\Program Files\Docker\Docker\Docker Desktop.exe'
      powershell.exe -NoProfile -Command "Try { Start-Process -FilePath '$WIN_DOCKER_EXE_PATH' -ErrorAction Stop } Catch { Exit 1 }" \
        >/dev/null 2>&1 || warn "Couldn't auto-start Docker Desktop. Start it manually."
      ;;
    linux)
      info "Trying to start docker service..."
      if command_exists systemctl; then
        sudo systemctl start docker 2>/dev/null || warn "systemctl start docker failed."
      elif command_exists service; then
        sudo service docker start 2>/dev/null || warn "service docker start failed."
      else
        warn "No systemctl/service; start docker manually."
      fi
      ;;
    *)
      warn "Don't know how to auto-start Docker on this platform."
      ;;
  esac
}

# ---------- 3) Docker flow ----------
log "Docker (Desktop/Engine)"

DOCKER_OK=false

if ! command_exists docker; then
  warn "docker CLI not found."
  if ask_yes_no "Should I try to install Docker for you?" "n"; then
    install_docker_cli
  fi
fi

if command_exists docker; then
  info "docker CLI: $(docker --version 2>/dev/null || echo 'version unknown')"
  if docker info >/dev/null 2>&1; then
    info "Docker daemon is running."
    DOCKER_OK=true
  else
    warn "Docker daemon is NOT running."
    if ask_yes_no "Try to start Docker now?" "y"; then
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
        warn "Docker is still not running."
        if ask_yes_no "Continue anyway (services that need Docker will fail)?" "n"; then
          DOCKER_OK=false
        else
          err "Docker is required for the dev environment. Exiting."
          exit 1
        fi
      fi
    else
      if ask_yes_no "Continue without starting Docker? (dev env will fail)" "n"; then
        DOCKER_OK=false
      else
        err "Docker needs to be running to continue. Exiting."
        exit 1
      fi
    fi
  fi
else
  warn "Docker CLI not available at all."
  if ! ask_yes_no "Continue without Docker? (dev env will NOT work)" "n"; then
    err "Docker is required. Exiting."
    exit 1
  fi
fi

# ---------- 4) Bun runtime ----------
log "Bun runtime (bun.sh)"

if command_exists bun; then
  info "bun present: $(bun --version 2>/dev/null || echo 'unknown')"
else
  warn "bun is not installed (required by project)."
  if [ "$PLATFORM" = "macos" ] || [ "$PLATFORM" = "linux" ]; then
    if ask_yes_no "Install bun via bun.sh now?" "y"; then
      if command_exists curl; then
        curl -fsSL https://bun.sh/install | bash || warn "bun install script failed."
      elif command_exists wget; then
        wget -qO- https://bun.sh/install | bash || warn "bun install script failed."
      else
        warn "Neither curl nor wget found. Can't run bun installer."
      fi
      if [ -f "$HOME/.bun/bin/bun" ]; then
        export PATH="$HOME/.bun/bin:$PATH"
        info "Added ~/.bun/bin to PATH for this session."
      fi
    fi
  else
    warn "Automatic bun install not configured for this platform. Install it manually."
  fi
fi

if ! command_exists bun; then
  err "bun runtime is required for this project (just recipes use it). Exiting."
  exit 1
fi

# ---------- 5) just command runner ----------
log "Checking 'just' command runner"

if command_exists just; then
  info "just present: $(just --version 2>/dev/null || echo 'unknown')"
else
  warn "'just' is not installed (required for 'just init' / 'just dev')."
  if ask_yes_no "Try to install 'just' using your package manager?" "y"; then
    if [ "$PLATFORM" = "macos" ] && command_exists brew; then
      brew install just || warn "brew install just failed."
    elif command_exists pacman; then
      sudo pacman -S --noconfirm just || warn "pacman install just failed."
    elif command_exists apt-get ]; then
      if command_exists cargo; then
        cargo install just || warn "cargo install just failed."
      else
        warn "Install Rust/cargo then run 'cargo install just', or see https://github.com/casey/just"
      fi
    else
      warn "Automatic install for 'just' not configured here. Install manually."
    fi
  fi
fi

if ! command_exists just; then
  err "'just' is required to run 'just init' and 'just dev'. Exiting."
  exit 1
fi

# ---------- 6) Port checks (informational) ----------
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
  fi
done
if [ "$PORT_ISSUES" -gt 0 ]; then
  warn "$PORT_ISSUES required port(s) are in use. Dev env may fail until you free them."
fi

# ---------- 7) Run `just init` ----------
log "Project initialization (just init)"

if ask_yes_no "Run 'just init' (install deps, create .env files) now?" "y"; then
  just init
  info "'just init' completed."
else
  warn "Skipping 'just init'. If deps/.env are missing, 'just dev' will prompt you later."
fi

# ---------- 8) Run `just dev` ----------
log "Development environment (just dev)"

if ask_yes_no "Start the dev environment now with 'just dev'?" "y"; then
  printf "${CYAN}I'll now run 'just dev'.${NC}\n"
  printf "${CYAN}- It will start Docker infra, run migrations, and launch backend/worker/frontend.${NC}\n"
  printf "${CYAN}- To stop: press Ctrl+C in this terminal, or run 'just dev stop' from another terminal.${NC}\n\n"
  # This will run until user stops it or it errors; due to set -e, errors will exit the script.
  just dev
else
  warn "Skipping 'just dev'. You can start it later with:" 
  printf "  just dev\n\n"
fi

# ---------- 9) Summary ----------
printf "\n${GREEN}=== Setup summary ===${NC}\n"
printf "${CYAN}To (re)initialize project:${NC}  just init\n"
printf "${CYAN}To start dev environment:${NC}   just dev\n"
printf "${CYAN}To stop dev environment:${NC}    just dev stop  (or Ctrl+C in the running terminal)\n"
printf "${CYAN}Frontend will be available at:${NC} http://localhost:5173\n\n"

printf "${GREEN}Interactive setup complete.${NC}\n"

exit 0

