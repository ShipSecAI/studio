#!/usr/bin/env bash
# install.sh - One-liner installer for ShipSec Studio (Production/Docker mode)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ShipSecAI/studio/main/install.sh | bash
#
# This script installs ShipSec Studio using pre-built Docker images from GHCR.
# For development setup, see: https://github.com/ShipSecAI/studio#option-3-development-setup
#
# Supported platforms: macOS, Linux, Windows (Git Bash/MSYS2/WSL)

set -u -o pipefail
# Note: We intentionally keep the default IFS (space, tab, newline) 
# because we use space-separated lists for MISSING_DEPS and INSTALL_FAILED

# ---------- Config ----------
REPO_URL="https://github.com/ShipSecAI/studio"
REPO_DIR="studio"
WAIT_DOCKER_SEC=60

# ---------- Colors ----------
setup_colors() {
  if [[ -t 1 ]] && [[ -n "${TERM:-}" ]]; then
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    RED='\033[0;31m'
    CYAN='\033[0;36m'
    BLUE='\033[0;34m'
    BOLD='\033[1m'
    NC='\033[0m'
  else
    GREEN=''
    YELLOW=''
    RED=''
    CYAN=''
    BLUE=''
    BOLD=''
    NC=''
  fi
}
setup_colors

# ---------- Logging ----------
# Note: Using %b to interpret escape sequences in the argument
log()  { printf "\n${GREEN}==>${NC} ${BOLD}%s${NC}\n" "$1"; }
info() { printf "    %b\n" "$1"; }
warn() { printf "    ${YELLOW}Warning:${NC} %b\n" "$1"; }
err()  { printf "    ${RED}Error:${NC} %b\n" "$1"; }

# ---------- Traps ----------
on_err() {
  local rc=$?
  printf "\n"
  err "Installation failed (exit code: $rc)"
  err "If you need help, please visit: https://github.com/ShipSecAI/studio/issues"
  exit $rc
}
on_int() {
  printf "\n"
  warn "Installation cancelled by user."
  exit 130
}
trap 'on_err' ERR
trap 'on_int' INT

# ---------- Utility ----------
command_exists() { command -v "$1" >/dev/null 2>&1; }

# Check if we can interact with user (even when piped via curl | bash)
is_interactive() {
  # stdin is a terminal
  [ -t 0 ] && return 0
  # stdin is piped but /dev/tty exists (curl | bash scenario)
  [ -e /dev/tty ] && return 0
  # Truly non-interactive
  return 1
}

# Cross-platform user input
# Uses /dev/tty to allow prompts even when script is piped (curl | bash)
ask_yes_no() {
  local prompt="$1"
  local default="${2:-n}"
  local yn_hint
  
  if [ "$default" = "y" ]; then
    yn_hint="[Y/n]"
  else
    yn_hint="[y/N]"
  fi
  
  # Check if we can read from /dev/tty (works even when script is piped)
  if [ -t 0 ]; then
    # stdin is a terminal
    :
  elif [ -e /dev/tty ]; then
    # stdin is piped but /dev/tty exists - we can still prompt
    exec < /dev/tty
  else
    # Truly non-interactive (no terminal available)
    case "$default" in
      y|Y) return 0 ;;
      *) return 1 ;;
    esac
  fi
  
  while true; do
    printf "    %s %s " "$prompt" "$yn_hint"
    read -r ans || ans=""
    ans="${ans:-$default}"
    case "$ans" in
      y|Y|yes|YES|Yes) return 0 ;;
      n|N|no|NO|No) return 1 ;;
      *) printf "    Please enter 'y' for yes or 'n' for no.\n" ;;
    esac
  done
}

# ---------- Platform Detection ----------
detect_platform() {
  local os_raw
  os_raw="$(uname -s 2>/dev/null || echo Unknown)"
  
  case "$os_raw" in
    Darwin)
      PLATFORM="macos"
      PLATFORM_NAME="macOS"
      ;;
    Linux)
      if grep -qEi "(microsoft|wsl)" /proc/version 2>/dev/null; then
        PLATFORM="wsl"
        PLATFORM_NAME="Windows (WSL)"
      else
        PLATFORM="linux"
        PLATFORM_NAME="Linux"
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*)
      PLATFORM="windows"
      PLATFORM_NAME="Windows (Git Bash)"
      ;;
    *)
      PLATFORM="unknown"
      PLATFORM_NAME="Unknown"
      ;;
  esac
}

# ---------- Dependency Installation ----------

# Check if we can use sudo
can_sudo() {
  if command_exists sudo; then
    # Check if user can sudo without password or is root
    if [ "$(id -u)" = "0" ] || sudo -n true 2>/dev/null; then
      return 0
    fi
    # In interactive mode, try to get sudo access (let user see password prompt)
    if is_interactive; then
      info "Some operations require administrator privileges."
      if sudo -v; then
        return 0
      fi
    fi
  fi
  return 1
}

# Check if current user is in docker group (for Linux/WSL)
check_docker_group() {
  # Skip on macOS and Windows - they don't use docker group
  if [ "$PLATFORM" = "macos" ] || [ "$PLATFORM" = "windows" ]; then
    return 0
  fi
  
  # Root doesn't need docker group
  if [ "$(id -u)" = "0" ]; then
    return 0
  fi
  
  # Check if docker group exists and user is a member
  if command_exists docker && getent group docker >/dev/null 2>&1; then
    if ! groups 2>/dev/null | grep -qw docker; then
      return 1  # User not in docker group
    fi
  fi
  
  return 0
}

# Install Docker - always asks for permission
install_docker() {
  log "Installing Docker"
  
  printf "\n"
  warn "Docker installation requires your permission."
  printf "\n"
  
  case "$PLATFORM" in
    macos)
      info "On macOS, you can install Docker in two ways:"
      printf "\n"
      info "  ${BOLD} Option 1: Docker Desktop${NC} (GUI app, easiest)"
      info "  ${BOLD} Option 2: Colima${NC} (CLI-only, lightweight)"
      printf "\n"
      
      if ! ask_yes_no "Would you like to install Docker now?" "y"; then
        info "Docker installation skipped."
        show_install_instructions "docker"
        return 1
      fi
      
      if command_exists brew; then
        printf "\n"
        info "Which Docker runtime would you prefer?"
        printf "\n"
        info "  1) Docker Desktop (GUI application)"
        info "  2) Colima (CLI-only, runs in terminal)"
        printf "\n"
        
        local choice=""
        if is_interactive; then
          printf "    Enter choice [1/2]: "
          read -r choice || choice="1"
        else
          choice="1"
        fi
        
        case "$choice" in
          2)
            info "Installing Colima and Docker CLI via Homebrew..."
            printf "\n"
            if brew install colima docker docker-compose; then
              printf "\n"
              info "${GREEN}Colima and Docker CLI installed successfully!${NC}"
              info "Starting Colima..."
              if colima start; then
                info "${GREEN}Colima is running! Docker daemon is ready.${NC}"
                return 0
              else
                warn "Colima installed but failed to start. Try: colima start"
                return 0
              fi
            else
              err "Failed to install Colima"
              return 1
            fi
            ;;
          *)
            info "Installing Docker Desktop via Homebrew..."
            printf "\n"
            if brew install --cask docker; then
              printf "\n"
              info "${GREEN}Docker Desktop installed successfully!${NC}"
              return 0
            else
              err "Failed to install Docker via Homebrew"
              return 1
            fi
            ;;
        esac
      else
        printf "\n"
        warn "Homebrew is not installed."
        info "Please install Docker Desktop manually from:"
        printf "\n"
        printf "    https://www.docker.com/products/docker-desktop\n"
        printf "\n"
        info "Or install Homebrew first:"
        printf "\n"
        printf "    /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"\n"
        printf "\n"
        return 1
      fi
      ;;
    linux)
      if ! ask_yes_no "Would you like to install Docker Engine now?" "y"; then
        info "Docker installation skipped."
        show_install_instructions "docker"
        return 1
      fi
      
      if can_sudo; then
        info "Installing Docker Engine via official script..."
        printf "\n"
        if curl -fsSL https://get.docker.com | sudo sh; then
          printf "\n"
          info "Adding current user to docker group..."
          sudo usermod -aG docker "$USER" 2>/dev/null || true
          printf "\n"
          printf "${GREEN}┌─────────────────────────────────────────────────────────────────┐${NC}\n"
          printf "${GREEN}│${NC}  ${BOLD}🚨 Docker installed but requires logout/login${NC}                  ${GREEN}│${NC}\n"
          printf "${GREEN}│${NC}                                                                 ${GREEN}│${NC}\n"
          printf "${GREEN}│${NC}  Your user has been added to the 'docker' group, but this      ${GREEN}│${NC}\n"
          printf "${GREEN}│${NC}  change won't take effect until you log out and back in.       ${GREEN}│${NC}\n"
          printf "${GREEN}│${NC}                                                                 ${GREEN}│${NC}\n"
          printf "${GREEN}│${NC}  ${BOLD}➡️  Please log out, log back in, then run:${NC}                     ${GREEN}│${NC}\n"
          printf "${GREEN}│${NC}                                                                 ${GREEN}│${NC}\n"
          printf "${GREEN}│${NC}      curl -fsSL https://raw.githubusercontent.com/ShipSecAI/   ${GREEN}│${NC}\n"
          printf "${GREEN}│${NC}      studio/main/install.sh | bash                              ${GREEN}│${NC}\n"
          printf "${GREEN}│${NC}                                                                 ${GREEN}│${NC}\n"
          printf "${GREEN}└─────────────────────────────────────────────────────────────────┘${NC}\n"
          printf "\n"
          info "Exiting now to avoid permission issues."
          exit 0
        else
          err "Failed to install Docker"
          return 1
        fi
      else
        printf "\n"
        err "Cannot install Docker without sudo access."
        info "Please install Docker manually:"
        printf "\n"
        printf "    curl -fsSL https://get.docker.com | sudo sh\n"
        printf "    sudo usermod -aG docker \$USER\n"
        printf "\n"
        return 1
      fi
      ;;
    wsl)
      printf "\n"
      info "For WSL, you have two options:"
      printf "\n"
      info "  ${BOLD} Option 1: Docker Desktop for Windows (Recommended)${NC}"
      info "    - Install Docker Desktop from: https://www.docker.com/products/docker-desktop"
      info "    - Enable WSL2 integration in Docker Desktop Settings > Resources > WSL Integration"
      printf "\n"
      info "  ${BOLD} Option 2: Docker Engine in WSL${NC}"
      
      if ! ask_yes_no "Would you like to install Docker Engine directly in WSL?" "y"; then
        info "Docker installation skipped."
        info "Please install Docker Desktop for Windows and enable WSL2 integration."
        return 1
      fi
      
      if can_sudo; then
        info "Installing Docker Engine..."
        printf "\n"
        if curl -fsSL https://get.docker.com | sudo sh; then
          printf "\n"
          info "Adding current user to docker group..."
          sudo usermod -aG docker "$USER" 2>/dev/null || true
          printf "\n"
          printf "${GREEN}┌─────────────────────────────────────────────────────────────────┐${NC}\n"
          printf "${GREEN}│${NC}  ${BOLD}🚨 Docker installed but requires logout/login${NC}                  ${GREEN}│${NC}\n"
          printf "${GREEN}│${NC}                                                                 ${GREEN}│${NC}\n"
          printf "${GREEN}│${NC}  Your user has been added to the 'docker' group, but this      ${GREEN}│${NC}\n"
          printf "${GREEN}│${NC}  change won't take effect until you log out and back in.       ${GREEN}│${NC}\n"
          printf "${GREEN}│${NC}                                                                 ${GREEN}│${NC}\n"
          printf "${GREEN}│${NC}  ${BOLD}➡️  Please log out, log back in, then run:${NC}                     ${GREEN}│${NC}\n"
          printf "${GREEN}│${NC}                                                                 ${GREEN}│${NC}\n"
          printf "${GREEN}│${NC}      curl -fsSL https://raw.githubusercontent.com/ShipSecAI/   ${GREEN}│${NC}\n"
          printf "${GREEN}│${NC}      studio/main/install.sh | bash                              ${GREEN}│${NC}\n"
          printf "${GREEN}│${NC}                                                                 ${GREEN}│${NC}\n"
          printf "${GREEN}└─────────────────────────────────────────────────────────────────┘${NC}\n"
          printf "\n"
          info "Exiting now to avoid permission issues."
          exit 0
        else
          err "Failed to install Docker"
          return 1
        fi
      else
        err "Cannot install Docker without sudo access."
        return 1
      fi
      ;;
    windows)
      printf "\n"
      info "Docker Desktop for Windows is required."
      printf "\n"
      
      if ! ask_yes_no "Would you like to install Docker Desktop now?" "y"; then
        info "Docker installation skipped."
        show_install_instructions "docker"
        return 1
      fi
      
      if command_exists winget; then
        info "Installing Docker Desktop via winget..."
        printf "\n"
        if winget install Docker.DockerDesktop --accept-source-agreements --accept-package-agreements; then
          printf "\n"
          info "${GREEN}Docker Desktop installed successfully!${NC}"
          info "Please restart your terminal and run this script again."
          return 0
        else
          err "Failed to install Docker Desktop"
          return 1
        fi
      fi
      
      info "Please install Docker Desktop manually from:"
      printf "\n"
      printf "    https://www.docker.com/products/docker-desktop\n"
      printf "\n"
      return 1
      ;;
    *)
      err "Automatic Docker installation not supported on this platform."
      info "Please install Docker manually."
      return 1
      ;;
  esac
}

# Install just automatically
install_just() {
  log "Installing just"
  
  case "$PLATFORM" in
    macos)
      if command_exists brew; then
        info "Installing just via Homebrew..."
        if brew install just; then
          info "${GREEN}just installed successfully!${NC}"
          return 0
        else
          err "Failed to install just"
          return 1
        fi
      else
        warn "Homebrew is not installed. Installing just via script..."
        mkdir -p ~/.local/bin
        # Use --force to overwrite if already exists
        if curl --proto '=https' --tlsv1.2 -sSf https://just.systems/install.sh | bash -s -- --to ~/.local/bin --force; then
          export PATH="$HOME/.local/bin:$PATH"
          info "${GREEN}just installed to ~/.local/bin${NC}"
          warn "Add ~/.local/bin to your PATH permanently by adding this to your shell profile:"
          printf "    export PATH=\"\$HOME/.local/bin:\$PATH\"\n"
          return 0
        else
          err "Failed to install just"
          return 1
        fi
      fi
      ;;
    linux|wsl)
      info "Installing just via official script..."
      mkdir -p ~/.local/bin
      # Use --force to overwrite if already exists
      if curl --proto '=https' --tlsv1.2 -sSf https://just.systems/install.sh | bash -s -- --to ~/.local/bin --force; then
        # Add to PATH for current session
        export PATH="$HOME/.local/bin:$PATH"
        info "${GREEN}just installed to ~/.local/bin${NC}"
        
        # Check if ~/.local/bin is already in shell profile
        local shell_profile=""
        if [ -n "${BASH_VERSION:-}" ]; then
          shell_profile="$HOME/.bashrc"
        elif [ -n "${ZSH_VERSION:-}" ]; then
          shell_profile="$HOME/.zshrc"
        elif [ -f "$HOME/.bashrc" ]; then
          shell_profile="$HOME/.bashrc"
        elif [ -f "$HOME/.profile" ]; then
          shell_profile="$HOME/.profile"
        fi
        
        # Add to shell profile if not already there
        if [ -n "$shell_profile" ] && [ -f "$shell_profile" ]; then
          if ! grep -q '\.local/bin' "$shell_profile" 2>/dev/null; then
            printf '\n# Added by ShipSec Studio installer\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$shell_profile"
            info "Added ~/.local/bin to PATH in $shell_profile"
          fi
        else
          warn "Add ~/.local/bin to your PATH permanently by adding this to your shell profile:"
          printf "    export PATH=\"\$HOME/.local/bin:\$PATH\"\n"
        fi
        return 0
      else
        err "Failed to install just"
        return 1
      fi
      ;;
    windows)
      if command_exists scoop; then
        info "Installing just via Scoop..."
        if scoop install just; then
          info "${GREEN}just installed successfully!${NC}"
          return 0
        fi
      elif command_exists choco; then
        info "Installing just via Chocolatey..."
        if choco install just -y; then
          info "${GREEN}just installed successfully!${NC}"
          return 0
        fi
      fi
      
      err "Could not install just automatically."
      info "Please install just manually from: https://github.com/casey/just/releases"
      return 1
      ;;
    *)
      err "Automatic just installation not supported on this platform."
      return 1
      ;;
  esac
}

# Install jq automatically
install_jq() {
  log "Installing jq"
  
  case "$PLATFORM" in
    macos)
      if command_exists brew; then
        info "Installing jq via Homebrew..."
        if brew install jq; then
          info "${GREEN}jq installed successfully!${NC}"
          return 0
        fi
      fi
      err "Failed to install jq"
      return 1
      ;;
    linux|wsl)
      if can_sudo; then
        # Detect package manager
        if command_exists apt-get; then
          info "Installing jq via apt..."
          if sudo apt-get update -qq && sudo apt-get install -y jq; then
            info "${GREEN}jq installed successfully!${NC}"
            return 0
          fi
        elif command_exists dnf; then
          info "Installing jq via dnf..."
          if sudo dnf install -y jq; then
            info "${GREEN}jq installed successfully!${NC}"
            return 0
          fi
        elif command_exists yum; then
          info "Installing jq via yum..."
          if sudo yum install -y jq; then
            info "${GREEN}jq installed successfully!${NC}"
            return 0
          fi
        elif command_exists pacman; then
          info "Installing jq via pacman..."
          if sudo pacman -S --noconfirm jq; then
            info "${GREEN}jq installed successfully!${NC}"
            return 0
          fi
        fi
      fi
      err "Failed to install jq"
      return 1
      ;;
    windows)
      if command_exists scoop; then
        info "Installing jq via Scoop..."
        if scoop install jq; then
          info "${GREEN}jq installed successfully!${NC}"
          return 0
        fi
      elif command_exists choco; then
        info "Installing jq via Chocolatey..."
        if choco install jq -y; then
          info "${GREEN}jq installed successfully!${NC}"
          return 0
        fi
      fi
      err "Failed to install jq"
      return 1
      ;;
    *)
      err "Automatic jq installation not supported on this platform."
      return 1
      ;;
  esac
}

# Install git automatically
install_git() {
  log "Installing git"
  
  case "$PLATFORM" in
    macos)
      info "Installing git via Xcode Command Line Tools..."
      if xcode-select --install 2>/dev/null; then
        info "Please complete the Xcode Command Line Tools installation and run this script again."
        return 1
      elif command_exists brew; then
        info "Installing git via Homebrew..."
        if brew install git; then
          info "${GREEN}git installed successfully!${NC}"
          return 0
        fi
      fi
      err "Failed to install git"
      return 1
      ;;
    linux|wsl)
      if can_sudo; then
        if command_exists apt-get; then
          info "Installing git via apt..."
          if sudo apt-get update -qq && sudo apt-get install -y git; then
            info "${GREEN}git installed successfully!${NC}"
            return 0
          fi
        elif command_exists dnf; then
          info "Installing git via dnf..."
          if sudo dnf install -y git; then
            info "${GREEN}git installed successfully!${NC}"
            return 0
          fi
        elif command_exists yum; then
          info "Installing git via yum..."
          if sudo yum install -y git; then
            info "${GREEN}git installed successfully!${NC}"
            return 0
          fi
        elif command_exists pacman; then
          info "Installing git via pacman..."
          if sudo pacman -S --noconfirm git; then
            info "${GREEN}git installed successfully!${NC}"
            return 0
          fi
        fi
      fi
      err "Failed to install git"
      return 1
      ;;
    windows)
      if command_exists winget; then
        info "Installing git via winget..."
        if winget install Git.Git --accept-source-agreements --accept-package-agreements; then
          info "${GREEN}git installed successfully!${NC}"
          info "Please restart your terminal for git to be available."
          return 0
        fi
      fi
      err "Failed to install git"
      info "Please install git from: https://git-scm.com/download/win"
      return 1
      ;;
    *)
      err "Automatic git installation not supported on this platform."
      return 1
      ;;
  esac
}

# Install curl automatically
install_curl() {
  log "Installing curl"
  
  case "$PLATFORM" in
    macos)
      # curl is pre-installed on macOS
      if command_exists brew; then
        info "Installing curl via Homebrew..."
        if brew install curl; then
          info "${GREEN}curl installed successfully!${NC}"
          return 0
        fi
      fi
      err "Failed to install curl"
      return 1
      ;;
    linux|wsl)
      if can_sudo; then
        if command_exists apt-get; then
          info "Installing curl via apt..."
          if sudo apt-get update -qq && sudo apt-get install -y curl; then
            info "${GREEN}curl installed successfully!${NC}"
            return 0
          fi
        elif command_exists dnf; then
          info "Installing curl via dnf..."
          if sudo dnf install -y curl; then
            info "${GREEN}curl installed successfully!${NC}"
            return 0
          fi
        elif command_exists yum; then
          info "Installing curl via yum..."
          if sudo yum install -y curl; then
            info "${GREEN}curl installed successfully!${NC}"
            return 0
          fi
        fi
      fi
      err "Failed to install curl"
      return 1
      ;;
    windows)
      # curl is included in Windows 10+ and Git Bash
      if command_exists choco; then
        info "Installing curl via Chocolatey..."
        if choco install curl -y; then
          info "${GREEN}curl installed successfully!${NC}"
          return 0
        fi
      fi
      err "Failed to install curl"
      return 1
      ;;
    *)
      err "Automatic curl installation not supported on this platform."
      return 1
      ;;
  esac
}

# Try to install a missing dependency
try_install_dep() {
  local dep="$1"
  
  case "$dep" in
    docker) install_docker ;;
    just)   install_just ;;
    jq)     install_jq ;;
    git)    install_git ;;
    curl)   install_curl ;;
    *)      return 1 ;;
  esac
}

# Start Docker daemon
start_docker_daemon() {
  log "Starting Docker daemon"
  
  case "$PLATFORM" in
    macos)
      # Check for Colima first (CLI-based, can start from terminal)
      if command_exists colima; then
        info "Found Colima - starting Docker runtime from terminal..."
        printf "\n"
        
        # Check if Colima is already running
        if colima status 2>/dev/null | grep -q "Running"; then
          info "${GREEN}Colima is already running!${NC}"
          return 0
        fi
        
        info "Starting Colima..."
        if colima start 2>&1; then
          printf "\n"
          # Wait for Docker to be ready
          printf "    Waiting for Docker to be ready"
          local start=$(date +%s)
          while ! docker info >/dev/null 2>&1; do
            local now=$(date +%s)
            local elapsed=$((now - start))
            if [ "$elapsed" -ge "$WAIT_DOCKER_SEC" ]; then
              printf "\n\n"
              err "Docker did not become ready within ${WAIT_DOCKER_SEC} seconds."
              return 1
            fi
            printf "."
            sleep 2
          done
          printf " ${GREEN}ready!${NC}\n"
          return 0
        else
          warn "Failed to start Colima, trying Docker Desktop..."
        fi
      fi
      
      # Try Docker Desktop - check multiple possible locations
      local docker_app=""
      if [ -d "/Applications/Docker.app" ]; then
        docker_app="/Applications/Docker.app"
      elif [ -d "$HOME/Applications/Docker.app" ]; then
        docker_app="$HOME/Applications/Docker.app"
      fi
      
      if [ -n "$docker_app" ]; then
        info "Starting Docker Desktop..."
        open -g "$docker_app"
        
        printf "    Waiting for Docker to be ready"
        local start=$(date +%s)
        while ! docker info >/dev/null 2>&1; do
          local now=$(date +%s)
          local elapsed=$((now - start))
          if [ "$elapsed" -ge "$WAIT_DOCKER_SEC" ]; then
            printf "\n\n"
            err "Docker did not start within ${WAIT_DOCKER_SEC} seconds."
            info "Docker Desktop may need to complete first-time setup."
            info "Please open Docker Desktop manually from Applications, complete the setup,"
            info "then run this script again."
            return 1
          fi
          printf "."
          sleep 2
        done
        printf " ${GREEN}ready!${NC}\n"
        return 0
      fi
      
      # Docker CLI exists but no runtime - user probably installed just 'docker' via brew
      if command_exists docker; then
        printf "\n"
        warn "Docker CLI is installed, but no Docker runtime is running."
        info "The 'docker' command needs a runtime (Docker Desktop or Colima) to work."
        printf "\n"
        
        if is_interactive && command_exists brew; then
          info "Would you like to install a Docker runtime now?"
          printf "\n"
          info "  1) Colima (CLI-only, lightweight, recommended)"
          info "  2) Docker Desktop (GUI application)"
          info "  3) Skip (I'll install manually)"
          printf "\n"
          
          printf "    Enter choice [1/2/3]: "
          local choice=""
          read -r choice || choice="3"
          
          case "$choice" in
            1)
              info "Installing Colima..."
              printf "\n"
              if brew install colima docker-compose; then
                info "${GREEN}Colima installed!${NC}"
                info "Starting Colima..."
                if colima start; then
                  info "${GREEN}Colima is running! Docker daemon is ready.${NC}"
                  return 0
                else
                  err "Failed to start Colima. Try running: colima start"
                  return 1
                fi
              else
                err "Failed to install Colima"
                return 1
              fi
              ;;
            2)
              info "Installing Docker Desktop..."
              printf "\n"
              if brew install --cask docker; then
                info "${GREEN}Docker Desktop installed!${NC}"
                info "Starting Docker Desktop..."
                open -g "/Applications/Docker.app"
                
                printf "    Waiting for Docker to be ready"
                local start=$(date +%s)
                while ! docker info >/dev/null 2>&1; do
                  local now=$(date +%s)
                  local elapsed=$((now - start))
                  if [ "$elapsed" -ge "$WAIT_DOCKER_SEC" ]; then
                    printf "\n\n"
                    warn "Docker Desktop is taking a while to start."
                    info "Please wait for Docker Desktop to finish starting, then run this script again."
                    return 1
                  fi
                  printf "."
                  sleep 2
                done
                printf " ${GREEN}ready!${NC}\n"
                return 0
              else
                err "Failed to install Docker Desktop"
                return 1
              fi
              ;;
            *)
              info "Skipping Docker runtime installation."
              ;;
          esac
        fi
        
        printf "\n"
        info "Please install a Docker runtime manually:"
        printf "\n"
        info "  ${BOLD}Option 1: Colima (CLI-only, lightweight)${NC}"
        printf "    brew install colima docker-compose\n"
        printf "    colima start\n"
        printf "\n"
        info "  ${BOLD}Option 2: Docker Desktop${NC}"
        printf "    brew install --cask docker\n"
        printf "    # Then open Docker Desktop from Applications\n"
        printf "\n"
        return 1
      fi
      
      # Neither Colima nor Docker Desktop found, and no docker CLI
      err "No Docker installation found."
      info "Please install Docker using one of these methods:"
      printf "\n"
      info "  ${BOLD} Option 1: Colima (CLI-only, recommended for terminal users)${NC}"
      printf "    brew install colima docker docker-compose\n"
      printf "    colima start\n"
      printf "\n"
      info "  ${BOLD} Option 2: Docker Desktop${NC}"
      printf "    brew install --cask docker\n"
      printf "    # Then open Docker Desktop from Applications\n"
      printf "\n"
      return 1
      ;;
    linux)
      if can_sudo; then
        # Try systemctl first (systemd) - preferred method
        if command_exists systemctl; then
          info "Starting Docker via systemctl..."
          if sudo systemctl start docker 2>/dev/null; then
            # Wait for Docker to be ready (use sudo for docker info if needed)
            printf "    Waiting for Docker to be ready"
            local start=$(date +%s)
            while ! sudo docker info >/dev/null 2>&1; do
              local now=$(date +%s)
              local elapsed=$((now - start))
              if [ "$elapsed" -ge "$WAIT_DOCKER_SEC" ]; then
                printf "\n\n"
                err "Docker did not start within ${WAIT_DOCKER_SEC} seconds."
                return 1
              fi
              printf "."
              sleep 2
            done
            printf " ${GREEN}ready!${NC}\n"
            
            # Enable Docker to start on boot
            sudo systemctl enable docker 2>/dev/null || true
            return 0
          fi
        fi
        
        # Try service command (SysVinit) - fallback for non-systemd systems
        if command_exists service; then
          info "Starting Docker via service command..."
          if sudo service docker start 2>/dev/null; then
            sleep 3
            if sudo docker info >/dev/null 2>&1; then
              info "${GREEN}Docker daemon started!${NC}"
              return 0
            fi
          fi
        fi
      fi
      
      # No backgrounding dockerd - it's dangerous and conflicts with init systems
      err "Failed to start Docker daemon."
      info "Please start Docker manually using your system's init system:"
      printf "\n"
      printf "    # For systemd (most modern Linux):\n"
      printf "    sudo systemctl start docker\n"
      printf "\n"
      printf "    # For SysVinit:\n"
      printf "    sudo service docker start\n"
      return 1
      ;;
    wsl)
      # In WSL, try service command
      if can_sudo; then
        if command_exists service; then
          info "Starting Docker via service command..."
          if sudo service docker start 2>/dev/null; then
            sleep 3
            if sudo docker info >/dev/null 2>&1; then
              info "${GREEN}Docker daemon started!${NC}"
              return 0
            fi
          fi
        fi
      fi
      
      # No backgrounding dockerd - it's dangerous
      printf "\n"
      warn "Could not start Docker daemon automatically in WSL."
      info "Please use one of these options:"
      printf "\n"
      info "  1. Start Docker Desktop for Windows (with WSL2 integration enabled)"
      info "  2. Start the Docker service manually: sudo service docker start"
      return 1
      ;;
    windows)
      # On Windows (Git Bash), try to start Docker Desktop via cmd.exe
      # This is more robust than hardcoding paths (handles non-C drives, localized Windows, etc.)
      info "Attempting to start Docker Desktop..."
      
      if cmd.exe /c start "" "Docker Desktop" 2>/dev/null; then
        printf "    Waiting for Docker to be ready"
        local start=$(date +%s)
        while ! docker info >/dev/null 2>&1; do
          local now=$(date +%s)
          local elapsed=$((now - start))
          if [ "$elapsed" -ge "$WAIT_DOCKER_SEC" ]; then
            printf "\n\n"
            warn "Docker did not become ready within ${WAIT_DOCKER_SEC} seconds."
            info "Docker Desktop may still be starting. Please wait and try again."
            return 1
          fi
          printf "."
          sleep 2
        done
        printf " ${GREEN}ready!${NC}\n"
        return 0
      else
        warn "Could not start Docker Desktop automatically."
        info "Please start Docker Desktop manually from the Start menu."
        return 1
      fi
      ;;
    *)
      err "Cannot start Docker daemon on this platform automatically."
      return 1
      ;;
  esac
}

# ---------- Dependency Installation Instructions (fallback) ----------
show_install_instructions() {
  local dep="$1"
  
  printf "\n"
  printf "    ${BOLD}How to install ${dep}:${NC}\n"
  printf "\n"
  
  case "$dep" in
    docker)
      case "$PLATFORM" in
        macos)
          printf "    ${CYAN} Option 1: Download Docker Desktop${NC}\n"
          printf "      https://www.docker.com/products/docker-desktop\n"
          printf "\n"
          printf "    ${CYAN} Option 2: Install via Homebrew${NC}\n"
          printf "      brew install --cask docker\n"
          ;;
        linux)
          printf "    ${CYAN} Install Docker Engine:${NC}\n"
          printf "      curl -fsSL https://get.docker.com | sudo sh\n"
          printf "      sudo usermod -aG docker \$USER\n"
          printf "      # Log out and back in for group changes to take effect\n"
          ;;
        wsl)
          printf "    ${CYAN} Option 1: Use Docker Desktop for Windows${NC}\n"
          printf "      Install Docker Desktop and enable WSL2 integration in Settings\n"
          printf "      https://www.docker.com/products/docker-desktop\n"
          printf "\n"
          printf "    ${CYAN} Option 2: Install Docker Engine in WSL${NC}\n"
          printf "      curl -fsSL https://get.docker.com | sudo sh\n"
          printf "      sudo usermod -aG docker \$USER\n"
          ;;
        windows)
          printf "    ${CYAN}Install Docker Desktop for Windows:${NC}\n"
          printf "      https://www.docker.com/products/docker-desktop\n"
          printf "\n"
          printf "    ${CYAN}Or via winget:${NC}\n"
          printf "      winget install Docker.DockerDesktop\n"
          ;;
      esac
      ;;
    just)
      case "$PLATFORM" in
        macos)
          printf "    ${CYAN} Install via Homebrew:${NC}\n"
          printf "      brew install just\n"
          ;;
        linux|wsl)
          printf "    ${CYAN} Option 1: Install via script${NC}\n"
          printf "      curl --proto '=https' --tlsv1.2 -sSf https://just.systems/install.sh | bash -s -- --to ~/.local/bin\n"
          printf "      # Add ~/.local/bin to your PATH if not already\n"
          printf "\n"
          printf "    ${CYAN} Option 2: Install via package manager${NC}\n"
          printf "      # Debian/Ubuntu (if available)\n"
          printf "      sudo apt install just\n"
          ;;
        windows)
          printf "    ${CYAN} Option 1: Install via Scoop${NC}\n"
          printf "      scoop install just\n"
          printf "\n"
          printf "    ${CYAN} Option 2: Install via Chocolatey${NC}\n"
          printf "      choco install just\n"
          printf "\n"
          printf "    ${CYAN} Option 3: Download from GitHub${NC}\n"
          printf "      https://github.com/casey/just/releases\n"
          ;;
      esac
      ;;
    curl)
      case "$PLATFORM" in
        macos)
          printf "    curl is pre-installed on macOS.\n"
          printf "    If missing, install via: brew install curl\n"
          ;;
        linux|wsl)
          printf "    ${CYAN}Debian/Ubuntu:${NC}\n"
          printf "      sudo apt-get update && sudo apt-get install -y curl\n"
          printf "\n"
          printf "    ${CYAN}RHEL/CentOS/Fedora:${NC}\n"
          printf "      sudo dnf install curl\n"
          ;;
        windows)
          printf "    curl is included in Windows 10+ and Git Bash.\n"
          printf "    If missing, install via: choco install curl\n"
          ;;
      esac
      ;;
    jq)
      case "$PLATFORM" in
        macos)
          printf "    ${CYAN} Install via Homebrew:${NC}\n"
          printf "      brew install jq\n"
          ;;
        linux|wsl)
          printf "    ${CYAN} Debian/Ubuntu:${NC}\n"
          printf "      sudo apt-get update && sudo apt-get install -y jq\n"
          printf "\n"
          printf "    ${CYAN} RHEL/CentOS/Fedora:${NC}\n"
          printf "      sudo dnf install jq\n"
          ;;
        windows)
          printf "    ${CYAN} Option 1: Install via Scoop${NC}\n"
          printf "      scoop install jq\n"
          printf "\n"
          printf "    ${CYAN} Option 2: Install via Chocolatey${NC}\n"
          printf "      choco install jq\n"
          ;;
      esac
      ;;
    git)
      case "$PLATFORM" in
        macos)
          printf "    ${CYAN} Install via Xcode Command Line Tools:${NC}\n"
          printf "      xcode-select --install\n"
          printf "\n"
          printf "    ${CYAN} Or via Homebrew:${NC}\n"
          printf "      brew install git\n"
          ;;
        linux|wsl)
          printf "    ${CYAN} Debian/Ubuntu:${NC}\n"
          printf "      sudo apt-get update && sudo apt-get install -y git\n"
          printf "\n"
          printf "    ${CYAN} RHEL/CentOS/Fedora:${NC}\n"
          printf "      sudo dnf install git\n"
          ;;
        windows)
          printf "    ${CYAN} Download Git for Windows:${NC}\n"
          printf "      https://git-scm.com/download/win\n"
          printf "\n"
          printf "    ${CYAN} Or via winget:${NC}\n"
          printf "      winget install Git.Git\n"
          ;;
      esac
      ;;
  esac
}

# ---------- Main Script ----------

detect_platform

# Banner
printf "\n"
printf "${BLUE}┌─────────────────────────────────────────────────────────────────┐${NC}\n"
printf "${BLUE}│${NC}                                                                 ${BLUE}│${NC}\n"
printf "${BLUE}│${NC}   ${BOLD}ShipSec Studio Installer${NC}                                      ${BLUE}│${NC}\n"
printf "${BLUE}│${NC}   Self-Hosted Production Deployment                             ${BLUE}│${NC}\n"
printf "${BLUE}│${NC}                                                                 ${BLUE}│${NC}\n"
printf "${BLUE}└─────────────────────────────────────────────────────────────────┘${NC}\n"
printf "\n"
info "Platform: ${BOLD}$PLATFORM_NAME${NC}"
info "Documentation: https://docs.shipsec.ai"
printf "\n"

# ---------- Early Check: Truly non-interactive mode without sudo ----------
# Only warn if we truly can't interact (no /dev/tty available)
if ! is_interactive; then
  # Truly non-interactive mode - check if we have sudo access
  if [ "$PLATFORM" = "linux" ] || [ "$PLATFORM" = "wsl" ]; then
    if [ "$(id -u)" != "0" ] && ! sudo -n true 2>/dev/null; then
      warn "Running in non-interactive mode without sudo access."
      info "If dependencies need to be installed, the script will fail."
      info "For unattended installation, either:"
      info "  - Run as root"
      info "  - Configure passwordless sudo"
      info "  - Pre-install all dependencies (docker, just, curl, jq, git)"
      printf "\n"
    fi
  fi
fi

# ---------- Check Prerequisites ----------
log "Checking prerequisites"
printf "\n"
info "ShipSec Studio requires the following tools:"
info "  - docker    (container runtime)"
info "  - just      (command runner)"
info "  - curl      (HTTP client)"
info "  - jq        (JSON processor)"
info "  - git       (version control)"
printf "\n"

MISSING_DEPS=""
ALL_OK=true

# Check each dependency (docker last since it may require logout/login on Linux)
for dep in just curl jq git docker; do
  if command_exists "$dep"; then
    case "$dep" in
      docker) ver=$(docker --version 2>/dev/null | sed 's/Docker version //' | cut -d',' -f1) ;;
      just)   ver=$(just --version 2>/dev/null | head -1) ;;
      curl)   ver=$(curl --version 2>/dev/null | head -1 | awk '{print $2}') ;;
      jq)     ver=$(jq --version 2>/dev/null) ;;
      git)    ver=$(git --version 2>/dev/null | sed 's/git version //') ;;
    esac
    printf "    ${GREEN}✓${NC} %-10s %s\n" "$dep" "$ver"
  else
    printf "    ${RED}✗${NC} %-10s ${RED}not found${NC}\n" "$dep"
    MISSING_DEPS="$MISSING_DEPS $dep"
    ALL_OK=false
  fi
done

# If dependencies are missing, offer to install them
if [ "$ALL_OK" = false ]; then
  MISSING_DEPS="${MISSING_DEPS# }"  # trim leading space
  
  printf "\n"
  warn "Missing required dependencies: ${BOLD}$MISSING_DEPS${NC}"
  printf "\n"
  
  # Check if we can interact with user (works even with curl | bash)
  if is_interactive; then
    if ask_yes_no "Would you like to install the missing dependencies automatically?" "y"; then
      INSTALL_FAILED=""
      
      for dep in $MISSING_DEPS; do
        printf "\n"
        if try_install_dep "$dep"; then
          # Re-check if the command is now available
          if command_exists "$dep"; then
            printf "    ${GREEN}✓${NC} $dep is now available\n"
          else
            # Some installations require PATH update or terminal restart
            warn "$dep was installed but may require a terminal restart to be available."
            INSTALL_FAILED="$INSTALL_FAILED $dep"
          fi
        else
          INSTALL_FAILED="$INSTALL_FAILED $dep"
        fi
      done
      
      # Check if any installations failed
      if [ -n "$INSTALL_FAILED" ]; then
        INSTALL_FAILED="${INSTALL_FAILED# }"  # trim leading space
        printf "\n"
        err "Could not install: ${BOLD}$INSTALL_FAILED${NC}"
        printf "\n"
        info "Please install these dependencies manually:"
        
        for dep in $INSTALL_FAILED; do
          show_install_instructions "$dep"
        done
        
        printf "\n"
        info "After installing, run this script again:"
        printf "\n"
        printf "    curl -fsSL https://raw.githubusercontent.com/ShipSecAI/studio/main/install.sh | bash\n"
        printf "\n"
        exit 1
      fi
      
      printf "\n"
      info "${GREEN}All dependencies installed successfully!${NC}"
    else
      # User declined automatic installation
      printf "\n"
      info "Manual installation instructions:"
      
      for dep in $MISSING_DEPS; do
        show_install_instructions "$dep"
      done
      
      printf "\n"
      info "After installing the missing dependencies, run this script again:"
      printf "\n"
      printf "    curl -fsSL https://raw.githubusercontent.com/ShipSecAI/studio/main/install.sh | bash\n"
      printf "\n"
      exit 1
    fi
  else
    # Non-interactive mode - show instructions and exit
    err "Missing required dependencies: ${BOLD}$MISSING_DEPS${NC}"
    
    for dep in $MISSING_DEPS; do
      show_install_instructions "$dep"
    done
    
    printf "\n"
    info "After installing the missing dependencies, run this script again:"
    printf "\n"
    printf "    curl -fsSL https://raw.githubusercontent.com/ShipSecAI/studio/main/install.sh | bash\n"
    printf "\n"
    exit 1
  fi
else
  printf "\n"
  info "${GREEN}All prerequisites are installed!${NC}"
fi

# ---------- Check Docker Group Membership (Linux/WSL only) ----------
if [ "$PLATFORM" = "linux" ] || [ "$PLATFORM" = "wsl" ]; then
  if ! check_docker_group; then
    printf "\n"
    warn "You are not in the 'docker' group."
    info "Docker group membership is required to run Docker commands without sudo."
    printf "\n"
    info "To fix this, run:"
    printf "\n"
    printf "    sudo usermod -aG docker \$USER\n"
    printf "\n"
    info "Then ${BOLD}log out and log back in${NC} for the change to take effect."
    info "After logging back in, run this script again."
    printf "\n"
    exit 1
  fi
fi

# ---------- Check Docker Daemon ----------
log "Checking Docker daemon"

if ! docker info >/dev/null 2>&1; then
  printf "\n"
  warn "Docker daemon is not running."
  printf "\n"
  
  # Check if we can interact with user (works even with curl | bash)
  if is_interactive; then
    if ask_yes_no "Would you like to start Docker automatically?" "y"; then
      printf "\n"
      if start_docker_daemon; then
        printf "\n"
        info "${GREEN}Docker daemon is now running!${NC}"
      else
        printf "\n"
        err "Failed to start Docker daemon automatically."
        printf "\n"
        
        case "$PLATFORM" in
          macos)
            info "Please start Docker Desktop from your Applications folder and run this script again."
            ;;
          linux)
            info "Please start Docker manually:"
            printf "    sudo systemctl start docker\n"
            printf "\n"
            info "Then run this script again."
            ;;
          wsl)
            info "To use Docker in WSL, you have two options:"
            printf "\n"
            info "  1. Start Docker Desktop for Windows (with WSL2 integration enabled)"
            info "  2. Start the Docker service in WSL: sudo service docker start"
            printf "\n"
            info "Then run this script again."
            ;;
          windows)
            info "Please start Docker Desktop for Windows and run this script again."
            ;;
        esac
        exit 1
      fi
    else
      printf "\n"
      case "$PLATFORM" in
        macos)
          info "Please start Docker Desktop from your Applications folder and run this script again."
          ;;
        linux)
          info "To start Docker, run:"
          printf "\n"
          printf "    sudo systemctl start docker\n"
          printf "\n"
          info "Then run this script again."
          ;;
        wsl)
          info "To use Docker in WSL, you have two options:"
          printf "\n"
          info "  1. Start Docker Desktop for Windows (with WSL2 integration enabled)"
          info "  2. Start the Docker service in WSL: sudo service docker start"
          printf "\n"
          info "Then run this script again."
          ;;
        windows)
          info "Please start Docker Desktop for Windows and run this script again."
          ;;
      esac
      exit 1
    fi
  else
    # Non-interactive mode - try to start automatically
    printf "\n"
    info "Attempting to start Docker daemon automatically..."
    printf "\n"
    
    if start_docker_daemon; then
      printf "\n"
      info "${GREEN}Docker daemon is now running!${NC}"
    else
      printf "\n"
      err "Failed to start Docker daemon."
      printf "\n"
      
      case "$PLATFORM" in
        macos)
          info "Please start Docker Desktop and run this script again."
          ;;
        linux)
          info "Please start Docker manually: sudo systemctl start docker"
          ;;
        wsl)
          info "Please start Docker Desktop for Windows or run: sudo service docker start"
          ;;
        windows)
          info "Please start Docker Desktop for Windows."
          ;;
      esac
      exit 1
    fi
  fi
else
  printf "\n"
  info "${GREEN}Docker daemon is running!${NC}"
fi

# ---------- Repository Setup ----------
log "Setting up repository"

IN_REPO=false

# Check if already in the repo
if [ -d .git ] && [ -f justfile ]; then
  IN_REPO=true
  info "Already in ShipSec Studio repository."
# Check if repo exists in current directory
elif [ -d "$REPO_DIR" ] && [ -d "$REPO_DIR/.git" ] && [ -f "$REPO_DIR/justfile" ]; then
  info "Found existing repository in ./$REPO_DIR"
  cd "$REPO_DIR" || { err "Failed to enter directory"; exit 1; }
  IN_REPO=true
fi

if [ "$IN_REPO" = false ]; then
  if [ -d "$REPO_DIR" ]; then
    printf "\n"
    warn "Directory '$REPO_DIR' already exists."
    
    if ask_yes_no "Do you want to use the existing directory?" "y"; then
      cd "$REPO_DIR" || { err "Failed to enter directory"; exit 1; }
    else
      info "Please remove or rename the '$REPO_DIR' directory and run this script again."
      exit 1
    fi
  else
    printf "\n"
    info "Cloning repository from GitHub..."
    printf "\n"
    
    if ! git clone "$REPO_URL" "$REPO_DIR"; then
      err "Failed to clone repository"
      exit 1
    fi
    
    cd "$REPO_DIR" || { err "Failed to enter directory"; exit 1; }
  fi
fi

PROJECT_ROOT="$(pwd)"
printf "\n"
info "Project directory: ${BOLD}$PROJECT_ROOT${NC}"

# ---------- Confirm Installation ----------
log "Ready to install"

printf "\n"
info "This will:"
info "  1. Fetch the latest release version from GitHub"
info "  2. Pull pre-built Docker images from GHCR"
info "  3. Start the full stack (frontend, backend, worker, infrastructure)"
printf "\n"
info "The following services will be available:"
info "  - Frontend:    http://localhost:8090"
info "  - Backend:     http://localhost:3211"
info "  - Temporal UI: http://localhost:8081"
printf "\n"

if ! ask_yes_no "Do you want to proceed with the installation?" "y"; then
  printf "\n"
  info "Installation cancelled."
  printf "\n"
  info "To install later, run:"
  printf "\n"
  printf "    cd %s && just prod start-latest\n" "$PROJECT_ROOT"
  printf "\n"
  exit 0
fi

# ---------- Start Installation ----------
log "Installing ShipSec Studio"

printf "\n"
if ! just prod start-latest; then
  printf "\n"
  err "Installation failed."
  err "Please check the error messages above."
  printf "\n"
  info "For troubleshooting, visit: https://github.com/ShipSecAI/studio/issues"
  exit 1
fi

# ---------- Success ----------
printf "\n"
printf "${GREEN}┌─────────────────────────────────────────────────────────────────┐${NC}\n"
printf "${GREEN}│${NC}                                                                 ${GREEN}│${NC}\n"
printf "${GREEN}│${NC}   ${BOLD}Installation Complete!${NC}                                        ${GREEN}│${NC}\n"
printf "${GREEN}│${NC}                                                                 ${GREEN}│${NC}\n"
printf "${GREEN}│${NC}   Open ShipSec Studio in your browser:                          ${GREEN}│${NC}\n"
printf "${GREEN}│${NC}                                                                 ${GREEN}│${NC}\n"
printf "${GREEN}│${NC}       ${BOLD}http://localhost:8090${NC}                                     ${GREEN}│${NC}\n"
printf "${GREEN}│${NC}                                                                 ${GREEN}│${NC}\n"
printf "${GREEN}└─────────────────────────────────────────────────────────────────┘${NC}\n"
printf "\n"
info "Useful commands:"
printf "\n"
printf "    just prod status   - Check service status\n"
printf "    just prod logs     - View logs\n"
printf "    just prod stop     - Stop all services\n"
printf "    just prod clean    - Remove all data\n"
printf "\n"
info "Documentation: https://docs.shipsec.ai"
info "Need help? https://github.com/ShipSecAI/studio/issues"
printf "\n"

exit 0
