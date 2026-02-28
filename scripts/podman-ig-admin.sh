#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.ig-admin.yml"

IMAGE_NAME="openclaw-ig-admin"
CONTAINER_NAME="openclaw-ig-admin"
POD_NAME="openclaw-ig-admin-pod"

usage() {
  cat <<EOF
Usage: $(basename "$0") <command>

Commands:
  build       Build the container image
  start       Start the container (detached)
  stop        Stop the container
  restart     Restart the container
  logs        Follow container logs
  status      Show container status
  shell       Open a shell in the running container
  clean       Stop and remove container + volumes

Environment:
  Copy .env.ig-admin to .env and fill in your credentials before starting.

EOF
  exit 1
}

check_env() {
  if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo "ERROR: .env file not found."
    echo "Copy .env.ig-admin to .env and fill in your credentials:"
    echo "  cp .env.ig-admin .env"
    exit 1
  fi
}

# Parse .env into --env flags, skipping comments and blank lines
env_flags() {
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [ -z "$line" ] && continue
    echo "--env"
    echo "$line"
  done < "$PROJECT_DIR/.env"
}

read_port() {
  local port="${GATEWAY_PORT:-18789}"
  if [ -f "$PROJECT_DIR/.env" ]; then
    local val
    val=$(grep -E '^GATEWAY_PORT=' "$PROJECT_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2-)
    [ -n "$val" ] && port="$val"
  fi
  echo "$port"
}

case "${1:-}" in
  build)
    echo "Building container image..."
    podman build --progress=plain --no-cache -t "$IMAGE_NAME" -f "$PROJECT_DIR/Dockerfile.ig-admin" "$PROJECT_DIR" 2>&1 | while IFS= read -r line; do
      echo "  $line"
    done
    echo "Done."
    ;;
  start)
    check_env
    echo "Starting container..."

    local_port="$(read_port)"

    mapfile -t env_args < <(env_flags)

    podman run -d \
      --name "$CONTAINER_NAME" \
      --replace \
      -p "${local_port}:18789" \
      "${env_args[@]}" \
      -e NODE_ENV=production \
      -e OPENCLAW_STATE_DIR=/data \
      --user 1000:1000 \
      --read-only \
      --tmpfs /tmp:size=64m,noexec,nosuid \
      --cap-drop ALL \
      --security-opt no-new-privileges \
      --memory 512m \
      --cpus 1.0 \
      --dns 8.8.8.8 \
      --dns 1.1.1.1 \
      -v "${IMAGE_NAME}-data:/data:Z" \
      -v "$PROJECT_DIR/skills/ig-kos-admin:/app/skills/ig-kos-admin:ro,Z" \
      --restart unless-stopped \
      --health-cmd 'curl -f http://localhost:18789/health || exit 1' \
      --health-interval 30s \
      --health-timeout 5s \
      --health-start-period 10s \
      --health-retries 3 \
      "$IMAGE_NAME"

    echo "Container started. View logs with: $0 logs"
    ;;
  stop)
    echo "Stopping container..."
    podman stop "$CONTAINER_NAME" 2>/dev/null || true
    podman rm "$CONTAINER_NAME" 2>/dev/null || true
    ;;
  restart)
    check_env
    echo "Restarting container..."
    podman restart "$CONTAINER_NAME"
    ;;
  logs)
    podman logs -f "$CONTAINER_NAME"
    ;;
  status)
    podman ps -a --filter "name=$CONTAINER_NAME"
    ;;
  shell)
    podman exec -it "$CONTAINER_NAME" /bin/bash
    ;;
  clean)
    echo "WARNING: This will remove the container and all session data."
    read -r -p "Continue? [y/N] " confirm
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
      podman stop "$CONTAINER_NAME" 2>/dev/null || true
      podman rm -v "$CONTAINER_NAME" 2>/dev/null || true
      podman volume rm "${IMAGE_NAME}-data" 2>/dev/null || true
      echo "Cleaned."
    fi
    ;;
  *)
    usage
    ;;
esac
