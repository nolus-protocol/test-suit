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

_bondedValidatorAddresses() {
  local -r accounts_dir="$1"
  local -r nolus_net="$2"

  run_cmd "$accounts_dir" query staking validators --output json --node "$nolus_net" |
    jq -r '[.validators[]
             | select(.status == 3 or .status == "BOND_STATUS_BONDED")
             | .operator_address]
           | sort | .[]'
}

_verifyResolved() {
  local -r value="$1"
  local -r description="$2"

  if [ -z "$value" ] || [ "$value" = "null" ]; then
    echo >&2 "Failed to resolve $description (got '${value}')."
    echo >&2 "If several fields are empty, the client is probably older than the node:"
    echo >&2 "  re-run the prep so it fetches the current nolus-core release."
    exit 1
  fi
}

prepareEnv() {
local -r node_url="$1"
local -r accounts_dir="$2"
local -r main_account_key="$3"
# Positional slot kept so the caller's argument list does not shift; nothing reads a
# feeder key any more, and prepare-env.sh has always passed "" for it.
local -r feeder_key="$4"
local -r protocol="$5"
local -r admin_contract_address="$6"
local -r no_price_currency_ticker="$7"
local -r no_price_lease_currency_ticker="$8"
local -r no_price_lease_currency_denom="$9"
local -r active_lease_address="${10}"
local -r oracle_code_id_different_protocol="${11}"
local -r dex_admin_key="${12}"
local -r lease_admin_key="${13}"
local -r test_transfers="${14}"
local -r test_oracle="${15}"
local -r test_staking="${16}"
local -r test_borrower="${17}"
local -r test_lender="${18}"
local -r test_treasury="${19}"
local -r test_vesting="${20}"
local -r test_admin="${21}"
local -r test_profit="${22}"
local -r test_timealarms="${23}"
local -r test_reserve="${24}"
local env_file="${25}"

local -r flags=(--output json --node "$node_url")

_addKey "test-user-1" "$accounts_dir"
_addKey "test-user-2" "$accounts_dir"

local -r user_1_priv_key=$(_exportKey "$main_account_key" "$accounts_dir")
local -r user_2_priv_key=$(_exportKey "test-user-1" "$accounts_dir")
local -r user_3_priv_key=$(_exportKey "test-user-2" "$accounts_dir")
_verifyResolved "$user_1_priv_key" "the private key of '$main_account_key'"
_verifyResolved "$user_2_priv_key" "the private key of 'test-user-1'"
_verifyResolved "$user_3_priv_key" "the private key of 'test-user-2'"

local -r bonded_validators=$(_bondedValidatorAddresses "$accounts_dir" "$node_url")
local -r bonded_count=$(printf '%s' "$bonded_validators" | grep -c . || true)

if [ "$bonded_count" -lt 1 ]; then
  echo >&2 "No bonded validator found on $node_url. Staking and fee assertions cannot be prepared."
  exit 1
fi

local -r validator_1_address=$(printf '%s\n' "$bonded_validators" | sed -n '1p')
local validator_2_address=""

if [ "$bonded_count" -ge 2 ]; then
  validator_2_address=$(printf '%s\n' "$bonded_validators" | sed -n '2p')
else
  echo >&2 "Warning: only 1 bonded validator on $node_url. VALIDATOR_2_ADDRESS is left empty;"
  echo >&2 "  staking redelegation and any two-validator case cannot run against this network."
fi

local dex_admin_priv_key=""
if [ -n "$dex_admin_key" ] ; then
  dex_admin_priv_key=$(_exportKey "$dex_admin_key" "$accounts_dir")
fi

local lease_admin_priv_key=""
if [ -n "$lease_admin_key" ] ; then
  lease_admin_priv_key=$(_exportKey "$lease_admin_key" "$accounts_dir")
fi

local -r chain_id=$(run_cmd "$accounts_dir" status "${flags[@]}" | jq -r '.node_info.network // .NodeInfo.network')
_verifyResolved "$chain_id" "the chain id of $node_url"

local -r gov_min_deposit_native=$(run_cmd "$accounts_dir" q gov params "${flags[@]}" | jq -r '.params.min_deposit[0].amount')
_verifyResolved "$gov_min_deposit_native" "the governance minimum deposit"

local -r tax_params=$(run_cmd "$accounts_dir" q tax params "${flags[@]}")
local -r fee_rate=$(echo "$tax_params" | jq '.params.fee_rate')
_verifyResolved "$fee_rate" "the tax fee rate"
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
_verifyResolved "$accepted_denoms" "the accepted fee denoms"

if [ "$accepted_denoms" = "[]" ]; then
  echo >&2 "Resolved no accepted fee denoms (ACCEPTED_DENOMS would be '[]')."
  echo >&2 "  Fee assertions read this and would silently compute NaN."
  exit 1
fi

# Get platform contracts
local -r platform_info=$(run_cmd "$accounts_dir" q wasm contract-state smart "$admin_contract_address" '{"platform":{}}' "${flags[@]}" | jq '.data')
local -r timealarms_address=$(echo "$platform_info" | jq -r '.timealarms')
local -r treasury_address=$(echo "$platform_info" | jq -r '.treasury')
_verifyResolved "$timealarms_address" "the timealarms address"
_verifyResolved "$treasury_address" "the treasury address"

# Get Protocol contracts

local -r protocol_query=$(jq -nc --arg p "$protocol" '{protocol: $p}')
local -r protocol_info=$(run_cmd "$accounts_dir" q wasm contract-state smart "$admin_contract_address" "$protocol_query" "${flags[@]}")

local -r dex_network=$(echo "$protocol_info" | jq -r '.data.network')
local -r protocol_contracts=$(echo "$protocol_info" | jq -r '.data.contracts')
local -r lpp_address=$(echo "$protocol_contracts" | jq -r '.lpp')
local -r leaser_address=$(echo "$protocol_contracts" | jq -r '.leaser')
local -r oracle_address=$(echo "$protocol_contracts" | jq -r '.oracle')
local -r profit_address=$(echo "$protocol_contracts" | jq -r '.profit')
local -r reserve_address=$(echo "$protocol_contracts" | jq -r '.reserve')
_verifyResolved "$dex_network" "the dex network of protocol '$protocol'"
_verifyResolved "$lpp_address" "the lpp address of protocol '$protocol'"
_verifyResolved "$leaser_address" "the leaser address of protocol '$protocol'"
_verifyResolved "$oracle_address" "the oracle address of protocol '$protocol'"
_verifyResolved "$profit_address" "the profit address of protocol '$protocol'"
_verifyResolved "$reserve_address" "the reserve address of protocol '$protocol'"

local -r protocol_currency=$(run_cmd "$accounts_dir" q wasm contract-state smart "$lpp_address" '{"lpn":[]}' "${flags[@]}" | jq -r '.data')
_verifyResolved "$protocol_currency" "the LPN of protocol '$protocol'"

local -r lender_deposit_capacity=$(run_cmd "$accounts_dir" q wasm contract-state smart "$lpp_address" '{"deposit_capacity":[]}' "${flags[@]}"  | jq -r '.data.amount')

local -r gov_module_address=$(run_cmd "$accounts_dir" q auth module-account gov "${flags[@]}" | jq -r '.account.value.address')
_verifyResolved "$gov_module_address" "the gov module address"

local -r leaser_config=$(run_cmd "$accounts_dir" q wasm contract-state smart "$leaser_address" '{"config":{}}' "${flags[@]}")
local -r lease_code_id=$(echo "$leaser_config" | jq -r '.data.config.lease_code')
_verifyResolved "$lease_code_id" "the lease code id"

local ics20_channel_local=""
local remote_lease_controller=""
ics20_channel_local=$(echo "$leaser_config" | jq -r '.data.config.ics20_channel_local') || ics20_channel_local=""
remote_lease_controller=$(echo "$leaser_config" | jq -r '.data.config.remote_lease_controller') || remote_lease_controller=""
_verifyResolved "$ics20_channel_local" "the local ICS-20 channel"
_verifyResolved "$remote_lease_controller" "the remote lease controller address"

local controller_channel=""
local ics20_channel_remote=""
local lease_channel=""
controller_channel=$(run_cmd "$accounts_dir" q wasm contract-state smart "$remote_lease_controller" '{"channel":[]}' "${flags[@]}") || controller_channel=""
ics20_channel_remote=$(echo "$controller_channel" | jq -r '.data.channel.established.ics20_channel_remote') || ics20_channel_remote=""
lease_channel=$(echo "$controller_channel" | jq -r '.data.channel.established.local_channel_id') || lease_channel=""
_verifyResolved "$lease_channel" "the lease channel"
_verifyResolved "$ics20_channel_remote" "the remote ICS-20 channel"


local -r solana_channel_ordinal="${ics20_channel_remote#channel-}"
if [[ ! "$solana_channel_ordinal" =~ ^[0-9]+$ ]]; then
  echo >&2 "The remote ICS-20 channel is '$ics20_channel_remote', which is not 'channel-<N>'."
  echo >&2 "  SOLANA_CHANNEL_ORDINAL would be '$solana_channel_ordinal' - and that value is what"
  echo >&2 "  \`solray-admin --channel-ordinal\` is given by hand, so it is not allowed to guess."
  exit 1
fi

local -r oracle_code_id=$(run_cmd "$accounts_dir" q wasm contract "$oracle_address" "${flags[@]}" | jq -r '.contract_info.code_id')
_verifyResolved "$oracle_code_id" "the oracle code id"

local test_interest=false;
if [ -n "$active_lease_address" ] && [ "$test_borrower" != "false" ] ; then
  test_interest=true
fi

[ ! -f "$HOME_DIR/$env_file" ] && touch "$HOME_DIR/$env_file"

DOT_ENV=$(cat <<-EOF
NODE_URL=${node_url}
CHAIN_ID=${chain_id}

USER_1_PRIV_KEY=${user_1_priv_key}
USER_2_PRIV_KEY=${user_2_priv_key}
USER_3_PRIV_KEY=${user_3_priv_key}
DEX_ADMIN_PRIV_KEY=${dex_admin_priv_key}
LEASE_ADMIN_PRIV_KEY=${lease_admin_priv_key}

VALIDATOR_1_ADDRESS=${validator_1_address}
VALIDATOR_2_ADDRESS=${validator_2_address}
GOV_MODULE_ADDRESS=${gov_module_address}

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
ORACLE_CODE_ID=${oracle_code_id}

REMOTE_LEASE_CONTROLLER=${remote_lease_controller}
ICS20_CHANNEL_LOCAL=${ics20_channel_local}
LEASE_CHANNEL=${lease_channel}
SOLANA_CHANNEL_ORDINAL=${solana_channel_ordinal}

LENDER_DEPOSIT_CAPACITY=${lender_deposit_capacity}

ACCEPTED_DENOMS=${accepted_denoms}

TEST_TRANSFER=${test_transfers}
TEST_ORACLE=${test_oracle}
TEST_STAKING=${test_staking}
TEST_BORROWER=${test_borrower}
TEST_LENDER=${test_lender}
TEST_TREASURY=${test_treasury}
TEST_VESTING=${test_vesting}
TEST_ADMIN=${test_admin}
TEST_BORROWER_INTEREST=${test_interest}
TEST_PROFIT=${test_profit}
TEST_TIMEALARMS=${test_timealarms}
TEST_RESERVE=${test_reserve}
EOF
  )
   echo "$DOT_ENV" > "$HOME_DIR/$env_file"
}
