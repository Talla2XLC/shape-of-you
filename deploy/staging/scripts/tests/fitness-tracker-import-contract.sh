#!/bin/sh
set -eu

REPOSITORY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../../.." && pwd)
COMPOSE="$REPOSITORY_ROOT/deploy/staging/compose.yaml"
SHARED_COMPOSE="$REPOSITORY_ROOT/deploy/staging/compose.shared-ingress.yaml"
COMPOSE_TEST_OVERRIDE="$REPOSITORY_ROOT/deploy/staging/scripts/tests/compose-no-runtime-env.yaml"
RELEASE_ENV="$REPOSITORY_ROOT/deploy/staging/release.env.example"
PUBLISH_WORKFLOW="$REPOSITORY_ROOT/.github/workflows/publish-staging.yml"
DEPLOY_WORKFLOW="$REPOSITORY_ROOT/.github/workflows/deploy-staging.yml"
CONTROLLER="$REPOSITORY_ROOT/deploy/staging/scripts/deployment-controller.sh"
DEPLOY="$REPOSITORY_ROOT/deploy/staging/scripts/deploy.sh"
PREFLIGHT="$REPOSITORY_ROOT/deploy/staging/scripts/vm-preflight.sh"
RENDERED=$(mktemp "${TMPDIR:-/tmp}/shape-of-you-importer-compose.XXXXXX")

cleanup() {
  rm -f "$RENDERED"
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

assert_fails_without_echo() {
  expected=$1
  forbidden=$2
  request_file=$3
  output_file=$(mktemp "${TMPDIR:-/tmp}/shape-of-you-importer-output.XXXXXX")
  if env SHAPE_OF_YOU_STAGING_LOCK_HELD=true \
    sh "$CONTROLLER" < "$request_file" > "$output_file" 2>&1; then
    printf '%s\n' 'Expected importer configuration to fail closed.' >&2
    rm -f "$output_file"
    exit 1
  fi
  grep -F -- "$expected" "$output_file" >/dev/null
  if [ -n "$forbidden" ] && grep -F -- "$forbidden" "$output_file" >/dev/null; then
    printf '%s\n' 'Importer configuration value was echoed on failure.' >&2
    rm -f "$output_file"
    exit 1
  fi
  rm -f "$output_file"
}

write_request() {
  run_import=$1
  person_id=$2
  email=$3
  private_key=$4
  request_file=$5
  {
    printf '%s\n' 'RELEASE_ID=0123456789abcdef0123456789abcdef01234567'
    printf '%s\n' 'API_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    printf '%s\n' 'EDGE_DIGEST=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    printf '%s\n' 'CERTBOT_DIGEST=sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
    printf '%s\n' 'ACME_EMAIL=operator@example.com'
    printf '%s\n' 'PUBLIC_IPV4=203.0.113.10'
    printf '%s\n' 'DEPLOYMENT_TOPOLOGY=shared-ingress'
    printf '%s\n' 'SCHEMA_BACKWARD_COMPATIBLE=true'
    printf '%s\n' 'RUN_WRITE_SMOKE=false'
    printf 'RUN_FITNESS_TRACKER_WEIGHT_DRY_RUN=%s\n' "$run_import"
    printf '%s\n' 'GHCR_NAMESPACE=example'
    printf '%s\n' 'GHCR_ACTOR=operator'
    printf '%s\n' 'CONTROL_SHA=0123456789abcdef0123456789abcdef01234567'
    printf '%s\n' 'DATABASE_URL=postgresql://api:password@database:5432/api'
    printf '%s\n' 'API_BROWSER_SESSION_KEYS=fixture-browser-session-key-ring'
    printf 'FITNESS_TRACKER_PERSON_ID=%s\n' "$person_id"
    printf 'GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL=%s\n' "$email"
    printf 'GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY=%s\n' "$private_key"
    printf '%s\n' 'GHCR_TOKEN=fixture-token'
  } > "$request_file"
}

assert_contains "$COMPOSE" 'fitness-tracker-import:'
assert_contains "$COMPOSE" 'dist/commands/import-fitness-tracker.js'
assert_contains "$COMPOSE" '/etc/shape-of-you/staging/fitness-tracker-import.env'
assert_contains "$COMPOSE" 'fitness-tracker-import'
assert_contains "$DEPLOY" 'RUN_FITNESS_TRACKER_WEIGHT_DRY_RUN'
assert_contains "$DEPLOY" 'compose --profile fitness-tracker-import run --rm --no-deps'
assert_contains "$PREFLIGHT" 'FITNESS_TRACKER_IMPORT_RUNTIME_ENV'
assert_contains "$CONTROLLER" 'fitness-tracker-import.env'
assert_contains "$CONTROLLER" 'install -m 0600'
assert_contains "$DEPLOY_WORKFLOW" 'run_fitness_tracker_weight_dry_run:'
assert_contains "$DEPLOY_WORKFLOW" 'STAGING_FITNESS_TRACKER_PERSON_ID'
assert_contains "$DEPLOY_WORKFLOW" 'STAGING_GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL'
assert_contains "$DEPLOY_WORKFLOW" 'STAGING_GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY'
assert_contains "$PUBLISH_WORKFLOW" 'run_fitness_tracker_weight_dry_run: false'

docker compose \
  --project-name shape-of-you-importer-contract-test \
  --env-file "$RELEASE_ENV" \
  --file "$COMPOSE" \
  --file "$SHARED_COMPOSE" \
  --file "$COMPOSE_TEST_OVERRIDE" \
  --profile fitness-tracker-import \
  config fitness-tracker-import > "$RENDERED"

assert_contains "$RENDERED" 'dist/commands/import-fitness-tracker.js'
assert_contains "$RENDERED" 'read_only: true'
assert_contains "$RENDERED" 'no-new-privileges:true'
assert_contains "$RENDERED" 'database_access:'
assert_not_contains "$RENDERED" 'ports:'
assert_not_contains "$RENDERED" 'API_BROWSER_SESSION_KEYS'
assert_not_contains "$RENDERED" 'edge:'

partial_request=$(mktemp "${TMPDIR:-/tmp}/shape-of-you-importer-partial.XXXXXX")
write_request false '00000000-0000-4000-8000-000000000001' '' '' "$partial_request"
assert_fails_without_echo \
  'Fitness Tracker importer configuration must be either absent or complete.' \
  '00000000-0000-4000-8000-000000000001' \
  "$partial_request"
rm -f "$partial_request"

missing_request=$(mktemp "${TMPDIR:-/tmp}/shape-of-you-importer-missing.XXXXXX")
write_request true '' '' '' "$missing_request"
assert_fails_without_echo \
  'Fitness Tracker Weight dry-run requires complete importer configuration.' \
  '' \
  "$missing_request"
rm -f "$missing_request"

sh -n "$CONTROLLER"
sh -n "$DEPLOY"
sh -n "$PREFLIGHT"

printf '%s\n' 'Fitness Tracker importer deployment contract test passed.'
