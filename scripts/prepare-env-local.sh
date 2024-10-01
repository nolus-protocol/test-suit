#!/bin/bash
set -euxo pipefail

NOLUS_LOCAL_NET="http://localhost:26612"
MAIN_KEY="reserve"
NOLUS_HOME_DIR="$HOME/.nolus"
PROTOCOL=""
ADMIN_CONTRACT_ADDRESS="nolus17p9rzwnnfxcjp32un9ug7yhhzgtkhvl9jfksztgw5uh69wac2pgsmc5xhq"
NO_PRICE_CURRENCY_TICKER="NLS"
FEEDER_KEY=""
DEX_ADMIN_KEY=""
ACTIVE_LEASE_ADDRESS=""

while [[ $# -gt 0 ]]; do
  key="$1"

  case $key in

  -h | --help)
    printf \
    "Usage: %s
    [--nolus-local-network <nolus_local_url>]
    [--home-dir <nolus_accounts_dir>]
    [--feeder-key <feeder_key_name>]
    [--dex-admin-key <dex_admin_key_name>]
    [--protocol <protocol>]
    [--admin-contract-address <admin_contract_address>]
    [--no-price-currency-ticker <no_price_currency_ticker>]
    [--active-lease-address <active_lease_address>]" \
    "$0"
    exit 0
    ;;

  --nolus-local-network)
    NOLUS_LOCAL_NET="$2"
    shift 2
    ;;

  --home-dir)
    NOLUS_HOME_DIR="$2"
    shift 2
    ;;

  --feeder-key)
    FEEDER_KEY="$2"
    shift 2
    ;;

  --dex-admin-key)
    DEX_ADMIN_KEY="$2"
    shift 2
    ;;

  --protocol)
    PROTOCOL="$2"
    shift 2
    ;;

  --admin-contract-address)
    ADMIN_CONTRACT_ADDRESS="$2"
    shift 2
    ;;

  --no-price-currency-ticker)
    NO_PRICE_CURRENCY_TICKER="$2"
    shift 2
    ;;

  --active-lease-address)
    ACTIVE_LEASE_ADDRESS="$2"
    shift 2
    ;;

  *)
    echo "unknown option '$key'"
    exit 1
    ;;

  esac
done

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

source "$SCRIPT_DIR"/common/verify.sh
verify_mandatory "$FEEDER_KEY" "feeder key"
verify_mandatory "$DEX_ADMIN_KEY" "dex-admin key"
verify_mandatory "$PROTOCOL" "protocol name"

source "$SCRIPT_DIR"/common/prepare-env.sh
prepareEnv "$NOLUS_LOCAL_NET" "local" "$NOLUS_HOME_DIR" "$MAIN_KEY" \
"$FEEDER_KEY" "$PROTOCOL" "$ADMIN_CONTRACT_ADDRESS" "$NO_PRICE_CURRENCY_TICKER" "$ACTIVE_LEASE_ADDRESS" \
"" "$DEX_ADMIN_KEY" "" "" "" "" "" "" "" "" "" "" "" "" ""
