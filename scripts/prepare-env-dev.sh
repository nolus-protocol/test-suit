#!/bin/bash
set -euxo pipefail

ARTIFACT_BIN="nolus.tar.gz"
NOLUS_DEV_NET="https://net-dev.nolus.io:26612"
GITLAB_API="https://gitlab-nomo.credissimo.net/api/v4"
HOME_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)
STABLE_DENOM='ibc/fj29fj0fj'
COSMZONE_PROJECT_ID="3"
SETUP_DEV_NETWORK_ARTIFACT="setup-dev-network"
NOLUS_BUILD_BINARY_ARTIFACT="build-binary"
FAUCET_KEY="faucet"
WASM_ADMIN_KEY="wasm_admin"

TAG=""
MNEMONIC_FAUCET=""
MNEMONIC_ADMIN=""
TOKEN_TYPE=""
TOKEN_VALUE=""
TEST_TRANSFER=""
TEST_ORACLE=""
TEST_STAKING=""
TEST_BORROWER=""
TEST_LENDER=""
TEST_TREASURY=""
TEST_VESTING=""
TEST_GOV=""


while [[ $# -gt 0 ]]; do
  key="$1"

  case $key in

  -h | --help)
    printf \
    "Usage: %s
    [--tag <cosmzone_preferred_tag>]
    [--mnemonic-faucet <mnemonic_phrase>]
    [--mnemonic-wasm-admin <mnemonic_phrase>]
    [--token-type <token_type>]
    [--token-value <token_value>]" \
     "$0"
    exit 0
    ;;

  --tag)
    TAG="$2"
    shift
    shift
    ;;

  --mnemonic-faucet)
    MNEMONIC_FAUCET="$2"
    shift
    shift
    ;;

  --mnemonic-wasm-admin)
    MNEMONIC_ADMIN="$2"
    shift
    shift
    ;;

  --token-type)
    TOKEN_TYPE="$2"
    shift
    shift
    ;;

  --token-value)
    TOKEN_VALUE="$2"
    shift
    shift
    ;;

  --test-transfer)
    TEST_TRANSFER="$2"
    shift
    shift
    ;;

  --test-oracle)
    TEST_ORACLE="$2"
    shift
    shift
    ;;

  --test-staking)
    TEST_STAKING="$2"
    shift
    shift
    ;;

  --test-borrower)
    TEST_BORROWER="$2"
    shift
    shift
    ;;

  --test-lender)
    TEST_LENDER="$2"
    shift
    shift
    ;;

  --test-treasury)
    TEST_TREASURY="$2"
    shift
    shift
    ;;

  --test-vesting)
    TEST_VESTING="$2"
    shift
    shift
    ;;

  --test-gov)
    TEST_GOV="$2"
    shift
    shift
    ;;
esac
done

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR"/common/verify.sh

verify_mandatory "$MNEMONIC_FAUCET" "faucet mnemonic phrase"
verify_mandatory "$MNEMONIC_ADMIN" "wasm admin mnemonic phrase"
verify_mandatory "$TOKEN_TYPE" "gitlab auth token type"
verify_mandatory "$TOKEN_VALUE" "gitlab auth token value"
verify_mandatory "$TEST_TRANSFER" "test transfer flag"
verify_mandatory "$TEST_ORACLE" "test oracle flag"
verify_mandatory "$TEST_STAKING" "test staking flag"
verify_mandatory "$TEST_BORROWER" "test borrower flag"
verify_mandatory "$TEST_LENDER" "test lender flag"
verify_mandatory "$TEST_TREASURY" "test treasury flag"
verify_mandatory "$TEST_VESTING" "test vesting flag"
verify_mandatory "$TEST_GOV" "test gov flag"

_downloadArtifact() {
  local -r name="$1"
  local -r version="$2"
  local -r project_id="$3"
  local response

  rm -rf "$name.zip"

  response=$(curl --output "$name".zip -w '%{http_code}' --header "$TOKEN_TYPE: $TOKEN_VALUE" "$GITLAB_API/projects/$project_id/jobs/artifacts/$version/download?job=$name")
  if [[ $response -ne 200 ]]; then
    echo "Error: failed to retrieve artifact $name, version $version from the project with ID $project_id. Are you sure the artifact and tag exist?"
    exit 1
  fi
   echo 'A' | unzip "$name".zip
}

# Get dev-network information

  if [[ -z ${TAG} ]]; then
    COSMZONE_LATEST_VERSION=$(curl --silent "$NOLUS_DEV_NET/abci_info" | jq '.result.response.version' | tr -d '"')
  else
    COSMZONE_LATEST_VERSION="$TAG"
  fi

_downloadArtifact "$SETUP_DEV_NETWORK_ARTIFACT" "v$COSMZONE_LATEST_VERSION" "$COSMZONE_PROJECT_ID"
_downloadArtifact "$NOLUS_BUILD_BINARY_ARTIFACT" "v$COSMZONE_LATEST_VERSION" "$COSMZONE_PROJECT_ID"

tar -xvf $ARTIFACT_BIN
export PATH
PATH=$HOME_DIR:$PATH
rm -r "$HOME_DIR/accounts"
ACCOUNTS_DIR="$HOME_DIR/accounts"

# contracts-info.json will be extracted here
CONTRACTS_INFO_PATH="$HOME_DIR"

# Recover wasm_admin and faucet
source "$SCRIPT_DIR"/common/cmd.sh
echo "$MNEMONIC_FAUCET" | run_cmd "$ACCOUNTS_DIR" keys add "$FAUCET_KEY" --recover --keyring-backend "test"
echo "$MNEMONIC_ADMIN" | run_cmd "$ACCOUNTS_DIR" keys add "$WASM_ADMIN_KEY" --recover --keyring-backend "test"

# Prepare .env
source "$SCRIPT_DIR"/common/prepare-env.sh
prepareEnv "$CONTRACTS_INFO_PATH" "$STABLE_DENOM" "$NOLUS_DEV_NET" "dev" "$ACCOUNTS_DIR" "$FAUCET_KEY" \
"$WASM_ADMIN_KEY" "$TEST_TRANSFER" "$TEST_ORACLE" "$TEST_STAKING" "$TEST_BORROWER" \
"$TEST_LENDER" "$TEST_TREASURY" "$TEST_VESTING" "$TEST_GOV"
