#!/bin/sh
set -eu

REPOSITORY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../../.." && pwd)
RUN_ID="shape-of-you-edge-e2e-$$"
NETWORK="$RUN_ID"
EDGE_CONTAINER="$RUN_ID-edge"
API_CONTAINER="$RUN_ID-api"
IDENTITY_CONTAINER="$RUN_ID-identity"
EDGE_IMAGE="$RUN_ID:local"
WORK_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/shape-of-you-edge-e2e.XXXXXX")
CERT_ROOT="$WORK_ROOT/cert"

cleanup() {
  docker container rm --force \
    "$EDGE_CONTAINER" "$API_CONTAINER" "$IDENTITY_CONTAINER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  docker image rm "$EDGE_IMAGE" >/dev/null 2>&1 || true
  rm -rf "$WORK_ROOT"
}

trap cleanup EXIT HUP INT TERM

mkdir -p "$CERT_ROOT"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj '/CN=staging.shape-of-you.ru' \
  -addext 'subjectAltName=DNS:staging.shape-of-you.ru,DNS:identity.staging.shape-of-you.ru' \
  -keyout "$CERT_ROOT/privkey.pem" \
  -out "$CERT_ROOT/fullchain.pem" >/dev/null 2>&1
chmod 644 "$CERT_ROOT/privkey.pem"

docker build \
  --file "$REPOSITORY_ROOT/deploy/staging/nginx/Dockerfile" \
  --tag "$EDGE_IMAGE" \
  "$REPOSITORY_ROOT" >/dev/null
docker network create "$NETWORK" >/dev/null

docker run --detach --name "$API_CONTAINER" --network "$NETWORK" \
  --network-alias api node:24-alpine node -e \
  'require("node:http").createServer((request,response)=>{response.setHeader("content-type","application/json");response.end(JSON.stringify({owner:"api",path:request.url}))}).listen(3000,"0.0.0.0")' \
  >/dev/null
docker run --detach --name "$IDENTITY_CONTAINER" --network "$NETWORK" \
  --network-alias identity node:24-alpine node -e \
  'require("node:http").createServer((request,response)=>{if(request.url.startsWith("/oauth/interaction/")){response.setHeader("Referrer-Policy","same-origin")}else if(request.url==="/oauth/provider-policy"){response.setHeader("Referrer-Policy","no-referrer")}response.setHeader("content-type","application/json");response.end(JSON.stringify({owner:"identity",path:request.url}))}).listen(3000,"0.0.0.0")' \
  >/dev/null

docker run --detach --name "$EDGE_CONTAINER" --network "$NETWORK" \
  --publish 127.0.0.1::8443 \
  --volume "$CERT_ROOT:/etc/nginx/tls/shape-of-you-staging:ro" \
  --env EDGE_PROXY_PROTOCOL= \
  --env 'EDGE_CLIENT_ADDRESS=$remote_addr' \
  --env 'EDGE_FORWARDED_FOR=$proxy_add_x_forwarded_for' \
  "$EDGE_IMAGE" >/dev/null

EDGE_PORT=$(docker port "$EDGE_CONTAINER" 8443/tcp | sed -n 's/.*://p')
if [ -z "$EDGE_PORT" ]; then
  printf '%s\n' 'The edge HTTPS port was not published.' >&2
  exit 1
fi

edge_url() {
  host=$1
  path=$2
  curl --silent --show-error --fail --insecure \
    --resolve "$host:$EDGE_PORT:127.0.0.1" \
    "https://$host:$EDGE_PORT$path"
}

attempt=0
until edge_url staging.shape-of-you.ru / >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    docker logs "$EDGE_CONTAINER" >&2
    exit 1
  fi
  sleep 1
done

wait_for_owner() {
  host=$1
  path=$2
  owner=$3
  attempt=0
  until edge_url "$host" "$path" | grep -F "\"owner\":\"$owner\"" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then
      printf 'Upstream %s did not become reachable through the edge.\n' "$owner" >&2
      exit 1
    fi
    sleep 1
  done
}

wait_for_owner staging.shape-of-you.ru /api/ready api
wait_for_owner identity.staging.shape-of-you.ru /ready identity

PRODUCT_HTML=$(edge_url staging.shape-of-you.ru /)
IDENTITY_HTML=$(edge_url identity.staging.shape-of-you.ru /sign-in)
printf '%s' "$PRODUCT_HTML" | grep -F '<div id="__nuxt"></div>' >/dev/null
printf '%s' "$IDENTITY_HTML" | grep -F '<div id="__nuxt"></div>' >/dev/null

edge_url staging.shape-of-you.ru /api/not-a-route | grep -F '"owner":"api"' >/dev/null
edge_url staging.shape-of-you.ru /.well-known/oauth-protected-resource | \
  grep -F '"owner":"api"' >/dev/null
edge_url identity.staging.shape-of-you.ru /v1 | grep -F '"owner":"identity"' >/dev/null
edge_url identity.staging.shape-of-you.ru /v1/not-a-route | \
  grep -F '"owner":"identity"' >/dev/null
edge_url identity.staging.shape-of-you.ru /.well-known | \
  grep -F '"owner":"identity"' >/dev/null
edge_url identity.staging.shape-of-you.ru /oauth/not-a-route | \
  grep -F '"owner":"identity"' >/dev/null

curl --silent --show-error --fail --insecure \
  --resolve "identity.staging.shape-of-you.ru:$EDGE_PORT:127.0.0.1" \
  --dump-header "$WORK_ROOT/oauth-interaction.headers" \
  --output /dev/null \
  "https://identity.staging.shape-of-you.ru:$EDGE_PORT/oauth/interaction/test"
tr -d '\r' < "$WORK_ROOT/oauth-interaction.headers" | \
  grep -i -x 'referrer-policy: same-origin' >/dev/null
if tr -d '\r' < "$WORK_ROOT/oauth-interaction.headers" | \
  grep -i '^referrer-policy: no-referrer$' >/dev/null; then
  printf '%s\n' 'Edge overrode the Identity OAuth interaction Referrer-Policy.' >&2
  exit 1
fi
INTERACTION_POLICY_COUNT=$(tr -d '\r' < "$WORK_ROOT/oauth-interaction.headers" | \
  grep -i -c '^referrer-policy:')
if [ "$INTERACTION_POLICY_COUNT" -ne 1 ]; then
  printf '%s\n' 'OAuth interaction response must contain one Referrer-Policy.' >&2
  exit 1
fi

curl --silent --show-error --fail --insecure \
  --resolve "identity.staging.shape-of-you.ru:$EDGE_PORT:127.0.0.1" \
  --dump-header "$WORK_ROOT/oauth-provider.headers" \
  --output /dev/null \
  "https://identity.staging.shape-of-you.ru:$EDGE_PORT/oauth/provider-policy"
tr -d '\r' < "$WORK_ROOT/oauth-provider.headers" | \
  grep -i -x 'referrer-policy: no-referrer' >/dev/null

ASSET_PATH=$(printf '%s' "$PRODUCT_HTML" | grep -o '/_nuxt/[^" ]*\.js' | head -n 1)
if [ -z "$ASSET_PATH" ]; then
  printf '%s\n' 'The generated HTML did not reference a Nuxt JavaScript asset.' >&2
  exit 1
fi
edge_url staging.shape-of-you.ru "$ASSET_PATH" >/dev/null
curl --silent --show-error --fail --insecure \
  --resolve "staging.shape-of-you.ru:$EDGE_PORT:127.0.0.1" \
  --dump-header "$WORK_ROOT/asset.headers" \
  --output /dev/null \
  "https://staging.shape-of-you.ru:$EDGE_PORT$ASSET_PATH"
grep -i '^cache-control: public, max-age=31536000, immutable' "$WORK_ROOT/asset.headers" >/dev/null
grep -i '^x-content-type-options: nosniff' "$WORK_ROOT/asset.headers" >/dev/null
grep -i '^x-frame-options: DENY' "$WORK_ROOT/asset.headers" >/dev/null
grep -i '^referrer-policy: no-referrer' "$WORK_ROOT/asset.headers" >/dev/null

curl --silent --show-error --fail --insecure \
  --resolve "identity.staging.shape-of-you.ru:$EDGE_PORT:127.0.0.1" \
  --dump-header "$WORK_ROOT/html.headers" \
  --output /dev/null \
  "https://identity.staging.shape-of-you.ru:$EDGE_PORT/sign-in"
grep -i '^content-security-policy:' "$WORK_ROOT/html.headers" >/dev/null
grep -i '^cache-control: no-store' "$WORK_ROOT/html.headers" >/dev/null
grep -i '^referrer-policy: no-referrer' "$WORK_ROOT/html.headers" >/dev/null

docker stop "$IDENTITY_CONTAINER" >/dev/null
UPSTREAM_STATUS=$(curl --silent --show-error --insecure \
  --resolve "identity.staging.shape-of-you.ru:$EDGE_PORT:127.0.0.1" \
  --output "$WORK_ROOT/upstream-error.body" \
  --write-out '%{http_code}' \
  "https://identity.staging.shape-of-you.ru:$EDGE_PORT/v1/unavailable")
case "$UPSTREAM_STATUS" in
  502|504) ;;
  *)
    printf 'Reserved Identity route returned %s instead of upstream failure.\n' \
      "$UPSTREAM_STATUS" >&2
    exit 1
    ;;
esac
if grep -F '<div id="__nuxt"></div>' "$WORK_ROOT/upstream-error.body" >/dev/null; then
  printf '%s\n' 'Reserved Identity route fell back to Nuxt HTML.' >&2
  exit 1
fi

printf '%s\n' 'Frontend edge runtime E2E passed.'
