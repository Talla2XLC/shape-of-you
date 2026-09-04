#!/bin/sh
set -eu

[ "$(id -u)" -eq 0 ] || {
  printf '%s\n' 'Run as root.' >&2
  exit 1
}

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
runner=$script_dir/shape-of-you-staging-recovery-erasure-sync
service=$script_dir/shape-of-you-staging-recovery-erasure-sync.service
timer=$script_dir/shape-of-you-staging-recovery-erasure-sync.timer

for source in "$runner" "$service" "$timer"; do
  [ -f "$source" ] && [ ! -L "$source" ] || {
    printf '%s\n' 'Recovery erasure sync asset is missing or unsafe.' >&2
    exit 1
  }
done

sh -n "$runner"
systemd-analyze verify "$service" "$timer"

install -d -o root -g root -m 0755 /usr/local/libexec
install -o root -g root -m 0555 "$runner" \
  /usr/local/libexec/shape-of-you-staging-recovery-erasure-sync
install -o root -g root -m 0644 "$service" \
  /etc/systemd/system/shape-of-you-staging-recovery-erasure-sync.service
install -o root -g root -m 0644 "$timer" \
  /etc/systemd/system/shape-of-you-staging-recovery-erasure-sync.timer

systemctl daemon-reload
systemctl enable --now shape-of-you-staging-recovery-erasure-sync.timer
printf '%s\n' 'Recovery erasure journal synchronization assets installed.'

