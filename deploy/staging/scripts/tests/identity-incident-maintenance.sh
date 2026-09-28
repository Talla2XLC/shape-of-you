#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../../.." && pwd)
MAINTENANCE=$SCRIPT_DIR/../identity-incident-maintenance.sh
TEST_ROOT=$(mktemp -d)
TEST_ROOT=$(readlink -f "$TEST_ROOT")
trap 'rm -rf "$TEST_ROOT"' EXIT HUP INT TERM
mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/releases" "$TEST_ROOT/runtime"
RELEASE_ID=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
mkdir -p "$TEST_ROOT/releases/$RELEASE_ID"
ln -s "$TEST_ROOT/releases/$RELEASE_ID" "$TEST_ROOT/current"
cat > "$TEST_ROOT/releases/$RELEASE_ID/release.env" <<EOF
DEPLOYMENT_TOPOLOGY=shared-ingress
IDENTITY_DIGEST=sha256:$(printf '%064d' 0)
API_SOURCE_RUN_ID=123456
API_IDENTITY_KID_DENY_CAPABILITY_VERSION=1
EOF
cat > "$TEST_ROOT/runtime/api.env" <<'EOF'
API_BROWSER_SESSION_KEYS=old-browser-key
EOF
cat > "$TEST_ROOT/runtime/identity.env" <<'EOF'
IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID=old
IDENTITY_OAUTH_ISSUANCE_DISABLED=false
EOF
cat > "$TEST_ROOT/api-stage.env" <<'EOF'
API_BROWSER_SESSION_KEYS=new-browser-key
IDENTITY_OAUTH_DENIED_KIDS={"version":1,"kids":["old"]}
EOF
cat > "$TEST_ROOT/identity-stage.env" <<'EOF'
IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID=old
IDENTITY_OAUTH_ISSUANCE_DISABLED=true
IDENTITY_OAUTH_PUBLICATION_DELAY_SECONDS=660
IDENTITY_OAUTH_VERIFICATION_OVERLAP_SECONDS=660
EOF
cat > "$TEST_ROOT/identity-activate.env" <<'EOF'
IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID=new
IDENTITY_OAUTH_ISSUANCE_DISABLED=true
IDENTITY_OAUTH_PUBLICATION_DELAY_SECONDS=660
IDENTITY_OAUTH_VERIFICATION_OVERLAP_SECONDS=660
EOF
cat > "$TEST_ROOT/identity-retire.env" <<'EOF'
IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID=new
IDENTITY_OAUTH_ISSUANCE_DISABLED=true
IDENTITY_OAUTH_PUBLICATION_DELAY_SECONDS=660
IDENTITY_OAUTH_VERIFICATION_OVERLAP_SECONDS=660
EOF
cat > "$TEST_ROOT/identity-resume.env" <<'EOF'
IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID=new
IDENTITY_OAUTH_ISSUANCE_DISABLED=false
IDENTITY_OAUTH_PUBLICATION_DELAY_SECONDS=660
IDENTITY_OAUTH_VERIFICATION_OVERLAP_SECONDS=660
EOF

cat > "$TEST_ROOT/bin/id" <<'EOF'
#!/bin/sh
printf '0\n'
EOF
cat > "$TEST_ROOT/bin/stat" <<'EOF'
#!/bin/sh
printf '0:600\n'
EOF
cat > "$TEST_ROOT/bin/flock" <<'EOF'
#!/bin/sh
exit 0
EOF
cat > "$TEST_ROOT/bin/docker" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$TEST_ROOT/docker.log"
if [ "${FAKE_FAIL_IDENTITY_UP:-false}" = true ]; then
  case "$*" in *'up --detach --no-deps --force-recreate identity'*) exit 1 ;; esac
fi
case "$*" in
  *'exec -T api node'*)
    [ "${FAKE_LEGACY_API:-false}" != true ] || exit 1
    while [ "$1" != --eval ]; do shift; done
    shift
    code=$1
    shift
    policy=$(sed -n 's/^IDENTITY_OAUTH_DENIED_KIDS=//p' "$RUNTIME_ENV")
    cd "$REPOSITORY_ROOT/apps/api"
    IDENTITY_OAUTH_DENIED_KIDS=$policy node --input-type=module --eval "$code" "$@"
    exit $?
    ;;
  *'exec -T identity node'*)
    while [ "$1" != --eval ]; do shift; done
    shift
    code=$1
    shift
    node --input-type=module --eval "$code" "$@"
    exit $?
    ;;
esac
exit 0
EOF
cat > "$TEST_ROOT/bin/date" <<'EOF'
#!/bin/sh
cat "$TEST_ROOT/time"
EOF
cat > "$TEST_ROOT/bin/curl" <<'EOF'
#!/bin/sh
output=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output=$2; shift 2 ;;
    --write-out|--request|--max-time) shift 2 ;;
    -*) shift ;;
    *) url=$1; shift ;;
  esac
done
phase=$(sed -n 's/^phase=//p' "$INCIDENT_MARKER")
case "$url" in
  */api/ready|*/live|*/.well-known/openid-configuration) status=200; body='{}' ;;
  */ready)
    if [ "$phase" = preparing-resume ]; then status=200; else status=503; fi
    body='{}'
    ;;
  */oauth/token) status=503; body='{}' ;;
  */oauth/jwks)
    status=200
    if [ "${FAKE_FALSE_JWKS:-false}" = true ]; then
      body='{"keys":[],"hint":{"kid":"new"}}'
    else
    case "$phase" in
      preparing-retire|preparing-resume) body=$(cat "$TEST_ROOT/new-jwks.json") ;;
      *) body=$(cat "$TEST_ROOT/both-jwks.json") ;;
    esac
    fi
    ;;
  *) status=500; body='{}' ;;
esac
printf '%s' "$body" > "$output"
printf '%s' "$status"
EOF
chmod +x "$TEST_ROOT/bin"/*

export TEST_ROOT
export REPOSITORY_ROOT
export INCIDENT_MARKER="$TEST_ROOT/runtime/identity-incident.state"
export DEPLOY_ROOT="$TEST_ROOT"
export RUNTIME_ENV="$TEST_ROOT/runtime/api.env"
export IDENTITY_RUNTIME_ENV="$TEST_ROOT/runtime/identity.env"
export LOCK_FILE="$TEST_ROOT/incident.lock"
export IDENTITY_URL=https://identity.example.test
export API_URL=https://api.example.test/api
export PATH="$TEST_ROOT/bin:$PATH"
printf '1000\n' > "$TEST_ROOT/time"
node --input-type=module --eval '
  import { generateKeyPairSync } from "node:crypto";
  import { writeFileSync } from "node:fs";
  const key = (kid) => ({ ...generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig" });
  const old = key("old");
  const next = key("new");
  writeFileSync(process.argv[1] + "/both-jwks.json", JSON.stringify({ keys: [old, next] }));
  writeFileSync(process.argv[1] + "/new-jwks.json", JSON.stringify({ keys: [next] }));
' "$TEST_ROOT"

if printf '%s' '{"keys":[],"hint":{"kid":"new"}}' |
  node "$SCRIPT_DIR/../verify-identity-jwks.mjs" old new present > /dev/null 2>&1; then
  printf '%s\n' 'Textual JWKS hint passed key validation.' >&2
  exit 1
fi

sed 's/^API_IDENTITY_KID_DENY_CAPABILITY_VERSION=1$/API_IDENTITY_KID_DENY_CAPABILITY_VERSION=0/' \
  "$TEST_ROOT/releases/$RELEASE_ID/release.env" > "$TEST_ROOT/release-legacy.env"
cp "$TEST_ROOT/release-legacy.env" "$TEST_ROOT/releases/$RELEASE_ID/release.env"
if sh "$MAINTENANCE" stage "$TEST_ROOT/api-stage.env" \
  "$TEST_ROOT/identity-stage.env" old new > "$TEST_ROOT/unverified.out" 2>&1; then
  printf '%s\n' 'Unverified API candidate was accepted for incident maintenance.' >&2
  exit 1
fi
[ ! -e "$INCIDENT_MARKER" ]
sed 's/^API_IDENTITY_KID_DENY_CAPABILITY_VERSION=0$/API_IDENTITY_KID_DENY_CAPABILITY_VERSION=1/' \
  "$TEST_ROOT/release-legacy.env" > "$TEST_ROOT/releases/$RELEASE_ID/release.env"

if sh "$MAINTENANCE" activate "$TEST_ROOT/identity-activate.env" \
  > "$TEST_ROOT/early.out" 2>&1; then
  printf '%s\n' 'Activation without staged publication was accepted.' >&2
  exit 1
fi
if [ -e "$INCIDENT_MARKER" ]; then
  printf '%s\n' 'Invalid phase created an incident marker.' >&2
  exit 1
fi

FAKE_FAIL_IDENTITY_UP=true
export FAKE_FAIL_IDENTITY_UP
if sh "$MAINTENANCE" stage "$TEST_ROOT/api-stage.env" \
  "$TEST_ROOT/identity-stage.env" old new > "$TEST_ROOT/failure.out" 2>&1; then
  printf '%s\n' 'A failed Identity restart was accepted.' >&2
  exit 1
fi
[ "$(sed -n 's/^phase=//p' "$INCIDENT_MARKER")" = preparing-stage ]
grep -Fq 'stop identity' "$TEST_ROOT/docker.log"
unset FAKE_FAIL_IDENTITY_UP
rm -f "$INCIDENT_MARKER"
printf '%s\n' 'API_BROWSER_SESSION_KEYS=old-browser-key' > "$RUNTIME_ENV"
printf '%s\n' \
  'IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID=old' \
  'IDENTITY_OAUTH_ISSUANCE_DISABLED=false' > "$IDENTITY_RUNTIME_ENV"

FAKE_LEGACY_API=true
export FAKE_LEGACY_API
if sh "$MAINTENANCE" stage "$TEST_ROOT/api-stage.env" \
  "$TEST_ROOT/identity-stage.env" old new > "$TEST_ROOT/legacy.out" 2>&1; then
  printf '%s\n' 'Legacy API passed runtime deny check.' >&2
  exit 1
fi
[ "$(sed -n 's/^phase=//p' "$INCIDENT_MARKER")" = preparing-stage ]
unset FAKE_LEGACY_API
rm -f "$INCIDENT_MARKER"
printf '%s\n' 'API_BROWSER_SESSION_KEYS=old-browser-key' > "$RUNTIME_ENV"

FAKE_FALSE_JWKS=true
export FAKE_FALSE_JWKS
if sh "$MAINTENANCE" stage "$TEST_ROOT/api-stage.env" \
  "$TEST_ROOT/identity-stage.env" old new > "$TEST_ROOT/false-jwks.out" 2>&1; then
  printf '%s\n' 'False JWKS passed stage.' >&2
  exit 1
fi
[ "$(sed -n 's/^phase=//p' "$INCIDENT_MARKER")" = preparing-stage ]
unset FAKE_FALSE_JWKS
rm -f "$INCIDENT_MARKER"
printf '%s\n' 'API_BROWSER_SESSION_KEYS=old-browser-key' > "$RUNTIME_ENV"

sh "$MAINTENANCE" stage "$TEST_ROOT/api-stage.env" \
  "$TEST_ROOT/identity-stage.env" old new > "$TEST_ROOT/stage.out"
[ "$(sed -n 's/^phase=//p' "$INCIDENT_MARKER")" = staged ]
[ "$(sed -n 's/^publication_observed_at=//p' "$INCIDENT_MARKER")" = 1001 ]
grep -Fq 'revoke-oauth-authority-for-incident.js --confirm-global-revocation' \
  "$TEST_ROOT/docker.log"
if sh "$MAINTENANCE" retire "$TEST_ROOT/identity-retire.env" \
  > "$TEST_ROOT/early.out" 2>&1; then
  printf '%s\n' 'Retirement before activation was accepted.' >&2
  exit 1
fi

printf '1660\n' > "$TEST_ROOT/time"
if sh "$MAINTENANCE" activate "$TEST_ROOT/identity-activate.env" \
  > "$TEST_ROOT/early-window.out" 2>&1; then
  printf '%s\n' 'Activation before external publication window was accepted.' >&2
  exit 1
fi
printf '1661\n' > "$TEST_ROOT/time"

sh "$MAINTENANCE" activate "$TEST_ROOT/identity-activate.env" \
  > "$TEST_ROOT/activate.out"
[ "$(sed -n 's/^phase=//p' "$INCIDENT_MARKER")" = activated ]
sh "$MAINTENANCE" retire "$TEST_ROOT/identity-retire.env" \
  > "$TEST_ROOT/retire.out"
[ "$(sed -n 's/^phase=//p' "$INCIDENT_MARKER")" = retired ]
sh "$MAINTENANCE" resume "$TEST_ROOT/identity-resume.env" \
  > "$TEST_ROOT/resume.out"
[ "$(sed -n 's/^phase=//p' "$INCIDENT_MARKER")" = resumed ]
grep -Fq 'API_BROWSER_SESSION_KEYS=new-browser-key' "$RUNTIME_ENV"
grep -Fq 'IDENTITY_OAUTH_DENIED_KIDS=' "$RUNTIME_ENV"
printf '%s\n' 'Identity incident maintenance simulation passed.'
