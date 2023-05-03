#!/bin/bash
set -euxo pipefail

HOME_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)

GITHUB_NOLUS_CORE_RELEASES="https://github.com/Nolus-Protocol/nolus-core/releases"
NOLUS_BUILD_BINARY_ARTIFACT="nolus.tar.gz"

NOLUS_DEV_NET="https://net-dev.nolus.io:26612"
FAUCET_KEY="faucet"
LPP_BASE_CURRENCY="USDC"

NOLUS_CORE_TAG=""
MNEMONIC_FAUCET=""
TEST_TRANSFER="true"
TEST_ORACLE="true"
TEST_STAKING="true"
TEST_BORROWER="true"
TEST_LENDER="true"
TEST_TREASURY="true"
TEST_VESTING="true"
TEST_GOV="true"


while [[ $# -gt 0 ]]; do
  key="$1"

  case $key in

  -h | --help)
    printf \
    "Usage: %s
    [--nolus-dev-net <nolus_dev_url>]
    [--lpp-base-currency <lpp_base_currency_ticker>]
    [--nolus-core-version-tag <nolus_core_preferred_tag>]
    [--mnemonic-faucet <mnemonic_phrase>]
    [--test-transfer-flag <test_transfer_true_or_false>]
    [--test-oracle-flag <test_oracle_true_or_false>]
    [--test-staking-flag <test_staking_true_or_false>]
    [--test-borrower-flag <test_borrower_true_or_false>]
    [--test-lender-flag <test_lender_true_or_false>]
    [--test-treasury-flag <test_treasury_true_or_false>]
    [--test-vesting-flag <test_vesting_true_or_false>]
    [--test-gov-flag <test_gov_true_or_false>] "\
    "$0"
    exit 0
    ;;

  --nolus-dev-net)
    NOLUS_DEV_NET="$2"
    shift
    shift
    ;;

  --lpp-base-currency)
    LPP_BASE_CURRENCY="$2"
    shift
    shift
    ;;

  --nolus-core-version-tag)
    NOLUS_CORE_TAG="$2"
    shift
    shift
    ;;

  --mnemonic-faucet)
    MNEMONIC_FAUCET="$2"
    shift
    shift
    ;;

  --test-transfer-flag)
    TEST_TRANSFER="$2"
    shift
    shift
    ;;

  --test-oracle-flag)
    TEST_ORACLE="$2"
    shift
    shift
    ;;

  --test-staking-flag)
    TEST_STAKING="$2"
    shift
    shift
    ;;

  --test-borrower-flag)
    TEST_BORROWER="$2"
    shift
    shift
    ;;

  --test-lender-flag)
    TEST_LENDER="$2"
    shift
    shift
    ;;

  --test-treasury-flag)
    TEST_TREASURY="$2"
    shift
    shift
    ;;

  --test-vesting-flag)
    TEST_VESTING="$2"
    shift
    shift
    ;;

  --test-gov-flag)
    TEST_GOV="$2"
    shift
    shift
    ;;

  *)
    echo "unknown option '$key'"
    exit 1
    ;;

  esac
done

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR"/common/verify.sh

verify_mandatory "$MNEMONIC_FAUCET" "faucet mnemonic"

_downloadArtifact() {
  local -r name="$1"
  local -r version="$2"
  local response

  rm -rf "$name"

  response=$(curl -L --output "$name" -w '%{http_code}' "$GITHUB_NOLUS_CORE_RELEASES/download/$version/$name")
  if [[ $response -ne 200 ]]; then
    echo "Error: failed to retrieve artifact $name, version $version. Are you sure the artifact and tag exist?"
    exit 1
  fi
}

# Get dev-network information

  if [[ -z ${NOLUS_CORE_TAG} ]]; then
    NOLUS_CORE_TAG=$(curl -L -s -H 'Accept: application/json' "$GITHUB_NOLUS_CORE_RELEASES/latest" | jq '.tag_name' | tr -d '"')
  fi

_downloadArtifact "$NOLUS_BUILD_BINARY_ARTIFACT" "$NOLUS_CORE_TAG"
tar -xvf "$NOLUS_BUILD_BINARY_ARTIFACT"

# Home dir
export PATH
PATH=$HOME_DIR:$PATH
rm -rf "$HOME_DIR/accounts"
mkdir "$HOME_DIR/accounts"
ACCOUNTS_DIR="$HOME_DIR/accounts"

source "$SCRIPT_DIR"/common/cmd.sh
echo "$MNEMONIC_FAUCET" | run_cmd "$ACCOUNTS_DIR" keys add "$FAUCET_KEY" --recover --keyring-backend "test"

# Prepare .env

source "$SCRIPT_DIR"/common/prepare-env.sh
prepareEnv "$LPP_BASE_CURRENCY" "$NOLUS_DEV_NET" "dev" "$ACCOUNTS_DIR" "$FAUCET_KEY" \
"" "$TEST_TRANSFER" "$TEST_ORACLE" "$TEST_STAKING" "$TEST_BORROWER" \
"$TEST_LENDER" "$TEST_TREASURY" "$TEST_VESTING" "$TEST_GOV" ""
