#!/bin/sh
set -eu

BASE_URL=${BASE_URL:-http://127.0.0.1:3001}
RUN_WRITE_SMOKE=${RUN_WRITE_SMOKE:-false}
RELEASE_ID=${RELEASE_ID:-manual}

curl --fail --silent --show-error --output /dev/null "$BASE_URL/"
curl --fail --silent --show-error --output /dev/null "$BASE_URL/edge-health"
curl --fail --silent --show-error --output /dev/null "$BASE_URL/api/health"
curl --fail --silent --show-error --output /dev/null "$BASE_URL/api/ready"
curl --fail --silent --show-error --output /dev/null "$BASE_URL/api/openapi.json"

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
    "{\"measuredAt\":\"$measured_at\",\"timezone\":\"UTC\",\"weightKg\":70,\"source\":\"manual\",\"dedupeKey\":\"$dedupe_key\",\"provenance\":{\"kind\":\"deployment-smoke\",\"releaseId\":\"$RELEASE_ID\"}}" \
    "$BASE_URL/api/v1/weight-measurements"

  measurement_id=$(
    sed -n 's/.*"id":"\([^"]*\)".*/\1/p' "$response_file" | head -n 1
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
