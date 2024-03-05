#!/bin/bash
set -euxo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR"/cmd.sh

HOME_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && cd .. && pwd)

_addKey() {
  local -r name="$1"
  local -r accounts_dir="$2"

  echo 'y' | run_cmd "$accounts_dir" keys add "$name" --keyring-backend "test"
}

_exportKey() {
  local -r name="$1"
  local -r accounts_dir="$2"

  echo 'y' | run_cmd "$accounts_dir" keys export "$name" --unsafe --unarmored-hex --keyring-backend "test"
}

_getValidatorAddress() {
  local -r index="$1"
  local -r accounts_dir="$2"
  local -r nolus_net="$3"

  run_cmd "$accounts_dir" query staking validators --output json --node "$nolus_net"| jq -r '.validators['$index'].operator_address'
}

prepareEnv() {
local -r node_url="$1"
local -r node_env="$2"
local -r accounts_dir="$3"
local -r main_accounts_key="$4"
local -r feeder_key="$5"
local -r protocol="$6"
local -r no_price_currency="$7"
local -r active_lease_address="$8"
local -r test_transfers="$9"
local -r test_oracle="${10}"
local -r test_staking="${11}"
local -r test_borrower="${12}"
local -r test_lender="${13}"
local -r test_treasury="${14}"
local -r test_vesting="${15}"
local -r test_gov="${16}"
local -r test_admin="${17}"

_addKey "test-user-1" "$accounts_dir"
_addKey "test-user-2" "$accounts_dir"

local -r user_1_priv_key=$(_exportKey "$main_accounts_key" "$accounts_dir")
local -r user_2_priv_key=$(_exportKey "test-user-1" "$accounts_dir")
local -r user_3_priv_key=$(_exportKey "test-user-2" "$accounts_dir")
local -r validator_1_address=$(_getValidatorAddress "0" "$accounts_dir" "$node_url")
local -r validator_2_address=$(_getValidatorAddress "1" "$accounts_dir" "$node_url")

local feeder_priv_key=""
if [ -n "$feeder_key" ] ; then
  feeder_priv_key=$(_exportKey "$feeder_key" "$accounts_dir")
fi

# Get platform contracts
local -r admin_contract_address='nolus1ghd753shjuwexxywmgs4xz7x2q732vcnkm6h2pyv9s6ah3hylvrq8welhp'

local -r platform_info=$(run_cmd "$accounts_dir" q wasm contract-state smart "$admin_contract_address" '{"platform":{}}' --output json --node "$node_url" | jq '.data')
local -r timealarms_address=$(echo "$platform_info" | jq -r '.timealarms')
local -r treasury_address=$(echo "$platform_info" | jq -r '.treasury')
local -r rewards_dispatcher_address=$(echo "$platform_info" | jq -r '.rewards_dispatcher')

# Get Protocol contracts

local -r protocol_info=$(run_cmd "$accounts_dir" q wasm contract-state smart "$admin_contract_address" '{"protocol":"'"$protocol"'"}' --output json --node "$node_url")
local -r dex_network=$(echo "$protocol_info" | jq -r '.data.network')
local -r protocol_contracts=$(echo "$protocol_info" | jq -r '.data.contracts')
local -r lpp_address=$(echo "$protocol_contracts" | jq -r '.lpp')
local -r leaser_address=$(echo "$protocol_contracts" | jq -r '.leaser')
local -r oracle_address=$(echo "$protocol_contracts" | jq -r '.oracle')
local -r profit_address=$(echo "$protocol_contracts" | jq -r '.profit')

local -r protocol_currency=$(run_cmd "$accounts_dir" q wasm contract-state smart "$lpp_address" '{"config":[]}' --output json --node "$node_url" | jq -r '.data.lpn_ticker')

local -r lender_deposit_capacity=$(run_cmd "$accounts_dir" q wasm contract-state smart "$lpp_address" '{"deposit_capacity":[]}' --output json --node "$node_url"  | jq -r '.data.amount')

local -r gov_module_address=$(run_cmd "$accounts_dir" q auth module-account gov --output json --node "$node_url"  | jq -r '.account.base_account.address')

local -r leaser_config=$(run_cmd "$accounts_dir" q wasm contract-state smart "$leaser_address" '{"config":{}}' --output json --node "$node_url")
local -r lease_code_id=$(echo "$leaser_config" | jq -r '.data.config.lease_code_id')

local test_interest=false;
if [ -n "$active_lease_address" ] && [ "$test_borrower" != "false" ] ; then
  test_interest=true
fi

DOT_ENV=$(cat <<-EOF
NODE_URL=${node_url}
ENV=${node_env}

USER_1_PRIV_KEY=${user_1_priv_key}
USER_2_PRIV_KEY=${user_2_priv_key}
USER_3_PRIV_KEY=${user_3_priv_key}
FEEDER_PRIV_KEY=${feeder_priv_key}

VALIDATOR_1_ADDRESS=${validator_1_address}
VALIDATOR_2_ADDRESS=${validator_2_address}
GOV_MODULE_ADDRESS=${gov_module_address}

DEX_NETWORK=${dex_network}
LPP_BASE_CURRENCY=${protocol_currency}
NO_PRICE_CURRENCY=${no_price_currency}

ADMIN_CONTRACT_ADDRESS=${admin_contract_address}
TREASURY_ADDRESS=${treasury_address}
TIMEALARMS_ADDRESS=${timealarms_address}
DISPATCHER_ADDRESS=${rewards_dispatcher_address}
ORACLE_ADDRESS=${oracle_address}
LEASER_ADDRESS=${leaser_address}
LPP_ADDRESS=${lpp_address}
PROFIT_ADDRESS=${profit_address}
LEASE_CODE_ID=${lease_code_id}

LENDER_DEPOSIT_CAPACITY=${lender_deposit_capacity}

ACTIVE_LEASE_ADDRESS=${active_lease_address}

TEST_TRANSFER=${test_transfers}
TEST_ORACLE=${test_oracle}
TEST_STAKING=${test_staking}
TEST_BORROWER=${test_borrower}
TEST_LENDER=${test_lender}
TEST_TREASURY=${test_treasury}
TEST_VESTING=${test_vesting}
TEST_GOV=${test_gov}
TEST_ADMIN=${test_admin}
TEST_BORROWER_INTEREST=${test_interest}
EOF
  )
   echo "$DOT_ENV" > "$HOME_DIR/.env"
}