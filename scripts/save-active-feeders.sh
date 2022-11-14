#!/bin/bash
set -euxo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR"/common/cmd.sh

HOME_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)
source "$HOME_DIR"/.env

ACCOUNTS_DIR="$HOME/.nolus"
FEEDERS_FILE="feeders.json"
NOLUS_NET="http://localhost:26612"

while [[ $# -gt 0 ]]; do
  key="$1"

  case $key in

  -h | --help)
    printf \
    "Usage: %s
    [--accounts-dir <nolus_accounts_dir>]
    [--feeders-file <feeders_file_name>]
    [--nolus-net <nolus_net>]" \
    "$0"
    exit 0
    ;;
  --accounts-dir)
    ACCOUNTS_DIR="$2"
    shift
    shift
    ;;
  --feeders-file)
    FEEDERS_FILE="$2"
    shift
    shift
    ;;
  --nolus-net)
    NOLUS_NET="$2"
    shift
    shift
    ;;
esac
done

GET_FEEDERS_MSG='{"feeders":{}}'

run_cmd "$ACCOUNTS_DIR" query wasm contract-state smart "$ORACLE_ADDRESS" "$GET_FEEDERS_MSG" --output json --node "$NOLUS_NET"> "$HOME_DIR/$FEEDERS_FILE"