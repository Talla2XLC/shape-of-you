#!/bin/sh
set -eu

CERT_NAME=${CERT_NAME:-shape-of-you-staging}
LETSENCRYPT_ROOT=${LETSENCRYPT_ROOT:-/etc/letsencrypt}
TLS_ROOT=${TLS_ROOT:-/var/lib/shape-of-you/tls}
NGINX_UID=${NGINX_UID:-101}
NGINX_GID=${NGINX_GID:-101}

source_dir="$LETSENCRYPT_ROOT/live/$CERT_NAME"
target_dir="$TLS_ROOT/$CERT_NAME"

test -s "$source_dir/fullchain.pem"
test -s "$source_dir/privkey.pem"

install -d -o "$NGINX_UID" -g "$NGINX_GID" -m 0700 "$target_dir"

fullchain_tmp=$(mktemp "$target_dir/.fullchain.pem.XXXXXX")
privkey_tmp=$(mktemp "$target_dir/.privkey.pem.XXXXXX")

cleanup() {
  rm -f "$fullchain_tmp" "$privkey_tmp"
}

trap cleanup EXIT HUP INT TERM

install -m 0444 "$source_dir/fullchain.pem" "$fullchain_tmp"
install -m 0400 "$source_dir/privkey.pem" "$privkey_tmp"
chown "$NGINX_UID:$NGINX_GID" "$fullchain_tmp" "$privkey_tmp"

mv -f "$fullchain_tmp" "$target_dir/fullchain.pem"
mv -f "$privkey_tmp" "$target_dir/privkey.pem"

trap - EXIT HUP INT TERM

printf '%s\n' "Installed certificate material for $CERT_NAME."
