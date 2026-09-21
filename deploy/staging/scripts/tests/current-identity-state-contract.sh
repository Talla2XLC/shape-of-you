#!/bin/sh
set -eu

REPOSITORY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../../.." && pwd)
VERIFIER="$REPOSITORY_ROOT/deploy/staging/scripts/verify-current-identity-state.sh"
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/shape-of-you-current-identity.XXXXXX")

cleanup() {
  rm -rf "$TEST_ROOT"
}

trap cleanup EXIT HUP INT TERM

FAKE_BIN="$TEST_ROOT/fake-bin"
RUNTIME_ENV="$TEST_ROOT/identity.env"
EXPECTED_IMAGE=ghcr.io/example/shape-of-you-identity
EXPECTED_DIGEST=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
mkdir -p "$FAKE_BIN"
printf '%s\n' 'DATABASE_URL=postgresql://identity:secret@example.test/identity' > "$RUNTIME_ENV"
EXPECTED_HASH=$(sha256sum "$RUNTIME_ENV" | awk '{print $1}')

printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  'case "${1:-}" in' \
  '  container) printf "%s\n" current-identity-container ;;' \
  '  inspect) printf "%s\n" "$FAKE_LIVE_IMAGE" ;;' \
  '  *) exit 1 ;;' \
  'esac' \
  > "$FAKE_BIN/docker"
chmod 0755 "$FAKE_BIN/docker"

assert_fails_with() {
  expected=$1
  shift
  output_file="$TEST_ROOT/failure.log"
  if "$@" >"$output_file" 2>&1; then
    printf '%s\n' 'Expected Identity state verification to fail.' >&2
    exit 1
  fi
  grep -F -- "$expected" "$output_file" >/dev/null
}

FAKE_LIVE_IMAGE="$EXPECTED_IMAGE@$EXPECTED_DIGEST"
export FAKE_LIVE_IMAGE
PATH="$FAKE_BIN:$PATH" sh "$VERIFIER" \
  "$EXPECTED_IMAGE" "$EXPECTED_DIGEST" "$EXPECTED_HASH" \
  "$RUNTIME_ENV" shape-of-you-staging

printf '%s\n' 'changed-state' >> "$RUNTIME_ENV"
assert_fails_with 'Identity runtime environment does not match the current release.' \
  env PATH="$FAKE_BIN:$PATH" FAKE_LIVE_IMAGE="$FAKE_LIVE_IMAGE" \
  sh "$VERIFIER" "$EXPECTED_IMAGE" "$EXPECTED_DIGEST" "$EXPECTED_HASH" \
  "$RUNTIME_ENV" shape-of-you-staging

printf '%s\n' 'DATABASE_URL=postgresql://identity:secret@example.test/identity' > "$RUNTIME_ENV"
assert_fails_with 'Running Identity image does not match the current release.' \
  env PATH="$FAKE_BIN:$PATH" FAKE_LIVE_IMAGE="$EXPECTED_IMAGE@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
  sh "$VERIFIER" "$EXPECTED_IMAGE" "$EXPECTED_DIGEST" "$EXPECTED_HASH" \
  "$RUNTIME_ENV" shape-of-you-staging

printf '%s\n' 'Current Identity state contract passed.'
