#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PACKAGE_DIR=$(dirname "$SCRIPT_DIR")
COMPOSE_FILE=${COMPOSE_FILE:-"$PACKAGE_DIR/compose.yaml"}
COMPOSE_PROJECT=${COMPOSE_PROJECT:-shape-of-you-staging}
DEPLOY_ROOT=${DEPLOY_ROOT:-/opt/shape-of-you/staging}
RELEASES_DIR="$DEPLOY_ROOT/releases"
CURRENT_LINK="$DEPLOY_ROOT/current"
PREVIOUS_LINK="$DEPLOY_ROOT/previous"
TARGET_RELEASE=${1:-}

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

compose() {
  docker compose \
    --project-name "$COMPOSE_PROJECT" \
    --env-file "$TARGET_ENV" \
    --file "$COMPOSE_FILE" \
    "$@"
}

compose pull api edge
compose up --detach --wait --wait-timeout 90 --remove-orphans api edge

RELEASE_ID="$TARGET_RELEASE" RUN_WRITE_SMOKE=false sh "$SCRIPT_DIR/smoke.sh"

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
