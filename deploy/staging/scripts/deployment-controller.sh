#!/bin/sh
set -eu

# This versioned controller is invoked only by the root-owned bootstrap after
# exact origin/main verification. It owns the evolving deployment protocol.
PATH=/usr/sbin:/usr/bin:/sbin:/bin
DEPLOY_ROOT=/opt/shape-of-you/staging
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CONTROL_STAGING=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
RUNTIME_ENV=/etc/shape-of-you/staging/api.env
IDENTITY_RUNTIME_ENV=/etc/shape-of-you/staging/identity.env
RELEASE_ENV=
DOCKER_CONFIG_DIR=

cleanup() {
  if [ -n "$RELEASE_ENV" ]; then
    rm -f "$RELEASE_ENV"
  fi

  if [ -n "$DOCKER_CONFIG_DIR" ]; then
    rm -rf "$DOCKER_CONFIG_DIR"
  fi
}

trap cleanup EXIT HUP INT TERM

fail() {
  printf '%s\n' "$1" >&2
  exit 2
}

[ "${SHAPE_OF_YOU_STAGING_LOCK_HELD:-}" = true ] ||
  fail 'Deployment controller must be invoked by the root-owned bootstrap.'
[ "$#" -eq 0 ] || fail 'Deployment controller accepts no arguments.'
command -v sha256sum >/dev/null 2>&1 ||
  fail 'sha256sum is required for Identity runtime verification.'

RELEASE_ID=
API_DIGEST=
DEPLOY_IDENTITY=
IDENTITY_IMAGE=
IDENTITY_DIGEST=
IDENTITY_RUNTIME_ENV_SHA256=
IDENTITY_SCHEMA_BACKWARD_COMPATIBLE=
IDENTITY_OAUTH_CLIENTS_BACKWARD_COMPATIBLE=
EDGE_DIGEST=
CERTBOT_DIGEST=
ACME_EMAIL=
PUBLIC_IPV4=
DEPLOYMENT_TOPOLOGY=
SCHEMA_BACKWARD_COMPATIBLE=
RUN_WRITE_SMOKE=
GHCR_NAMESPACE=
GHCR_ACTOR=
CONTROL_SHA=
DATABASE_URL=
IDENTITY_DATABASE_URL=
IDENTITY_TOTP_ACTIVE_KEY_ID=
IDENTITY_TOTP_ENCRYPTION_KEYS=
IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID=
IDENTITY_OAUTH_SIGNING_KEYS=
IDENTITY_OAUTH_COOKIE_KEYS=
IDENTITY_CHATGPT_REDIRECT_URI=
IDENTITY_WEB_REDIRECT_URI=
API_BROWSER_SESSION_KEYS=
INTERVALS_ICU_CLIENT_ID=
INTERVALS_ICU_CLIENT_SECRET=
INTERVALS_ICU_REDIRECT_URI=
INTEGRATION_ENCRYPTION_KEY_RING=
INTEGRATION_ENCRYPTION_ACTIVE_KEY_ID=
GHCR_TOKEN=
seen_keys=' '

while IFS= read -r input_line || [ -n "$input_line" ]; do
  case "$input_line" in
    *=*)
      input_key=${input_line%%=*}
      input_value=${input_line#*=}
      ;;
    *)
      fail 'Malformed deployment input.'
      ;;
  esac

  case "$input_key" in
    RELEASE_ID|API_DIGEST|DEPLOY_IDENTITY|IDENTITY_DIGEST|EDGE_DIGEST|CERTBOT_DIGEST|ACME_EMAIL|PUBLIC_IPV4|DEPLOYMENT_TOPOLOGY|SCHEMA_BACKWARD_COMPATIBLE|IDENTITY_SCHEMA_BACKWARD_COMPATIBLE|IDENTITY_OAUTH_CLIENTS_BACKWARD_COMPATIBLE|RUN_WRITE_SMOKE|GHCR_NAMESPACE|GHCR_ACTOR|CONTROL_SHA|DATABASE_URL|IDENTITY_DATABASE_URL|IDENTITY_TOTP_ACTIVE_KEY_ID|IDENTITY_TOTP_ENCRYPTION_KEYS|IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID|IDENTITY_OAUTH_SIGNING_KEYS|IDENTITY_OAUTH_COOKIE_KEYS|IDENTITY_CHATGPT_REDIRECT_URI|IDENTITY_WEB_REDIRECT_URI|API_BROWSER_SESSION_KEYS|INTERVALS_ICU_CLIENT_ID|INTERVALS_ICU_CLIENT_SECRET|INTERVALS_ICU_REDIRECT_URI|INTEGRATION_ENCRYPTION_KEY_RING|INTEGRATION_ENCRYPTION_ACTIVE_KEY_ID|GHCR_TOKEN)
      case "$seen_keys" in
        *" $input_key "*) fail "Duplicate input: $input_key." ;;
      esac
      seen_keys="$seen_keys$input_key "
      case "$input_key" in
        RELEASE_ID) RELEASE_ID=$input_value ;;
        API_DIGEST) API_DIGEST=$input_value ;;
        DEPLOY_IDENTITY) DEPLOY_IDENTITY=$input_value ;;
        IDENTITY_DIGEST) IDENTITY_DIGEST=$input_value ;;
        EDGE_DIGEST) EDGE_DIGEST=$input_value ;;
        CERTBOT_DIGEST) CERTBOT_DIGEST=$input_value ;;
        ACME_EMAIL) ACME_EMAIL=$input_value ;;
        PUBLIC_IPV4) PUBLIC_IPV4=$input_value ;;
        DEPLOYMENT_TOPOLOGY) DEPLOYMENT_TOPOLOGY=$input_value ;;
        SCHEMA_BACKWARD_COMPATIBLE) SCHEMA_BACKWARD_COMPATIBLE=$input_value ;;
        IDENTITY_SCHEMA_BACKWARD_COMPATIBLE) IDENTITY_SCHEMA_BACKWARD_COMPATIBLE=$input_value ;;
        IDENTITY_OAUTH_CLIENTS_BACKWARD_COMPATIBLE) IDENTITY_OAUTH_CLIENTS_BACKWARD_COMPATIBLE=$input_value ;;
        RUN_WRITE_SMOKE) RUN_WRITE_SMOKE=$input_value ;;
        GHCR_NAMESPACE) GHCR_NAMESPACE=$input_value ;;
        GHCR_ACTOR) GHCR_ACTOR=$input_value ;;
        CONTROL_SHA) CONTROL_SHA=$input_value ;;
        DATABASE_URL) DATABASE_URL=$input_value ;;
        IDENTITY_DATABASE_URL) IDENTITY_DATABASE_URL=$input_value ;;
        IDENTITY_TOTP_ACTIVE_KEY_ID) IDENTITY_TOTP_ACTIVE_KEY_ID=$input_value ;;
        IDENTITY_TOTP_ENCRYPTION_KEYS) IDENTITY_TOTP_ENCRYPTION_KEYS=$input_value ;;
        IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID) IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID=$input_value ;;
        IDENTITY_OAUTH_SIGNING_KEYS) IDENTITY_OAUTH_SIGNING_KEYS=$input_value ;;
        IDENTITY_OAUTH_COOKIE_KEYS) IDENTITY_OAUTH_COOKIE_KEYS=$input_value ;;
        IDENTITY_CHATGPT_REDIRECT_URI) IDENTITY_CHATGPT_REDIRECT_URI=$input_value ;;
        IDENTITY_WEB_REDIRECT_URI) IDENTITY_WEB_REDIRECT_URI=$input_value ;;
        API_BROWSER_SESSION_KEYS) API_BROWSER_SESSION_KEYS=$input_value ;;
        INTERVALS_ICU_CLIENT_ID) INTERVALS_ICU_CLIENT_ID=$input_value ;;
        INTERVALS_ICU_CLIENT_SECRET) INTERVALS_ICU_CLIENT_SECRET=$input_value ;;
        INTERVALS_ICU_REDIRECT_URI) INTERVALS_ICU_REDIRECT_URI=$input_value ;;
        INTEGRATION_ENCRYPTION_KEY_RING) INTEGRATION_ENCRYPTION_KEY_RING=$input_value ;;
        INTEGRATION_ENCRYPTION_ACTIVE_KEY_ID) INTEGRATION_ENCRYPTION_ACTIVE_KEY_ID=$input_value ;;
        GHCR_TOKEN) GHCR_TOKEN=$input_value ;;
      esac
      ;;
    *)
      fail "Unexpected deployment input: $input_key."
      ;;
  esac
done

[ -n "$RELEASE_ID" ] || fail 'RELEASE_ID is required.'
[ -n "$API_DIGEST" ] || fail 'API_DIGEST is required.'
[ -n "$DEPLOY_IDENTITY" ] || fail 'DEPLOY_IDENTITY is required.'
[ -n "$EDGE_DIGEST" ] || fail 'EDGE_DIGEST is required.'
[ -n "$CERTBOT_DIGEST" ] || fail 'CERTBOT_DIGEST is required.'
[ -n "$ACME_EMAIL" ] || fail 'ACME_EMAIL is required.'
[ -n "$PUBLIC_IPV4" ] || fail 'PUBLIC_IPV4 is required.'
[ -n "$DEPLOYMENT_TOPOLOGY" ] || fail 'DEPLOYMENT_TOPOLOGY is required.'
[ -n "$SCHEMA_BACKWARD_COMPATIBLE" ] || fail 'SCHEMA_BACKWARD_COMPATIBLE is required.'
[ -n "$RUN_WRITE_SMOKE" ] || fail 'RUN_WRITE_SMOKE is required.'
[ -n "$API_BROWSER_SESSION_KEYS" ] || fail 'API_BROWSER_SESSION_KEYS is required.'
[ -n "$GHCR_NAMESPACE" ] || fail 'GHCR_NAMESPACE is required.'
[ -n "$GHCR_ACTOR" ] || fail 'GHCR_ACTOR is required.'
[ -n "$CONTROL_SHA" ] || fail 'CONTROL_SHA is required.'
[ -n "$DATABASE_URL" ] || fail 'DATABASE_URL is required.'
[ -n "$GHCR_TOKEN" ] || fail 'GHCR_TOKEN is required.'

printf '%s\n' "$RELEASE_ID" | grep -Eq '^[0-9a-f]{40}$' || fail 'Invalid RELEASE_ID.'
printf '%s\n' "$CONTROL_SHA" | grep -Eq '^[0-9a-f]{40}$' || fail 'Invalid CONTROL_SHA.'
printf '%s\n' "$API_DIGEST" | grep -Eq '^sha256:[0-9a-f]{64}$' || fail 'Invalid API_DIGEST.'
case "$DEPLOY_IDENTITY" in
  true|false) ;;
  *) fail 'Invalid DEPLOY_IDENTITY.' ;;
esac

read_current_release_value() {
  current_key=$1
  current_file=$2
  if ! current_value=$(awk -v key="$current_key" '
    index($0, key "=") == 1 {
      count += 1
      value = substr($0, length(key) + 2)
    }
    END {
      if (count != 1 || value == "") exit 1
      print value
    }
  ' "$current_file"); then
    fail "Current release has no unique $current_key."
  fi
  printf '%s\n' "$current_value"
}

if [ "$DEPLOY_IDENTITY" = false ]; then
  if [ -n "$IDENTITY_DIGEST" ] || [ -n "$IDENTITY_DATABASE_URL" ] ||
    [ -n "$IDENTITY_SCHEMA_BACKWARD_COMPATIBLE" ] ||
    [ -n "$IDENTITY_OAUTH_CLIENTS_BACKWARD_COMPATIBLE" ] ||
    [ -n "$IDENTITY_TOTP_ACTIVE_KEY_ID" ] ||
    [ -n "$IDENTITY_TOTP_ENCRYPTION_KEYS" ] ||
    [ -n "$IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID" ] ||
    [ -n "$IDENTITY_OAUTH_SIGNING_KEYS" ] ||
    [ -n "$IDENTITY_OAUTH_COOKIE_KEYS" ] ||
    [ -n "$IDENTITY_CHATGPT_REDIRECT_URI" ] ||
    [ -n "$IDENTITY_WEB_REDIRECT_URI" ]; then
    fail 'Identity deployment inputs must be omitted when current Identity is reused.'
  fi
  [ -L "$DEPLOY_ROOT/current" ] ||
    fail 'Current release is required when Identity delivery is reused.'
  current_release=$(readlink -f "$DEPLOY_ROOT/current")
  current_release_id=${current_release##*/}
  printf '%s\n' "$current_release_id" | grep -Eq '^[0-9a-f]{40}$' ||
    fail 'Current release target is not an immutable release.'
  [ "$current_release" = "$DEPLOY_ROOT/releases/$current_release_id" ] ||
    fail 'Current release target is outside the release store.'
  current_release_env=$current_release/release.env
  [ -f "$current_release_env" ] && [ ! -L "$current_release_env" ] ||
    fail 'Current release manifest is missing or unsafe.'
  IDENTITY_IMAGE=$(read_current_release_value IDENTITY_IMAGE "$current_release_env")
  IDENTITY_DIGEST=$(read_current_release_value IDENTITY_DIGEST "$current_release_env")
  IDENTITY_SCHEMA_BACKWARD_COMPATIBLE=$(
    read_current_release_value IDENTITY_SCHEMA_BACKWARD_COMPATIBLE "$current_release_env"
  )
  IDENTITY_OAUTH_CLIENTS_BACKWARD_COMPATIBLE=$(
    read_current_release_value IDENTITY_OAUTH_CLIENTS_BACKWARD_COMPATIBLE "$current_release_env"
  )
  IDENTITY_RUNTIME_ENV_SHA256=$(
    read_current_release_value IDENTITY_RUNTIME_ENV_SHA256 "$current_release_env"
  )
else
  IDENTITY_IMAGE=ghcr.io/$GHCR_NAMESPACE/shape-of-you-identity
  [ -n "$IDENTITY_DIGEST" ] ||
    fail 'IDENTITY_DIGEST is required when Identity deployment is enabled.'
fi

if [ -n "$IDENTITY_DIGEST" ]; then
  [ -n "$IDENTITY_SCHEMA_BACKWARD_COMPATIBLE" ] || fail 'IDENTITY_SCHEMA_BACKWARD_COMPATIBLE is required when Identity deployment is enabled.'
  [ -n "$IDENTITY_OAUTH_CLIENTS_BACKWARD_COMPATIBLE" ] || fail 'IDENTITY_OAUTH_CLIENTS_BACKWARD_COMPATIBLE is required when Identity deployment is enabled.'
  [ "$IDENTITY_IMAGE" = "ghcr.io/$GHCR_NAMESPACE/shape-of-you-identity" ] ||
    fail 'Current Identity image does not match the configured namespace.'
  printf '%s\n' "$IDENTITY_DIGEST" | grep -Eq '^sha256:[0-9a-f]{64}$' || fail 'Invalid IDENTITY_DIGEST.'
  case "$IDENTITY_SCHEMA_BACKWARD_COMPATIBLE" in
    true|false) ;;
    *) fail 'Invalid IDENTITY_SCHEMA_BACKWARD_COMPATIBLE.' ;;
  esac
  case "$IDENTITY_OAUTH_CLIENTS_BACKWARD_COMPATIBLE" in
    true|false) ;;
    *) fail 'Invalid IDENTITY_OAUTH_CLIENTS_BACKWARD_COMPATIBLE.' ;;
  esac
  if [ "$DEPLOY_IDENTITY" = false ]; then
    # No Identity schema, client policy, or runtime transition occurs. The
    # inherited coordinate is therefore exactly compatible with itself.
    IDENTITY_SCHEMA_BACKWARD_COMPATIBLE=true
    IDENTITY_OAUTH_CLIENTS_BACKWARD_COMPATIBLE=true
  fi
fi

IDENTITY_STATE_VERIFIER=$CONTROL_STAGING/scripts/verify-current-identity-state.sh
test -f "$IDENTITY_STATE_VERIFIER" && test ! -L "$IDENTITY_STATE_VERIFIER" ||
  fail 'Verified Identity state verifier is missing or unsafe.'
if [ "$DEPLOY_IDENTITY" = false ]; then
  sh "$IDENTITY_STATE_VERIFIER" \
    "$IDENTITY_IMAGE" \
    "$IDENTITY_DIGEST" \
    "$IDENTITY_RUNTIME_ENV_SHA256" \
    "$IDENTITY_RUNTIME_ENV" \
    shape-of-you-staging
fi

if [ "$DEPLOY_IDENTITY" = true ]; then
  [ -n "$IDENTITY_DATABASE_URL" ] || fail 'IDENTITY_DATABASE_URL is required when Identity deployment is enabled.'
  [ -n "$IDENTITY_TOTP_ACTIVE_KEY_ID" ] || fail 'IDENTITY_TOTP_ACTIVE_KEY_ID is required when Identity deployment is enabled.'
  [ -n "$IDENTITY_TOTP_ENCRYPTION_KEYS" ] || fail 'IDENTITY_TOTP_ENCRYPTION_KEYS is required when Identity deployment is enabled.'
  [ -n "$IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID" ] || fail 'IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID is required when Identity deployment is enabled.'
  [ -n "$IDENTITY_OAUTH_SIGNING_KEYS" ] || fail 'IDENTITY_OAUTH_SIGNING_KEYS is required when Identity deployment is enabled.'
  [ -n "$IDENTITY_OAUTH_COOKIE_KEYS" ] || fail 'IDENTITY_OAUTH_COOKIE_KEYS is required when Identity deployment is enabled.'
  [ -n "$IDENTITY_CHATGPT_REDIRECT_URI" ] || fail 'IDENTITY_CHATGPT_REDIRECT_URI is required when Identity deployment is enabled.'
  [ -n "$IDENTITY_WEB_REDIRECT_URI" ] || fail 'IDENTITY_WEB_REDIRECT_URI is required when Identity deployment is enabled.'
  case "$IDENTITY_DATABASE_URL" in
    postgresql://*) ;;
    *) fail 'IDENTITY_DATABASE_URL must use the postgresql scheme.' ;;
  esac
  [ "$IDENTITY_CHATGPT_REDIRECT_URI" = 'https://chatgpt.com/connector_platform_oauth_redirect' ] ||
    fail 'Invalid IDENTITY_CHATGPT_REDIRECT_URI.'
  [ "$IDENTITY_WEB_REDIRECT_URI" = 'https://staging.shape-of-you.ru/api/browser-auth/callback' ] ||
    fail 'Invalid IDENTITY_WEB_REDIRECT_URI.'
  printf '%s\n' "$IDENTITY_TOTP_ACTIVE_KEY_ID" |
    grep -Eq '^[A-Za-z0-9._-]{1,64}$' || fail 'Invalid IDENTITY_TOTP_ACTIVE_KEY_ID.'
  printf '%s\n' "$IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID" |
    grep -Eq '^[A-Za-z0-9._-]{1,64}$' || fail 'Invalid IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID.'
fi
printf '%s\n' "$EDGE_DIGEST" | grep -Eq '^sha256:[0-9a-f]{64}$' || fail 'Invalid EDGE_DIGEST.'
printf '%s\n' "$CERTBOT_DIGEST" | grep -Eq '^sha256:[0-9a-f]{64}$' || fail 'Invalid CERTBOT_DIGEST.'
printf '%s\n' "$ACME_EMAIL" |
  grep -Eq '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' ||
  fail 'Invalid ACME_EMAIL.'
printf '%s\n' "$PUBLIC_IPV4" |
  awk -F. 'NF == 4 { for (i = 1; i <= 4; i++) if ($i !~ /^[0-9]+$/ || $i > 255) exit 1; exit 0 } { exit 1 }' ||
  fail 'Invalid PUBLIC_IPV4.'
printf '%s\n' "$GHCR_NAMESPACE" | grep -Eq '^[a-z0-9][a-z0-9._-]*$' || fail 'Invalid GHCR_NAMESPACE.'
printf '%s\n' "$GHCR_ACTOR" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9-]*$' || fail 'Invalid GHCR_ACTOR.'

case "$DEPLOYMENT_TOPOLOGY" in
  shared-ingress|standalone) ;;
  *) fail 'Invalid DEPLOYMENT_TOPOLOGY.' ;;
esac

case "$SCHEMA_BACKWARD_COMPATIBLE" in
  true|false) ;;
  *) fail 'Invalid SCHEMA_BACKWARD_COMPATIBLE.' ;;
esac

case "$RUN_WRITE_SMOKE" in
  true|false) ;;
  *) fail 'Invalid RUN_WRITE_SMOKE.' ;;
esac

integration_settings_count=0
for integration_setting in \
  "$INTERVALS_ICU_CLIENT_ID" \
  "$INTERVALS_ICU_CLIENT_SECRET" \
  "$INTERVALS_ICU_REDIRECT_URI" \
  "$INTEGRATION_ENCRYPTION_KEY_RING" \
  "$INTEGRATION_ENCRYPTION_ACTIVE_KEY_ID"; do
  if [ -n "$integration_setting" ]; then
    integration_settings_count=$((integration_settings_count + 1))
  fi
done
case "$integration_settings_count" in
  5)
    case "$INTERVALS_ICU_REDIRECT_URI" in
      https://*) ;;
      *) fail 'INTERVALS_ICU_REDIRECT_URI must use https.' ;;
    esac
    ;;
  0) ;;
  *) fail 'Intervals.icu credentials, redirect URI, and integration encryption settings must be supplied together.' ;;
esac

case "$DATABASE_URL" in
  postgresql://*) ;;
  *) fail 'DATABASE_URL must use the postgresql scheme.' ;;
esac

test -f "$CONTROL_STAGING/scripts/deploy.sh" || fail 'Verified deployment script is missing.'
test -f "$CONTROL_STAGING/compose.yaml" || fail 'Verified Compose file is missing.'
JOURNAL_SYNC_INSTALLER=$CONTROL_STAGING/system/install-recovery-erasure-sync-assets.sh
test -f "$JOURNAL_SYNC_INSTALLER" && test ! -L "$JOURNAL_SYNC_INSTALLER" ||
  fail 'Verified Recovery erasure sync installer is missing or unsafe.'

umask 077
install -d -m 0700 /etc/shape-of-you/staging
runtime_file=$(mktemp /etc/shape-of-you/staging/api.env.XXXXXX)
printf 'DATABASE_URL=%s\n' "$DATABASE_URL" > "$runtime_file"
printf 'API_BROWSER_SESSION_KEYS=%s\n' "$API_BROWSER_SESSION_KEYS" >> "$runtime_file"
if [ "$integration_settings_count" -eq 5 ]; then
  {
    printf 'INTERVALS_ICU_CLIENT_ID=%s\n' "$INTERVALS_ICU_CLIENT_ID"
    printf 'INTERVALS_ICU_CLIENT_SECRET=%s\n' "$INTERVALS_ICU_CLIENT_SECRET"
    printf 'INTERVALS_ICU_REDIRECT_URI=%s\n' "$INTERVALS_ICU_REDIRECT_URI"
    printf 'INTEGRATION_ENCRYPTION_KEY_RING=%s\n' "$INTEGRATION_ENCRYPTION_KEY_RING"
    printf 'INTEGRATION_ENCRYPTION_ACTIVE_KEY_ID=%s\n' "$INTEGRATION_ENCRYPTION_ACTIVE_KEY_ID"
  } >> "$runtime_file"
fi
install -m 0600 "$runtime_file" "$RUNTIME_ENV"
rm -f "$runtime_file"

if [ "$DEPLOY_IDENTITY" = true ]; then
  identity_runtime_file=$(mktemp /etc/shape-of-you/staging/identity.env.XXXXXX)
  {
    printf 'DATABASE_URL=%s\n' "$IDENTITY_DATABASE_URL"
    printf 'IDENTITY_TOTP_ACTIVE_KEY_ID=%s\n' "$IDENTITY_TOTP_ACTIVE_KEY_ID"
    printf 'IDENTITY_TOTP_ENCRYPTION_KEYS=%s\n' "$IDENTITY_TOTP_ENCRYPTION_KEYS"
    printf 'IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID=%s\n' "$IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID"
    printf 'IDENTITY_OAUTH_SIGNING_KEYS=%s\n' "$IDENTITY_OAUTH_SIGNING_KEYS"
    printf 'IDENTITY_OAUTH_COOKIE_KEYS=%s\n' "$IDENTITY_OAUTH_COOKIE_KEYS"
    printf 'IDENTITY_CHATGPT_REDIRECT_URI=%s\n' "$IDENTITY_CHATGPT_REDIRECT_URI"
    printf 'IDENTITY_WEB_REDIRECT_URI=%s\n' "$IDENTITY_WEB_REDIRECT_URI"
  } > "$identity_runtime_file"
  install -m 0600 "$identity_runtime_file" "$IDENTITY_RUNTIME_ENV"
  rm -f "$identity_runtime_file"
  IDENTITY_RUNTIME_ENV_SHA256=$(sha256sum "$IDENTITY_RUNTIME_ENV" | awk '{print $1}')
fi

RELEASE_ENV=$(mktemp /run/shape-of-you-staging-release.XXXXXX)
cat > "$RELEASE_ENV" <<EOF
RELEASE_ID=$RELEASE_ID
API_IMAGE=ghcr.io/$GHCR_NAMESPACE/shape-of-you-api
API_DIGEST=$API_DIGEST
EDGE_IMAGE=ghcr.io/$GHCR_NAMESPACE/shape-of-you-edge
EDGE_DIGEST=$EDGE_DIGEST
CERTBOT_IMAGE=ghcr.io/$GHCR_NAMESPACE/shape-of-you-certbot
CERTBOT_DIGEST=$CERTBOT_DIGEST
ACME_EMAIL=$ACME_EMAIL
PUBLIC_IPV4=$PUBLIC_IPV4
DEPLOYMENT_TOPOLOGY=$DEPLOYMENT_TOPOLOGY
SCHEMA_BACKWARD_COMPATIBLE=$SCHEMA_BACKWARD_COMPATIBLE
EOF

if [ -n "$IDENTITY_DIGEST" ]; then
  cat >> "$RELEASE_ENV" <<EOF
IDENTITY_IMAGE=$IDENTITY_IMAGE
IDENTITY_DIGEST=$IDENTITY_DIGEST
IDENTITY_RUNTIME_ENV_SHA256=$IDENTITY_RUNTIME_ENV_SHA256
IDENTITY_SCHEMA_BACKWARD_COMPATIBLE=$IDENTITY_SCHEMA_BACKWARD_COMPATIBLE
IDENTITY_OAUTH_CLIENTS_BACKWARD_COMPATIBLE=$IDENTITY_OAUTH_CLIENTS_BACKWARD_COMPATIBLE
IDENTITY_UPDATE_REQUIRED=$DEPLOY_IDENTITY
EOF
fi

DOCKER_CONFIG_DIR=$(mktemp -d)
printf '%s' "$GHCR_TOKEN" | DOCKER_CONFIG="$DOCKER_CONFIG_DIR" \
  docker login ghcr.io --username "$GHCR_ACTOR" --password-stdin >/dev/null

COMPOSE_FILE="$CONTROL_STAGING/compose.yaml" \
DEPLOY_ROOT="$DEPLOY_ROOT" \
RUNTIME_ENV="$RUNTIME_ENV" \
IDENTITY_RUNTIME_ENV="$IDENTITY_RUNTIME_ENV" \
RUN_WRITE_SMOKE="$RUN_WRITE_SMOKE" \
DOCKER_CONFIG="$DOCKER_CONFIG_DIR" \
  sh "$CONTROL_STAGING/scripts/deploy.sh" "$RELEASE_ENV"

sh "$JOURNAL_SYNC_INSTALLER"
