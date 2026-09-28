#!/bin/sh
set -eu

if [ "$#" -ne 4 ]; then
  printf '%s\n' 'Usage: verify-api-publication-candidate.sh <release-id> <api-digest> <repository> <output>' >&2
  exit 2
fi

RELEASE_ID=$1
API_DIGEST=$2
REPOSITORY=$3
OUTPUT=$4
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
printf '%s\n' "$RELEASE_ID" | grep -Eq '^[0-9a-f]{40}$'
printf '%s\n' "$API_DIGEST" | grep -Eq '^sha256:[0-9a-f]{64}$'
printf '%s\n' "$REPOSITORY" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'

run_id=$(gh run list --repo "$REPOSITORY" --workflow publish-staging.yml \
  --branch main --commit "$RELEASE_ID" --status success --limit 1 \
  --json databaseId --jq '.[0].databaseId')
printf '%s\n' "$run_id" | grep -Eq '^[1-9][0-9]*$' || {
  printf '%s\n' 'No successful publication run for the requested release.' >&2
  exit 2
}

head_sha=$(gh run view "$run_id" --repo "$REPOSITORY" --json headSha --jq '.headSha')
head_branch=$(gh run view "$run_id" --repo "$REPOSITORY" --json headBranch --jq '.headBranch')
conclusion=$(gh run view "$run_id" --repo "$REPOSITORY" --json conclusion --jq '.conclusion')
event=$(gh run view "$run_id" --repo "$REPOSITORY" --json event --jq '.event')
[ "$head_sha" = "$RELEASE_ID" ] && [ "$head_branch" = main ] &&
  [ "$conclusion" = success ] || {
  printf '%s\n' 'Publication run provenance mismatch.' >&2
  exit 2
}
case "$event" in push|workflow_dispatch) ;; *)
  printf '%s\n' 'Publication run event is not trusted.' >&2
  exit 2
esac

temporary_dir=$(mktemp -d)
trap 'rm -rf "$temporary_dir"' EXIT HUP INT TERM
gh run download "$run_id" --repo "$REPOSITORY" \
  --name "staging-release-candidate-$RELEASE_ID" --dir "$temporary_dir"
fields=$(sh "$SCRIPT_DIR/read-release-candidate.sh" \
  "$temporary_dir/candidate.env" "$RELEASE_ID" "$run_id" "$REPOSITORY")
field() {
  printf '%s\n' "$fields" | awk -F= -v key="$1" '$1 == key { print $2 }'
}
[ "$(field api_digest)" = "$API_DIGEST" ] || {
  printf '%s\n' 'API digest differs from the verified publication candidate.' >&2
  exit 2
}
capability_version=$(field api_identity_kid_deny_capability_version)
printf '%s\n' "$capability_version" | grep -Eq '^(0|1)$' || exit 2
{
  printf 'api_source_run_id=%s\n' "$run_id"
  printf 'api_identity_kid_deny_capability_version=%s\n' "$capability_version"
} >> "$OUTPUT"
