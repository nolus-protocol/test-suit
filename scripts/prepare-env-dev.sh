#!/bin/bash
set -euxo pipefail

_downloadArtifact() {
  local -r name="$1"
  local -r version="$2"
  local response

  rm -rf "$name"

  response=$(curl -L --output "$name" -w '%{http_code}' "$GITHUB_NOLUS_CORE_RELEASES/download/$version/$name")
  if [[ $response -ne 200 ]]; then
    echo "Error: failed to retrieve artifact $name, version $version. Are you sure that the artifact and the tag both exist?"
    exit 1
  fi
}

HOME_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)

GITHUB_NOLUS_CORE_RELEASES="https://github.com/Nolus-Protocol/nolus-core/releases"
NOLUS_BUILD_BINARY_ARTIFACT="nolus.tar.gz"

NOLUS_DEV_NET="https://vitosha-rpc.nolus.network"
NOLUS_CORE_TAG=""
TEST_WALLET_MNEMONIC=""

PROTOCOL=""
ACTIVE_LEASE_ADDRESS=""
NO_PRICE_CURRENCY_TICKER=""
ORACLE_CODE_ID_DIFFERENT_PROTOCOL=""

TEST_TRANSFER="true"
TEST_ORACLE="true"
TEST_STAKING="true"
TEST_BORROWER="true"
TEST_LENDER="true"
TEST_TREASURY="true"
TEST_VESTING="true"
TEST_GOV="true"
TEST_ADMIN="true"
TEST_PROFIT="true"
TEST_TIMEALARMS="true"
TEST_RESERVE="true"

ADMIN_CONTRACT_ADDRESS="nolus17p9rzwnnfxcjp32un9ug7yhhzgtkhvl9jfksztgw5uh69wac2pgsmc5xhq"

ENV_FILE=".env"

while [[ $# -gt 0 ]]; do
  key="$1"

  case $key in

  -h | --help)
    printf \
    "Usage: %s
    [--nolus-dev-net <nolus_dev_url>]
    [--nolus-core-version-tag <nolus_core_preferred_tag>]
    [--test-wallet-mnemonic <mnemonic_phrase>]
    [--protocol <protocol_name_to_test>]
    [--admin-contract-address <admin_contract_address>]
    [--active-lease-address <active_lease_address>]
    [--oracle-code-id-different-protocol <oracle_code_id_different_protocol>]
    [--test-transfer-flag <test_transfer_true_or_false>]
    [--test-oracle-flag <test_oracle_true_or_false>]
    [--test-staking-flag <test_staking_true_or_false>]
    [--test-borrower-flag <test_borrower_true_or_false>]
    [--test-lender-flag <test_lender_true_or_false>]
    [--test-treasury-flag <test_treasury_true_or_false>]
    [--test-vesting-flag <test_vesting_true_or_false>]
    [--test-gov-flag <test_gov_true_or_false>]
    [--test-admin-flag <test_admin_true_or_false>]
    [--test-profit-flag <test_profit_true_or_false>]
    [--test-timealarms-flag <test_timealarms_true_or_false>]
    [--no-price-currency-ticker <no_price_currency_ticker>]
    [--test-reserve-flag <test_reserve_true_or_false>]
    [--env-file <env_file_name>]" \
    "$0"
    exit 0
    ;;

  --nolus-dev-net)
    NOLUS_DEV_NET="$2"
    shift 2
    ;;

  --nolus-core-version-tag)
    NOLUS_CORE_TAG="$2"
    shift 2
    ;;

  --test-wallet-mnemonic)
    TEST_WALLET_MNEMONIC="$2"
    shift 2
    ;;

  --protocol)
    PROTOCOL="$2"
    shift 2
    ;;

  --admin-contract-address)
    ADMIN_CONTRACT_ADDRESS="$2"
    shift 2
    ;;

  --active-lease-address)
    ACTIVE_LEASE_ADDRESS="$2"
    shift 2
    ;;

  --oracle-code-id-different-protocol)
    ORACLE_CODE_ID_DIFFERENT_PROTOCOL="$2"
    shift 2
    ;;

  --no-price-currency-ticker)
    NO_PRICE_CURRENCY_TICKER="$2"
    shift 2
    ;;

  --test-transfer-flag)
    TEST_TRANSFER="$2"
    shift 2
    ;;

  --test-oracle-flag)
    TEST_ORACLE="$2"
    shift 2
    ;;

  --test-staking-flag)
    TEST_STAKING="$2"
    shift 2
    ;;

  --test-borrower-flag)
    TEST_BORROWER="$2"
    shift 2
    ;;

  --test-lender-flag)
    TEST_LENDER="$2"
    shift 2
    ;;

  --test-treasury-flag)
    TEST_TREASURY="$2"
    shift 2
    ;;

  --test-vesting-flag)
    TEST_VESTING="$2"
    shift 2
    ;;

  --test-gov-flag)
    TEST_GOV="$2"
    shift 2
    ;;

  --test-admin-flag)
    TEST_ADMIN="$2"
    shift 2
    ;;

  --test-profit-flag)
    TEST_PROFIT="$2"
    shift 2
    ;;

  --test-timealarms-flag)
    TEST_TIMEALARMS="$2"
    shift 2
    ;;

  --test-reserve-flag)
    TEST_RESERVE="$2"
    shift 2
    ;;

  --output-file)
    ENV_FILE="$2"
    shift 2
    ;;
  *)
    echo "unknown option '$key'"
    exit 1
    ;;

  esac
done

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR"/common/verify.sh

verify_mandatory "$TEST_WALLET_MNEMONIC" "test wallet mnemonic"
verify_mandatory "$PROTOCOL" "protocol name"
verify_mandatory "$ORACLE_CODE_ID_DIFFERENT_PROTOCOL" "oracle code id different protocol"

if [[ -z ${NOLUS_CORE_TAG} ]]; then
    NOLUS_CORE_TAG=$(curl -L -s -H 'Accept: application/json' "$GITHUB_NOLUS_CORE_RELEASES/latest" | jq -r '.tag_name')
fi

_downloadArtifact "$NOLUS_BUILD_BINARY_ARTIFACT" "$NOLUS_CORE_TAG"
tar -xvf "$NOLUS_BUILD_BINARY_ARTIFACT"

export PATH
PATH=$HOME_DIR:$PATH
rm -rf "$HOME_DIR/accounts"
mkdir "$HOME_DIR/accounts"
ACCOUNTS_DIR="$HOME_DIR/accounts"

source "$SCRIPT_DIR"/common/cmd.sh
TEST_ACCOUNT_KEY="test-main-account"
echo "$TEST_WALLET_MNEMONIC" | run_cmd "$ACCOUNTS_DIR"  keys add "$TEST_ACCOUNT_KEY" --recover --keyring-backend "test"

source "$SCRIPT_DIR"/common/prepare-env.sh
prepareEnv "$NOLUS_DEV_NET" "dev" "$ACCOUNTS_DIR" "$TEST_ACCOUNT_KEY" "" "$PROTOCOL" \
"$ADMIN_CONTRACT_ADDRESS" "$NO_PRICE_CURRENCY_TICKER" "" "" "$ACTIVE_LEASE_ADDRESS" "$ORACLE_CODE_ID_DIFFERENT_PROTOCOL" "" "$TEST_TRANSFER" "$TEST_ORACLE" "$TEST_STAKING" \
"$TEST_BORROWER" "$TEST_LENDER" "$TEST_TREASURY" "$TEST_VESTING" "$TEST_GOV" "$TEST_ADMIN" \
"$TEST_PROFIT" "$TEST_TIMEALARMS" "$TEST_RESERVE" "$ENV_FILE"