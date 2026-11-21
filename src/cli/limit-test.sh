#!/bin/bash
set -eu

# Lower both inherited limits, keeping a stricter limit set by the caller.
cap() {
  local current
  current=$(ulimit -S "$1")
  if [[ "$current" != unlimited && "$current" -lt "$2" ]]; then
    ulimit "$1" "$current"
  else
    ulimit "$1" "$2"
  fi
}

cap -t 180
cap -f 131072
cap -u "$1"
if [[ "$2" != 0 ]]; then
  cap -d "$2"
fi
shift 2
exec "$@"
