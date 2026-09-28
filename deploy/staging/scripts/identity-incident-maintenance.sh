#!/bin/sh
set -eu

# Operator-only incident path. Candidate env files are provisioned separately
# under explicit approval; their values must never appear in output.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PACKAGE_DIR=$(dirname "$SCRIPT_DIR")
DEPLOY_ROOT=${DEPLOY_ROOT:-/opt/shape-of-you/staging}
CURRENT_LINK=$DEPLOY_ROOT/current
RUNTIME_ENV=${RUNTIME_ENV:-/etc/shape-of-you/staging/api.env}
IDENTITY_RUNTIME_ENV=${IDENTITY_RUNTIME_ENV:-/etc/shape-of-you/staging/identity.env}
INCIDENT_MARKER=${INCIDENT_MARKER:-/etc/shape-of-you/staging/identity-incident.state}
LOCK_FILE=${LOCK_FILE:-/run/shape-of-you-staging.lock}
COMPOSE_PROJECT=${COMPOSE_PROJECT:-shape-of-you-staging}
IDENTITY_URL=${IDENTITY_URL:-https://identity.staging.shape-of-you.ru}
API_URL=${API_URL:-https://staging.shape-of-you.ru/api}
PHASE=${1:-}
marker_written=false
umask 077

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

if [ "$(id -u)" -ne 0 ]; then
  fail 'Identity incident maintenance requires root.'
fi
case "$PHASE" in stage|activate|retire|resume) ;; *) fail 'Expected stage, activate, retire or resume.' ;; esac
command -v flock >/dev/null 2>&1 || fail 'flock is required.'
exec 9>"$LOCK_FILE"
flock -n 9 || fail 'Another deployment or maintenance operation is active.'

current_release=$(readlink -f "$CURRENT_LINK")
case "$current_release" in "$DEPLOY_ROOT"/releases/*) ;; *) fail 'Current release is unsafe.' ;; esac
release_id=$(basename "$current_release")
printf '%s\n' "$release_id" | grep -Eq '^[0-9a-f]{40}$' || fail 'Current release id is invalid.'
release_env=$current_release/release.env
test -f "$release_env" && test ! -L "$release_env" || fail 'Current release manifest is unsafe.'
# shellcheck disable=SC1090
. "$release_env"
test -n "${IDENTITY_DIGEST:-}" || fail 'Current release has no Identity image.'
[ "${API_IDENTITY_KID_DENY_CAPABILITY_VERSION:-}" = 1 ] ||
  fail 'Current API image has no verified CI deny capability.'
printf '%s\n' "${API_SOURCE_RUN_ID:-}" | grep -Eq '^[1-9][0-9]*$' ||
  fail 'Current API image has no verified publication run.'
case "$DEPLOYMENT_TOPOLOGY" in
  shared-ingress) topology_file=$PACKAGE_DIR/compose.shared-ingress.yaml ;;
  standalone) topology_file=$PACKAGE_DIR/compose.standalone.yaml ;;
  *) fail 'Current deployment topology is invalid.' ;;
esac

compose() {
  docker compose --project-name "$COMPOSE_PROJECT" \
    --env-file "$release_env" \
    --file "$PACKAGE_DIR/compose.yaml" \
    --file "$topology_file" \
    --file "$PACKAGE_DIR/compose.identity.yaml" "$@"
}

cleanup() {
  result=$?
  if [ -n "${probe_file:-}" ]; then
    rm -f "$probe_file"
  fi
  if [ "$result" -ne 0 ] && [ "$marker_written" = true ]; then
    compose stop identity >/dev/null 2>&1 || :
  fi
  exit "$result"
}
trap 'cleanup' EXIT

assert_protected_file() {
  file=$1
  case "$file" in /*) ;; *) fail 'Candidate env path must be absolute.' ;; esac
  test -f "$file" && test ! -L "$file" || fail 'Candidate env file is unsafe.'
  [ "$(stat -c '%u:%a' "$file")" = '0:600' ] ||
    fail 'Candidate env file must be root-owned mode 0600.'
}

env_value() {
  file=$1
  key=$2
  awk -v key="$key" '
    index($0, key "=") == 1 { count++; value = substr($0, length(key) + 2) }
    END { if (count != 1) exit 1; print value }
  ' "$file" || fail 'Required runtime setting is missing or duplicated.'
}

assert_kid() {
  printf '%s\n' "$1" | grep -Eq '^[A-Za-z0-9._-]{1,64}$' || fail 'Invalid key id.'
}

assert_rotation_policy() {
  policy_file=$1
  publication_seconds=$(env_value "$policy_file" IDENTITY_OAUTH_PUBLICATION_DELAY_SECONDS)
  overlap_seconds=$(env_value "$policy_file" IDENTITY_OAUTH_VERIFICATION_OVERLAP_SECONDS)
  for policy_seconds in "$publication_seconds" "$overlap_seconds"; do
    printf '%s\n' "$policy_seconds" | grep -Eq '^[0-9]+$' ||
      fail 'Identity rotation window is invalid.'
    [ "$policy_seconds" -ge 660 ] && [ "$policy_seconds" -le 604800 ] ||
      fail 'Identity rotation window is outside the supported range.'
  done
}

write_marker() {
  marker_phase=$1
  marker_tmp=$(mktemp "${INCIDENT_MARKER}.XXXXXX")
  {
    printf 'phase=%s\n' "$marker_phase"
    printf 'release_id=%s\n' "$release_id"
    printf 'old_kid=%s\n' "$old_kid"
    printf 'new_kid=%s\n' "$new_kid"
    printf 'publication_observed_at=%s\n' "$publication_observed_at"
    printf 'publication_seconds=%s\n' "$publication_seconds"
  } > "$marker_tmp"
  chmod 0600 "$marker_tmp"
  mv -f "$marker_tmp" "$INCIDENT_MARKER"
  marker_written=true
}

install_runtime() {
  source_file=$1
  target_file=$2
  temporary_file=$(mktemp "${target_file}.XXXXXX")
  install -m 0600 "$source_file" "$temporary_file"
  mv -f "$temporary_file" "$target_file"
}

http_status() {
  method=$1
  url=$2
  output=$3
  curl --silent --show-error --max-time 10 --request "$method" \
    --output "$output" --write-out '%{http_code}' "$url"
}

assert_http() {
  method=$1
  url=$2
  expected=$3
  attempt=1
  while [ "$attempt" -le 12 ]; do
    actual=$(http_status "$method" "$url" "$probe_file") || actual=unavailable
    if [ "$actual" = "$expected" ]; then
      return
    fi
    attempt=$((attempt + 1))
    sleep 2
  done
  fail 'Incident HTTP check failed.'
}

assert_jwks() {
  expected_old=$1
  assert_http GET "$IDENTITY_URL/oauth/jwks" 200
  compose exec -T identity node --input-type=module --eval \
    "$(cat "$SCRIPT_DIR/verify-identity-jwks.mjs")" \
    "$old_kid" "$new_kid" "$expected_old" < "$probe_file" >/dev/null ||
    fail 'External JWKS does not contain the expected usable keys.'
}

assert_api_deny() {
  compose exec -T api node --input-type=module --eval \
    "$(cat "$SCRIPT_DIR/verify-api-identity-deny.mjs")" \
    "$old_kid" "$new_kid" >/dev/null ||
    fail 'Running API has no effective Identity key-deny capability.'
}

assert_maintenance() {
  assert_http GET "$IDENTITY_URL/live" 200
  assert_http GET "$IDENTITY_URL/ready" 503
  assert_http POST "$IDENTITY_URL/oauth/token" 503
  assert_http GET "$IDENTITY_URL/.well-known/openid-configuration" 200
  assert_jwks "$1"
}

probe_file=$(mktemp)
assert_protected_file "$RUNTIME_ENV"
assert_protected_file "$IDENTITY_RUNTIME_ENV"

if [ "$PHASE" = stage ]; then
  [ "$#" -eq 5 ] || fail 'Stage requires API env, Identity env, old kid and new kid.'
  [ ! -e "$INCIDENT_MARKER" ] && [ ! -L "$INCIDENT_MARKER" ] ||
    fail 'An Identity incident is already active.'
  api_candidate=$2
  identity_candidate=$3
  old_kid=$4
  new_kid=$5
  assert_kid "$old_kid"
  assert_kid "$new_kid"
  [ "$old_kid" != "$new_kid" ] || fail 'Replacement key id must differ.'
  assert_protected_file "$api_candidate"
  assert_protected_file "$identity_candidate"
  assert_rotation_policy "$identity_candidate"
  publication_observed_at=0
  [ "$(env_value "$IDENTITY_RUNTIME_ENV" IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID)" = "$old_kid" ] ||
    fail 'Current active key does not match the incident key.'
  [ "$(env_value "$identity_candidate" IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID)" = "$old_kid" ] ||
    fail 'Stage must retain the current active key.'
  [ "$(env_value "$identity_candidate" IDENTITY_OAUTH_ISSUANCE_DISABLED)" = true ] ||
    fail 'Stage must disable OAuth issuance.'
  deny_policy=$(env_value "$api_candidate" IDENTITY_OAUTH_DENIED_KIDS)
  printf '%s' "$deny_policy" | grep -Fq "\"$old_kid\"" ||
    fail 'API deny policy does not name the incident key.'
  old_cookie_keys=$(env_value "$RUNTIME_ENV" API_BROWSER_SESSION_KEYS | tr -d '[:space:]')
  new_cookie_keys=$(env_value "$api_candidate" API_BROWSER_SESSION_KEYS | tr -d '[:space:]')
  [ -n "$new_cookie_keys" ] || fail 'Replacement API browser cookie key is missing.'
  old_ifs=$IFS
  IFS=,
  set -f
  for old_cookie_key in $old_cookie_keys; do
    case ",$new_cookie_keys," in
      *",$old_cookie_key,"*) fail 'Old API browser cookie key remains in candidate.' ;;
    esac
  done
  set +f
  IFS=$old_ifs
  write_marker preparing-stage
  install_runtime "$api_candidate" "$RUNTIME_ENV"
  compose up --detach --no-deps --force-recreate api
  assert_http GET "$API_URL/ready" 200
  assert_api_deny
  compose stop identity
  install_runtime "$identity_candidate" "$IDENTITY_RUNTIME_ENV"
  compose up --detach --no-deps --force-recreate identity
  assert_maintenance present
  publication_observed_at=$(($(date +%s) + 1))
  compose run --rm --no-deps identity \
    node dist/commands/revoke-oauth-authority-for-incident.js --confirm-global-revocation
  write_marker staged
else
  [ "$#" -eq 2 ] || fail 'This phase requires one Identity env candidate.'
  [ -f "$INCIDENT_MARKER" ] && [ ! -L "$INCIDENT_MARKER" ] ||
    fail 'Identity incident marker is missing or unsafe.'
  [ "$(stat -c '%u:%a' "$INCIDENT_MARKER")" = '0:600' ] ||
    fail 'Identity incident marker has unsafe permissions.'
  marker_release=$(env_value "$INCIDENT_MARKER" release_id)
  [ "$marker_release" = "$release_id" ] || fail 'Incident release changed unexpectedly.'
  old_kid=$(env_value "$INCIDENT_MARKER" old_kid)
  new_kid=$(env_value "$INCIDENT_MARKER" new_kid)
  publication_observed_at=$(env_value "$INCIDENT_MARKER" publication_observed_at)
  stage_publication_seconds=$(env_value "$INCIDENT_MARKER" publication_seconds)
  assert_kid "$old_kid"
  assert_kid "$new_kid"
  printf '%s\n' "$publication_observed_at" | grep -Eq '^[0-9]+$' ||
    fail 'Incident publication evidence is invalid.'
  printf '%s\n' "$stage_publication_seconds" | grep -Eq '^[0-9]+$' ||
    fail 'Incident publication window is invalid.'
  [ "$publication_observed_at" -gt 0 ] &&
    [ "$stage_publication_seconds" -ge 660 ] &&
    [ "$stage_publication_seconds" -le 604800 ] ||
    fail 'Incident publication evidence is missing.'
  case "$PHASE:$(env_value "$INCIDENT_MARKER" phase)" in
    activate:staged|retire:activated|resume:retired) ;;
    *) fail 'Identity incident phase transition is invalid.' ;;
  esac
  identity_candidate=$2
  assert_protected_file "$identity_candidate"
  assert_rotation_policy "$identity_candidate"
  publication_seconds=$stage_publication_seconds
  [ "$(env_value "$identity_candidate" IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID)" = "$new_kid" ] ||
    fail 'Replacement key must be active.'
  if [ "$PHASE" = resume ]; then
    expected_mode=false
  else
    expected_mode=true
  fi
  [ "$(env_value "$identity_candidate" IDENTITY_OAUTH_ISSUANCE_DISABLED)" = "$expected_mode" ] ||
    fail 'OAuth issuance mode is invalid for this phase.'
  printf '%s' "$(env_value "$RUNTIME_ENV" IDENTITY_OAUTH_DENIED_KIDS)" |
    grep -Fq "\"$old_kid\"" || fail 'API deny policy was removed.'
  if [ "$PHASE" = activate ]; then
    now=$(date +%s)
    [ "$now" -ge "$((publication_observed_at + publication_seconds))" ] ||
      fail 'External JWKS publication window has not completed.'
  fi
  assert_api_deny
  write_marker "preparing-$PHASE"
  compose stop identity
  install_runtime "$identity_candidate" "$IDENTITY_RUNTIME_ENV"
  compose up --detach --no-deps --force-recreate identity
  if [ "$PHASE" = activate ]; then
    assert_maintenance present
    write_marker activated
  elif [ "$PHASE" = retire ]; then
    assert_maintenance absent
    write_marker retired
  else
    assert_http GET "$IDENTITY_URL/ready" 200
    assert_jwks absent
    write_marker resumed
  fi
fi

printf 'Identity incident phase %s completed for release %s.\n' "$PHASE" "$release_id"
