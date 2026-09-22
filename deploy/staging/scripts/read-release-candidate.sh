#!/bin/sh
set -eu

if [ "$#" -ne 4 ]; then
  printf '%s\n' \
    'Usage: read-release-candidate.sh <candidate> <release-id> <run-id> <repository>' >&2
  exit 2
fi

CANDIDATE_FILE=$1
EXPECTED_RELEASE_ID=$2
EXPECTED_RUN_ID=$3
EXPECTED_REPOSITORY=$4

test -f "$CANDIDATE_FILE"
printf '%s\n' "$EXPECTED_RELEASE_ID" | grep -Eq '^[0-9a-f]{40}$'
printf '%s\n' "$EXPECTED_RUN_ID" | grep -Eq '^[1-9][0-9]*$'
printf '%s\n' "$EXPECTED_REPOSITORY" |
  grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'

source_repository=
source_run_id=
release_id=
api_digest=
deploy_identity=
expected_staging_base=
identity_digest=
edge_digest=
certbot_digest=
seen_source_repository=false
seen_source_run_id=false
seen_release_id=false
seen_api_digest=false
seen_deploy_identity=false
seen_expected_staging_base=false
seen_identity_digest=false
seen_edge_digest=false
seen_certbot_digest=false

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    *=*) ;;
    *)
      printf '%s\n' 'Malformed staging release candidate line.' >&2
      exit 2
      ;;
  esac

  key=${line%%=*}
  value=${line#*=}
  case "$key" in
    SOURCE_REPOSITORY)
      [ "$seen_source_repository" = false ] || {
        printf '%s\n' 'Duplicate staging release candidate field.' >&2
        exit 2
      }
      source_repository=$value
      seen_source_repository=true
      ;;
    SOURCE_RUN_ID)
      [ "$seen_source_run_id" = false ] || {
        printf '%s\n' 'Duplicate staging release candidate field.' >&2
        exit 2
      }
      source_run_id=$value
      seen_source_run_id=true
      ;;
    RELEASE_ID)
      [ "$seen_release_id" = false ] || {
        printf '%s\n' 'Duplicate staging release candidate field.' >&2
        exit 2
      }
      release_id=$value
      seen_release_id=true
      ;;
    API_DIGEST)
      [ "$seen_api_digest" = false ] || {
        printf '%s\n' 'Duplicate staging release candidate field.' >&2
        exit 2
      }
      api_digest=$value
      seen_api_digest=true
      ;;
    DEPLOY_IDENTITY)
      [ "$seen_deploy_identity" = false ] || {
        printf '%s\n' 'Duplicate staging release candidate field.' >&2
        exit 2
      }
      deploy_identity=$value
      seen_deploy_identity=true
      ;;
    EXPECTED_STAGING_BASE)
      [ "$seen_expected_staging_base" = false ] || {
        printf '%s\n' 'Duplicate staging release candidate field.' >&2
        exit 2
      }
      expected_staging_base=$value
      seen_expected_staging_base=true
      ;;
    IDENTITY_DIGEST)
      [ "$seen_identity_digest" = false ] || {
        printf '%s\n' 'Duplicate staging release candidate field.' >&2
        exit 2
      }
      identity_digest=$value
      seen_identity_digest=true
      ;;
    EDGE_DIGEST)
      [ "$seen_edge_digest" = false ] || {
        printf '%s\n' 'Duplicate staging release candidate field.' >&2
        exit 2
      }
      edge_digest=$value
      seen_edge_digest=true
      ;;
    CERTBOT_DIGEST)
      [ "$seen_certbot_digest" = false ] || {
        printf '%s\n' 'Duplicate staging release candidate field.' >&2
        exit 2
      }
      certbot_digest=$value
      seen_certbot_digest=true
      ;;
    *)
      printf '%s\n' 'Unexpected staging release candidate field.' >&2
      exit 2
      ;;
  esac
done < "$CANDIDATE_FILE"

for seen in \
  "$seen_source_repository" \
  "$seen_source_run_id" \
  "$seen_release_id" \
  "$seen_api_digest" \
  "$seen_deploy_identity" \
  "$seen_expected_staging_base" \
  "$seen_identity_digest" \
  "$seen_edge_digest" \
  "$seen_certbot_digest"; do
  if [ "$seen" != true ]; then
    printf '%s\n' 'Missing staging release candidate field.' >&2
    exit 2
  fi
done

digest_pattern='^sha256:[0-9a-f]{64}$'
printf '%s\n' "$source_repository" |
  grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
printf '%s\n' "$source_run_id" | grep -Eq '^[1-9][0-9]*$'
printf '%s\n' "$release_id" | grep -Eq '^[0-9a-f]{40}$'
printf '%s\n' "$api_digest" | grep -Eq "$digest_pattern"
printf '%s\n' "$deploy_identity" | grep -Eq '^(true|false)$'
printf '%s\n' "$edge_digest" | grep -Eq "$digest_pattern"
printf '%s\n' "$certbot_digest" | grep -Eq "$digest_pattern"

if [ "$deploy_identity" = true ]; then
  printf '%s\n' "$identity_digest" | grep -Eq "$digest_pattern"
  [ -z "$expected_staging_base" ] || {
    printf '%s\n' 'Expected staging base must be empty when Identity is included.' >&2
    exit 2
  }
elif [ -n "$identity_digest" ]; then
  printf '%s\n' \
    'Identity digest must be empty for an inherited candidate.' >&2
  exit 2
else
  printf '%s\n' "$expected_staging_base" | grep -Eq '^[0-9a-f]{40}$'
fi

if [ "$source_repository" != "$EXPECTED_REPOSITORY" ] ||
  [ "$source_run_id" != "$EXPECTED_RUN_ID" ] ||
  [ "$release_id" != "$EXPECTED_RELEASE_ID" ]; then
  printf '%s\n' 'Staging release candidate provenance mismatch.' >&2
  exit 2
fi

printf 'release_id=%s\n' "$release_id"
printf 'api_digest=%s\n' "$api_digest"
printf 'deploy_identity=%s\n' "$deploy_identity"
printf 'expected_staging_base=%s\n' "$expected_staging_base"
printf 'identity_digest=%s\n' "$identity_digest"
printf 'edge_digest=%s\n' "$edge_digest"
printf 'certbot_digest=%s\n' "$certbot_digest"
