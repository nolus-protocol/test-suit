#!/bin/bash
set -euxo pipefail

NOLUS_LOCAL_NET="http://localhost:26612"
LPP_BASE_CURRENCY="USDC"
MAIN_KEY="reserve"
CONTRACTS_OWNER_KEY="contracts_owner"
NOLUS_HOME_DIR="$HOME/.nolus"
CONTRACTS_INFO_PATH=""

while [[ $# -gt 0 ]]; do
  key="$1"

  case $key in

  -h | --help)
    printf \
    "Usage: %s
    [--nolus-local-network <nolus_local_net>]
    [--contracts-result-file-path <path_to_contracts_info>]
    [--contracts-owner-key <contracts_owner_key>]
    [--lpp-base-currency <lpp_base_currency>]
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

  --contracts-owner-key)
    CONTRACTS_OWNER_KEY="$2"
    shift
    shift
    ;;

  --lpp-base-currency)
    LPP_BASE_CURRENCY="$2"
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

prepareEnv "$CONTRACTS_INFO_PATH" "$LPP_BASE_CURRENCY" "$NOLUS_LOCAL_NET" "local" "$NOLUS_HOME_DIR" "$MAIN_KEY" "$CONTRACTS_OWNER_KEY" \
"" "" "" "" "" "" "" "" ""