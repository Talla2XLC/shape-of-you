#!/bin/sh
set -eu

expected_image=${1:-}
expected_digest=${2:-}
expected_runtime_hash=${3:-}
runtime_env=${4:-}
compose_project=${5:-}

fail() {
  printf '%s\n' "$1" >&2
  exit 2
}

[ "$#" -eq 5 ] || fail 'Identity state verification requires five arguments.'
command -v sha256sum >/dev/null 2>&1 ||
  fail 'sha256sum is required for Identity state verification.'
printf '%s\n' "$expected_digest" | grep -Eq '^sha256:[0-9a-f]{64}$' ||
  fail 'Current Identity digest is invalid.'
printf '%s\n' "$expected_runtime_hash" | grep -Eq '^[0-9a-f]{64}$' ||
  fail 'Current Identity runtime hash is invalid.'
[ -f "$runtime_env" ] && [ ! -L "$runtime_env" ] ||
  fail 'Identity runtime environment is missing or unsafe.'

actual_runtime_hash=$(sha256sum "$runtime_env" | awk '{print $1}')
[ "$actual_runtime_hash" = "$expected_runtime_hash" ] ||
  fail 'Identity runtime environment does not match the current release.'

identity_containers=$(docker container ls --quiet \
  --filter "label=com.docker.compose.project=$compose_project" \
  --filter 'label=com.docker.compose.service=identity')
identity_container_count=$(printf '%s\n' "$identity_containers" |
  awk 'NF { count += 1 } END { print count + 0 }')
[ "$identity_container_count" -eq 1 ] ||
  fail 'Exactly one running current Identity container is required.'

live_image=$(docker inspect --format '{{.Config.Image}}' "$identity_containers")
[ "$live_image" = "$expected_image@$expected_digest" ] ||
  fail 'Running Identity image does not match the current release.'
