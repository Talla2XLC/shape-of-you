#!/bin/sh
set -eu

REPOSITORY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../../.." && pwd)
BOOTSTRAP="$REPOSITORY_ROOT/deploy/staging/system/shape-of-you-staging-deploy"
CONTROLLER="$REPOSITORY_ROOT/deploy/staging/scripts/deployment-controller.sh"
INSTALLER="$REPOSITORY_ROOT/deploy/staging/system/install-root-owned-assets.sh"
SUDOERS="$REPOSITORY_ROOT/deploy/staging/system/shape-deploy.sudoers"
COMPOSE="$REPOSITORY_ROOT/deploy/staging/compose.yaml"
PREFLIGHT="$REPOSITORY_ROOT/deploy/staging/scripts/vm-preflight.sh"
DEPLOY="$REPOSITORY_ROOT/deploy/staging/scripts/deploy.sh"
DEPLOY_WORKFLOW="$REPOSITORY_ROOT/.github/workflows/deploy-staging.yml"
PUBLISH_WORKFLOW="$REPOSITORY_ROOT/.github/workflows/publish-staging.yml"

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

write_identity_request() {
  callback=$1
  request_file=$2
  {
    printf '%s\n' 'RELEASE_ID=0123456789abcdef0123456789abcdef01234567'
    printf '%s\n' 'API_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    printf '%s\n' 'IDENTITY_DIGEST=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    printf '%s\n' 'EDGE_DIGEST=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    printf '%s\n' 'CERTBOT_DIGEST=sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
    printf '%s\n' 'ACME_EMAIL=operator@example.com'
    printf '%s\n' 'PUBLIC_IPV4=203.0.113.10'
    printf '%s\n' 'DEPLOYMENT_TOPOLOGY=shared-ingress'
    printf '%s\n' 'SCHEMA_BACKWARD_COMPATIBLE=true'
    printf '%s\n' 'IDENTITY_SCHEMA_BACKWARD_COMPATIBLE=true'
    printf '%s\n' 'IDENTITY_OAUTH_CLIENTS_BACKWARD_COMPATIBLE=true'
    printf '%s\n' 'RUN_WRITE_SMOKE=false'
    printf '%s\n' 'GHCR_NAMESPACE=example'
    printf '%s\n' 'GHCR_ACTOR=operator'
    printf '%s\n' 'CONTROL_SHA=0123456789abcdef0123456789abcdef01234567'
    printf '%s\n' 'DATABASE_URL=postgresql://api:password@database:5432/api'
    printf '%s\n' 'IDENTITY_DATABASE_URL=postgresql://identity:password@database:5432/identity'
    printf '%s\n' 'IDENTITY_TOTP_ACTIVE_KEY_ID=staging-v1'
    printf '%s\n' 'IDENTITY_TOTP_ENCRYPTION_KEYS=fixture-key-ring'
    printf '%s\n' 'IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID=staging-v1'
    printf '%s\n' 'IDENTITY_OAUTH_SIGNING_KEYS=fixture-signing-key-ring'
    printf '%s\n' 'IDENTITY_OAUTH_COOKIE_KEYS=fixture-cookie-key-ring'
    printf 'IDENTITY_CHATGPT_REDIRECT_URI=%s\n' "$callback"
    printf '%s\n' 'IDENTITY_WEB_REDIRECT_URI=https://staging.shape-of-you.ru/api/browser-auth/callback'
    printf '%s\n' 'API_BROWSER_SESSION_KEYS=fixture-browser-session-key-ring'
    printf '%s\n' 'GHCR_TOKEN=fixture-token'
  } > "$request_file"
}

assert_callback_rejected_without_echo() {
  callback=$1
  request_file=$(mktemp "${TMPDIR:-/tmp}/shape-of-you-callback-request.XXXXXX")
  output_file=$(mktemp "${TMPDIR:-/tmp}/shape-of-you-callback-output.XXXXXX")
  write_identity_request "$callback" "$request_file"
  if env SHAPE_OF_YOU_STAGING_LOCK_HELD=true \
    sh "$CONTROLLER" < "$request_file" > "$output_file" 2>&1; then
    printf '%s\n' 'Unsafe callback input was accepted.' >&2
    rm -f "$request_file" "$output_file"
    exit 1
  fi
  if [ -n "$callback" ] && grep -F -- "$callback" "$output_file" >/dev/null; then
    printf '%s\n' 'Rejected callback was echoed.' >&2
    rm -f "$request_file" "$output_file"
    exit 1
  fi
  rm -f "$request_file" "$output_file"
}

assert_contains "$BOOTSTRAP" 'MAX_REQUEST_BYTES=65536'
assert_contains "$BOOTSTRAP" 'MAX_REQUEST_LINES=128'
assert_contains "$BOOTSTRAP" 'NETWORK_ATTEMPTS=3'
assert_contains "$BOOTSTRAP" 'NETWORK_RETRY_DELAY_SECONDS=2'
assert_contains "$BOOTSTRAP" 'retry_network()'
assert_contains "$BOOTSTRAP" '[ "$attempt" -lt "$NETWORK_ATTEMPTS" ] || return 1'
assert_contains "$BOOTSTRAP" 'sleep "$NETWORK_RETRY_DELAY_SECONDS"'
assert_contains "$BOOTSTRAP" 'head -c $((MAX_REQUEST_BYTES + 1))'
assert_contains "$BOOTSTRAP" 'request_bytes=$(wc -c < "$REQUEST_FILE")'
assert_contains "$BOOTSTRAP" 'CONTROL_REPOSITORY=https://github.com/Talla2XLC/shape-of-you.git'
assert_contains "$BOOTSTRAP" 'CONTROL_BRANCH=main'
assert_contains "$BOOTSTRAP" 'GIT_TERMINAL_PROMPT=0'
assert_contains "$BOOTSTRAP" 'git init "$CONTROL_ROOT"'
assert_contains "$BOOTSTRAP" 'git -C "$CONTROL_ROOT" remote add origin "$CONTROL_REPOSITORY"'
assert_contains "$BOOTSTRAP" 'retry_network git -C "$CONTROL_ROOT" -c http.version=HTTP/1.1'
assert_not_contains "$BOOTSTRAP" 'git clone'
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
assert_contains "$CONTROLLER" 'API_BROWSER_SESSION_KEYS'
assert_contains "$CONTROLLER" 'docker login ghcr.io'
assert_contains "$CONTROLLER" 'Deployment controller must be invoked by the root-owned bootstrap.'
assert_not_contains "$CONTROLLER" 'git clone'
assert_not_contains "$CONTROLLER" 'git -C'
assert_not_contains "$CONTROLLER" 'FITNESS_TRACKER'
assert_not_contains "$CONTROLLER" 'GOOGLE_SHEETS_SERVICE_ACCOUNT'
assert_not_contains "$COMPOSE" 'fitness-tracker-import'
assert_not_contains "$DEPLOY_WORKFLOW" 'run_fitness_tracker_weight_dry_run'
assert_not_contains "$PUBLISH_WORKFLOW" 'run_fitness_tracker_weight_dry_run'
assert_contains "$PUBLISH_WORKFLOW" 'paths-ignore:'
assert_contains "$PUBLISH_WORKFLOW" "- '**/*.md'"
assert_contains "$PUBLISH_WORKFLOW" "- 'docs/**'"
assert_contains "$PUBLISH_WORKFLOW" "- 'plans/**'"
assert_contains "$DEPLOY_WORKFLOW" 'ServerAliveInterval=30'
assert_contains "$DEPLOY_WORKFLOW" 'ServerAliveCountMax=6'
assert_contains "$PREFLIGHT" 'command -v timeout'
assert_contains "$DEPLOY" 'run_migration()'
assert_contains "$DEPLOY" 'timeout --signal=TERM --kill-after=30s 300s'
assert_not_contains "$DEPLOY" 'timeout --foreground'
assert_contains "$DEPLOY" 'migration_container="${COMPOSE_PROJECT}-${migration_service}-migration"'
assert_contains "$DEPLOY" 'run --name "$migration_container" --rm'
assert_contains "$DEPLOY" 'docker rm --force "$container_name"'
assert_contains "$DEPLOY" 'docker container ls --all --quiet'
assert_contains "$DEPLOY" '--filter "name=^/${container_name}$"'
assert_contains "$DEPLOY" "run_migration 'API migration' migrate"
assert_contains "$DEPLOY" "run_migration 'Identity migration' identity-migrate"
assert_contains "$DEPLOY" 'timed out after 300 seconds'
assert_contains "$DEPLOY" 'ended with SIGKILL or timeout escalation'
assert_contains "$DEPLOY" 'compose ps --all "$migration_service"'
assert_not_contains "$DEPLOY_WORKFLOW" 'MIGRATION_TIMEOUT'
assert_not_contains "$PUBLISH_WORKFLOW" 'MIGRATION_TIMEOUT'

assert_contains "$INSTALLER" 'shape-of-you-staging-deploy'
assert_contains "$SUDOERS" '/usr/local/sbin/shape-of-you-staging-deploy ""'

assert_fails_with 'Deployment controller must be invoked by the root-owned bootstrap.' \
  sh "$CONTROLLER"

unknown_request=$(mktemp "${TMPDIR:-/tmp}/shape-of-you-unknown-request.XXXXXX")
printf '%s\n' 'FUTURE_FIELD=value' > "$unknown_request"
assert_fails_with 'Unexpected deployment input: FUTURE_FIELD.' \
  env SHAPE_OF_YOU_STAGING_LOCK_HELD=true sh "$CONTROLLER" < "$unknown_request"
rm -f "$unknown_request"

assert_callback_rejected_without_echo ''
assert_callback_rejected_without_echo 'not-a-url'
assert_callback_rejected_without_echo 'https://user@chatgpt.com/connector_platform_oauth_redirect'
assert_callback_rejected_without_echo 'https://example.com/connector_platform_oauth_redirect'
assert_callback_rejected_without_echo 'https://chatgpt.com/connector/oauth/42Qr-Z4hTGXh'
assert_callback_rejected_without_echo 'https://chatgpt.com/connector_platform_oauth_redirect?leak=value'
assert_callback_rejected_without_echo 'https://chatgpt.com/connector_platform_oauth_redirect#fragment'
multiline_callback=$(printf 'https://chatgpt.com/connector_platform_oauth_redirect\nFUTURE_FIELD=injected')
assert_callback_rejected_without_echo "$multiline_callback"

sh -n "$BOOTSTRAP"
sh -n "$CONTROLLER"
sh -n "$DEPLOY"
sh -n "$PREFLIGHT"

printf '%s\n' 'Deployment bootstrap contract test passed.'
