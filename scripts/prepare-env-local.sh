#!/bin/bash
set -euxo pipefail

NOLUS_LOCAL_NET="http://localhost:26612"
STABLE_DENOM="ibc/8A34AF0C1943FD0DFCDE9ADBF0B2C9959C45E87E6088EA2FC6ADACD59261B8A2"
IBC_TOKEN="ibc/8A34AF0C1943FD0DFCDE9ADBF0B2C9959C45E87E6088EA2FC6ADACD59261B8A2"
NOLUS_HOME_DIR="$HOME/.nolus"
CONTRACTS_INFO_PATH=""

while [[ $# -gt 0 ]]; do
  key="$1"

  case $key in

  -h | --help)
    printf \
    "Usage: %s
    [--nolus-local-network <nolus-local-net-url>]
    [--contracts-result-file-path <path_to_contracts_info>]
    [--ibc-token <ibc-denom>]
    [--stable-denom <string>]
    [--home-dir <nolus_accounts_dir>]" \
     "$0"
    exit 0
    ;;

  --nolus-local-network)
    NOLUS_LOCAL_NET="$2"
    shift
    shift
    ;;

  --contracts-result-file-path)
    CONTRACTS_INFO_PATH="$2"
    shift
    shift
    ;;

  --ibc-denom)
    IBC_TOKEN="$2"
    shift
    shift
    ;;

  --stable-denom)
    STABLE_DENOM="$2"
    shift
    shift
    ;;

  --home-dir)
    NOLUS_HOME_DIR="$2"
    shift
    shift
    ;;

  *)
    echo "unknown option '$key'"
    exit 1
    ;;

  esac
done

# Prepare .env

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR"/common/prepare-env.sh
source "$SCRIPT_DIR"/verify.sh

verify_mandatory "$CONTRACTS_INFO_PATH" "contracts info file path"

prepareEnv "$CONTRACTS_INFO_PATH" "$STABLE_DENOM" "$IBC_TOKEN" "$NOLUS_LOCAL_NET" "$NOLUS_HOME_DIR"