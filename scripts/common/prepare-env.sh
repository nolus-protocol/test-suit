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
local -r lpp_base_currency=$1
local -r node_url=$2
local -r node_env=$3
local -r accounts_dir=$4
local -r main_accounts_key=$5
local -r contracts_owner_key=$6
local -r test_transfers=$7
local -r test_oracle=$8
local -r test_staking=$9
local -r test_borrower=${10}
local -r test_lender=${11}
local -r test_treasury=${12}
local -r test_vesting=${13}
local -r test_gov=${14}
local -r no_price_currency=${15}

addKey "test-user-1" "$accounts_dir"
addKey "test-user-2" "$accounts_dir"

local -r user_1_priv_key=$(exportKey "$main_accounts_key" "$accounts_dir")
local -r user_2_priv_key=$(exportKey "test-user-1" "$accounts_dir")
local -r user_3_priv_key=$(exportKey "test-user-2" "$accounts_dir")
local -r contracts_owner=$(exportKey "$contracts_owner_key" "$accounts_dir")
local -r validator_1_address=$(getValidatorAddress "0" "$accounts_dir" "$node_url")
local -r validator_2_address=$(getValidatorAddress "1" "$accounts_dir" "$node_url")

# Get contracts addresses

curl https://raw.githubusercontent.com/Nolus-Protocol/nolus-money-market/main/scripts/deploy-contracts-genesis.sh >> deploy-contracts-genesis.sh
source $HOME_DIR/deploy-contracts-genesis.sh

local -r treasury_address=$(treasury_instance_addr)
local -r lpp_address=$(lpp_instance_addr)
local -r timealarms_address=$(timealarms_instance_addr)
local -r oracle_address=$(oracle_instance_addr)
local -r profit_address=$(profit_instance_addr)
local -r leaser_address=$(leaser_instance_addr)
local -r dispatcher_address=$(rewards_dispatcher_instance_addr)

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