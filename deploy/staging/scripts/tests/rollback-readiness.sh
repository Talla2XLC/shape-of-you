#!/bin/sh
set -eu

REPOSITORY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../../.." && pwd)
ROLLBACK_SOURCE="$REPOSITORY_ROOT/deploy/staging/scripts/rollback.sh"
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/shape-of-you-rollback-test.XXXXXX")
RELEASE_ID=0123456789abcdef0123456789abcdef01234567

cleanup() {
  rm -rf "$TEST_ROOT"
}

trap cleanup EXIT HUP INT TERM

mkdir -p "$TEST_ROOT/package/scripts" "$TEST_ROOT/fake-bin" \
  "$TEST_ROOT/deploy/releases/$RELEASE_ID"
cp "$ROLLBACK_SOURCE" "$TEST_ROOT/package/scripts/rollback.sh"
printf '%s\n' \
  'CERTBOT_IMAGE=ghcr.io/example/shape-of-you-certbot' \
  'CERTBOT_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
  'DEPLOYMENT_TOPOLOGY=shared-ingress' \
  > "$TEST_ROOT/deploy/releases/$RELEASE_ID/release.env"

FAKE_DOCKER_LOG="$TEST_ROOT/docker.log"
FAKE_WAIT_MARKER="$TEST_ROOT/edge-ready"
FAKE_SMOKE_LOG="$TEST_ROOT/smoke.log"
export FAKE_DOCKER_LOG FAKE_WAIT_MARKER FAKE_SMOKE_LOG

printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  'printf "%s\\n" "$*" >> "$FAKE_DOCKER_LOG"' \
  'case "$*" in' \
  '  *"up --detach --wait --wait-timeout 90 --remove-orphans api edge"*) touch "$FAKE_WAIT_MARKER" ;;' \
  'esac' \
  > "$TEST_ROOT/fake-bin/docker"
chmod 0755 "$TEST_ROOT/fake-bin/docker"

printf '%s\n' \
  '#!/bin/sh' \
  'exit 0' \
  > "$TEST_ROOT/fake-bin/flock"
chmod 0755 "$TEST_ROOT/fake-bin/flock"

printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  'test -f "$FAKE_WAIT_MARKER"' \
  'printf "%s\\n" "$RELEASE_ID" > "$FAKE_SMOKE_LOG"' \
  > "$TEST_ROOT/package/scripts/smoke.sh"
chmod 0755 "$TEST_ROOT/package/scripts/smoke.sh"

PATH="$TEST_ROOT/fake-bin:$PATH" \
DEPLOY_ROOT="$TEST_ROOT/deploy" \
LOCK_FILE="$TEST_ROOT/deploy.lock" \
EXPECTED_DEPLOYMENT_TOPOLOGY=shared-ingress \
  sh "$TEST_ROOT/package/scripts/rollback.sh" "$RELEASE_ID" >/dev/null

grep -F -- 'up --detach --wait --wait-timeout 90 --remove-orphans api edge' \
  "$FAKE_DOCKER_LOG" >/dev/null
test -s "$FAKE_SMOKE_LOG"

if PATH="$TEST_ROOT/fake-bin:$PATH" \
  DEPLOY_ROOT="$TEST_ROOT/deploy" \
  LOCK_FILE="$TEST_ROOT/deploy.lock" \
  EXPECTED_DEPLOYMENT_TOPOLOGY=standalone \
  sh "$TEST_ROOT/package/scripts/rollback.sh" "$RELEASE_ID" >/dev/null 2>&1; then
  printf '%s\n' 'Cross-topology automatic rollback was not rejected.' >&2
  exit 1
fi

printf '%s\n' 'rollback readiness regression test passed.'
