#!/bin/sh
set -eu

BASE_URL=${BASE_URL:-https://staging.shape-of-you.ru}
HTTP_BASE_URL=${HTTP_BASE_URL:-http://staging.shape-of-you.ru}
IDENTITY_URL=${IDENTITY_URL:-https://identity.staging.shape-of-you.ru}
RUN_WRITE_SMOKE=${RUN_WRITE_SMOKE:-false}
RELEASE_ID=${RELEASE_ID:-manual}

curl --fail --silent --show-error --output /dev/null "$BASE_URL/"
curl --fail --silent --show-error --output /dev/null "$BASE_URL/edge-health"
curl --fail --silent --show-error --output /dev/null "$BASE_URL/api/health"
curl --fail --silent --show-error --output /dev/null "$BASE_URL/api/ready"
curl --fail --silent --show-error --output /dev/null "$BASE_URL/api/openapi.json"

redirect_url=$(
  curl \
    --silent \
    --show-error \
    --output /dev/null \
    --write-out '%{redirect_url}' \
    "$HTTP_BASE_URL/"
)

if [ "$redirect_url" != "$BASE_URL/" ]; then
  printf '%s\n' "Expected HTTP redirect to $BASE_URL/, got $redirect_url." >&2
  exit 1
fi

identity_status=$(
  curl \
    --silent \
    --show-error \
    --output /dev/null \
    --write-out '%{http_code}' \
    "$IDENTITY_URL/"
)

if [ "$identity_status" != "503" ]; then
  printf '%s\n' "Expected Identity placeholder to return 503, got $identity_status." >&2
  exit 1
fi

oversize_status=$(
  head -c 70000 /dev/zero |
    tr '\000' x |
    curl \
      --silent \
      --output /dev/null \
      --write-out '%{http_code}' \
      --request POST \
      --header 'Content-Type: application/json' \
      --data-binary @- \
      "$BASE_URL/api/v1/weight-measurements"
)

if [ "$oversize_status" != "413" ]; then
  printf '%s\n' "Expected oversized request to return 413, got $oversize_status." >&2
  exit 1
fi

if [ "$RUN_WRITE_SMOKE" = "true" ]; then
  response_file=$(mktemp)
  trap 'rm -f "$response_file"' EXIT HUP INT TERM
  measured_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  dedupe_key="deployment-smoke:${RELEASE_ID}:$(date -u '+%s')"

  curl \
    --fail \
    --silent \
    --show-error \
    --output "$response_file" \
    --request POST \
    --header 'Content-Type: application/json' \
    --data \
    "{\"measuredAt\":\"$measured_at\",\"timezone\":\"UTC\",\"weightKg\":70,\"dedupeKey\":\"$dedupe_key\",\"sourceReference\":{\"channel\":\"manual\",\"externalSystem\":null,\"externalRecordId\":null,\"occurredAt\":\"$measured_at\"}}" \
    "$BASE_URL/api/v1/weight-measurements"

  measurement_id=$(
    sed -n 's/^[^"]*"id":"\([^"]*\)".*/\1/p' "$response_file" | head -n 1
  )

  if [ -z "$measurement_id" ]; then
    printf '%s\n' "Write smoke response did not contain a measurement id." >&2
    exit 1
  fi

  curl \
    --fail \
    --silent \
    --show-error \
    --output /dev/null \
    "$BASE_URL/api/v1/weight-measurements/$measurement_id"
fi

printf '%s\n' "Staging smoke checks passed."
