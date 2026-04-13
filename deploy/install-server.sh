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

if [[ -z "$REPO_URL" || -z "$ADMIN_PASSWORD" ]]; then
  echo "Missing required arguments." >&2
  usage
  exit 1
fi

if [[ -z "$SESSION_SECRET" ]]; then
  SESSION_SECRET="$(openssl rand -hex 32)"
fi

if ! command -v git >/dev/null 2>&1; then
  apt-get update
  apt-get install -y git
fi

if ! command -v node >/dev/null 2>&1; then
  apt-get update
  apt-get install -y nodejs npm
fi

if [[ "$INSTALL_NGINX" == "true" ]] && ! command -v nginx >/dev/null 2>&1; then
  apt-get update
  apt-get install -y nginx
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
  cat > "/etc/nginx/sites-available/${SERVICE_NAME}.conf" <<EOF
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

  ln -sf "/etc/nginx/sites-available/${SERVICE_NAME}.conf" "/etc/nginx/sites-enabled/${SERVICE_NAME}.conf"
  nginx -t
  systemctl reload nginx
fi

echo "Installed Signal Forge to $APP_DIR"
echo "Admin URL: http://$(hostname -I | awk '{print $1}'):$PORT/admin.html"
if [[ -n "$DOMAIN" ]]; then
  echo "Public domain: http://$DOMAIN/admin.html"
fi
