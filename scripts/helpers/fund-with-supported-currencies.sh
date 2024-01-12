#!/bin/bash
set -euxo pipefail

DEX_ACCOUNT_MNEMONIC="$1"
DEX_ACCOUNT_ADDRESS="$2"
DEX_NETWORK="$3"
DEX_NETWORK_NODE_URL="$4"
DEX_NETWORK_BINARY_PATH="$5"
DEX_NETWORK_HOME_DIR="$6"
DEX_NETWORK_NATIVE_DENOM="$7"
LEASER_CONTRACT_ADDRESS="$8"
NOLUS_MAINKEY_ADDRESS="$9"

NOLUS_HOME_DIR="$HOME/.nolus"
NOLUS_NODE_URL="http://localhost:26612"

wait_tx_included_in_block() {
  local -r network_binary_dir_path="$1"
  local -r network_net="$2"
  local -r tx_broadcast_result="$3"

  tx_result=$(echo "$tx_broadcast_result" | awk 'NR > 1')
  tx_result=$(echo "$tx_result" | jq -c '.')

  local tx_hash
  tx_hash=$(echo "$tx_result" | jq -r '.txhash')
  tx_hash=$(echo "$tx_hash" | sed '/^null$/d')

  local tx_state="NOT_INCLUDED"

  while [ "$tx_state" == "NOT_INCLUDED"  ]
  do
    sleep 1
    tx_state=$("$network_binary_dir_path" q tx "$tx_hash" --node "$network_net" --output json) || tx_state="NOT_INCLUDED"
  done

  echo "$tx_state"
}

##########################################################################################
# PLACE ALL SUPPORTED CURRENCIES AND THEIR POOL_IDS HERE, AS SHOWN BELOW
# The script will exchange && transfer them to the nolus... address


######## OSMOSIS-OSMOSIS ########

#USDC
# nolus-osmosis-USDC = ibc/5DE4FCAF68AE40F81F738C857C0D95F7C1BC47B00FA1026E85C1DD92524D4A11
declare -A  CURRENCY1=(
    [dex_network]="OSMOSIS"
    [denom]="ibc/6F34E1BD664C36CE49ACC28E60D62559A5F96C4F9A6CCE4FC5A67B2852E24CFE"
    [pool_id]="5"
    [amount]="100000"
)

#ATOM
# nolus-osmosis-ATOM = ibc/ECFDE61B64BB920E087E7448C4C3FE356B7BD13A1C2153119E98816C964FE196
declare -A  CURRENCY2=(
  [dex_network]="OSMOSIS"
  [denom]="ibc/A8C2D23A1E6F95DA4E48BA349667E322BD7A6C996D8A4AAE8BA72E190F3D1477"
  [pool_id]="12"
  [amount]="1000000"
)

#OSMO
# nolus-osmosis-OSMO = ibc/ED07A3391A112B175915CD8FAF43A2DA8E4790EDE12566649D0C2F97716B8518
declare -A  CURRENCY3=(
  [dex_network]="OSMOSIS"
  [denom]="uosmo"
  [amount]="100000"
)

# TO DO - more currencies

######## NEUTRON-ASTROPORT ########

ASTROPORT_ROUTER_CONTRACT="neutron12jm24l9lr9cupufqjuxpdjnnweana4h66tsx5cl800mke26td26sq7m05p"

#NTRN
# nolus-astroport-NTRN = ibc/4E41ED8F3DCAEA15F4D6ADC6EDD7C04A676160735C9710B904B7BF53525B56D6
declare -A  CURRENCY4=(
    [dex_network]="NEUTRON"
    [denom]="untrn"
    [amount]="100000"
)

#ATOM
# nolus-astroport-ATOM = ibc/B62610294777CD7D4567F7125B5D88DE95C6B7F7ED25430F3808F863202BC599
declare -A  CURRENCY5=(
    [dex_network]="NEUTRON"
    [denom]="ibc/C4CFF46FD6DE35CA4CF4CE031E643C8FDC9BA4B99AE598E9B0ED98FE3A2319F9"
    [amount]="10000"
)


##########################################################################################

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)
source "$SCRIPT_DIR"/common/cmd.sh

declare -r status=$(echo "$DEX_ACCOUNT_MNEMONIC" | "$DEX_NETWORK_BINARY_PATH" keys add main_key_testing --recover)
REMOTE_CHANNEL_ID=$(run_cmd "$NOLUS_HOME_DIR" q wasm contract-state smart "$LEASER_CONTRACT_ADDRESS" '{"config":{}}' --node "$NOLUS_NODE_URL" --output json | jq '.data.config.dex.transfer_channel.remote_endpoint' | tr -d '"')

FLAGS="--home $DEX_NETWORK_HOME_DIR --from $DEX_ACCOUNT_ADDRESS --gas auto --gas-adjustment 1.3 --fees 100000$DEX_NETWORK_NATIVE_DENOM --node $DEX_NETWORK_NODE_URL --broadcast-mode sync"

# swap and transfer
declare -n currency
declare swapped_token

for currency in ${!CURRENCY@}; do
  if [ "${currency[dex_network]}" == "$DEX_NETWORK" ] ; then

    if [ "${currency[denom]}" != "$DEX_NETWORK_NATIVE_DENOM" ] ; then

      if [ "$DEX_NETWORK" == "NEUTRON" ] ; then
        swap_msg='{"execute_swap_operations":{"operations":[{"astro_swap":{"offer_asset_info":{"native_token":{"denom":"untrn"}},"ask_asset_info":{"native_token":{"denom":"'"${currency[denom]}"'"}}}}]}}'
        swap_tx=$(echo 'y' | "$DEX_NETWORK_BINARY_PATH" tx wasm execute "$ASTROPORT_ROUTER_CONTRACT" "$swap_msg" $FLAGS --amount "${currency[amount]}$DEX_NETWORK_NATIVE_DENOM" --output json)
        swap_tx=$(wait_tx_included_in_block "$DEX_NETWORK_BINARY_PATH" "$DEX_NETWORK_NODE_URL" "$swap_tx")
        swapped_token=$(echo "$swap_tx" |  jq -r '.logs[].events[] | select(.type == "wasm") | .attributes[] | select(.key == "return_amount") | .value')"${currency[denom]}"
      else
        swap_tx=$(echo 'y' | "$DEX_NETWORK_BINARY_PATH" tx gamm swap-exact-amount-in "${currency[amount]}""$DEX_NETWORK_NATIVE_DENOM" 10000 --swap-route-denoms "${currency[denom]}" --swap-route-pool-ids "${currency[pool_id]}" $FLAGS --output json)
        swap_tx=$(wait_tx_included_in_block "$DEX_NETWORK_BINARY_PATH" "$DEX_NETWORK_NODE_URL" "$swap_tx")
        swapped_token=$(echo "$swap_tx" |  jq -r '.logs[].events[] | select(.type == "token_swapped") | .attributes[] | select(.key == "tokens_out") | .value')
      fi
  else
    swapped_token="${currency[amount]}${currency[denom]}"
  fi

  transfer_tx=$(echo 'y' | "$DEX_NETWORK_BINARY_PATH" tx ibc-transfer transfer transfer "$REMOTE_CHANNEL_ID" "$NOLUS_MAINKEY_ADDRESS"  "$swapped_token" --packet-timeout-height "0-0"  $FLAGS --output json)
  wait_tx_included_in_block "$DEX_NETWORK_BINARY_PATH" "$DEX_NETWORK_NODE_URL" "$transfer_tx"
  fi
done
