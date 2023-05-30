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
# The script will exchange OSMO for these currencies and send from them to the nolus... address

#USDC
# nolus-USDC = ibc/5DE4FCAF68AE40F81F738C857C0D95F7C1BC47B00FA1026E85C1DD92524D4A11
declare -A  CURRENCY1=(
    [denom]="ibc/6F34E1BD664C36CE49ACC28E60D62559A5F96C4F9A6CCE4FC5A67B2852E24CFE"
    [pool_id]="5"
    [amount]="1000000"
)

#ATOM
# nolus-ATOM = ibc/ECFDE61B64BB920E087E7448C4C3FE356B7BD13A1C2153119E98816C964FE196
declare -A  CURRENCY2=(
  [denom]="ibc/A8C2D23A1E6F95DA4E48BA349667E322BD7A6C996D8A4AAE8BA72E190F3D1477"
  [pool_id]="12"
  [amount]="10000000"
)


#OSMO
# nolus-OSMO = ibc/ED07A3391A112B175915CD8FAF43A2DA8E4790EDE12566649D0C2F97716B8518
declare -A  CURRENCY3=(
  [denom]="uosmo"
  [amount]="1000000"
)

# TO DO
# valid for osmo-test-4
#
# #CRO
# # nolus-CRO = ibc/E1BCC0F7B932E654B1A930F72B76C0678D55095387E2A4D8F00E941A8F82EE48
# declare -A CURRENCY2=(
#     [denom]="ibc/E6931F78057F7CC5DA0FD6CEF82FF39373A6E0452BF1FD76910B93292CF356C1"
#     [pool_id]="9"
#     [amount]="1000000"
# )

# #JUNO
# # nolus-JUNO = ibc/4F3E83AB35529435E4BFEA001F5D935E7250133347C4E1010A9C77149EF0394C
# declare -A  CURRENCY4=(
#   [denom]="ibc/46B44899322F3CD854D2D46DEEF881958467CDD4B3B10086DA49296BBED94BED"
#   [pool_id]="497"
#   [amount]="1000000"
# )

# #SCRT
# # nolus-SCRT = ibc/EA00FFF0335B07B5CD1530B7EB3D2C710620AE5B168C71AFF7B50532D690E107
# declare -A  CURRENCY5=(
#   [denom]="ibc/0954E1C28EB7AF5B72D24F3BC2B47BBB2FDF91BDDFD57B74B99E133AED40972A"
#   [pool_id]="584"
#   [amount]="1000000"
# )

# #STARS
# # nolus-STARS = ibc/11E3CF372E065ACB1A39C531A3C7E7E03F60B5D0653AD2139D31128ACD2772B5
# declare -A  CURRENCY6=(
#   [denom]="ibc/987C17B11ABC2B20019178ACE62929FE9840202CE79498E29FE8E5CB02B7C0A4"
#   [pool_id]="604"
#   [amount]="1000000"
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

  FLAGS="--home $OSMOSIS_HOME_DIR --from $OSMOSIS_ACCOUNT_ADDRESS --gas 2000000 --fees 5000uosmo --node $OSMOSIS_NODE_URL --broadcast-mode block"

  # swap and transfer
  declare -n currency
  declare swapped_token
  for currency in ${!CURRENCY@}; do
  if [ "${currency[denom]}" != "uosmo" ]; then
    swapped_token=$(echo 'y' | osmosisd tx gamm swap-exact-amount-in "${currency[amount]}"uosmo 100000 --swap-route-denoms "${currency[denom]}" --swap-route-pool-ids "${currency[pool_id]}" $FLAGS --output json | jq '.events[16].attributes[4].value | @base64d' | tr -d '"')
  else
    swapped_token=${currency[amount]}${currency[denom]}
  fi
    echo 'y' | osmosisd tx ibc-transfer transfer transfer "$REMOTE_CHANNEL_ID" "$NOLUS_MAINKEY_ADDRESS"  "$swapped_token" --packet-timeout-height "0-0"  $FLAGS
  done
