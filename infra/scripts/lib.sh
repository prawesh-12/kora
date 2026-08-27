set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT/infra/docker/docker-compose.yml"

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

require_docker() {
  if ! docker info >/dev/null 2>&1; then
    echo "Docker is not running. Start the Docker daemon and try again." >&2
    exit 1
  fi
}

check_port() {
  local port="$1"
  if compose ps --format '{{.Names}}' 2>/dev/null | grep -q .; then return 0; fi
  local holder
  holder="$(ss -ltnp 2>/dev/null | awk -v p=":$port\$" '$4 ~ p {print $NF}' | head -1 || true)"
  if [ -n "$holder" ]; then
    echo "Port $port is already in use by: $holder" >&2
    echo "Stop that process or change the published port in $COMPOSE_FILE." >&2
    exit 1
  fi
}
