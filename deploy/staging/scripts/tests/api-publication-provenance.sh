#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
VERIFY=$SCRIPT_DIR/../verify-api-publication-candidate.sh
WRITE=$SCRIPT_DIR/../write-release-candidate.sh
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT HUP INT TERM
mkdir -p "$TEST_ROOT/bin"
release_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
api_digest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
identity_digest=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
edge_digest=sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
certbot_digest=sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee

SOURCE_REPOSITORY=Talla2XLC/shape-of-you SOURCE_RUN_ID=123456 \
RELEASE_ID=$release_id API_DIGEST=$api_digest DEPLOY_IDENTITY=true \
IDENTITY_DIGEST=$identity_digest EDGE_DIGEST=$edge_digest \
CERTBOT_DIGEST=$certbot_digest sh "$WRITE" "$TEST_ROOT/candidate.env"

cat > "$TEST_ROOT/bin/gh" <<'EOF'
#!/bin/sh
case "$1 $2" in
  'run list') printf '%s\n' 123456 ;;
  'run view')
    while [ "$#" -gt 0 ]; do
      if [ "$1" = --json ]; then
        case "$2" in
          headSha) printf '%s\n' "${FAKE_HEAD_SHA:-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}" ;;
          headBranch) printf '%s\n' main ;;
          conclusion) printf '%s\n' success ;;
          event) printf '%s\n' push ;;
        esac
        exit 0
      fi
      shift
    done
    exit 1
    ;;
  'run download')
    while [ "$#" -gt 0 ]; do
      if [ "$1" = --dir ]; then
        cp "$FAKE_CANDIDATE" "$2/candidate.env"
        exit 0
      fi
      shift
    done
    exit 1
    ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$TEST_ROOT/bin/gh"
export FAKE_CANDIDATE="$TEST_ROOT/candidate.env"
export PATH="$TEST_ROOT/bin:$PATH"
output=$TEST_ROOT/output
sh "$VERIFY" "$release_id" "$api_digest" Talla2XLC/shape-of-you "$output"
grep -qx 'api_source_run_id=123456' "$output"
grep -qx 'api_identity_kid_deny_capability_version=1' "$output"

if sh "$VERIFY" "$release_id" \
  sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff \
  Talla2XLC/shape-of-you "$TEST_ROOT/mismatch" >/dev/null 2>&1; then
  printf '%s\n' 'Arbitrary API digest passed publication provenance.' >&2
  exit 1
fi

FAKE_HEAD_SHA=ffffffffffffffffffffffffffffffffffffffff
export FAKE_HEAD_SHA
if sh "$VERIFY" "$release_id" "$api_digest" \
  Talla2XLC/shape-of-you "$TEST_ROOT/wrong-head" >/dev/null 2>&1; then
  printf '%s\n' 'Wrong publication commit passed provenance.' >&2
  exit 1
fi
unset FAKE_HEAD_SHA

grep -v '^API_IDENTITY_KID_DENY_CAPABILITY_VERSION=' \
  "$TEST_ROOT/candidate.env" > "$TEST_ROOT/legacy.env"
FAKE_CANDIDATE=$TEST_ROOT/legacy.env
export FAKE_CANDIDATE
sh "$VERIFY" "$release_id" "$api_digest" \
  Talla2XLC/shape-of-you "$TEST_ROOT/legacy-output"
grep -qx 'api_identity_kid_deny_capability_version=0' "$TEST_ROOT/legacy-output"

printf '%s\n' 'API publication provenance contract passed.'
