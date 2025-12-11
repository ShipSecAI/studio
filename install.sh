#!/usr/bin/env bash
# test.sh - Portable interactive bootstrap for ShipSecAI/studio
# Works on macOS (bash 3.x), Linux, and Windows (MSYS/WSL/Git Bash).
# Avoids associative arrays for macOS compatibility.

# Safety: do not use -e (so interactive checks don't abort). Keep -u and pipefail.
set -u -o pipefail
IFS=$'\n\t'

# ---------- Config ----------
REPO_URL="https://github.com/ShipSecAI/studio"
REPO_DIR="studio"
REQUIRED_PORTS=(5433 7233 8081 9000 9001 3100)
WAIT_DOCKER_SEC=60

# ---------- Colors ----------
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'
CYAN='\033[0;36m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

log(){ printf "\n${GREEN}==> %s${NC}\n" "$1"; }
info(){ printf "${CYAN}%s${NC}\n" "$1"; }
warn(){ printf "${YELLOW}WARN:${NC} %s\n" "$1"; }
err(){ printf "${RED}ERROR:${NC} %s\n" "$1"; }

# ---------- Traps ----------
on_err(){
  local rc=$?
  err "Script failed (rc=$rc) at ${BASH_SOURCE[1]}:${BASH_LINENO[0]}"
  exit $rc
}
on_int(){
  printf "\n${YELLOW}Interrupted by user. Exiting...${NC}\n"
  exit 130
}
trap 'on_err' ERR
trap 'on_int' INT

# ---------- Utility ----------
command_exists(){ command -v "$1" >/dev/null 2>&1; }

# read prompt safely from controlling tty (works when stdin is redirected)
ask_yes_no(){
  local prompt default ans tty
  prompt="$1"
  default="${2:-n}"
  if [ "$default" = "y" ]; then prompt="${prompt} [Y/n] "; else prompt="${prompt} [y/N] "; fi
  tty=/dev/tty
  if [ ! -r "$tty" ]; then
    # fallback to stdin (less robust)
    read -r -p "$prompt" ans 2>/dev/null || ans=""
    ans="${ans:-$default}"
    case "$ans" in y|Y) return 0 ;; *) return 1 ;; esac
  fi
  while true; do
    printf "%s" "$prompt" > "$tty"
    IFS= read -r ans < "$tty" || ans=""
    ans="${ans:-$default}"
    case "$ans" in
      y|Y) return 0 ;;
      n|N) return 1 ;;
      *) printf "Please type y or n and press Enter.\n" > "$tty" ;;
    esac
  done
}

# ---------- Status table (indexed arrays for portability) ----------
components=( "Git" "Node.js" "npm" "pm2" "Docker CLI" "Docker Daemon" "Bun" "Just" )
# parallel arrays: status[i], version[i]
declare -a status
declare -a version_info

set_status(){
  local i name="$1" st="$2" ver="$3"
  for idx in "${!components[@]}"; do
    if [ "${components[$idx]}" = "$name" ]; then
      status[$idx]="$st"
      version_info[$idx]="$ver"
      return 0
    fi
  done
  return 1
}
get_status(){
  local name="$1"
  for idx in "${!components[@]}"; do
    if [ "${components[$idx]}" = "$name" ]; then
      printf "%s" "${status[$idx]:-UNKNOWN}"
      return 0
    fi
  done
  printf "UNKNOWN"; return 1
}
get_version(){ 
  local name="$1"
  for idx in "${!components[@]}"; do
    if [ "${components[$idx]}" = "$name" ]; then
      printf "%s" "${version_info[$idx]:--}"
      return 0
    fi
  done
  printf "-"; return 1
}

print_status_table(){
  printf "\n${BOLD}${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}\n"
  printf "${BOLD}${BLUE}║${NC}  ${BOLD}System Requirements Status${NC}                                  ${BOLD}${BLUE}║${NC}\n"
  printf "${BOLD}${BLUE}╠════════════════════════════════════════════════════════════════╣${NC}\n"
  printf "${BOLD}${BLUE}║${NC} %-20s ${BOLD}│${NC} %-12s ${BOLD}│${NC} %-28s ${BOLD}${BLUE}║${NC}\n" "Component" "Status" "Version/Info"
  printf "${BOLD}${BLUE}╠════════════════════════════════════════════════════════════════╣${NC}\n"
  for i in "${!components[@]}"; do
    local comp="${components[$i]}"
    local st="${status[$i]:-UNKNOWN}"
    local ver="${version_info[$i]:--}"
    local col="${YELLOW}"
    case "$st" in
      INSTALLED|RUNNING) col="${GREEN}" ;;
      MISSING) col="${RED}" ;;
      STOPPED|UNKNOWN) col="${YELLOW}" ;;
      *) col="${YELLOW}" ;;
    esac
    printf "${BOLD}${BLUE}║${NC} %-20s ${BOLD}│${NC} ${col}%-12s${NC} ${BOLD}│${NC} %-28s ${BOLD}${BLUE}║${NC}\n" "$comp" "$st" "${ver:0:28}"
  done
  printf "${BOLD}${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}\n\n"
}

# ---------- Platform ----------
OS_RAW="$(uname -s 2>/dev/null || echo Unknown)"
case "$OS_RAW" in
  Darwin) PLATFORM="macos" ;;
  Linux) PLATFORM="linux" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows-msys" ;;
  *) PLATFORM="unknown" ;;
esac
log "Platform detected: $PLATFORM"

# ---------- Initial checks ----------
log "Checking system dependencies (quick probes)..."

# Git
if command_exists git; then
  set_status "Git" "INSTALLED" "$(git --version 2>/dev/null | head -1)"
else
  set_status "Git" "MISSING" "-"
fi

# Node
if command_exists node; then
  set_status "Node.js" "INSTALLED" "$(node --version 2>/dev/null || echo unknown)"
else
  set_status "Node.js" "MISSING" "-"
fi

# npm
if command_exists npm; then
  set_status "npm" "INSTALLED" "$(npm --version 2>/dev/null || echo unknown)"
else
  set_status "npm" "MISSING" "-"
fi

# pm2
if command_exists pm2; then
  set_status "pm2" "INSTALLED" "$(pm2 --version 2>/dev/null || echo unknown)"
else
  set_status "pm2" "UNKNOWN" "-"
fi

# Docker CLI
if command_exists docker; then
  set_status "Docker CLI" "INSTALLED" "$(docker --version 2>/dev/null | head -1 || echo unknown)"
else
  set_status "Docker CLI" "MISSING" "-"
fi

# Docker daemon probe (non-fatal)
if command_exists docker; then
  if docker info >/dev/null 2>&1; then
    set_status "Docker Daemon" "RUNNING" "active"
  else
    set_status "Docker Daemon" "STOPPED" "not running / permission?"
  fi
else
  set_status "Docker Daemon" "STOPPED" "no docker CLI"
fi

# Bun
if command_exists bun; then
  set_status "Bun" "INSTALLED" "$(bun --version 2>/dev/null || echo unknown)"
else
  set_status "Bun" "MISSING" "-"
fi

# Just
if command_exists just; then
  set_status "Just" "INSTALLED" "$(just --version 2>/dev/null | head -1 || echo unknown)"
else
  set_status "Just" "MISSING" "-"
fi

print_status_table

# ---------- Repo detection & clone ----------
log "Repository check"
IN_REPO=false
if [ -d .git ] || [ -f justfile ] || [ -f Justfile ]; then
  IN_REPO=true
else
  if [ -d "$REPO_DIR" ] && { [ -d "$REPO_DIR/.git" ] || [ -f "$REPO_DIR/justfile" ] || [ -f "$REPO_DIR/Justfile" ]; }; then
    info "Detected existing repo in ./$REPO_DIR"
    if ask_yes_no "Use './$REPO_DIR' and cd into it?" "y"; then
      cd "$REPO_DIR" || { err "cd failed"; exit 1; }
      IN_REPO=true
    fi
  fi
fi

if [ "$IN_REPO" = false ]; then
  info "No repo detected in current directory."
  if ask_yes_no "Clone ShipSecAI/studio into './$REPO_DIR' now?" "y"; then
    if ! command_exists git; then
      warn "git is required to clone the repo."
      if ask_yes_no "Install git now?" "y"; then
        # try install below
        :
      else
        err "Cannot continue without git. Exiting."
        exit 1
      fi
    fi
    if [ -d "$REPO_DIR" ]; then
      warn "Directory exists; using it."
    else
      git clone "$REPO_URL" "$REPO_DIR" || { err "git clone failed"; exit 1; }
    fi
    cd "$REPO_DIR" || { err "cd failed"; exit 1; }
  else
    err "Cannot continue without the repository. Exiting."
    exit 1
  fi
fi

PROJECT_ROOT="$(pwd)"
info "Project root: $PROJECT_ROOT"

# ---------- Install helpers ----------
install_git(){
  info "Installing git for $PLATFORM..."
  case "$PLATFORM" in
    macos)
      if command_exists brew; then brew install git || warn "brew git failed"; else warn "Install Homebrew then git: https://brew.sh/"; return 1; fi
      ;;
    linux)
      if command_exists apt-get; then sudo apt-get update -y && sudo apt-get install -y git; elif command_exists dnf; then sudo dnf install -y git; elif command_exists pacman; then sudo pacman -S --noconfirm git; else warn "Install git manually"; return 1; fi
      ;;
    windows-msys)
      if command_exists choco; then choco install -y git; elif command_exists winget; then winget install --id Git.Git -e; else warn "Install Git for Windows manually"; return 1; fi
      ;;
    *)
      warn "Manual git install required"
      return 1
      ;;
  esac
  hash -r 2>/dev/null || true
  return 0
}

install_node_linux(){
  info "Installing Node.js (NodeSource LTS) on Debian/Ubuntu..."
  if ! command_exists apt-get; then warn "apt-get not found"; return 1; fi
  sudo apt-get update -y || true
  sudo apt-get install -y curl || true
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - || warn "NodeSource setup failed"
  sudo apt-get install -y nodejs || warn "nodejs install failed"
  hash -r 2>/dev/null || true
}

install_pm2(){
  info "Installing pm2 (npm global)"
  if ! command_exists npm; then warn "npm missing; cannot install pm2"; return 1; fi
  if command_exists sudo; then
    sudo npm install -g pm2 || npm install -g pm2 || warn "pm2 install failed"
  else
    npm install -g pm2 || warn "pm2 install failed"
  fi
  hash -r 2>/dev/null || true
}

install_bun(){
  info "Installing bun via bun.sh"
  if command_exists curl; then curl -fsSL https://bun.sh/install | bash || warn "bun install script failed"; elif command_exists wget; then wget -qO- https://bun.sh/install | bash || warn "bun install script failed"; else warn "curl/wget missing"; return 1; fi
  if [ -f "$HOME/.bun/bin/bun" ]; then export PATH="$HOME/.bun/bin:$PATH"; hash -r 2>/dev/null || true; fi
}

install_just(){
  info "Installing just (task runner)"
  if [ "$PLATFORM" = "macos" ] && command_exists brew; then brew install just || warn "brew install just failed"
  elif command_exists pacman; then sudo pacman -S --noconfirm just || warn "pacman install just failed"
  elif command_exists apt-get; then
    if command_exists cargo; then cargo install just || warn "cargo install just failed"
    else
      info "Installing rustup to build 'just' (this will modify shell profile)"
      curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y || warn "rustup failed"
      source "$HOME/.cargo/env" 2>/dev/null || true
      cargo install just || warn "cargo install just failed"
    fi
  else
    warn "Please install 'just' manually: https://github.com/casey/just"
  fi
  hash -r 2>/dev/null || true
}

install_docker_cli(){
  info "Installing Docker (best-effort) for $PLATFORM..."
  case "$PLATFORM" in
    macos)
      if command_exists brew; then brew install --cask docker || warn "brew failed to install Docker Desktop"; else warn "Install Docker Desktop manually: https://www.docker.com/products/docker-desktop"; fi
      ;;
    linux)
      if command_exists apt-get && command_exists lsb_release; then
        sudo apt-get update -y || true
        sudo apt-get install -y ca-certificates curl gnupg lsb-release apt-transport-https || true
        sudo mkdir -p /etc/apt/keyrings
        if curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null; then
          sudo chmod a+r /etc/apt/keyrings/docker.gpg || true
          echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
          sudo apt-get update -y || true
          sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin || warn "apt-get install docker failed"
          sudo usermod -aG docker "$USER" || warn "usermod add docker group failed"
        else
          warn "Docker GPG fetch failed; trying convenience script"
          curl -fsSL https://get.docker.com | sudo sh || warn "convenience install failed"
        fi
      else
        curl -fsSL https://get.docker.com | sudo sh || warn "convenience install failed"
      fi
      ;;
    windows-msys)
      if command_exists choco; then choco install -y docker-desktop || warn "choco failed"; elif command_exists winget; then winget install -e --id Docker.DockerDesktop || warn "winget failed"; else warn "Install Docker Desktop manually"; fi
      ;;
    *)
      warn "Manual docker install required"
      ;;
  esac
  hash -r 2>/dev/null || true
}

start_docker_daemon(){
  case "$PLATFORM" in
    macos)
      info "Attempting to start Docker daemon on macOS..."
      local docker_started=false
      
      # Method 1: Try Docker Desktop CLI (newer versions)
      if [ -x "/Applications/Docker.app/Contents/Resources/bin/docker" ]; then
        # Check if 'docker desktop' subcommand exists (Docker Desktop 4.x+)
        if /Applications/Docker.app/Contents/Resources/bin/docker help 2>&1 | grep -q "desktop"; then
          info "Using 'docker desktop start' CLI command..."
          /Applications/Docker.app/Contents/Resources/bin/docker desktop start 2>/dev/null && docker_started=true
        fi
      fi
      
      # Method 2: Start via open command (opens Docker Desktop app)
      if [ "$docker_started" = false ]; then
        if [ -d "/Applications/Docker.app" ]; then
          info "Starting Docker Desktop app..."
          open -g "/Applications/Docker.app" && docker_started=true
        elif [ -d "$HOME/Applications/Docker.app" ]; then
          open -g "$HOME/Applications/Docker.app" && docker_started=true
        else
          # Fallback: try open -a with different app names
          if open -g -a "Docker" 2>/dev/null; then
            docker_started=true
          elif open -g -a "Docker Desktop" 2>/dev/null; then
            docker_started=true
          fi
        fi
      fi
      
      if [ "$docker_started" = false ]; then
        warn "Couldn't start Docker Desktop. Please start it manually from Applications."
      else
        info "Docker daemon starting. Waiting for it to become ready..."
      fi
      ;;
    windows-msys)
      powershell.exe -NoProfile -Command "Try { Start-Process -FilePath 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe' -ErrorAction Stop } Catch { Exit 1 }" >/dev/null 2>&1 || warn "Couldn't auto-start Docker Desktop"
      ;;
    linux)
      if command_exists systemctl; then sudo systemctl enable --now docker || warn "systemctl start failed"; elif command_exists service; then sudo service docker start || warn "service start failed"; else sudo dockerd >/dev/null 2>&1 & sleep 3; fi
      ;;
    *) warn "Cannot auto-start Docker on this platform";;
  esac
}

wait_for_docker(){
  local start now elapsed
  start=$(date +%s)
  while ! docker info >/dev/null 2>&1; do
    now=$(date +%s); elapsed=$((now - start))
    if [ "$elapsed" -ge "$WAIT_DOCKER_SEC" ]; then return 1; fi
    printf "."; sleep 1
  done
  printf "\n"; return 0
}

# ---------- Ensure project dependencies function ----------
ensure_project_deps(){
  log "Ensuring project dependencies are installed (root + backend + worker + frontend)"

  local folders=( "." "backend" "worker" "frontend" )
  printf "\nPlanned actions:\n"
  printf "%-12s | %s\n" "folder" "action"
  printf "-------------|----------------------------\n"
  for f in "${folders[@]}"; do
    if [ -f "$PROJECT_ROOT/$f/package.json" ]; then
      printf "%-12s | %-26s\n" "$f" "install (bun -> npm fallback)"
    else
      printf "%-12s | %-26s\n" "$f" "skip (no package.json)"
    fi
  done
  printf "\n"

  if ! ask_yes_no "Proceed with dependency installation for listed folders?" "y"; then
    warn "Skipping dependency installation."
    return 0
  fi

  for f in "${folders[@]}"; do
    if [ -f "$PROJECT_ROOT/$f/package.json" ]; then
      info "Installing dependencies in ./$f ..."
      if command_exists bun; then
        if (cd "$PROJECT_ROOT/$f" && bun install); then
          info "bun install OK in ./$f"
          continue
        else
          warn "bun install failed in ./$f — trying npm fallback"
        fi
      fi

      if command_exists npm; then
        if [ -f "$PROJECT_ROOT/$f/package-lock.json" ]; then
          info "Running npm ci in ./$f"
          (cd "$PROJECT_ROOT/$f" && npm ci --silent) || {
            warn "npm ci failed, trying npm install"
            (cd "$PROJECT_ROOT/$f" && npm install --silent) || { err "npm install failed in ./$f"; }
          }
        else
          info "Running npm install in ./$f"
          (cd "$PROJECT_ROOT/$f" && npm install --silent) || { err "npm install failed in ./$f"; }
        fi
      else
        warn "npm not available to install deps in ./$f. Install Node/npm or bun."
      fi
    else
      info "No package.json in ./$f — skipping"
    fi
  done

  # Ensure tsx
  TSX_PATH="$PROJECT_ROOT/node_modules/.bin/tsx"
  if [ ! -x "$TSX_PATH" ]; then
    warn "tsx binary not found at $TSX_PATH"
    if command_exists npm; then
      if ask_yes_no "Attempt to install local devDependency 'tsx' in project root now?" "y"; then
        (cd "$PROJECT_ROOT" && npm install --no-audit --no-fund --save-dev tsx) || warn "Failed to install tsx locally"
      else
        warn "Skipping tsx install. PM2 may fail."
      fi
    else
      warn "npm not available to install tsx. Consider 'npm i -g tsx' as fallback."
    fi
  else
    info "tsx binary present."
  fi
}

# ---------- Main interactive flow ----------
# 1) Offer to install missing basic tools (git/node/pm2/bun/just/docker)
log "Interactive installation checks"

# Git
if ! command_exists git; then
  warn "git not found"
  if ask_yes_no "Install git now?" "y"; then install_git || warn "git install attempt finished"; fi
fi
if command_exists git; then set_status "Git" "INSTALLED" "$(git --version 2>/dev/null | head -1)"; fi

# Node
if ! command_exists node; then
  warn "node missing"
  if ask_yes_no "Install Node.js now?" "y"; then
    if [ "$PLATFORM" = "linux" ] && command_exists apt-get; then install_node_linux || warn "node install attempt finished"
    else warn "Automatic Node install not supported on this platform; please install manually"; fi
  fi
fi
if command_exists node; then set_status "Node.js" "INSTALLED" "$(node --version 2>/dev/null)"; fi

# npm recorded
if command_exists npm; then set_status "npm" "INSTALLED" "$(npm --version 2>/dev/null)"; fi

# pm2
if ! command_exists pm2; then
  warn "pm2 missing"
  if ask_yes_no "Install pm2 globally via npm?" "y"; then install_pm2 || warn "pm2 install attempt finished"; fi
fi
if command_exists pm2; then set_status "pm2" "INSTALLED" "$(pm2 --version 2>/dev/null)"; fi

# Docker CLI
if ! command_exists docker; then
  warn "docker CLI missing"
  if ask_yes_no "Install Docker now (best-effort)? (You may still prefer Docker Desktop GUI on macOS)" "n"; then install_docker_cli || warn "docker install attempt finished"; fi
fi
if command_exists docker; then set_status "Docker CLI" "INSTALLED" "$(docker --version 2>/dev/null | head -1)"; fi

# Docker daemon start/permissions
if command_exists docker; then
  if docker info >/dev/null 2>&1; then
    set_status "Docker Daemon" "RUNNING" "active"
  else
    set_status "Docker Daemon" "STOPPED" "not running/permission"
    warn "Docker daemon not running or you lack permissions"
    if ask_yes_no "Try to start Docker now?" "y"; then
      start_docker_daemon
      info "Waiting for Docker to become ready (up to ${WAIT_DOCKER_SEC}s)..."
      if wait_for_docker; then set_status "Docker Daemon" "RUNNING" "active"; else warn "Docker did not become ready"; fi
    fi
  fi
fi

# Bun
if ! command_exists bun; then
  warn "bun missing"
  if ask_yes_no "Install bun via bun.sh?" "y"; then install_bun || warn "bun install attempt finished"; fi
fi
if command_exists bun; then set_status "Bun" "INSTALLED" "$(bun --version 2>/dev/null)"; fi

# Just
if ! command_exists just; then
  warn "just missing"
  if ask_yes_no "Install just now (may install rust/cargo)?" "n"; then install_just || warn "just install attempt finished"; fi
fi
if command_exists just; then set_status "Just" "INSTALLED" "$(just --version 2>/dev/null | head -1)"; fi

# Print final status
print_status_table

# Ports check
log "Checking required ports: ${REQUIRED_PORTS[*]}"
PORT_ISSUES=0
for p in "${REQUIRED_PORTS[@]}"; do
  if command_exists lsof; then
    if lsof -iTCP:"$p" -sTCP:LISTEN -P -n >/dev/null 2>&1; then warn "Port $p is in use"; PORT_ISSUES=$((PORT_ISSUES+1)); fi
  elif command_exists ss; then
    if ss -lnt 2>/dev/null | awk '{print $4}' | grep -E ":$p\$" >/dev/null 2>&1; then warn "Port $p is in use"; PORT_ISSUES=$((PORT_ISSUES+1)); fi
  fi
done
if [ "$PORT_ISSUES" -gt 0 ]; then warn "$PORT_ISSUES required port(s) are in use. Dev env may fail."; fi

# Run just init
log "Project initialization (just init)"
if ask_yes_no "Run 'just init' (installs deps & creates .env files) now?" "y"; then
  just init || warn "'just init' returned non-zero (it may have partially succeeded)."
  # Ensure project dependencies AFTER just init
  ensure_project_deps
else
  warn "Skipping 'just init'. If deps/.env are missing, 'just dev' will prompt you later."
fi

# Run just dev
log "Development environment (just dev)"
if ask_yes_no "Start development environment now with 'just dev'?" "y"; then
  if ! command_exists docker || ! docker ps >/dev/null 2>&1; then
    warn "Docker not accessible; 'just dev' likely will fail. Aborting 'just dev'."
  else
    just dev || warn "'just dev' exited with non-zero."
  fi
else
  info "Skipped 'just dev'. Start later with: just dev"
fi

printf "\n${GREEN}=== Setup script finished (interactive) ===${NC}\n"
exit 0
