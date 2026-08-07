#!/bin/sh
set -eu

REPOSITORY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../../.." && pwd)
BOOTSTRAP="$REPOSITORY_ROOT/deploy/staging/system/shape-of-you-staging-deploy"
CONTROLLER="$REPOSITORY_ROOT/deploy/staging/scripts/deployment-controller.sh"
INSTALLER="$REPOSITORY_ROOT/deploy/staging/system/install-root-owned-assets.sh"
SUDOERS="$REPOSITORY_ROOT/deploy/staging/system/shape-deploy.sudoers"

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

assert_fails_with() {
  expected=$1
  shift
  output_file=$(mktemp "${TMPDIR:-/tmp}/shape-of-you-bootstrap-test.XXXXXX")
  if "$@" >"$output_file" 2>&1; then
    printf '%s\n' 'Expected command to fail.' >&2
    rm -f "$output_file"
    exit 1
  fi
  grep -F -- "$expected" "$output_file" >/dev/null
  rm -f "$output_file"
}

assert_contains "$BOOTSTRAP" 'MAX_REQUEST_BYTES=65536'
assert_contains "$BOOTSTRAP" 'MAX_REQUEST_LINES=128'
assert_contains "$BOOTSTRAP" 'head -c $((MAX_REQUEST_BYTES + 1))'
assert_contains "$BOOTSTRAP" 'request_bytes=$(wc -c < "$REQUEST_FILE")'
assert_contains "$BOOTSTRAP" 'CONTROL_REPOSITORY=https://github.com/Talla2XLC/shape-of-you.git'
assert_contains "$BOOTSTRAP" 'CONTROL_BRANCH=main'
assert_contains "$BOOTSTRAP" 'CONTROL_SHA does not match current origin/main.'
assert_contains "$BOOTSTRAP" 'deploy/staging/scripts/deployment-controller.sh'
assert_contains "$BOOTSTRAP" 'test ! -L "$controller"'
assert_contains "$BOOTSTRAP" 'sh "$controller" < "$REQUEST_FILE"'
assert_not_contains "$BOOTSTRAP" 'DATABASE_URL'
assert_not_contains "$BOOTSTRAP" 'GHCR_TOKEN'
assert_not_contains "$BOOTSTRAP" 'IDENTITY_'
assert_not_contains "$BOOTSTRAP" 'docker login'
assert_not_contains "$BOOTSTRAP" 'compose.yaml'

assert_contains "$CONTROLLER" 'Unexpected deployment input:'
assert_contains "$CONTROLLER" 'Duplicate input:'
assert_contains "$CONTROLLER" 'DATABASE_URL'
assert_contains "$CONTROLLER" 'GHCR_TOKEN'
assert_contains "$CONTROLLER" 'docker login ghcr.io'
assert_contains "$CONTROLLER" 'Deployment controller must be invoked by the root-owned bootstrap.'
assert_not_contains "$CONTROLLER" 'git clone'
assert_not_contains "$CONTROLLER" 'git -C'

assert_contains "$INSTALLER" 'shape-of-you-staging-deploy'
assert_contains "$SUDOERS" '/usr/local/sbin/shape-of-you-staging-deploy ""'

assert_fails_with 'Deployment controller must be invoked by the root-owned bootstrap.' \
  sh "$CONTROLLER"

unknown_request=$(mktemp "${TMPDIR:-/tmp}/shape-of-you-unknown-request.XXXXXX")
printf '%s\n' 'FUTURE_FIELD=value' > "$unknown_request"
assert_fails_with 'Unexpected deployment input: FUTURE_FIELD.' \
  env SHAPE_OF_YOU_STAGING_LOCK_HELD=true sh "$CONTROLLER" < "$unknown_request"
rm -f "$unknown_request"

sh -n "$BOOTSTRAP"
sh -n "$CONTROLLER"

printf '%s\n' 'Deployment bootstrap contract test passed.'
