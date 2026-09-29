#!/bin/bash

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd ../.. && pwd)
CMD="$REPO_ROOT/nolusd"

if [[ ! -x "$CMD" ]]; then
  echo >&2 "No nolusd at $CMD."
  echo >&2 "Run 'yarn prepare-env' - it downloads the nolus-core release and leaves the client there."
  exit 1
fi

run_cmd() {
  local home="$1"
  shift

  "$CMD" "$@" --home "$home" 2>&1
}
