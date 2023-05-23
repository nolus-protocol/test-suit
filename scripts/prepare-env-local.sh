#!/bin/bash
set -euxo pipefail

NOLUS_LOCAL_NET="http://localhost:26612"
LPP_BASE_CURRENCY="USDC"
MAIN_KEY="reserve"
NOLUS_HOME_DIR="$HOME/.nolus"
NO_PRICE_CURRENCY="STARS"
FEEDER_KEY=""
ACTIVE_LEASE_ADDRESS=""

while [[ $# -gt 0 ]]; do
  key="$1"

  case $key in

  -h | --help)
    printf \
    "Usage: %s
    [--nolus-local-network <nolus_local_url>]
    [--lpp-base-currency <lpp_base_currency_ticker>]
    [--home-dir <nolus_accounts_dir>]
    [--feeder-key <feeder_key_name>]
    [--no-price-currency <no_price_currency_ticker>]
    [--active-lease-address <active_lease_address>]" \
    "$0"
    exit 0
    ;;

  --nolus-local-network)
    NOLUS_LOCAL_NET="$2"
    shift
    shift
    ;;

  --lpp-base-currency)
    LPP_BASE_CURRENCY="$2"
    shift
    shift
    ;;

  --feeder-key)
    FEEDER_KEY="$2"
    shift
    shift
    ;;

  --home-dir)
    NOLUS_HOME_DIR="$2"
    shift
    shift
    ;;

  --no-price-currency)
    NO_PRICE_CURRENCY="$2"
    shift
    shift
    ;;

  --active-lease-address)
    ACTIVE_LEASE_ADDRESS="$2"
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

source "$SCRIPT_DIR"/common/verify.sh
verify_mandatory "$FEEDER_KEY" "feeder key name"

source "$SCRIPT_DIR"/common/prepare-env.sh
prepareEnv "$LPP_BASE_CURRENCY" "$NOLUS_LOCAL_NET" "local" "$NOLUS_HOME_DIR" "$MAIN_KEY" \
"$FEEDER_KEY" "" "" "" "" "" "" "" "" "$NO_PRICE_CURRENCY" "$ACTIVE_LEASE_ADDRESS"