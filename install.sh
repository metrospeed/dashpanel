#!/usr/bin/env bash
# dashpanel installer for Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/metrospeed/dashpanel/main/install.sh | sudo bash
#
# Installs (or updates) dashpanel into /opt/dashpanel and runs it as a systemd
# service. Run it again at any time to update; your config is kept.
# Pass --docker to run it with Docker Compose instead. --help for all options.
set -euo pipefail

REPO="${DASHPANEL_REPO:-https://github.com/metrospeed/dashpanel.git}"
BRANCH="${DASHPANEL_BRANCH:-main}"
DIR="${DASHPANEL_DIR:-/opt/dashpanel}"
PORT=""
MODE="service" # service | docker | none
UNINSTALL=0
PURGE=0
SERVICE_USER="dashpanel"
ENV_FILE="/etc/dashpanel.env"
UNIT_FILE="/etc/systemd/system/dashpanel.service"
MIN_NODE=18
NODE_MAJOR=22 # installed from NodeSource when the distro's Node is too old

usage() {
  cat <<EOF
Usage: install.sh [options]

  --dir PATH      Install directory (default: /opt/dashpanel)
  --port PORT     Port to listen on (default: 7676)
  --branch NAME   Git branch to install (default: main)
  --docker        Run with Docker Compose instead of a systemd service
  --no-service    Only install files and Node; don't create a service
  --uninstall     Stop and remove the service (keeps the install dir)
  --purge         With --uninstall: also delete the install dir and config
  -h, --help      Show this help

Environment overrides: DASHPANEL_REPO, DASHPANEL_BRANCH, DASHPANEL_DIR
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --docker) MODE="docker"; shift ;;
    --no-service) MODE="none"; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --purge) PURGE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [ -n "$PORT" ] && ! [[ "$PORT" =~ ^[0-9]+$ && "$PORT" -ge 1 && "$PORT" -le 65535 ]]; then
  echo "--port must be a number between 1 and 65535" >&2
  exit 1
fi

# ------------------------------------------------------------------ output

if [ -t 1 ]; then
  BOLD=$'\e[1m'; DIM=$'\e[2m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; RESET=$'\e[0m'
else
  BOLD=""; DIM=""; GREEN=""; YELLOW=""; RED=""; RESET=""
fi
step() { echo "${BOLD}==>${RESET} $*"; }
info() { echo "    $*"; }
warn() { echo "${YELLOW}warning:${RESET} $*" >&2; }
die() { echo "${RED}error:${RESET} $*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

if [ "$(id -u)" -ne 0 ]; then
  die "run as root, e.g.: curl -fsSL <install.sh url> | sudo bash"
fi

# ------------------------------------------------------------------ packages

PM=""
for candidate in apt-get dnf yum pacman zypper apk; do
  if have "$candidate"; then PM="$candidate"; break; fi
done

APT_UPDATED=0
pkg_install() {
  case "$PM" in
    apt-get)
      if [ "$APT_UPDATED" -eq 0 ]; then apt-get update -qq; APT_UPDATED=1; fi
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null ;;
    dnf|yum) "$PM" install -y -q "$@" >/dev/null ;;
    pacman) pacman -Sy --noconfirm --needed "$@" >/dev/null ;;
    zypper) zypper --non-interactive --quiet install "$@" >/dev/null ;;
    apk) apk add --quiet "$@" >/dev/null ;;
    *) die "no supported package manager found; install $* manually and re-run" ;;
  esac
}

node_major() {
  have node || { echo 0; return; }
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

install_base_packages() {
  local missing=()
  have git || missing+=(git)
  have curl || missing+=(curl)
  if [ "$MODE" != "docker" ] && ! have ping; then
    case "$PM" in
      apt-get) missing+=(iputils-ping) ;;
      apk) ;; # busybox ping
      *) missing+=(iputils) ;;
    esac
  fi
  if [ ${#missing[@]} -gt 0 ]; then
    step "Installing ${missing[*]}"
    [ "$PM" = "apt-get" ] && missing+=(ca-certificates)
    pkg_install "${missing[@]}"
  fi
}

install_node() {
  if [ "$(node_major)" -ge "$MIN_NODE" ]; then
    info "Node.js $(node -v) found"
    return
  fi
  step "Installing Node.js"
  case "$PM" in
    apt-get|dnf|yum)
      # Distro packages are often too old (Ubuntu 22.04 ships Node 12), so use NodeSource.
      local family="deb"
      [ "$PM" != "apt-get" ] && family="rpm"
      curl -fsSL "https://${family}.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
      pkg_install nodejs ;;
    pacman|apk|zypper) pkg_install nodejs ;;
    *) die "install Node.js ${MIN_NODE}+ manually and re-run" ;;
  esac
  [ "$(node_major)" -ge "$MIN_NODE" ] || die "Node.js ${MIN_NODE}+ is required, found $(node -v 2>/dev/null || echo none)"
  info "Node.js $(node -v) installed"
}

# ------------------------------------------------------------------ files

git_dir() { git -c safe.directory="$DIR" -C "$DIR" "$@"; }

fetch_code() {
  if [ -d "$DIR/.git" ]; then
    step "Updating $DIR"
    git_dir fetch --quiet origin "$BRANCH"
    git_dir checkout --quiet "$BRANCH"
    git_dir merge --quiet --ff-only "origin/$BRANCH" \
      || die "local changes in $DIR block the update; commit or discard them and re-run"
  elif [ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ]; then
    die "$DIR exists and is not a dashpanel checkout; pick another --dir"
  else
    step "Downloading dashpanel to $DIR"
    git clone --quiet --depth 1 --branch "$BRANCH" "$REPO" "$DIR"
  fi
  # config/dashboard.json and uploaded backgrounds are git-ignored, so updates never touch them.
  mkdir -p "$DIR/config" "$DIR/.cache"
}

new_token() {
  if have openssl; then openssl rand -hex 16; else head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

# Write KEY=value into an env file, replacing an existing line.
set_env() {
  local file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

get_env() { grep "^$2=" "$1" 2>/dev/null | head -1 | cut -d= -f2-; }

# ------------------------------------------------------------------ service

write_unit() {
  local node_bin sandbox=""
  node_bin="$(command -v node)"
  # Filesystem sandboxing needs mount namespaces, which unprivileged LXC containers
  # (e.g. on Proxmox without nesting) often lack; the container already isolates us there.
  if ! systemd-detect-virt --container --quiet 2>/dev/null; then
    sandbox="ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=${DIR}/config ${DIR}/.cache"
  fi
  cat > "$UNIT_FILE" <<EOF
[Unit]
Description=dashpanel homelab start page
Documentation=https://github.com/metrospeed/dashpanel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${node_bin} ${DIR}/server.js
Restart=on-failure
RestartSec=3

# Ping checks need raw sockets.
AmbientCapabilities=CAP_NET_RAW
CapabilityBoundingSet=CAP_NET_RAW
NoNewPrivileges=true
${sandbox}

[Install]
WantedBy=multi-user.target
EOF
}

install_service() {
  have systemctl && [ -d /run/systemd/system ] || {
    warn "systemd isn't running here, so no service was created."
    info "Start it yourself with: cd $DIR && PORT=${PORT:-7676} node server.js"
    MODE="none"
    return
  }

  if ! id "$SERVICE_USER" >/dev/null 2>&1; then
    step "Creating system user $SERVICE_USER"
    local nologin
    nologin="$(command -v nologin || echo /bin/false)"
    useradd --system --home-dir "$DIR" --no-create-home --shell "$nologin" "$SERVICE_USER"
  fi
  chown -R "$SERVICE_USER:$SERVICE_USER" "$DIR"

  if [ ! -f "$ENV_FILE" ]; then
    step "Creating $ENV_FILE"
    install -m 600 /dev/null "$ENV_FILE"
    {
      echo "# dashpanel settings, read by dashpanel.service"
      echo "PORT=${PORT:-7676}"
      echo "# Needed to edit the dashboard from other machines and to use the MCP server remotely."
      echo "DASHPANEL_TOKEN=$(new_token)"
    } >> "$ENV_FILE"
  elif [ -n "$PORT" ]; then
    set_env "$ENV_FILE" PORT "$PORT"
  fi

  step "Installing systemd service"
  write_unit
  systemctl daemon-reload
  systemctl enable --quiet dashpanel
  systemctl restart dashpanel
}

install_docker() {
  have docker || die "Docker is not installed. See https://docs.docker.com/engine/install/"
  docker compose version >/dev/null 2>&1 || die "the Docker Compose plugin is required (docker compose)"
  local env="$DIR/.env"
  if [ ! -f "$env" ]; then
    install -m 600 /dev/null "$env"
    echo "DASHPANEL_TOKEN=$(new_token)" >> "$env"
  fi
  if [ -n "$PORT" ]; then
    set_env "$env" PORT "$PORT"
  elif [ -z "$(get_env "$env" PORT)" ]; then
    set_env "$env" PORT 7676
  fi
  step "Starting with Docker Compose"
  (cd "$DIR" && docker compose up -d --build --quiet-pull)
}

uninstall() {
  if [ "$PURGE" -eq 1 ]; then
    # Resolve symlinks and '..' before checking the directory we would delete.
    DIR="$(cd -- "$DIR" && pwd -P)" || die "cannot resolve install directory"
    case "$DIR" in
      /|/bin|/boot|/dev|/etc|/home|/lib|/lib64|/media|/mnt|/opt|/proc|/root|/run|/sbin|/srv|/sys|/tmp|/usr|/usr/local|/var|/var/lib|/var/www)
        die "refusing to purge system directory $DIR" ;;
    esac
    # Check identity before stopping anything or removing the systemd unit.
    [ -f "$DIR/server.js" ] && [ -f "$DIR/install.sh" ] \
      && [ -f "$DIR/config/dashboard.example.json" ] \
      && grep -Eq '"name"[[:space:]]*:[[:space:]]*"dashpanel"' "$DIR/package.json" \
      || die "$DIR doesn't look like a dashpanel install; not deleting it"
  fi
  if [ -f "$DIR/docker-compose.yml" ] && have docker && (cd "$DIR" && docker compose ps -q 2>/dev/null | grep -q .); then
    step "Stopping Docker container"
    (cd "$DIR" && docker compose down)
  fi
  if [ -f "$UNIT_FILE" ]; then
    step "Removing systemd service"
    systemctl disable --now --quiet dashpanel 2>/dev/null || true
    rm -f "$UNIT_FILE"
    systemctl daemon-reload
  fi
  if [ "$PURGE" -eq 1 ]; then
    step "Deleting $DIR and $ENV_FILE"
    rm -rf "$DIR" "$ENV_FILE"
    id "$SERVICE_USER" >/dev/null 2>&1 && userdel "$SERVICE_USER" 2>/dev/null || true
  else
    info "Kept $DIR (your config is in $DIR/config). Use --uninstall --purge to delete it."
  fi
  echo "${GREEN}dashpanel uninstalled.${RESET}"
}

# ------------------------------------------------------------------ main

# Everything runs from main(), which bash has to read in full before starting.
# That way nothing can swallow the rest of the script when it's piped via curl | bash.
main() {
  if [ "$UNINSTALL" -eq 1 ]; then
    uninstall
    return
  fi

  install_base_packages
  [ "$MODE" = "docker" ] || install_node
  fetch_code

  case "$MODE" in
    service) install_service ;;
    docker) install_docker ;;
  esac

  if [ "$MODE" = "docker" ]; then
    port="$(get_env "$DIR/.env" PORT)"
    token="$(get_env "$DIR/.env" DASHPANEL_TOKEN)"
  elif [ "$MODE" = "service" ]; then
    port="$(get_env "$ENV_FILE" PORT)"
    token="$(get_env "$ENV_FILE" DASHPANEL_TOKEN)"
  else
    port="${PORT:-7676}"
    token=""
  fi

  if [ "$MODE" != "none" ]; then
    step "Waiting for dashpanel to start"
    for _ in $(seq 1 30); do
      curl -fsS -o /dev/null "http://127.0.0.1:${port}/api/config" 2>/dev/null && break
      sleep 1
    done
    if ! curl -fsS -o /dev/null "http://127.0.0.1:${port}/api/config" 2>/dev/null; then
      [ "$MODE" = "service" ] && die "dashpanel didn't start. Check: journalctl -u dashpanel -n 50"
      die "dashpanel didn't start. Check: cd $DIR && docker compose logs"
    fi
  fi

  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  url="http://${ip:-localhost}:${port}"

  echo
  echo "${GREEN}${BOLD}dashpanel is ready${RESET}"
  if [ "$MODE" != "none" ]; then
    echo "  Open:    ${BOLD}${url}${RESET}"
  fi
  echo "  Config:  ${DIR}/config/dashboard.json"
  if [ -n "$token" ]; then
    echo "  Token:   ${token}   ${DIM}(asked for when you edit from another machine)${RESET}"
    echo
    echo "  Manage it from Claude Code on your computer:"
    echo "    claude mcp add dashpanel --scope user -e DASHPANEL_URL=${url} -e DASHPANEL_TOKEN=${token} -- npx -y github:metrospeed/dashpanel"
  fi
  echo
  if [ "$MODE" = "service" ]; then
    echo "  Logs: journalctl -u dashpanel -f    Update: re-run this script    Remove: install.sh --uninstall"
  elif [ "$MODE" = "docker" ]; then
    echo "  Logs: cd $DIR && docker compose logs -f    Update: re-run with --docker"
  fi
}

main
