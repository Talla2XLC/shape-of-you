#!/bin/sh
set -eu

REPOSITORY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../../.." && pwd)
ROLLBACK_SOURCE="$REPOSITORY_ROOT/deploy/staging/scripts/rollback.sh"
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/shape-of-you-rollback-test.XXXXXX")
RELEASE_ID=0123456789abcdef0123456789abcdef01234567
IDENTITY_RELEASE_ID=89abcdef0123456789abcdef0123456789abcdef

cleanup() {
  rm -rf "$TEST_ROOT"
}

trap cleanup EXIT HUP INT TERM

mkdir -p "$TEST_ROOT/package/scripts" "$TEST_ROOT/fake-bin" \
  "$TEST_ROOT/deploy/releases/$RELEASE_ID" \
  "$TEST_ROOT/deploy/releases/$IDENTITY_RELEASE_ID"
cp "$ROLLBACK_SOURCE" "$TEST_ROOT/package/scripts/rollback.sh"
touch "$TEST_ROOT/package/compose.identity.yaml"
printf '%s\n' \
  'CERTBOT_IMAGE=ghcr.io/example/shape-of-you-certbot' \
  'CERTBOT_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
  'DEPLOYMENT_TOPOLOGY=shared-ingress' \
  > "$TEST_ROOT/deploy/releases/$RELEASE_ID/release.env"
printf '%s\n' \
  'CERTBOT_IMAGE=ghcr.io/example/shape-of-you-certbot' \
  'CERTBOT_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
  'IDENTITY_IMAGE=ghcr.io/example/shape-of-you-identity' \
  'IDENTITY_DIGEST=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' \
  'IDENTITY_SCHEMA_BACKWARD_COMPATIBLE=false' \
  'DEPLOYMENT_TOPOLOGY=shared-ingress' \
  > "$TEST_ROOT/deploy/releases/$IDENTITY_RELEASE_ID/release.env"

FAKE_DOCKER_LOG="$TEST_ROOT/docker.log"
FAKE_WAIT_MARKER="$TEST_ROOT/edge-ready"
FAKE_SMOKE_LOG="$TEST_ROOT/smoke.log"
export FAKE_DOCKER_LOG FAKE_WAIT_MARKER FAKE_SMOKE_LOG

printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  'printf "%s\\n" "$*" >> "$FAKE_DOCKER_LOG"' \
  'if [ "${1:-}" = inspect ]; then' \
  '  case "$*" in' \
  '    *-migration*)' \
  '      case "$*" in' \
  '        *--format*) printf "%s\\n" "Migration container state: running"; exit 0 ;;' \
  '        *) exit 1 ;;' \
  '      esac' \
  '      ;;' \
  '  esac' \
  'fi' \
  'case "$*" in' \
  '  *" ps --quiet "*) printf "%s\\n" fake-container ;;' \
  '  *"up --detach --wait --wait-timeout 90 --remove-orphans api edge"*) touch "$FAKE_WAIT_MARKER" ;;' \
  '  *"up --detach --wait --wait-timeout 90 --remove-orphans api identity edge"*) touch "$FAKE_WAIT_MARKER" ;;' \
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
  'shift 3' \
  'exec "$@"' \
  > "$TEST_ROOT/fake-bin/timeout"
chmod 0755 "$TEST_ROOT/fake-bin/timeout"

printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  'test -f "$FAKE_WAIT_MARKER"' \
  'printf "%s:%s\\n" "$RELEASE_ID" "${IDENTITY_SMOKE_ENABLED:-false}" >> "$FAKE_SMOKE_LOG"' \
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
grep -F -- "$RELEASE_ID:false" "$FAKE_SMOKE_LOG" >/dev/null

PATH="$TEST_ROOT/fake-bin:$PATH" \
DEPLOY_ROOT="$TEST_ROOT/deploy" \
LOCK_FILE="$TEST_ROOT/deploy.lock" \
EXPECTED_DEPLOYMENT_TOPOLOGY=shared-ingress \
  sh "$TEST_ROOT/package/scripts/rollback.sh" "$IDENTITY_RELEASE_ID" >/dev/null

grep -F -- 'up --detach --wait --wait-timeout 90 --remove-orphans api identity edge' \
  "$FAKE_DOCKER_LOG" >/dev/null
grep -F -- "$IDENTITY_RELEASE_ID:true" "$FAKE_SMOKE_LOG" >/dev/null

if PATH="$TEST_ROOT/fake-bin:$PATH" \
  DEPLOY_ROOT="$TEST_ROOT/deploy" \
  LOCK_FILE="$TEST_ROOT/deploy.lock" \
  EXPECTED_DEPLOYMENT_TOPOLOGY=standalone \
  sh "$TEST_ROOT/package/scripts/rollback.sh" "$RELEASE_ID" >/dev/null 2>&1; then
  printf '%s\n' 'Cross-topology automatic rollback was not rejected.' >&2
  exit 1
fi

GATE_PACKAGE="$TEST_ROOT/gate-package"
GATE_DEPLOY_ROOT="$TEST_ROOT/gate-deploy"
GATE_RELEASE_ID=fedcba9876543210fedcba9876543210fedcba98
GATE_PREVIOUS_ID=1111111111111111111111111111111111111111
GATE_ROLLBACK_LOG="$TEST_ROOT/gate-rollback.log"
export GATE_ROLLBACK_LOG
mkdir -p "$GATE_PACKAGE/scripts" "$GATE_DEPLOY_ROOT/releases/$GATE_PREVIOUS_ID"
cp "$REPOSITORY_ROOT/deploy/staging/scripts/deploy.sh" "$GATE_PACKAGE/scripts/deploy.sh"
touch "$GATE_PACKAGE/compose.yaml" "$GATE_PACKAGE/compose.identity.yaml" \
  "$GATE_PACKAGE/compose.shared-ingress.yaml"
ln -s "$GATE_DEPLOY_ROOT/releases/$GATE_PREVIOUS_ID" "$GATE_DEPLOY_ROOT/current"

printf '%s\n' '#!/bin/sh' 'exit 0' > "$GATE_PACKAGE/scripts/vm-preflight.sh"
printf '%s\n' '#!/bin/sh' 'exit 1' > "$GATE_PACKAGE/scripts/smoke.sh"
printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  'printf "%s\n" "$1" >> "$GATE_ROLLBACK_LOG"' \
  > "$GATE_PACKAGE/scripts/rollback.sh"
chmod 0755 "$GATE_PACKAGE/scripts/"*.sh

run_automatic_rollback_case() {
  api_schema_compatible=$1
  identity_schema_compatible=$2
  client_compatible=$3
  expected_rollback=$4
  gate_release_env="$TEST_ROOT/gate-release.env"
  rm -f "$GATE_ROLLBACK_LOG"
  printf '%s\n' \
    "RELEASE_ID=$GATE_RELEASE_ID" \
    'API_IMAGE=ghcr.io/example/shape-of-you-api' \
    'API_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
    'IDENTITY_IMAGE=ghcr.io/example/shape-of-you-identity' \
    'IDENTITY_DIGEST=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' \
    "IDENTITY_SCHEMA_BACKWARD_COMPATIBLE=$identity_schema_compatible" \
    "IDENTITY_OAUTH_CLIENTS_BACKWARD_COMPATIBLE=$client_compatible" \
    'EDGE_IMAGE=ghcr.io/example/shape-of-you-edge' \
    'EDGE_DIGEST=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' \
    'CERTBOT_IMAGE=ghcr.io/example/shape-of-you-certbot' \
    'CERTBOT_DIGEST=sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' \
    'ACME_EMAIL=operator@example.com' \
    'PUBLIC_IPV4=203.0.113.10' \
    'DEPLOYMENT_TOPOLOGY=shared-ingress' \
    "SCHEMA_BACKWARD_COMPATIBLE=$api_schema_compatible" \
    > "$gate_release_env"

  if PATH="$TEST_ROOT/fake-bin:$PATH" \
    DEPLOY_ROOT="$GATE_DEPLOY_ROOT" \
    COMPOSE_FILE="$GATE_PACKAGE/compose.yaml" \
    IDENTITY_COMPOSE_FILE="$GATE_PACKAGE/compose.identity.yaml" \
    sh "$GATE_PACKAGE/scripts/deploy.sh" "$gate_release_env" >/dev/null 2>&1; then
    printf '%s\n' 'A smoke-failed deployment unexpectedly succeeded.' >&2
    exit 1
  fi

  if [ "$expected_rollback" = true ]; then
    grep -Fx "$GATE_PREVIOUS_ID" "$GATE_ROLLBACK_LOG" >/dev/null
  elif [ -e "$GATE_ROLLBACK_LOG" ]; then
    printf '%s\n' 'Automatic rollback ran without both compatibility declarations.' >&2
    exit 1
  fi
}

run_automatic_rollback_case true true true true
run_automatic_rollback_case true true false false
run_automatic_rollback_case false true true false
run_automatic_rollback_case true false true false

printf '%s\n' \
  '#!/bin/sh' \
  'exit 124' \
  > "$TEST_ROOT/fake-bin/timeout"
chmod 0755 "$TEST_ROOT/fake-bin/timeout"
timeout_log="$TEST_ROOT/migration-timeout.log"
if PATH="$TEST_ROOT/fake-bin:$PATH" \
  DEPLOY_ROOT="$GATE_DEPLOY_ROOT" \
  COMPOSE_FILE="$GATE_PACKAGE/compose.yaml" \
  IDENTITY_COMPOSE_FILE="$GATE_PACKAGE/compose.identity.yaml" \
  sh "$GATE_PACKAGE/scripts/deploy.sh" "$gate_release_env" \
  >"$timeout_log" 2>&1; then
  printf '%s\n' 'A timed-out API migration unexpectedly succeeded.' >&2
  exit 1
fi
grep -F -- 'API migration timed out after 300 seconds (exit status 124).' \
  "$timeout_log" >/dev/null
grep -F -- 'Compose status after API migration failure:' \
  "$timeout_log" >/dev/null
grep -F -- 'Migration container state: running' "$timeout_log" >/dev/null
grep -F -- 'rm --force shape-of-you-staging-migrate-migration' \
  "$FAKE_DOCKER_LOG" >/dev/null
grep -F -- 'Migration container shape-of-you-staging-migrate-migration is no longer present.' \
  "$timeout_log" >/dev/null

printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  'case "$*" in' \
  '  *" identity-migrate") exit 124 ;;' \
  'esac' \
  'shift 3' \
  'exec "$@"' \
  > "$TEST_ROOT/fake-bin/timeout"
chmod 0755 "$TEST_ROOT/fake-bin/timeout"
identity_timeout_log="$TEST_ROOT/identity-migration-timeout.log"
if PATH="$TEST_ROOT/fake-bin:$PATH" \
  DEPLOY_ROOT="$GATE_DEPLOY_ROOT" \
  COMPOSE_FILE="$GATE_PACKAGE/compose.yaml" \
  IDENTITY_COMPOSE_FILE="$GATE_PACKAGE/compose.identity.yaml" \
  sh "$GATE_PACKAGE/scripts/deploy.sh" "$gate_release_env" \
  >"$identity_timeout_log" 2>&1; then
  printf '%s\n' 'A timed-out Identity migration unexpectedly succeeded.' >&2
  exit 1
fi
grep -F -- 'API migration completed.' "$identity_timeout_log" >/dev/null
grep -F -- 'Identity migration timed out after 300 seconds (exit status 124).' \
  "$identity_timeout_log" >/dev/null
grep -F -- 'rm --force shape-of-you-staging-identity-migrate-migration' \
  "$FAKE_DOCKER_LOG" >/dev/null

printf '%s\n' '#!/bin/sh' 'exit 137' > "$TEST_ROOT/fake-bin/timeout"
chmod 0755 "$TEST_ROOT/fake-bin/timeout"
sigkill_log="$TEST_ROOT/migration-sigkill.log"
if PATH="$TEST_ROOT/fake-bin:$PATH" \
  DEPLOY_ROOT="$GATE_DEPLOY_ROOT" \
  COMPOSE_FILE="$GATE_PACKAGE/compose.yaml" \
  IDENTITY_COMPOSE_FILE="$GATE_PACKAGE/compose.identity.yaml" \
  sh "$GATE_PACKAGE/scripts/deploy.sh" "$gate_release_env" \
  >"$sigkill_log" 2>&1; then
  printf '%s\n' 'A SIGKILL-ended API migration unexpectedly succeeded.' >&2
  exit 1
fi
grep -F -- 'API migration ended with SIGKILL or timeout escalation (exit status 137).' \
  "$sigkill_log" >/dev/null
if grep -F -- 'API migration timed out' "$sigkill_log" >/dev/null; then
  printf '%s\n' 'Exit status 137 was incorrectly reported as a definite timeout.' >&2
  exit 1
fi

printf '%s\n' '#!/bin/sh' 'exit 42' > "$TEST_ROOT/fake-bin/timeout"
chmod 0755 "$TEST_ROOT/fake-bin/timeout"
failure_log="$TEST_ROOT/migration-failure.log"
if PATH="$TEST_ROOT/fake-bin:$PATH" \
  DEPLOY_ROOT="$GATE_DEPLOY_ROOT" \
  COMPOSE_FILE="$GATE_PACKAGE/compose.yaml" \
  IDENTITY_COMPOSE_FILE="$GATE_PACKAGE/compose.identity.yaml" \
  sh "$GATE_PACKAGE/scripts/deploy.sh" "$gate_release_env" \
  >"$failure_log" 2>&1; then
  printf '%s\n' 'A failed API migration unexpectedly succeeded.' >&2
  exit 1
fi
grep -F -- 'API migration failed (exit status 42).' "$failure_log" >/dev/null

printf '%s\n' 'rollback readiness regression test passed.'
