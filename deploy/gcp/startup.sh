#!/bin/bash
# ContractRift on a Google Cloud e2-micro (Debian 12). Idempotent: runs on every boot.
set -euo pipefail
exec >>/var/log/contractrift-startup.log 2>&1
echo "=== boot $(date -Is)"
MDB=http://metadata.google.internal/computeMetadata/v1/instance
md() { curl -fsS -H 'Metadata-Flavor: Google' "$MDB/$1" 2>/dev/null || true; }

# 1 GB swap: the e2-micro has only 1 GB RAM.
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Docker Engine + Compose plugin from Docker's official repository.
if ! command -v docker >/dev/null; then
  apt-get update -y
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

mkdir -p /opt/contractrift && cd /opt/contractrift
IP=$(md network-interfaces/0/access-configs/0/external-ip)
HOST="$(echo "$IP" | tr . -).sslip.io"

# Secrets come from instance metadata on first boot only, then live in a root-only file.
if [ ! -s secrets.env ]; then
  umask 077
  printf 'ENCRYPTION_KEY=%s\nSETUP_TOKEN=%s\n' "$(md attributes/encryption-key)" "$(md attributes/setup-token)" > secrets.env
fi
printf 'HOST=%s\n' "$HOST" > .env   # compose variable substitution; refreshed each boot (IP can change after stop/start)

cat > docker-compose.yml <<'YAML'
services:
  app:
    image: ghcr.io/ahmedgcompany-cyber/contractrift:${CONTRACTRIFT_VERSION:-0.3.1}
    restart: unless-stopped
    env_file: secrets.env
    environment:
      NODE_ENV: production
      APP_URL: https://${HOST}
      COOKIE_SECURE: 'true'
      TRUST_PROXY: 'true'
      DEMO_MODE: 'true'
      ALLOW_PRIVATE_TARGETS: 'false'
      NODE_OPTIONS: --max-old-space-size=384
    volumes: [data:/data]
    mem_limit: 700m
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ['80:80', '443:443']
    environment:
      HOST: ${HOST}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on: [app]
volumes:
  data: {}
  caddy_data: {}
  caddy_config: {}
YAML

cat > Caddyfile <<'CADDY'
{$HOST} {
  encode gzip
  reverse_proxy app:3000
}
CADDY

docker compose pull
docker compose up -d
echo "=== up: https://$HOST"
