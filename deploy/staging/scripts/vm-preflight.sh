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

# release.env contains immutable image coordinates and non-secret deployment
# metadata only.
# shellcheck disable=SC1090
. "$RELEASE_ENV"

: "${PUBLIC_IPV4:?PUBLIC_IPV4 is required}"

command -v getent >/dev/null 2>&1
command -v awk >/dev/null 2>&1

for hostname in staging.shape-of-you.ru identity.staging.shape-of-you.ru; do
  if ! getent ahostsv4 "$hostname" |
    awk '{ print $1 }' |
    grep -Fx "$PUBLIC_IPV4" >/dev/null; then
    printf '%s\n' "$hostname does not resolve to the expected staging IPv4 address." >&2
    exit 1
  fi
done

docker compose \
  --project-name "$COMPOSE_PROJECT" \
  --env-file "$RELEASE_ENV" \
  --file "$COMPOSE_FILE" \
  --profile operations \
  config --quiet

compose_port() {
  service=$1
  container_port=$2

  docker compose \
    --project-name "$COMPOSE_PROJECT" \
    --env-file "$RELEASE_ENV" \
    --file "$COMPOSE_FILE" \
    --profile operations \
    port "$service" "$container_port" 2>/dev/null || true
}

port_is_project_owned() {
  host_port=$1
  edge_container_port=$2
  bootstrap_container_port=$3

  compose_port edge "$edge_container_port" |
    grep -Eq "(^|:)$host_port$" && return 0

  if [ -n "$bootstrap_container_port" ]; then
    compose_port edge-bootstrap "$bootstrap_container_port" |
      grep -Eq "(^|:)$host_port$" && return 0
  fi

  return 1
}

if command -v ss >/dev/null 2>&1; then
  if ss -ltn | grep -Eq '(^|[[:space:]])[^[:space:]]*:80[[:space:]]' &&
    ! port_is_project_owned 80 8080 8080; then
    printf '%s\n' \
      "Port 80 is already listening and is not owned by this Compose project." >&2
    exit 1
  fi

  if ss -ltn | grep -Eq '(^|[[:space:]])[^[:space:]]*:443[[:space:]]' &&
    ! port_is_project_owned 443 8443 ''; then
    printf '%s\n' \
      "Port 443 is already listening and is not owned by this Compose project." >&2
    exit 1
  fi
fi

printf '%s\n' "VM preflight passed."
