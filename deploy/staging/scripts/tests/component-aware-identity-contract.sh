#!/bin/sh
set -eu

REPOSITORY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../../.." && pwd)
DETECTOR="$REPOSITORY_ROOT/deploy/staging/scripts/detect-identity-change.sh"
DEPLOY_SOURCE="$REPOSITORY_ROOT/deploy/staging/scripts/deploy.sh"
TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/shape-of-you-identity-change.XXXXXX")

cleanup() {
  rm -rf "$TEST_ROOT"
}

trap cleanup EXIT HUP INT TERM

git -C "$TEST_ROOT" init --quiet
git -C "$TEST_ROOT" config user.email test@example.invalid
git -C "$TEST_ROOT" config user.name 'Shape of You test'
mkdir -p "$TEST_ROOT/apps/api" "$TEST_ROOT/apps/identity" "$TEST_ROOT/deploy/staging"
printf '%s\n' node_modules > "$TEST_ROOT/.dockerignore"
printf '%s\n' api > "$TEST_ROOT/apps/api/source.ts"
printf '%s\n' identity > "$TEST_ROOT/apps/identity/source.ts"
printf '%s\n' compose > "$TEST_ROOT/deploy/staging/compose.identity.yaml"
for input in package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json; do
  printf '%s\n' "$input" > "$TEST_ROOT/$input"
done
git -C "$TEST_ROOT" add .dockerignore apps deploy package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json
git -C "$TEST_ROOT" commit --quiet -m baseline
baseline=$(git -C "$TEST_ROOT" rev-parse HEAD)

printf '%s\n' api-change >> "$TEST_ROOT/apps/api/source.ts"
git -C "$TEST_ROOT" add apps/api/source.ts
git -C "$TEST_ROOT" commit --quiet -m api
api_change=$(git -C "$TEST_ROOT" rev-parse HEAD)
[ "$(REPOSITORY_ROOT="$TEST_ROOT" sh "$DETECTOR" "$baseline" "$api_change")" = false ]

printf '%s\n' identity-change >> "$TEST_ROOT/apps/identity/source.ts"
git -C "$TEST_ROOT" add apps/identity/source.ts
git -C "$TEST_ROOT" commit --quiet -m identity
identity_change=$(git -C "$TEST_ROOT" rev-parse HEAD)
[ "$(REPOSITORY_ROOT="$TEST_ROOT" sh "$DETECTOR" "$api_change" "$identity_change")" = true ]

printf '%s\n' lock-change >> "$TEST_ROOT/pnpm-lock.yaml"
git -C "$TEST_ROOT" add pnpm-lock.yaml
git -C "$TEST_ROOT" commit --quiet -m lock
shared_change=$(git -C "$TEST_ROOT" rev-parse HEAD)
[ "$(REPOSITORY_ROOT="$TEST_ROOT" sh "$DETECTOR" "$identity_change" "$shared_change")" = true ]

printf '%s\n' '*.log' >> "$TEST_ROOT/.dockerignore"
git -C "$TEST_ROOT" add .dockerignore
git -C "$TEST_ROOT" commit --quiet -m dockerignore
dockerignore_change=$(git -C "$TEST_ROOT" rev-parse HEAD)
[ "$(REPOSITORY_ROOT="$TEST_ROOT" sh "$DETECTOR" "$shared_change" "$dockerignore_change")" = true ]

[ "$(REPOSITORY_ROOT="$TEST_ROOT" sh "$DETECTOR" 0000000000000000000000000000000000000000 "$dockerignore_change")" = true ]
[ "$(REPOSITORY_ROOT="$TEST_ROOT" sh "$DETECTOR" invalid "$dockerignore_change")" = true ]

DEPLOY_PACKAGE="$TEST_ROOT/deploy-package"
DEPLOY_ROOT="$TEST_ROOT/runtime"
RELEASE_ID=fedcba9876543210fedcba9876543210fedcba98
FAKE_BIN="$TEST_ROOT/fake-bin"
FAKE_DOCKER_LOG="$TEST_ROOT/docker.log"
FAKE_SMOKE_LOG="$TEST_ROOT/smoke.log"
export FAKE_DOCKER_LOG FAKE_SMOKE_LOG

mkdir -p "$DEPLOY_PACKAGE/scripts" "$FAKE_BIN"
cp "$DEPLOY_SOURCE" "$DEPLOY_PACKAGE/scripts/deploy.sh"
touch "$DEPLOY_PACKAGE/compose.yaml" \
  "$DEPLOY_PACKAGE/compose.identity.yaml" \
  "$DEPLOY_PACKAGE/compose.shared-ingress.yaml"

printf '%s\n' '#!/bin/sh' 'exit 0' > "$DEPLOY_PACKAGE/scripts/vm-preflight.sh"
printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  'printf "%s:%s\n" "$RELEASE_ID" "$IDENTITY_SMOKE_ENABLED" >> "$FAKE_SMOKE_LOG"' \
  > "$DEPLOY_PACKAGE/scripts/smoke.sh"
printf '%s\n' '#!/bin/sh' 'exit 1' > "$DEPLOY_PACKAGE/scripts/rollback.sh"
chmod 0755 "$DEPLOY_PACKAGE/scripts/"*.sh

printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  'printf "%s\n" "$*" >> "$FAKE_DOCKER_LOG"' \
  'case "$*" in' \
  '  *"compose"*" ps --quiet "*) printf "%s\n" fake-container ;;' \
  '  "inspect "*) exit 0 ;;' \
  'esac' \
  > "$FAKE_BIN/docker"
printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  'shift 3' \
  'exec "$@"' \
  > "$FAKE_BIN/timeout"
chmod 0755 "$FAKE_BIN/docker" "$FAKE_BIN/timeout"

RELEASE_ENV="$TEST_ROOT/reused-identity-release.env"
printf '%s\n' \
  "RELEASE_ID=$RELEASE_ID" \
  'API_IMAGE=ghcr.io/example/shape-of-you-api' \
  'API_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
  'IDENTITY_IMAGE=ghcr.io/example/shape-of-you-identity' \
  'IDENTITY_DIGEST=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' \
  'IDENTITY_SCHEMA_BACKWARD_COMPATIBLE=false' \
  'IDENTITY_OAUTH_CLIENTS_BACKWARD_COMPATIBLE=false' \
  'IDENTITY_UPDATE_REQUIRED=false' \
  'EDGE_IMAGE=ghcr.io/example/shape-of-you-edge' \
  'EDGE_DIGEST=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' \
  'CERTBOT_IMAGE=ghcr.io/example/shape-of-you-certbot' \
  'CERTBOT_DIGEST=sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' \
  'ACME_EMAIL=operator@example.com' \
  'PUBLIC_IPV4=203.0.113.10' \
  'DEPLOYMENT_TOPOLOGY=shared-ingress' \
  'SCHEMA_BACKWARD_COMPATIBLE=false' \
  > "$RELEASE_ENV"

PATH="$FAKE_BIN:$PATH" \
DEPLOY_ROOT="$DEPLOY_ROOT" \
COMPOSE_FILE="$DEPLOY_PACKAGE/compose.yaml" \
IDENTITY_COMPOSE_FILE="$DEPLOY_PACKAGE/compose.identity.yaml" \
  sh "$DEPLOY_PACKAGE/scripts/deploy.sh" "$RELEASE_ENV" >/dev/null

grep -F -- 'pull api edge certbot' "$FAKE_DOCKER_LOG" >/dev/null
grep -F -- 'run --name shape-of-you-staging-migrate-migration --rm migrate' \
  "$FAKE_DOCKER_LOG" >/dev/null
grep -F -- 'up --detach --wait --wait-timeout 90 api' "$FAKE_DOCKER_LOG" >/dev/null
grep -F -- 'up --detach --no-deps --wait --wait-timeout 90 --remove-orphans edge' \
  "$FAKE_DOCKER_LOG" >/dev/null
grep -F -- "$RELEASE_ID:true" "$FAKE_SMOKE_LOG" >/dev/null

for forbidden_operation in \
  'identity-migrate' \
  'identity-reconcile-oauth-clients' \
  'parseTotpKeyRing' \
  'up --detach --wait --wait-timeout 90 api identity'; do
  if grep -F -- "$forbidden_operation" "$FAKE_DOCKER_LOG" >/dev/null; then
    printf '%s\n' "Unchanged Identity operation was executed: $forbidden_operation" >&2
    exit 1
  fi
done

printf '%s\n' 'Component-aware Identity delivery contract passed.'
