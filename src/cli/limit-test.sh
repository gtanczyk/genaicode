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
  group=
  while IFS=: read -r hierarchy controllers path; do
    if [[ "$hierarchy" = 0 && -z "$controllers" ]]; then group=$path; fi
  done < /proc/self/cgroup
  check_max() {
    local value
    if [[ -z "$group" ]] || ! IFS= read -r value < "/sys/fs/cgroup$group/$1" ||
       [[ ! "$value" =~ ^[0-9]+$ ]] || ((value > $2)); then
      echo "Isolated test runner unavailable. The systemd user scope requires an enforced $1 limit." >&2
      exit 1
    fi
  }
  check_max memory.max "$3"
  check_max memory.swap.max 0
  check_max pids.max "$4"
fi
shift 4
exec "$@"
