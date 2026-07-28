#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PACKAGE_DIR=$(dirname "$SCRIPT_DIR")
COMPOSE_FILE=${COMPOSE_FILE:-"$PACKAGE_DIR/compose.yaml"}
RUNTIME_ENV=${RUNTIME_ENV:-/etc/shape-of-you/staging/api.env}
RELEASE_ENV=${1:-}
COMPOSE_PROJECT=${COMPOSE_PROJECT:-shape-of-you-staging}

command -v docker >/dev/null 2>&1
command -v curl >/dev/null 2>&1
docker info >/dev/null
docker compose version >/dev/null

test -f "$COMPOSE_FILE"
test -f "$RUNTIME_ENV"
test -n "$RELEASE_ENV"
test -f "$RELEASE_ENV"

docker compose \
  --project-name "$COMPOSE_PROJECT" \
  --env-file "$RELEASE_ENV" \
  --file "$COMPOSE_FILE" \
  config --quiet

if command -v ss >/dev/null 2>&1 &&
  ss -ltn | grep -Eq '(^|[[:space:]])[^[:space:]]*:3001[[:space:]]'; then
  running_edge=$(
    docker compose \
      --project-name "$COMPOSE_PROJECT" \
      --env-file "$RELEASE_ENV" \
      --file "$COMPOSE_FILE" \
      ps --status running --services |
      grep -E '^edge$' || true
  )

  if [ "$running_edge" != "edge" ]; then
    printf '%s\n' \
      "Port 3001 is already listening and is not owned by this Compose project." >&2
    exit 1
  fi
fi

printf '%s\n' "VM preflight passed."
