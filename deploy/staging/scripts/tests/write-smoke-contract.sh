#!/bin/sh
set -eu

REPOSITORY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../../.." && pwd)
SMOKE_SOURCE="$REPOSITORY_ROOT/deploy/staging/scripts/smoke.sh"
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/shape-of-you-write-smoke-test.XXXXXX")

cleanup() {
  rm -rf "$TEST_ROOT"
}

trap cleanup EXIT HUP INT TERM

mkdir -p "$TEST_ROOT/fake-bin"

cat > "$TEST_ROOT/fake-bin/curl" <<'EOF'
#!/bin/sh
set -eu

output=/dev/null
data=
method=GET
write_out=false
url=

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output)
      shift
      output=$1
      ;;
    --data)
      shift
      data=$1
      ;;
    --request)
      shift
      method=$1
      ;;
    --write-out)
      shift
      write_out=true
      ;;
    http://*|https://*)
      url=$1
      ;;
  esac
  shift
done

if [ "$write_out" = "true" ]; then
  printf '%s' '413'
  exit 0
fi

if [ "$method" = "POST" ]; then
  printf '%s' "$data" | grep -F '"sourceReference":{' >/dev/null
  printf '%s' "$data" | grep -F '"channel":"manual"' >/dev/null
  printf '%s' "$data" | grep -F '"externalSystem":null' >/dev/null
  printf '%s' "$data" | grep -F '"externalRecordId":null' >/dev/null
  printf '%s' "$data" | grep -F '"occurredAt":"' >/dev/null

  if printf '%s' "$data" | grep -F '"provenance":' >/dev/null; then
    exit 1
  fi

  printf '%s' \
    '{"id":"00000000-0000-4000-8000-000000000001","sourceReference":{"id":"00000000-0000-4000-8000-000000000002"}}' \
    > "$output"
fi

case "$url" in
  */api/v1/weight-measurements/*)
    case "$url" in
      *00000000-0000-4000-8000-000000000001) ;;
      *) exit 1 ;;
    esac
    ;;
esac
EOF

chmod 0755 "$TEST_ROOT/fake-bin/curl"

PATH="$TEST_ROOT/fake-bin:$PATH" \
RUN_WRITE_SMOKE=true \
RELEASE_ID=0123456789abcdef0123456789abcdef01234567 \
  sh "$SMOKE_SOURCE" >/dev/null

printf '%s\n' 'write smoke contract regression test passed.'
