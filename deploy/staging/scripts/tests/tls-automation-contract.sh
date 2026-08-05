#!/bin/sh
set -eu

REPOSITORY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../../.." && pwd)
COMPOSE="$REPOSITORY_ROOT/deploy/staging/compose.yaml"
DEPLOY="$REPOSITORY_ROOT/deploy/staging/scripts/deploy.sh"
NGINX="$REPOSITORY_ROOT/deploy/staging/nginx/nginx.conf"
INSTALLER="$REPOSITORY_ROOT/deploy/staging/certbot/install-certificate.sh"
RENEW="$REPOSITORY_ROOT/deploy/staging/system/shape-of-you-staging-cert-renew"
TIMER="$REPOSITORY_ROOT/deploy/staging/system/shape-of-you-staging-cert-renew.timer"
PUBLISH_WORKFLOW="$REPOSITORY_ROOT/.github/workflows/publish-staging.yml"
DEPLOY_WORKFLOW="$REPOSITORY_ROOT/.github/workflows/deploy-staging.yml"

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

assert_contains "$COMPOSE" '"80:8080"'
assert_contains "$COMPOSE" '"443:8443"'
assert_contains "$COMPOSE" 'certbot_state:/etc/letsencrypt'
assert_contains "$COMPOSE" 'edge_tls:/etc/nginx/tls:ro'
assert_not_contains "$COMPOSE" '/var/run/docker.sock'

assert_contains "$DEPLOY" '--webroot-path /var/www/certbot'
assert_contains "$DEPLOY" '--domain "$APP_HOST"'
assert_contains "$DEPLOY" '--domain "$IDENTITY_HOST"'
assert_contains "$NGINX" 'return 308 https://$host$request_uri;'
assert_contains "$NGINX" 'server_name identity.staging.shape-of-you.ru;'
assert_contains "$NGINX" 'return 503'

assert_contains "$INSTALLER" 'install -d -o "$NGINX_UID" -g "$NGINX_GID" -m 0700 "$target_dir"'
assert_contains "$INSTALLER" 'install -m 0400 "$source_dir/privkey.pem"'
assert_contains "$RENEW" 'certbot renew'
assert_contains "$RENEW" 'nginx -t'
assert_contains "$RENEW" 'nginx -s reload'
assert_contains "$TIMER" 'OnCalendar=*-*-* 03,15:00:00'
assert_contains "$TIMER" 'Persistent=true'
assert_contains "$PUBLISH_WORKFLOW" "vars.STAGING_TLS_AUTOMATION_ENABLED == 'true'"
assert_contains "$DEPLOY_WORKFLOW" "vars.STAGING_TLS_AUTOMATION_ENABLED == 'true'"

printf '%s\n' 'TLS automation contract test passed.'
