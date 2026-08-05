#!/bin/sh
set -eu

REPOSITORY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../../.." && pwd)
COMPOSE="$REPOSITORY_ROOT/deploy/staging/compose.yaml"
SHARED_COMPOSE="$REPOSITORY_ROOT/deploy/staging/compose.shared-ingress.yaml"
STANDALONE_COMPOSE="$REPOSITORY_ROOT/deploy/staging/compose.standalone.yaml"
DEPLOY="$REPOSITORY_ROOT/deploy/staging/scripts/deploy.sh"
NGINX="$REPOSITORY_ROOT/deploy/staging/nginx/nginx.conf.template"
NGINX_START="$REPOSITORY_ROOT/deploy/staging/nginx/start-edge.sh"
INSTALLER="$REPOSITORY_ROOT/deploy/staging/certbot/install-certificate.sh"
RENEW="$REPOSITORY_ROOT/deploy/staging/system/shape-of-you-staging-cert-renew"
TIMER="$REPOSITORY_ROOT/deploy/staging/system/shape-of-you-staging-cert-renew.timer"
PUBLISH_WORKFLOW="$REPOSITORY_ROOT/.github/workflows/publish-staging.yml"
DEPLOY_WORKFLOW="$REPOSITORY_ROOT/.github/workflows/deploy-staging.yml"
RELEASE_ENV="$REPOSITORY_ROOT/deploy/staging/release.env.example"
RENDER_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/shape-of-you-compose-render.XXXXXX")

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

assert_not_contains "$COMPOSE" 'ports:'
assert_contains "$SHARED_COMPOSE" 'name: shared-vm-ingress'
assert_contains "$SHARED_COMPOSE" 'shape-of-you-edge'
assert_not_contains "$SHARED_COMPOSE" 'ports:'
assert_contains "$STANDALONE_COMPOSE" '"80:8080"'
assert_contains "$STANDALONE_COMPOSE" '"443:8443"'
assert_contains "$COMPOSE" 'certbot_state:/etc/letsencrypt'
assert_contains "$COMPOSE" 'edge_tls:/etc/nginx/tls:ro'
assert_not_contains "$COMPOSE" '/var/run/docker.sock'

assert_contains "$DEPLOY" '--webroot-path /var/www/certbot'
assert_contains "$DEPLOY" '--domain "$APP_HOST"'
assert_contains "$DEPLOY" '--domain "$IDENTITY_HOST"'
assert_contains "$NGINX" 'return 308 https://$host$request_uri;'
assert_contains "$NGINX" 'server_name identity.staging.shape-of-you.ru;'
assert_contains "$NGINX" 'return 503'
assert_contains "$NGINX" 'listen 8443 ssl ${EDGE_PROXY_PROTOCOL};'
assert_contains "$NGINX" 'limit_req_zone ${EDGE_CLIENT_ADDRESS}'
assert_contains "$NGINX" 'proxy_set_header X-Forwarded-For ${EDGE_FORWARDED_FOR};'
assert_contains "$NGINX_START" "x:proxy_protocol:'\$proxy_protocol_addr':'\$proxy_protocol_addr'"
assert_contains "$NGINX_START" "x::'\$remote_addr':'\$proxy_add_x_forwarded_for'"
assert_contains "$DEPLOY" 'compose.shared-ingress.yaml'
assert_contains "$DEPLOY" 'compose.standalone.yaml'

assert_contains "$INSTALLER" 'install -d -o "$NGINX_UID" -g "$NGINX_GID" -m 0700 "$target_dir"'
assert_contains "$INSTALLER" 'install -m 0400 "$source_dir/privkey.pem"'
assert_contains "$RENEW" 'certbot renew'
assert_contains "$RENEW" 'start-shape-of-you-edge --test'
assert_contains "$RENEW" 'nginx -c /tmp/nginx.conf -s reload'
assert_contains "$TIMER" 'OnCalendar=*-*-* 03,15:00:00'
assert_contains "$TIMER" 'Persistent=true'
assert_contains "$PUBLISH_WORKFLOW" "vars.STAGING_TLS_AUTOMATION_ENABLED == 'true'"
assert_contains "$DEPLOY_WORKFLOW" "github.event_name == 'workflow_dispatch' || vars.STAGING_TLS_AUTOMATION_ENABLED == 'true'"

docker compose \
  --project-name shape-of-you-contract-test \
  --env-file "$RELEASE_ENV" \
  --file "$COMPOSE" \
  --file "$SHARED_COMPOSE" \
  --profile operations \
  config --no-env-resolution > "$RENDER_ROOT/shared.yaml"

docker compose \
  --project-name shape-of-you-contract-test \
  --env-file "$RELEASE_ENV" \
  --file "$COMPOSE" \
  --file "$STANDALONE_COMPOSE" \
  --profile operations \
  config --no-env-resolution > "$RENDER_ROOT/standalone.yaml"

assert_not_contains "$RENDER_ROOT/shared.yaml" 'ports:'
assert_contains "$RENDER_ROOT/shared.yaml" 'name: shared-vm-ingress'
assert_contains "$RENDER_ROOT/standalone.yaml" 'published: "80"'
assert_contains "$RENDER_ROOT/standalone.yaml" 'published: "443"'

printf '%s\n' 'TLS automation contract test passed.'
