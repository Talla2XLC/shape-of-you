#!/bin/sh
set -eu

REPOSITORY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../../.." && pwd)
RUNNER="$REPOSITORY_ROOT/deploy/staging/system/shape-of-you-staging-recovery-erasure-sync"
SERVICE="$RUNNER.service"
TIMER="$RUNNER.timer"
INSTALLER="$REPOSITORY_ROOT/deploy/staging/system/install-recovery-erasure-sync-assets.sh"
CONTROLLER="$REPOSITORY_ROOT/deploy/staging/scripts/deployment-controller.sh"
COMPOSE="$REPOSITORY_ROOT/deploy/staging/compose.yaml"

assert_contains() {
  file=$1
  text=$2
  grep -F -- "$text" "$file" >/dev/null
}

assert_not_contains() {
  file=$1
  text=$2
  if grep -F -- "$text" "$file" >/dev/null; then
    printf '%s\n' "Unexpected text in $file: $text" >&2
    exit 1
  fi
}

assert_contains "$RUNNER" 'JOURNAL_ROOT=/home/talla2xlc/recovery-erasure-journal'
assert_contains "$RUNNER" 'RUNTIME_ENV=/etc/shape-of-you/staging/api.env'
assert_contains "$RUNNER" 'docker run --rm --pull never --init'
assert_contains "$RUNNER" '--read-only'
assert_contains "$RUNNER" '--cap-drop ALL'
assert_contains "$RUNNER" '--security-opt no-new-privileges:true'
assert_contains "$RUNNER" '--user "$journal_uid:$journal_gid"'
assert_contains "$RUNNER" '--env-file "$RUNTIME_ENV"'
assert_contains "$RUNNER" '--mount "type=bind,src=$JOURNAL_ROOT,dst=$CONTAINER_JOURNAL_ROOT"'
assert_contains "$RUNNER" '--action sync-pending'
assert_contains "$RUNNER" '--checkpoint-directory "$CONTAINER_JOURNAL_ROOT/checkpoints"'
assert_contains "$RUNNER" 'flock -n 9'
assert_not_contains "$RUNNER" 'DATABASE_URL'
assert_not_contains "$RUNNER" 'talking-to-ai'
assert_not_contains "$COMPOSE" 'recovery-erasure-journal'

assert_contains "$SERVICE" 'Type=oneshot'
assert_contains "$SERVICE" 'User=root'
assert_contains "$SERVICE" 'ExecStart=/bin/sh /usr/local/libexec/shape-of-you-staging-recovery-erasure-sync'
assert_contains "$SERVICE" 'NoNewPrivileges=true'
assert_contains "$SERVICE" 'ProtectSystem=strict'
assert_contains "$TIMER" 'OnUnitInactiveSec=1min'
assert_contains "$TIMER" 'Persistent=true'

assert_contains "$INSTALLER" 'systemd-analyze verify "$service" "$timer"'
assert_contains "$INSTALLER" 'systemctl enable --now shape-of-you-staging-recovery-erasure-sync.timer'
assert_contains "$CONTROLLER" 'JOURNAL_SYNC_INSTALLER=$CONTROL_STAGING/system/install-recovery-erasure-sync-assets.sh'
assert_contains "$CONTROLLER" 'sh "$CONTROL_STAGING/scripts/deploy.sh" "$RELEASE_ENV"'
assert_contains "$CONTROLLER" 'sh "$JOURNAL_SYNC_INSTALLER"'
deploy_line=$(grep -n -F 'sh "$CONTROL_STAGING/scripts/deploy.sh" "$RELEASE_ENV"' "$CONTROLLER" | cut -d: -f1)
install_line=$(grep -n -F 'sh "$JOURNAL_SYNC_INSTALLER"' "$CONTROLLER" | cut -d: -f1)
[ "$install_line" -gt "$deploy_line" ] || {
  printf '%s\n' 'Recovery erasure assets must be installed only after successful deployment.' >&2
  exit 1
}

sh -n "$RUNNER"
sh -n "$INSTALLER"
sh -n "$CONTROLLER"

if command -v systemd-analyze >/dev/null 2>&1; then
  systemd-analyze verify "$SERVICE" "$TIMER"
fi

printf '%s\n' 'Recovery erasure sync contract test passed.'

