#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.ig-admin.yml"

usage() {
  cat <<EOF
Usage: $(basename "$0") <command>

Commands:
  build       Build the Docker image
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

case "${1:-}" in
  build)
    echo "Building Docker image..."
    docker compose -f "$COMPOSE_FILE" build
    echo "Done."
    ;;
  start)
    check_env
    echo "Starting container..."
    docker compose -f "$COMPOSE_FILE" up -d
    echo "Container started. View logs with: $0 logs"
    ;;
  stop)
    echo "Stopping container..."
    docker compose -f "$COMPOSE_FILE" down
    ;;
  restart)
    check_env
    echo "Restarting container..."
    docker compose -f "$COMPOSE_FILE" restart
    ;;
  logs)
    docker compose -f "$COMPOSE_FILE" logs -f
    ;;
  status)
    docker compose -f "$COMPOSE_FILE" ps
    ;;
  shell)
    docker compose -f "$COMPOSE_FILE" exec ig-admin /bin/bash
    ;;
  clean)
    echo "WARNING: This will remove the container and all session data."
    read -r -p "Continue? [y/N] " confirm
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
      docker compose -f "$COMPOSE_FILE" down -v
      echo "Cleaned."
    fi
    ;;
  *)
    usage
    ;;
esac
