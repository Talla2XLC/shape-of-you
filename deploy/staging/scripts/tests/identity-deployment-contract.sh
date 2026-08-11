#!/bin/sh
set -eu

REPOSITORY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../../.." && pwd)
COMPOSE="$REPOSITORY_ROOT/deploy/staging/compose.yaml"
IDENTITY_COMPOSE="$REPOSITORY_ROOT/deploy/staging/compose.identity.yaml"
SHARED_COMPOSE="$REPOSITORY_ROOT/deploy/staging/compose.shared-ingress.yaml"
STANDALONE_COMPOSE="$REPOSITORY_ROOT/deploy/staging/compose.standalone.yaml"
COMPOSE_TEST_OVERRIDE="$REPOSITORY_ROOT/deploy/staging/scripts/tests/compose-no-runtime-env.yaml"
IDENTITY_TEST_OVERRIDE="$REPOSITORY_ROOT/deploy/staging/scripts/tests/compose-identity-no-runtime-env.yaml"
RELEASE_ENV="$REPOSITORY_ROOT/deploy/staging/release.env.example"
PUBLISH_WORKFLOW="$REPOSITORY_ROOT/.github/workflows/publish-staging.yml"
DEPLOY_WORKFLOW="$REPOSITORY_ROOT/.github/workflows/deploy-staging.yml"
DEPLOY="$REPOSITORY_ROOT/deploy/staging/scripts/deploy.sh"
ROLLBACK="$REPOSITORY_ROOT/deploy/staging/scripts/rollback.sh"
CONTROLLER="$REPOSITORY_ROOT/deploy/staging/scripts/deployment-controller.sh"
SMOKE="$REPOSITORY_ROOT/deploy/staging/scripts/smoke.sh"
NGINX="$REPOSITORY_ROOT/deploy/staging/nginx/nginx.conf.template"
RENDER_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/shape-of-you-identity-render.XXXXXX")

cleanup() {
  rm -rf "$RENDER_ROOT"
}

trap cleanup EXIT HUP INT TERM

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

assert_contains "$IDENTITY_COMPOSE" 'identity.staging.shape-of-you.ru'
assert_contains "$IDENTITY_COMPOSE" '/etc/shape-of-you/staging/identity.env'
assert_contains "$IDENTITY_COMPOSE" 'identity_database_access'
assert_contains "$IDENTITY_COMPOSE" 'identity-migrate:'
assert_contains "$IDENTITY_COMPOSE" 'identity-reconcile-oauth-clients:'
assert_contains "$IDENTITY_COMPOSE" 'reconcile-predefined-oauth-clients.js'
assert_not_contains "$IDENTITY_COMPOSE" 'ports:'
assert_contains "$PUBLISH_WORKFLOW" 'file: apps/identity/Dockerfile'
assert_contains "$PUBLISH_WORKFLOW" 'shape-of-you-identity:sha-${{ github.sha }}'
assert_contains "$PUBLISH_WORKFLOW" 'Attest Identity image'
assert_contains "$PUBLISH_WORKFLOW" 'identity_digest: ${{ needs.publish-identity.outputs.digest }}'
assert_contains "$DEPLOY_WORKFLOW" 'STAGING_IDENTITY_DATABASE_URL'
assert_contains "$DEPLOY_WORKFLOW" 'STAGING_IDENTITY_TOTP_ACTIVE_KEY_ID'
assert_contains "$DEPLOY_WORKFLOW" 'STAGING_IDENTITY_TOTP_ENCRYPTION_KEYS'
assert_contains "$DEPLOY_WORKFLOW" 'STAGING_IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID'
assert_contains "$DEPLOY_WORKFLOW" 'STAGING_IDENTITY_OAUTH_SIGNING_KEYS'
assert_contains "$DEPLOY_WORKFLOW" 'STAGING_IDENTITY_OAUTH_COOKIE_KEYS'
assert_contains "$DEPLOY_WORKFLOW" 'STAGING_IDENTITY_CHATGPT_REDIRECT_URI'
assert_contains "$DEPLOY_WORKFLOW" "printf 'IDENTITY_DIGEST=%s"
assert_contains "$DEPLOY_WORKFLOW" "printf 'IDENTITY_SCHEMA_BACKWARD_COMPATIBLE=%s"
assert_contains "$DEPLOY_WORKFLOW" "printf 'IDENTITY_OAUTH_CLIENTS_BACKWARD_COMPATIBLE=%s"
assert_contains "$DEPLOY" 'identity-migrate'
assert_contains "$DEPLOY" 'identity-reconcile-oauth-clients'
assert_contains "$DEPLOY" 'parseTotpKeyRing'
assert_contains "$DEPLOY" 'api identity'
assert_contains "$ROLLBACK" 'api identity edge'
assert_contains "$CONTROLLER" 'IDENTITY_DATABASE_URL'
assert_contains "$CONTROLLER" 'IDENTITY_TOTP_ACTIVE_KEY_ID'
assert_contains "$CONTROLLER" 'IDENTITY_TOTP_ENCRYPTION_KEYS'
assert_contains "$CONTROLLER" 'IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID'
assert_contains "$CONTROLLER" 'IDENTITY_OAUTH_SIGNING_KEYS'
assert_contains "$CONTROLLER" 'IDENTITY_OAUTH_COOKIE_KEYS'
assert_contains "$CONTROLLER" 'IDENTITY_SCHEMA_BACKWARD_COMPATIBLE'
assert_contains "$CONTROLLER" 'IDENTITY_OAUTH_CLIENTS_BACKWARD_COMPATIBLE'
assert_contains "$CONTROLLER" 'IDENTITY_CHATGPT_REDIRECT_URI'
assert_contains "$CONTROLLER" '/etc/shape-of-you/staging/identity.env'
assert_contains "$CONTROLLER" 'shape-of-you-identity'
assert_contains "$DEPLOY" 'rollback_schema_compatible'
assert_contains "$SMOKE" 'IDENTITY_SMOKE_ENABLED'
assert_contains "$SMOKE" '"$IDENTITY_URL/live"'
assert_contains "$SMOKE" '"$IDENTITY_URL/ready"'
assert_contains "$NGINX" 'proxy_pass http://identity:3000;'

docker compose \
  --project-name shape-of-you-identity-contract-test \
  --env-file "$RELEASE_ENV" \
  --file "$COMPOSE" \
  --file "$SHARED_COMPOSE" \
  --file "$IDENTITY_COMPOSE" \
  --file "$COMPOSE_TEST_OVERRIDE" \
  --file "$IDENTITY_TEST_OVERRIDE" \
  --profile operations \
  config > "$RENDER_ROOT/shared.yaml"

docker compose \
  --project-name shape-of-you-identity-contract-test \
  --env-file "$RELEASE_ENV" \
  --file "$COMPOSE" \
  --file "$STANDALONE_COMPOSE" \
  --file "$IDENTITY_COMPOSE" \
  --file "$COMPOSE_TEST_OVERRIDE" \
  --file "$IDENTITY_TEST_OVERRIDE" \
  --profile operations \
  config > "$RENDER_ROOT/standalone.yaml"

assert_contains "$RENDER_ROOT/shared.yaml" 'shape-of-you-identity@sha256:'
assert_contains "$RENDER_ROOT/shared.yaml" 'identity_database_access:'
assert_not_contains "$RENDER_ROOT/shared.yaml" 'published:'
assert_contains "$RENDER_ROOT/standalone.yaml" 'published: "80"'
assert_contains "$RENDER_ROOT/standalone.yaml" 'published: "443"'

printf '%s\n' 'Identity deployment contract test passed.'
