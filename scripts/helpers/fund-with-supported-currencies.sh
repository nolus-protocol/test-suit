#!/bin/bash
set -euxo pipefail

OSMOSIS_ACCOUNT_MNEMONIC="$1"
OSMOSIS_ACCOUNT_ADDRESS="$2"
NOLUS_MAINKEY_ADDRESS="$3"
OSMOSIS_NODE_URL="$4"
NOLUS_HOME_DIR="$HOME/.nolus"
OSMOSIS_HOME_DIR="$HOME/.osmosisd"
NOLUS_NODE_URL="http://localhost:26612"
LEASER_CONTRACT_ADDRESS="nolus1wn625s4jcmvk0szpl85rj5azkfc6suyvf75q6vrddscjdphtve8s5gg42f"

##########################################################################################
# PLACE ALL SUPPORTED CURRENCIES AND THEIR POOL_IDS HERE, AS SHOWN BELOW
# The script will exchange the Osmo for these currencies and send from them to the nolus address

#USDC(temporary)
declare -A  CURRENCY1=(
    [denom]="ibc/902BDADA0D46931BF5DEBE0648CC1FE137AA4B7346475DD0490D503C937A12BD"
    [pool_id]="672"
)

#CRO
declare -A CURRENCY2=(
    [denom]="ibc/E6931F78057F7CC5DA0FD6CEF82FF39373A6E0452BF1FD76910B93292CF356C1"
    [pool_id]="9"
)

# TO DO
#declare -A  CURRENCY3=(
#   [denom]=""
#   [pool_id]=""
# )

##########################################################################################

while [[ $# -gt 5 ]]; do
  key="$5"

  case $key in

   --nolus-node)
    NOLUS_NODE_URL="$6"
    shift
    shift
    ;;

  --nolus-home-dir)
    NOLUS_HOME_DIR="$6"
    shift
    shift
    ;;

  --osmosis-home-dir)
    OSMOSIS_HOME_DIR="$6"
    shift
    shift
    ;;

  --leaser-contract-address)
    LEASER_CONTRACT_ADDRESS="$6"
    shift
    shift
    ;;

 *)
    echo "unknown option '$key'"
    exit 1
    ;;

  esac
done

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)
source "$SCRIPT_DIR"/common/cmd.sh

  # recover osmosis key
  declare -r status=$(echo "$OSMOSIS_ACCOUNT_MNEMONIC" | osmosisd keys add osmosis_main_key_testing --recover)
  REMOTE_CHANNEL_ID=$(run_cmd "$NOLUS_HOME_DIR" q wasm contract-state smart "$LEASER_CONTRACT_ADDRESS" '{"config":{}}' --node "$NOLUS_NODE_URL" --output json | jq '.data.config.dex.transfer_channel.remote_endpoint' | tr -d '"')

  FLAGS="--home $OSMOSIS_HOME_DIR --from $OSMOSIS_ACCOUNT_ADDRESS --gas 200000 --fees 900uosmo --node $OSMOSIS_NODE_URL --broadcast-mode block"

  # swap and transfer
  declare -n currency
  for currency in ${!CURRENCY@}; do
    echo 'y' | osmosisd tx gamm swap-exact-amount-in 1000000uosmo 100000 --swap-route-denoms "${currency[denom]}" --swap-route-pool-ids "${currency[pool_id]}" $FLAGS
    echo 'y' | osmosisd tx ibc-transfer transfer transfer "$REMOTE_CHANNEL_ID" "$NOLUS_MAINKEY_ADDRESS"  100000"${currency[denom]}" --packet-timeout-height "0-0"  $FLAGS
  done
