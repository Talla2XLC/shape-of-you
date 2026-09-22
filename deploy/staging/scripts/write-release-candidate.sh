#!/bin/sh
set -eu

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  printf '%s\n' 'Usage: write-release-candidate.sh <output-file>' >&2
  exit 2
fi

OUTPUT_FILE=$1

: "${SOURCE_REPOSITORY:?SOURCE_REPOSITORY is required}"
: "${SOURCE_RUN_ID:?SOURCE_RUN_ID is required}"
: "${RELEASE_ID:?RELEASE_ID is required}"
: "${API_DIGEST:?API_DIGEST is required}"
: "${DEPLOY_IDENTITY:?DEPLOY_IDENTITY is required}"
: "${EDGE_DIGEST:?EDGE_DIGEST is required}"
: "${CERTBOT_DIGEST:?CERTBOT_DIGEST is required}"

digest_pattern='^sha256:[0-9a-f]{64}$'

printf '%s\n' "$SOURCE_REPOSITORY" |
  grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
printf '%s\n' "$SOURCE_RUN_ID" | grep -Eq '^[1-9][0-9]*$'
printf '%s\n' "$RELEASE_ID" | grep -Eq '^[0-9a-f]{40}$'
printf '%s\n' "$API_DIGEST" | grep -Eq "$digest_pattern"
printf '%s\n' "$DEPLOY_IDENTITY" | grep -Eq '^(true|false)$'
printf '%s\n' "$EDGE_DIGEST" | grep -Eq "$digest_pattern"
printf '%s\n' "$CERTBOT_DIGEST" | grep -Eq "$digest_pattern"

if [ "$DEPLOY_IDENTITY" = true ]; then
  : "${IDENTITY_DIGEST:?IDENTITY_DIGEST is required when Identity changes}"
  printf '%s\n' "$IDENTITY_DIGEST" | grep -Eq "$digest_pattern"
  if [ -n "${EXPECTED_STAGING_BASE:-}" ]; then
    printf '%s\n' 'EXPECTED_STAGING_BASE must be empty when Identity is included.' >&2
    exit 2
  fi
elif [ -n "${IDENTITY_DIGEST:-}" ]; then
  printf '%s\n' \
    'IDENTITY_DIGEST must be empty when Identity is inherited.' >&2
  exit 2
else
  : "${EXPECTED_STAGING_BASE:?EXPECTED_STAGING_BASE is required when Identity is inherited}"
  printf '%s\n' "$EXPECTED_STAGING_BASE" | grep -Eq '^[0-9a-f]{40}$'
fi

umask 077
{
  printf 'SOURCE_REPOSITORY=%s\n' "$SOURCE_REPOSITORY"
  printf 'SOURCE_RUN_ID=%s\n' "$SOURCE_RUN_ID"
  printf 'RELEASE_ID=%s\n' "$RELEASE_ID"
  printf 'API_DIGEST=%s\n' "$API_DIGEST"
  printf 'DEPLOY_IDENTITY=%s\n' "$DEPLOY_IDENTITY"
  printf 'EXPECTED_STAGING_BASE=%s\n' "${EXPECTED_STAGING_BASE:-}"
  printf 'IDENTITY_DIGEST=%s\n' "${IDENTITY_DIGEST:-}"
  printf 'EDGE_DIGEST=%s\n' "$EDGE_DIGEST"
  printf 'CERTBOT_DIGEST=%s\n' "$CERTBOT_DIGEST"
} > "$OUTPUT_FILE"
