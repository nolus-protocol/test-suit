#!/bin/bash
set -euxo pipefail

NOLUS_LOCAL_NET="http://localhost:26612"
MAIN_KEY="reserve"
NOLUS_HOME_DIR="$HOME/.nolus"
PROTOCOL=""
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
    [--home-dir <nolus_accounts_dir>]
    [--feeder-key <feeder_key_name>]
    [--protocol <protocol>]
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

  --home-dir)
    NOLUS_HOME_DIR="$2"
    shift
    shift
    ;;

  --feeder-key)
    FEEDER_KEY="$2"
    shift
    shift
    ;;

  --protocol)
    PROTOCOL="$2"
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

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

source "$SCRIPT_DIR"/common/verify.sh
verify_mandatory "$FEEDER_KEY" "feeder key"
verify_mandatory "$PROTOCOL" "protocol name"

source "$SCRIPT_DIR"/common/prepare-env.sh
prepareEnv "$NOLUS_LOCAL_NET" "local" "$NOLUS_HOME_DIR" "$MAIN_KEY" \
"$FEEDER_KEY" "$PROTOCOL" "$NO_PRICE_CURRENCY" "$ACTIVE_LEASE_ADDRESS" \
"" "" "" "" "" "" "" "" "" "" "" ""
