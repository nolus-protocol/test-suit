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
local -r lpp_base_currency=$2
local -r node_url=$3
local -r node_env=$4
local -r accounts_dir=$5
local -r main_accounts_key=$6
local -r contracts_owner_key=$7
local -r test_transfers=$8
local -r test_oracle=$9
local -r test_staking=${10}
local -r test_borrower=${11}
local -r test_lender=${12}
local -r test_treasury=${13}
local -r test_vesting=${14}
local -r test_gov=${15}
local -r no_price_currency=${16}

addKey "test-user-1" "$accounts_dir"
addKey "test-user-2" "$accounts_dir"

local -r user_1_priv_key=$(exportKey "$main_accounts_key" "$accounts_dir")
local -r user_2_priv_key=$(exportKey "test-user-1" "$accounts_dir")
local -r user_3_priv_key=$(exportKey "test-user-2" "$accounts_dir")
local -r contracts_owner=$(exportKey "$contracts_owner_key" "$accounts_dir")
local -r validator_1_address=$(getValidatorAddress "0" "$accounts_dir" "$node_url")
local -r validator_2_address=$(getValidatorAddress "1" "$accounts_dir" "$node_url")

# Get contracts addresses

local -r treasury_address=$(jq .contracts_info[0].treasury.instance "$contracts_info_path"/contracts-info.json | tr -d '"')
local -r lpp_address=$(jq .contracts_info[1].lpp.instance "$contracts_info_path"/contracts-info.json | tr -d '"')
local -r timealarms_address=$(jq .contracts_info[2].timealarms.instance "$contracts_info_path"/contracts-info.json | tr -d '"')
local -r oracle_address=$(jq .contracts_info[3].oracle.instance "$contracts_info_path"/contracts-info.json | tr -d '"')
local -r profit_address=$(jq .contracts_info[4].profit.instance "$contracts_info_path"/contracts-info.json | tr -d '"')
local -r leaser_address=$(jq .contracts_info[5].leaser.instance "$contracts_info_path"/contracts-info.json | tr -d '"')
local -r dispatcher_address=$(jq .contracts_info[6].rewards_dispatcher.instance "$contracts_info_path"/contracts-info.json | tr -d '"')

# Save the results

DOT_ENV=$(cat <<-EOF
NODE_URL=${node_url}
ENV=${node_env}
LPP_BASE_CURRENCY=${lpp_base_currency}
NO_PRICE_CURRENCY=${no_price_currency}

USER_1_PRIV_KEY=${user_1_priv_key}
USER_2_PRIV_KEY=${user_2_priv_key}
USER_3_PRIV_KEY=${user_3_priv_key}
CONTRACTS_OWNER_KEY=${contracts_owner}
VALIDATOR_1_ADDRESS=${validator_1_address}
VALIDATOR_2_ADDRESS=${validator_2_address}

TIMEALARMS_ADDRESS=${timealarms_address}
ORACLE_ADDRESS=${oracle_address}
LEASER_ADDRESS=${leaser_address}
LPP_ADDRESS=${lpp_address}
TREASURY_ADDRESS=${treasury_address}
DISPATCHER_ADDRESS=${dispatcher_address}
PROFIT_ADDRESS=${profit_address}

TEST_TRANSFER=${test_transfers}
TEST_ORACLE=${test_oracle}
TEST_STAKING=${test_staking}
TEST_BORROWER=${test_borrower}
TEST_LENDER=${test_lender}
TEST_TREASURY=${test_treasury}
TEST_VESTING=${test_vesting}
TEST_GOV=${test_gov}
EOF
  )
   echo "$DOT_ENV" > "$HOME_DIR/.env"
}