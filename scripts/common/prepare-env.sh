#!/bin/bash
set -euxo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR"/cmd.sh

HOME_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && cd .. && pwd)

addKey() {
  local -r name="$1"
  local -r accounts_dir="$2"

  echo 'y' | run_cmd "$accounts_dir" keys add "$name" --keyring-backend "test"
}

exportKey() {
  local -r name="$1"
  local -r accounts_dir="$2"

  echo 'y' | run_cmd "$accounts_dir" keys export "$name" --unsafe --unarmored-hex --keyring-backend "test"
}

getValidatorAddress() {
  local -r index="$1"
  local -r accounts_dir="$2"
  local -r nolus_net="$3"

  run_cmd "$accounts_dir" query staking validators --output json --node "$nolus_net"| jq '.validators['$index'].operator_address' | tr -d '"'
}

prepareEnv() {

# Add new keys

local -r contracts_info_path=$1
local -r stable_denom=$2
local -r ibc_token=$3
local -r node_url=$4
local -r accounts_dir=$5

addKey "test-user-1" "$accounts_dir"
addKey "test-user-2" "$accounts_dir"

local -r user_1_priv_key=$(exportKey "treasury" "$accounts_dir")
local -r user_2_priv_key=$(exportKey "test-user-1" "$accounts_dir")
local -r user_3_priv_key=$(exportKey "test-user-2" "$accounts_dir")
local -r validator_1_address=$(getValidatorAddress "0" "$accounts_dir" "$node_url")
local -r validator_2_address=$(getValidatorAddress "1" "$accounts_dir" "$node_url")

# Get contracts addresses and ids

local -r lpp_address=$(jq ."$contracts_info_path"[1].lpp.instance contracts-info.json | tr -d '"')
local -r leaser_address=$(jq .contracts_info[2].leaser.instance contracts-info.json | tr -d '"')
local -r oracle_address=$(jq .contracts_info[3].oracle.instance contracts-info.json | tr -d '"')
local -r treasury_address=$(jq .contracts_info[4].treasury.instance contracts-info.json | tr -d '"')
local -r profit_address=$(jq .contracts_info[5].profit.instance contracts-info.json | tr -d '"')
local -r dispatcher_address=$(jq .contracts_info[6].rewards_dispatcher.instance contracts-info.json | tr -d '"')

# Save the results

DOT_ENV=$(cat <<-EOF
NODE_URL=${node_url}
IBC_TOKEN=${ibc_token}
STABLE_DENOM=${stable_denom}
USER_1_PRIV_KEY=${user_1_priv_key}
USER_2_PRIV_KEY=${user_2_priv_key}
USER_3_PRIV_KEY=${user_3_priv_key}
VALIDATOR_1_ADDRESS=${validator_1_address}
VALIDATOR_2_ADDRESS=${validator_2_address}
ORACLE_ADDRESS=${oracle_address}
LEASER_ADDRESS=${leaser_address}
LPP_ADDRESS=${lpp_address}
TREASURY_ADDRESS=${treasury_address}
DISPATCHER_ADDRESS=${dispatcher_address}
PROFIT_ADDRESS=${profit_address}
EOF
  )
   echo "$DOT_ENV" > "$HOME_DIR/.env"
}