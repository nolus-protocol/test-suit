#!/bin/bash
set -euxo pipefail

NOLUS_LOCAL_NET="http://localhost:26612"
STABLE_DENOM="USDC"
MAIN_KEY="reserve"
WASM_ADMIN_KEY="contracts_owner"
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
    [--wasm-admin-key <existing_key>]
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

  --wasm-admin-key)
    WASM_ADMIN_KEY="$2"
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

prepareEnv "$CONTRACTS_INFO_PATH" "$STABLE_DENOM" "$NOLUS_LOCAL_NET" "local" "$NOLUS_HOME_DIR" "$MAIN_KEY" "$WASM_ADMIN_KEY" \
"" "" "" "" "" "" "" "" ""