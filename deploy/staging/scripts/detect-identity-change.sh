#!/bin/sh
set -eu

repository_root=${REPOSITORY_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)}
before_revision=${1:-}
after_revision=${2:-}

is_revision() {
  printf '%s\n' "$1" | grep -Eq '^[0-9a-f]{40}$'
}

# Initial, incomplete, or otherwise unverifiable histories take the safe full
# Identity delivery path.
if ! is_revision "$before_revision" || ! is_revision "$after_revision" ||
  [ "$before_revision" = 0000000000000000000000000000000000000000 ] ||
  ! git -C "$repository_root" cat-file -e "$before_revision^{commit}" 2>/dev/null ||
  ! git -C "$repository_root" cat-file -e "$after_revision^{commit}" 2>/dev/null; then
  printf '%s\n' true
  exit 0
fi

if git -C "$repository_root" diff --quiet "$before_revision" "$after_revision" -- \
  .dockerignore \
  apps/identity \
  deploy/staging/compose.identity.yaml \
  package.json \
  pnpm-lock.yaml \
  pnpm-workspace.yaml \
  tsconfig.base.json; then
  printf '%s\n' false
else
  printf '%s\n' true
fi
