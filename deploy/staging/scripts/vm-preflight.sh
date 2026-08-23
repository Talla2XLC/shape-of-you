#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PACKAGE_DIR=$(dirname "$SCRIPT_DIR")
COMPOSE_FILE=${COMPOSE_FILE:-"$PACKAGE_DIR/compose.yaml"}
RUNTIME_ENV=${RUNTIME_ENV:-/etc/shape-of-you/staging/api.env}
IDENTITY_RUNTIME_ENV=${IDENTITY_RUNTIME_ENV:-/etc/shape-of-you/staging/identity.env}
FITNESS_TRACKER_IMPORT_RUNTIME_ENV=${FITNESS_TRACKER_IMPORT_RUNTIME_ENV:-/etc/shape-of-you/staging/fitness-tracker-import.env}
RUN_FITNESS_TRACKER_WEIGHT_DRY_RUN=${RUN_FITNESS_TRACKER_WEIGHT_DRY_RUN:-false}
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

case "$RUN_FITNESS_TRACKER_WEIGHT_DRY_RUN" in
  true) test -f "$FITNESS_TRACKER_IMPORT_RUNTIME_ENV" ;;
  false) ;;
  *)
    printf '%s\n' 'Invalid Fitness Tracker Weight dry-run declaration.' >&2
    exit 2
    ;;
esac

# release.env contains immutable image coordinates and non-secret deployment
# metadata only.
# shellcheck disable=SC1090
. "$RELEASE_ENV"

: "${PUBLIC_IPV4:?PUBLIC_IPV4 is required}"
: "${DEPLOYMENT_TOPOLOGY:?DEPLOYMENT_TOPOLOGY is required}"

identity_enabled=false
compose_profiles='--profile operations'
if [ "$RUN_FITNESS_TRACKER_WEIGHT_DRY_RUN" = true ]; then
  compose_profiles="$compose_profiles --profile fitness-tracker-import"
fi
if [ -n "${IDENTITY_IMAGE:-}" ] || [ -n "${IDENTITY_DIGEST:-}" ] ||
  [ -n "${IDENTITY_SCHEMA_BACKWARD_COMPATIBLE:-}" ] ||
  [ -n "${IDENTITY_OAUTH_CLIENTS_BACKWARD_COMPATIBLE:-}" ]; then
  : "${IDENTITY_IMAGE:?IDENTITY_IMAGE is required when Identity deployment is enabled}"
  : "${IDENTITY_DIGEST:?IDENTITY_DIGEST is required when Identity deployment is enabled}"
  : "${IDENTITY_SCHEMA_BACKWARD_COMPATIBLE:?IDENTITY_SCHEMA_BACKWARD_COMPATIBLE is required when Identity deployment is enabled}"
  case "$IDENTITY_SCHEMA_BACKWARD_COMPATIBLE" in
    true|false) ;;
    *)
      printf '%s\n' 'Invalid Identity schema compatibility declaration.' >&2
      exit 2
      ;;
  esac
  : "${IDENTITY_OAUTH_CLIENTS_BACKWARD_COMPATIBLE:?IDENTITY_OAUTH_CLIENTS_BACKWARD_COMPATIBLE is required when Identity deployment is enabled}"
  case "$IDENTITY_OAUTH_CLIENTS_BACKWARD_COMPATIBLE" in
    true|false) ;;
    *)
      printf '%s\n' 'Invalid predefined OAuth client compatibility declaration.' >&2
      exit 2
      ;;
  esac
  test -f "$IDENTITY_RUNTIME_ENV"
  test -f "$PACKAGE_DIR/compose.identity.yaml"
  identity_enabled=true
fi

case "$DEPLOYMENT_TOPOLOGY" in
  shared-ingress)
    COMPOSE_TOPOLOGY_FILE="$PACKAGE_DIR/compose.shared-ingress.yaml"
    ;;
  standalone)
    COMPOSE_TOPOLOGY_FILE="$PACKAGE_DIR/compose.standalone.yaml"
    ;;
  *)
    printf '%s\n' "Unsupported deployment topology: $DEPLOYMENT_TOPOLOGY" >&2
    exit 2
    ;;
esac

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

if [ "$identity_enabled" = "true" ]; then
  docker compose \
    --project-name "$COMPOSE_PROJECT" \
    --env-file "$RELEASE_ENV" \
    --file "$COMPOSE_FILE" \
    --file "$COMPOSE_TOPOLOGY_FILE" \
    --file "$PACKAGE_DIR/compose.identity.yaml" \
    $compose_profiles \
    config --quiet
else
  docker compose \
    --project-name "$COMPOSE_PROJECT" \
    --env-file "$RELEASE_ENV" \
    --file "$COMPOSE_FILE" \
    --file "$COMPOSE_TOPOLOGY_FILE" \
    $compose_profiles \
    config --quiet
fi

compose_port() {
  service=$1
  container_port=$2

  docker compose \
    --project-name "$COMPOSE_PROJECT" \
    --env-file "$RELEASE_ENV" \
    --file "$COMPOSE_FILE" \
    --file "$COMPOSE_TOPOLOGY_FILE" \
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

if [ "$DEPLOYMENT_TOPOLOGY" = "shared-ingress" ]; then
  docker network inspect shared-vm-ingress >/dev/null

  if command -v ss >/dev/null 2>&1; then
    ss -ltn | grep -Eq '(^|[[:space:]])[^[:space:]]*:80[[:space:]]' || {
      printf '%s\n' 'Shared ingress is not listening on host port 80.' >&2
      exit 1
    }
    ss -ltn | grep -Eq '(^|[[:space:]])[^[:space:]]*:443[[:space:]]' || {
      printf '%s\n' 'Shared ingress is not listening on host port 443.' >&2
      exit 1
    }
  fi
elif command -v ss >/dev/null 2>&1; then
  if ss -ltn | grep -Eq '(^|[[:space:]])[^[:space:]]*:80[[:space:]]' &&
    ! port_is_project_owned 80 8080 8080; then
    printf '%s\n' 'Port 80 is owned by another process.' >&2
    exit 1
  fi

  if ss -ltn | grep -Eq '(^|[[:space:]])[^[:space:]]*:443[[:space:]]' &&
    ! port_is_project_owned 443 8443 ''; then
    printf '%s\n' 'Port 443 is owned by another process.' >&2
    exit 1
  fi
fi

printf '%s\n' "VM preflight passed."
