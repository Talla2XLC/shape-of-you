#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PACKAGE_DIR=$(dirname "$SCRIPT_DIR")
COMPOSE_FILE=${COMPOSE_FILE:-"$PACKAGE_DIR/compose.yaml"}
IDENTITY_COMPOSE_FILE=${IDENTITY_COMPOSE_FILE:-"$PACKAGE_DIR/compose.identity.yaml"}
COMPOSE_PROJECT=${COMPOSE_PROJECT:-shape-of-you-staging}
DEPLOY_ROOT=${DEPLOY_ROOT:-/opt/shape-of-you/staging}
RELEASES_DIR="$DEPLOY_ROOT/releases"
CURRENT_LINK="$DEPLOY_ROOT/current"
PREVIOUS_LINK="$DEPLOY_ROOT/previous"
TARGET_RELEASE=${1:-}
LOCK_FILE=${LOCK_FILE:-/run/shape-of-you-staging.lock}
EXPECTED_DEPLOYMENT_TOPOLOGY=${EXPECTED_DEPLOYMENT_TOPOLOGY:-}

if [ "${SHAPE_OF_YOU_STAGING_LOCK_HELD:-false}" != "true" ]; then
  command -v flock >/dev/null 2>&1
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    printf '%s\n' 'Rollback refused because a deployment or renewal is active.' >&2
    exit 1
  fi
fi

if [ -z "$TARGET_RELEASE" ]; then
  if [ ! -L "$PREVIOUS_LINK" ]; then
    printf '%s\n' "No previous release is recorded." >&2
    exit 2
  fi
  TARGET_RELEASE=$(basename "$(readlink -f "$PREVIOUS_LINK")")
fi

printf '%s\n' "$TARGET_RELEASE" | grep -Eq '^[0-9a-f]{40}$'

TARGET_DIR="$RELEASES_DIR/$TARGET_RELEASE"
TARGET_ENV="$TARGET_DIR/release.env"
test -f "$TARGET_ENV"

# The current Compose topology always includes the digest-pinned Certbot image.
# A release created before this topology cutover cannot be rendered safely.
# shellcheck disable=SC1090
. "$TARGET_ENV"
: "${CERTBOT_IMAGE:?Target release predates TLS automation and cannot be rolled back safely}"
: "${CERTBOT_DIGEST:?Target release predates TLS automation and cannot be rolled back safely}"
: "${DEPLOYMENT_TOPOLOGY:?Target release has no deployment topology}"
printf '%s\n' "$CERTBOT_DIGEST" | grep -Eq '^sha256:[0-9a-f]{64}$'

identity_enabled=false
if [ -n "${IDENTITY_IMAGE:-}" ] || [ -n "${IDENTITY_DIGEST:-}" ] ||
  [ -n "${IDENTITY_SCHEMA_BACKWARD_COMPATIBLE:-}" ]; then
  : "${IDENTITY_IMAGE:?Target release has incomplete Identity coordinates}"
  : "${IDENTITY_DIGEST:?Target release has incomplete Identity coordinates}"
  : "${IDENTITY_SCHEMA_BACKWARD_COMPATIBLE:?Target release has no Identity schema compatibility declaration}"
  case "$IDENTITY_SCHEMA_BACKWARD_COMPATIBLE" in
    true|false) ;;
    *)
      printf '%s\n' 'Invalid Identity schema compatibility declaration.' >&2
      exit 2
      ;;
  esac
  printf '%s\n' "$IDENTITY_DIGEST" | grep -Eq '^sha256:[0-9a-f]{64}$'
  test -f "$IDENTITY_COMPOSE_FILE"
  identity_enabled=true
fi

case "$DEPLOYMENT_TOPOLOGY" in
  shared-ingress) COMPOSE_TOPOLOGY_FILE="$PACKAGE_DIR/compose.shared-ingress.yaml" ;;
  standalone) COMPOSE_TOPOLOGY_FILE="$PACKAGE_DIR/compose.standalone.yaml" ;;
  *)
    printf '%s\n' "Unsupported deployment topology: $DEPLOYMENT_TOPOLOGY" >&2
    exit 2
    ;;
esac

if [ -n "$EXPECTED_DEPLOYMENT_TOPOLOGY" ] &&
  [ "$DEPLOYMENT_TOPOLOGY" != "$EXPECTED_DEPLOYMENT_TOPOLOGY" ]; then
  printf '%s\n' 'Automatic rollback across deployment topologies is forbidden.' >&2
  exit 1
fi

compose() {
  if [ "$identity_enabled" = "true" ]; then
    docker compose \
      --project-name "$COMPOSE_PROJECT" \
      --env-file "$TARGET_ENV" \
      --file "$COMPOSE_FILE" \
      --file "$COMPOSE_TOPOLOGY_FILE" \
      --file "$IDENTITY_COMPOSE_FILE" \
      "$@"
  else
    docker compose \
      --project-name "$COMPOSE_PROJECT" \
      --env-file "$TARGET_ENV" \
      --file "$COMPOSE_FILE" \
      --file "$COMPOSE_TOPOLOGY_FILE" \
      "$@"
  fi
}

if [ "$identity_enabled" = "true" ]; then
  compose pull api identity edge
  compose up --detach --wait --wait-timeout 90 --remove-orphans api identity edge
else
  compose pull api edge
  compose up --detach --wait --wait-timeout 90 --remove-orphans api edge
fi

RELEASE_ID="$TARGET_RELEASE" \
RUN_WRITE_SMOKE=false \
IDENTITY_SMOKE_ENABLED="$identity_enabled" \
  sh "$SCRIPT_DIR/smoke.sh"

old_current=
if [ -L "$CURRENT_LINK" ]; then
  old_current=$(readlink -f "$CURRENT_LINK")
fi

if [ -n "$old_current" ] && [ "$old_current" != "$TARGET_DIR" ]; then
  ln -sfn "$old_current" "$PREVIOUS_LINK"
fi
ln -sfn "$TARGET_DIR" "$CURRENT_LINK"

printf '%s\n' "Application rollback to $TARGET_RELEASE completed."
printf '%s\n' "Database migrations were not reverted."
