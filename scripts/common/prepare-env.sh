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
local -r main_account_key="$4"
local -r feeder_key="$5"
local -r protocol="$6"
local -r admin_contract_address="$7"
local -r no_price_currency_ticker="$8"
local -r no_price_lease_currency_ticker="$9"
local -r no_price_lease_currency_denom="${10}"
local -r active_lease_address="${11}"
local -r oracle_code_id_different_protocol="${12}"
local -r dex_admin_key="${13}"
local -r lease_admin_key="${14}"
local -r test_transfers="${15}"
local -r test_oracle="${16}"
local -r test_staking="${17}"
local -r test_borrower="${18}"
local -r test_lender="${19}"
local -r test_treasury="${20}"
local -r test_vesting="${21}"
local -r test_gov="${22}"
local -r test_admin="${23}"
local -r test_profit="${24}"
local -r test_timealarms="${25}"
local -r test_reserve="${26}"
local env_file="${27}"

local -r flags="--output json --node $node_url"

_addKey "test-user-1" "$accounts_dir"
_addKey "test-user-2" "$accounts_dir"

local -r user_1_priv_key=$(_exportKey "$main_account_key" "$accounts_dir")
local -r user_2_priv_key=$(_exportKey "test-user-1" "$accounts_dir")
local -r user_3_priv_key=$(_exportKey "test-user-2" "$accounts_dir")
local -r validator_1_address=$(_getValidatorAddress "1" "$accounts_dir" "$node_url")
local -r validator_2_address=$(_getValidatorAddress "0" "$accounts_dir" "$node_url")

local feeder_priv_key=""
if [ -n "$feeder_key" ] ; then
  feeder_priv_key=$(_exportKey "$feeder_key" "$accounts_dir")
fi

local dex_admin_priv_key=""
if [ -n "$dex_admin_key" ] ; then
  dex_admin_priv_key=$(_exportKey "$dex_admin_key" "$accounts_dir")
fi

local lease_admin_priv_key=""
if [ -n "$lease_admin_key" ] ; then
  lease_admin_priv_key=$(_exportKey "$lease_admin_key" "$accounts_dir")
fi


local -r gov_min_deposit_native=$(run_cmd "$accounts_dir" q gov params $flags | jq -r '.params.min_deposit[0].amount')

local -r tax_params=$(run_cmd "$accounts_dir" q tax params $flags)
local -r fee_rate=$(echo "$tax_params" | jq '.params.fee_rate')
local -r validator_fee_part=$((100-"$fee_rate"))
local -r accepted_denoms=$(echo "$tax_params" | jq -c '
  [
    .params.dex_fee_params[] as $profit_obj |
    $profit_obj.accepted_denoms_min_prices[] |
    {
      denom: .denom,
      minPrice: .min_price,
      profit: $profit_obj.profit_address
    }
  ]
')

# Get platform contracts
local -r platform_info=$(run_cmd "$accounts_dir" q wasm contract-state smart "$admin_contract_address" '{"platform":{}}' $flags | jq '.data')
local -r timealarms_address=$(echo "$platform_info" | jq -r '.timealarms')
local -r treasury_address=$(echo "$platform_info" | jq -r '.treasury')

# Get Protocol contracts

local -r protocol_info=$(run_cmd "$accounts_dir" q wasm contract-state smart "$admin_contract_address" '{"protocol":"'"$protocol"'"}' $flags)
local -r dex_network=$(echo "$protocol_info" | jq -r '.data.network')
local -r protocol_contracts=$(echo "$protocol_info" | jq -r '.data.contracts')
local -r lpp_address=$(echo "$protocol_contracts" | jq -r '.lpp')
local -r leaser_address=$(echo "$protocol_contracts" | jq -r '.leaser')
local -r oracle_address=$(echo "$protocol_contracts" | jq -r '.oracle')
local -r profit_address=$(echo "$protocol_contracts" | jq -r '.profit')
local -r reserve_address=$(echo "$protocol_contracts" | jq -r '.reserve')

local -r protocol_currency=$(run_cmd "$accounts_dir" q wasm contract-state smart "$lpp_address" '{"lpn":[]}' $flags | jq -r '.data')

local -r lender_deposit_capacity=$(run_cmd "$accounts_dir" q wasm contract-state smart "$lpp_address" '{"deposit_capacity":[]}' $flags  | jq -r '.data.amount')

local -r gov_module_address=$(run_cmd "$accounts_dir" q auth module-account gov $flags | jq -r '.account.value.address')

local -r leaser_config=$(run_cmd "$accounts_dir" q wasm contract-state smart "$leaser_address" '{"config":{}}' $flags)
local -r lease_code_id=$(echo "$leaser_config" | jq -r '.data.config.lease_code')

local -r lpp_code_id=$(run_cmd "$accounts_dir" q wasm contract "$lpp_address" $flags | jq -r '.contract_info.code_id')

local -r oracle_code_id=$(run_cmd "$accounts_dir" q wasm contract "$oracle_address" $flags | jq -r '.contract_info.code_id')

local test_interest=false;
if [ -n "$active_lease_address" ] && [ "$test_borrower" != "false" ] ; then
  test_interest=true
fi

[ ! -f "$HOME_DIR/$env_file" ] && touch "$HOME_DIR/$env_file"

DOT_ENV=$(cat <<-EOF
NODE_URL=${node_url}
ENV=${node_env}

USER_1_PRIV_KEY=${user_1_priv_key}
USER_2_PRIV_KEY=${user_2_priv_key}
USER_3_PRIV_KEY=${user_3_priv_key}
FEEDER_PRIV_KEY=${feeder_priv_key}
DEX_ADMIN_PRIV_KEY=${dex_admin_priv_key}
LEASE_ADMIN_PRIV_KEY=${lease_admin_priv_key}

VALIDATOR_1_ADDRESS=${validator_1_address}
VALIDATOR_2_ADDRESS=${validator_2_address}
GOV_MODULE_ADDRESS=${gov_module_address}

DEX_NETWORK=${dex_network}
PROTOCOL=${protocol}
LPP_BASE_CURRENCY=${protocol_currency}

NO_PRICE_CURRENCY_TICKER=${no_price_currency_ticker}
NO_PRICE_LEASE_CURRENCY_TICKER=${no_price_lease_currency_ticker}
NO_PRICE_LEASE_CURRENCY_DENOM=${no_price_lease_currency_denom}
ORACLE_CODE_ID_DIFFERENT_PROTOCOL=${oracle_code_id_different_protocol}

ACTIVE_LEASE_ADDRESS=${active_lease_address}

GOV_MIN_DEPOSIT_NATIVE=${gov_min_deposit_native}
VALIDATOR_FEE_PART=${validator_fee_part}

ADMIN_CONTRACT_ADDRESS=${admin_contract_address}
TREASURY_ADDRESS=${treasury_address}
TIMEALARMS_ADDRESS=${timealarms_address}
ORACLE_ADDRESS=${oracle_address}
LEASER_ADDRESS=${leaser_address}
LPP_ADDRESS=${lpp_address}
PROFIT_ADDRESS=${profit_address}
RESERVE_ADDRESS=${reserve_address}
LEASE_CODE_ID=${lease_code_id}
LPP_CODE_ID=${lpp_code_id}
ORACLE_CODE_ID=${oracle_code_id}

LENDER_DEPOSIT_CAPACITY=${lender_deposit_capacity}

ACCEPTED_DENOMS=${accepted_denoms}

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
TEST_PROFIT=${test_profit}
TEST_TIMEALARMS=${test_timealarms}
TEST_RESERVE=${test_reserve}
EOF
  )
   echo "$DOT_ENV" > "$HOME_DIR/$env_file"
}