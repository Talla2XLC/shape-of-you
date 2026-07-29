#!/bin/sh
set -eu

# Run this script as root from a reviewed repository checkout. It installs the
# immutable privilege boundary; the wrapper later verifies and fetches control
# files from the approved repository main branch.
[ "$(id -u)" -eq 0 ] || {
  printf '%s\n' 'Run as root.' >&2
  exit 1
}

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
staging_dir=$(CDPATH= cd "$script_dir/.." && pwd)
control_root=/opt/shape-of-you/staging/control

install -d -o root -g root -m 0755 "$control_root"
install -d -o root -g root -m 0755 /opt/shape-of-you/staging/releases
install -d -o root -g root -m 0700 /etc/shape-of-you/staging

install -o root -g root -m 0755 "$script_dir/shape-of-you-staging-deploy" \
  /usr/local/sbin/shape-of-you-staging-deploy
install -o root -g root -m 0440 "$script_dir/shape-deploy.sudoers" \
  /etc/sudoers.d/shape-deploy

visudo -cf /etc/sudoers.d/shape-deploy
printf '%s\n' 'Root-owned Shape of You staging deployment assets installed.'
