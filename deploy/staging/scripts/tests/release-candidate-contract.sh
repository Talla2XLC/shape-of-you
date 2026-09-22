#!/bin/sh
set -eu

REPOSITORY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../../.." && pwd)
WRITER="$REPOSITORY_ROOT/deploy/staging/scripts/write-release-candidate.sh"
READER="$REPOSITORY_ROOT/deploy/staging/scripts/read-release-candidate.sh"
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/shape-of-you-release-candidate.XXXXXX")

cleanup() {
  rm -rf "$TEST_ROOT"
}

trap cleanup EXIT HUP INT TERM

release_id=0123456789abcdef0123456789abcdef01234567
api_digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
identity_digest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
edge_digest=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
certbot_digest=sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
candidate="$TEST_ROOT/candidate.env"

SOURCE_REPOSITORY=Talla2XLC/shape-of-you \
SOURCE_RUN_ID=123456 \
RELEASE_ID=$release_id \
API_DIGEST=$api_digest \
DEPLOY_IDENTITY=true \
EXPECTED_STAGING_BASE= \
IDENTITY_DIGEST=$identity_digest \
EDGE_DIGEST=$edge_digest \
CERTBOT_DIGEST=$certbot_digest \
  sh "$WRITER" "$candidate"

output=$(sh "$READER" "$candidate" "$release_id" 123456 Talla2XLC/shape-of-you)
printf '%s\n' "$output" | grep -F -- "release_id=$release_id" >/dev/null
printf '%s\n' "$output" | grep -F -- "identity_digest=$identity_digest" >/dev/null
printf '%s\n' "$output" | grep -F -- 'expected_staging_base=' >/dev/null

inherited="$TEST_ROOT/inherited.env"
SOURCE_REPOSITORY=Talla2XLC/shape-of-you \
SOURCE_RUN_ID=123457 \
RELEASE_ID=$release_id \
API_DIGEST=$api_digest \
DEPLOY_IDENTITY=false \
EXPECTED_STAGING_BASE=$release_id \
IDENTITY_DIGEST= \
EDGE_DIGEST=$edge_digest \
CERTBOT_DIGEST=$certbot_digest \
  sh "$WRITER" "$inherited"
sh "$READER" "$inherited" "$release_id" 123457 Talla2XLC/shape-of-you |
  grep -F -- 'deploy_identity=false' >/dev/null
sh "$READER" "$inherited" "$release_id" 123457 Talla2XLC/shape-of-you |
  grep -F -- "expected_staging_base=$release_id" >/dev/null

missing_base="$TEST_ROOT/missing-base.env"
sed 's/^EXPECTED_STAGING_BASE=.*/EXPECTED_STAGING_BASE=/' "$inherited" > "$missing_base"

assert_rejected() {
  candidate_file=$1
  expected_release=${2:-$release_id}
  expected_run=${3:-123456}
  expected_repository=${4:-Talla2XLC/shape-of-you}
  if sh "$READER" "$candidate_file" "$expected_release" "$expected_run" \
    "$expected_repository" >/dev/null 2>&1; then
    printf '%s\n' "Unsafe candidate was accepted: $candidate_file" >&2
    exit 1
  fi
}

duplicate="$TEST_ROOT/duplicate.env"
cp "$candidate" "$duplicate"
printf 'API_DIGEST=%s\n' "$api_digest" >> "$duplicate"
assert_rejected "$duplicate"

unknown="$TEST_ROOT/unknown.env"
cp "$candidate" "$unknown"
printf '%s\n' 'DATABASE_URL=must-not-be-accepted' >> "$unknown"
assert_rejected "$unknown"

missing="$TEST_ROOT/missing.env"
grep -v '^EDGE_DIGEST=' "$candidate" > "$missing"
assert_rejected "$missing"

malformed="$TEST_ROOT/malformed.env"
sed 's/^API_DIGEST=.*/API_DIGEST=latest/' "$candidate" > "$malformed"
assert_rejected "$malformed"
assert_rejected "$missing_base" "$release_id" 123457 Talla2XLC/shape-of-you

assert_rejected "$candidate" "$release_id" 999999 Talla2XLC/shape-of-you
assert_rejected "$candidate" "$release_id" 123456 another/repository

if grep -Eq '(^|[[:space:]])(eval|source)([[:space:]]|$)' "$READER"; then
  printf '%s\n' 'Candidate reader must not evaluate artifact contents.' >&2
  exit 1
fi

sh -n "$WRITER"
sh -n "$READER"

printf '%s\n' 'Staging release candidate contract passed.'
