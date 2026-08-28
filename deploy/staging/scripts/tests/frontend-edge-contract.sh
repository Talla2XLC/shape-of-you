#!/bin/sh
set -eu

REPOSITORY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../../.." && pwd)
WEB_PACKAGE="$REPOSITORY_ROOT/apps/web/package.json"
WEB_CONFIG="$REPOSITORY_ROOT/apps/web/nuxt.config.ts"
EDGE_DOCKERFILE="$REPOSITORY_ROOT/deploy/staging/nginx/Dockerfile"
NGINX="$REPOSITORY_ROOT/deploy/staging/nginx/nginx.conf.template"
PUBLISH_WORKFLOW="$REPOSITORY_ROOT/.github/workflows/publish-staging.yml"
COMPOSE="$REPOSITORY_ROOT/deploy/staging/compose.yaml"

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

assert_contains "$WEB_PACKAGE" '"nuxt": "4.5.1"'
assert_contains "$WEB_PACKAGE" '"build": "nuxt generate"'
assert_contains "$WEB_CONFIG" 'ssr: false'
assert_contains "$WEB_CONFIG" 'preset: "static"'
assert_not_contains "$COMPOSE" 'web:'

assert_contains "$EDGE_DOCKERFILE" 'FROM node:24-alpine AS web-build'
assert_contains "$EDGE_DOCKERFILE" 'COPY --from=web-build'
assert_contains "$EDGE_DOCKERFILE" '/workspace/apps/web/.output/public'
assert_contains "$PUBLISH_WORKFLOW" 'context: .'
assert_contains "$PUBLISH_WORKFLOW" 'file: deploy/staging/nginx/Dockerfile'

assert_contains "$NGINX" 'location = /.well-known/oauth-protected-resource {'
assert_contains "$NGINX" 'location = /.well-known {'
assert_contains "$NGINX" 'location ^~ /.well-known/ {'
assert_contains "$NGINX" 'location ^~ /oauth/ {'
assert_contains "$NGINX" 'location = /v1 {'
assert_contains "$NGINX" 'location ^~ /v1/ {'
assert_contains "$NGINX" 'location = /live {'
assert_contains "$NGINX" 'location = /ready {'
assert_contains "$NGINX" 'try_files $uri/index.html $uri /200.html;'
assert_contains "$NGINX" "script-src 'self' 'unsafe-inline'"
assert_contains "$NGINX" 'add_header X-Frame-Options "DENY" always;'
assert_contains "$NGINX" 'add_header Referrer-Policy "no-referrer" always;'
assert_contains "$NGINX" 'upstream api_backend {'
assert_contains "$NGINX" 'zone api_backend 64k;'
assert_contains "$NGINX" 'server api:3000 resolve;'
assert_contains "$NGINX" 'upstream identity_backend {'
assert_contains "$NGINX" 'zone identity_backend 64k;'
assert_contains "$NGINX" 'server identity:3000 resolve;'
RESOLVER_COUNT=$(grep -c '^        resolver 127.0.0.11 valid=5s ipv6=off;$' "$NGINX")
if [ "$RESOLVER_COUNT" -ne 2 ]; then
  printf '%s\n' 'API and Identity upstreams must use Docker runtime DNS resolution.' >&2
  exit 1
fi
assert_contains "$NGINX" 'proxy_pass http://identity_backend;'
assert_contains "$NGINX" 'proxy_pass http://api_backend/;'
assert_not_contains "$NGINX" 'proxy_pass http://identity:3000;'
assert_not_contains "$NGINX" 'proxy_pass http://api:3000/'

IDENTITY_SERVER=$(sed -n '/server_name identity\.staging\.shape-of-you\.ru;/,$p' "$NGINX")
if printf '%s\n' "$IDENTITY_SERVER" | \
  grep '^        add_header Referrer-Policy "no-referrer" always;$' >/dev/null; then
  printf '%s\n' 'Identity proxy responses must preserve the upstream Referrer-Policy.' >&2
  exit 1
fi
IDENTITY_STATIC_POLICY_COUNT=$(printf '%s\n' "$IDENTITY_SERVER" | \
  grep -c '^            add_header Referrer-Policy "no-referrer" always;$')
if [ "$IDENTITY_STATIC_POLICY_COUNT" -ne 2 ]; then
  printf '%s\n' 'Identity static HTML and assets must retain no-referrer.' >&2
  exit 1
fi

if find "$REPOSITORY_ROOT/apps/web" \
  \( -name node_modules -o -name .nuxt -o -name .output \) -prune -o \
  -type d -name server -print | grep . >/dev/null; then
  printf '%s\n' 'A server directory is forbidden in the static web package.' >&2
  exit 1
fi

printf '%s\n' 'Frontend edge contract test passed.'
