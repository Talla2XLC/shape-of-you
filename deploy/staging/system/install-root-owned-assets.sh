#!/bin/sh
set -eu

# Run this script as root from a reviewed repository checkout. It installs the
# immutable deployment control plane; GitHub Actions must never update it.
[ "$(id -u)" -eq 0 ] || {
  printf '%s\n' 'Run as root.' >&2
  exit 1
}

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
staging_dir=$(CDPATH= cd "$script_dir/.." && pwd)
system_root=/opt/shape-of-you/staging/system

install -d -o root -g root -m 0755 "$system_root/scripts"
install -d -o root -g root -m 0755 /opt/shape-of-you/staging/releases
install -d -o root -g root -m 0700 /etc/shape-of-you/staging

install -o root -g root -m 0644 "$staging_dir/compose.yaml" "$system_root/compose.yaml"
install -o root -g root -m 0755 "$staging_dir/scripts/deploy.sh" "$system_root/scripts/deploy.sh"
install -o root -g root -m 0755 "$staging_dir/scripts/rollback.sh" "$system_root/scripts/rollback.sh"
install -o root -g root -m 0755 "$staging_dir/scripts/smoke.sh" "$system_root/scripts/smoke.sh"
install -o root -g root -m 0755 "$staging_dir/scripts/vm-preflight.sh" "$system_root/scripts/vm-preflight.sh"
install -o root -g root -m 0755 "$script_dir/shape-of-you-staging-deploy" \
  /usr/local/sbin/shape-of-you-staging-deploy
install -o root -g root -m 0440 "$script_dir/shape-deploy.sudoers" \
  /etc/sudoers.d/shape-deploy

visudo -cf /etc/sudoers.d/shape-deploy
printf '%s\n' 'Root-owned Shape of You staging deployment assets installed.'
