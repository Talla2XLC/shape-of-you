#!/bin/sh
set -eu

template=/etc/nginx/nginx.conf.template
rendered=/tmp/nginx.conf
candidate="$rendered.candidate.$$"

cleanup() {
  rm -f "$candidate"
}

trap cleanup EXIT HUP INT TERM

case "${EDGE_PROXY_PROTOCOL+x}:${EDGE_PROXY_PROTOCOL-}:${EDGE_CLIENT_ADDRESS-}:${EDGE_FORWARDED_FOR-}" in
  x:proxy_protocol:'$proxy_protocol_addr':'$proxy_protocol_addr') ;;
  x::'$remote_addr':'$proxy_add_x_forwarded_for') ;;
  *)
    printf '%s\n' 'Invalid or incomplete edge topology configuration.' >&2
    exit 2
    ;;
esac

case "${1:-}" in
  ''|--test) ;;
  *)
    printf '%s\n' 'Usage: start-shape-of-you-edge [--test]' >&2
    exit 2
    ;;
esac

envsubst \
  '${EDGE_PROXY_PROTOCOL} ${EDGE_CLIENT_ADDRESS} ${EDGE_FORWARDED_FOR}' \
  < "$template" > "$candidate"

nginx -c "$candidate" -t
mv "$candidate" "$rendered"
trap - EXIT HUP INT TERM

case "${1:-}" in
  '') exec nginx -c "$rendered" -g 'daemon off;' ;;
  --test) exit 0 ;;
esac
