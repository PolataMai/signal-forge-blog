#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/signal-forge"
SERVICE_NAME="signal-forge"
DOMAIN=""
REPO_URL=""
BRANCH="main"
ADMIN_PASSWORD=""
SESSION_SECRET=""
PORT="3000"
INSTALL_NGINX="true"
PKG_MANAGER=""
NODE_VERSION="v20.20.2"
NODE_UNOFFICIAL_BASE_URL="https://unofficial-builds.nodejs.org/download/release"

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "Please run this script with sudo or as root." >&2
    exit 1
  fi
}

detect_pkg_manager() {
  if command -v dnf >/dev/null 2>&1; then
    PKG_MANAGER="dnf"
    return
  fi

  if command -v yum >/dev/null 2>&1; then
    PKG_MANAGER="yum"
    return
  fi

  if command -v apt-get >/dev/null 2>&1; then
    PKG_MANAGER="apt-get"
    return
  fi

  echo "Unsupported package manager. Expected dnf, yum, or apt-get." >&2
  exit 1
}

pkg_update() {
  case "$PKG_MANAGER" in
    dnf)
      dnf -y makecache
      ;;
    yum)
      yum -y makecache
      ;;
    apt-get)
      apt-get update
      ;;
  esac
}

pkg_install() {
  case "$PKG_MANAGER" in
    dnf)
      dnf install -y "$@"
      ;;
    yum)
      yum install -y "$@"
      ;;
    apt-get)
      apt-get install -y "$@"
      ;;
  esac
}

version_lt() {
  local left="$1"
  local right="$2"

  if [[ "$left" == "$right" ]]; then
    return 1
  fi

  [[ "$(printf '%s\n%s\n' "$left" "$right" | sort -V | head -n 1)" == "$left" ]]
}

ensure_base_packages() {
  pkg_update

  case "$PKG_MANAGER" in
    dnf)
      pkg_install git curl openssl ca-certificates
      ;;
    yum)
      pkg_install epel-release || true
      pkg_install git curl openssl ca-certificates
      ;;
    apt-get)
      pkg_install git curl openssl ca-certificates
      ;;
  esac
}

node_major_version() {
  if ! command -v node >/dev/null 2>&1; then
    echo "0"
    return
  fi

  node -p "process.versions.node.split('.')[0]"
}

glibc_version() {
  if command -v getconf >/dev/null 2>&1; then
    getconf GNU_LIBC_VERSION | awk '{print $2}'
    return
  fi

  ldd --version | head -n 1 | grep -oE '[0-9]+\.[0-9]+' | head -n 1
}

install_nodejs_unofficial_glibc217() {
  local arch
  local node_dir
  local tarball
  local download_url
  local expected_size
  local actual_size

  arch="$(uname -m)"
  if [[ "$arch" != "x86_64" ]]; then
    echo "CentOS 7 fallback currently supports only x86_64. Current arch: $arch" >&2
    exit 1
  fi

  pkg_install xz

  node_dir="/usr/local/lib/nodejs/node-${NODE_VERSION}-linux-x64-glibc-217"
  tarball="/tmp/node-${NODE_VERSION}-linux-x64-glibc-217.tar.xz"
  download_url="${NODE_UNOFFICIAL_BASE_URL}/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64-glibc-217.tar.xz"

  mkdir -p /usr/local/lib/nodejs
  rm -rf "$node_dir"
  expected_size="$(curl -fsSI "$download_url" | awk '/^Content-Length:/ {print $2}' | tr -d '\r')"

  echo "Downloading ${download_url}"
  curl -fL --retry 5 --retry-delay 2 --retry-all-errors --continue-at - "$download_url" -o "$tarball"

  actual_size="$(wc -c < "$tarball" | tr -d ' ')"
  if [[ -n "$expected_size" && "$actual_size" != "$expected_size" ]]; then
    echo "Downloaded file size mismatch: expected ${expected_size}, got ${actual_size}" >&2
    exit 1
  fi

  tar -xJf "$tarball" -C /usr/local/lib/nodejs

  ln -sfn "${node_dir}/bin/node" /usr/local/bin/node
  ln -sfn "${node_dir}/bin/npm" /usr/local/bin/npm
  ln -sfn "${node_dir}/bin/npx" /usr/local/bin/npx

  if [[ -x "${node_dir}/bin/corepack" ]]; then
    ln -sfn "${node_dir}/bin/corepack" /usr/local/bin/corepack
  fi

  echo "Installed Node.js ${NODE_VERSION} from unofficial glibc-217 build for CentOS 7 compatibility."
}

install_nodejs() {
  local major_version
  local glibc_ver
  major_version="$(node_major_version)"

  if [[ "$major_version" -ge 18 ]]; then
    return
  fi

  glibc_ver="$(glibc_version)"

  if version_lt "$glibc_ver" "2.28"; then
    echo "Detected glibc ${glibc_ver}. NodeSource Node 20 requires glibc >= 2.28." >&2
    echo "Falling back to Node.js ${NODE_VERSION} unofficial linux-x64-glibc-217 build." >&2
    echo "Warning: this fallback is experimental. CentOS Linux 7 reached EOL on June 30, 2024." >&2
    install_nodejs_unofficial_glibc217
    return
  fi

  case "$PKG_MANAGER" in
    dnf|yum)
      curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
      pkg_install nodejs
      ;;
    apt-get)
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
      pkg_install nodejs
      ;;
  esac
}

install_nginx() {
  if command -v nginx >/dev/null 2>&1; then
    systemctl enable --now nginx
    return
  fi

  case "$PKG_MANAGER" in
    dnf)
      pkg_install nginx
      ;;
    yum)
      pkg_install nginx
      ;;
    apt-get)
      pkg_install nginx
      ;;
  esac

  systemctl enable --now nginx
}

configure_selinux() {
  if ! command -v getenforce >/dev/null 2>&1; then
    return
  fi

  if [[ "$(getenforce)" == "Disabled" ]]; then
    return
  fi

  if ! command -v setsebool >/dev/null 2>&1; then
    case "$PKG_MANAGER" in
      dnf)
        pkg_install policycoreutils-python-utils
        ;;
      yum)
        pkg_install policycoreutils-python || true
        ;;
    esac
  fi

  if command -v setsebool >/dev/null 2>&1; then
    setsebool -P httpd_can_network_connect 1 || true
  fi
}

configure_firewalld() {
  if ! command -v firewall-cmd >/dev/null 2>&1; then
    return
  fi

  if ! systemctl is-active --quiet firewalld; then
    return
  fi

  firewall-cmd --permanent --add-service=http || true
  firewall-cmd --reload || true
}

usage() {
  cat <<'EOF'
Usage:
  sudo bash deploy/install-server.sh --repo-url <git-url> --domain <domain> --admin-password <password> [options]

Options:
  --repo-url <url>         Git repository URL to clone or update
  --branch <name>          Git branch, default: main
  --domain <domain>        Public domain used by Nginx
  --app-dir <path>         Install directory, default: /opt/signal-forge
  --service-name <name>    systemd service name, default: signal-forge
  --admin-password <pwd>   Admin login password for /admin.html
  --session-secret <str>   Session secret; if omitted, a random one is generated
  --port <port>            App port, default: 3000
  --skip-nginx             Skip Nginx setup
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-url)
      REPO_URL="${2:-}"
      shift 2
      ;;
    --branch)
      BRANCH="${2:-}"
      shift 2
      ;;
    --domain)
      DOMAIN="${2:-}"
      shift 2
      ;;
    --app-dir)
      APP_DIR="${2:-}"
      shift 2
      ;;
    --service-name)
      SERVICE_NAME="${2:-}"
      shift 2
      ;;
    --admin-password)
      ADMIN_PASSWORD="${2:-}"
      shift 2
      ;;
    --session-secret)
      SESSION_SECRET="${2:-}"
      shift 2
      ;;
    --port)
      PORT="${2:-}"
      shift 2
      ;;
    --skip-nginx)
      INSTALL_NGINX="false"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

require_root
detect_pkg_manager

if [[ -z "$REPO_URL" || -z "$ADMIN_PASSWORD" ]]; then
  echo "Missing required arguments." >&2
  usage
  exit 1
fi

ensure_base_packages
install_nodejs

if [[ -z "$SESSION_SECRET" ]]; then
  SESSION_SECRET="$(openssl rand -hex 32)"
fi

if [[ "$INSTALL_NGINX" == "true" ]]; then
  install_nginx
fi

mkdir -p "$(dirname "$APP_DIR")"

if [[ ! -d "$APP_DIR/.git" ]]; then
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
fi

cat > "$APP_DIR/.env" <<EOF
BLOG_PORT=$PORT
BLOG_ADMIN_PASSWORD=$ADMIN_PASSWORD
BLOG_SESSION_SECRET=$SESSION_SECRET
BLOG_SECURE_COOKIE=true
EOF

chmod 600 "$APP_DIR/.env"

cd "$APP_DIR"
node scripts/sync-posts.mjs

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Signal Forge Blog
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/env node server.mjs
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.service"

if [[ "$INSTALL_NGINX" == "true" && -n "$DOMAIN" ]]; then
  cat > "/etc/nginx/conf.d/${SERVICE_NAME}.conf" <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

  configure_selinux
  configure_firewalld
  nginx -t
  systemctl reload nginx
fi

echo "Installed Signal Forge to $APP_DIR"
echo "Admin URL: http://$(hostname -I | awk '{print $1}'):$PORT/admin.html"
if [[ -n "$DOMAIN" ]]; then
  echo "Public domain: http://$DOMAIN/admin.html"
fi
