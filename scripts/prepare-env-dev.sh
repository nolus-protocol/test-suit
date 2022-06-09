#!/bin/bash
set -euxo pipefail

ROOT_DIR=$(pwd)
ARTIFACT_BIN="nolus.tar.gz"
CONTRACTS_BIN="contracts.tar.gz"
NOLUS_DEV_NET="https://net-dev.nolus.io:26612"
GITLAB_API="https://gitlab-nomo.credissimo.net/api/v4"
IBC_TOKEN='ibc/8A34AF0C1943FD0DFCDE9ADBF0B2C9959C45E87E6088EA2FC6ADACD59261B8A2'
STABLE_DENOM='ibc/8A34AF0C1943FD0DFCDE9ADBF0B2C9959C45E87E6088EA2FC6ADACD59261B8A2'
SMART_CONTRACTS_PROJECT_ID="8"
COSMZONE_PROJECT_ID="3"
CONTRACTS_INFO_ARTIFACT="deploy:cargo"
SETUP_DEV_NETWORK_ARTIFACT="setup-dev-network"
NOLUS_BUILD_BINARY_ARTIFACT="build-binary"

if [[ $# -eq 0 ]]; then
  if [[ -z ${CI_JOB_TOKEN+x} ]]; then
    echo "Error: there is no PRIVATE or CI_JOB token"
    exit 1
  fi
  if [[ -v PIPELINE_PREFERRED_TAG ]]; then
    TAG="$PIPELINE_PREFERRED_TAG"
  fi
    TOKEN_TYPE="JOB-TOKEN"
    TOKEN_VALUE="$CI_JOB_TOKEN"
    TAGS_ENDPOINT_ACCESS_TOKEN="$SMART_CONTRACTS_ACCESS_KEY"
else
  if [[ $# -eq 2 ]]; then
    TAG="$2"
  fi
  TOKEN_TYPE="PRIVATE-TOKEN"
  TOKEN_VALUE="$1"
  TAGS_ENDPOINT_ACCESS_TOKEN="$1"
fi

downloadArtifact() {
  local -r name="$1"
  local -r version="$2"
  local -r project_id="$3"
  local -r response

  response=$(curl --output "$name".zip -w '%{http_code}' --header "$TOKEN_TYPE: $TOKEN_VALUE" "$GITLAB_API/projects/$project_id/jobs/artifacts/$version/download?job=$name")
  if [[ $response -ne 200 ]]; then
    echo "Error: failed to retrieve artifact $name, version $version from the project with ID $project_id. Are you sure the artifact and tag exist?"
    exit 1
  fi
   echo 'A' | unzip "$name".zip
}

addKey() {
  local -r name="$1"
  local -r account_dir="$ACCOUNTS_DIR"

  echo 'y' | nolusd keys add "$name" --keyring-backend "test" --home "$account_dir"
}

exportKey() {
  local -r name="$1"
  local -r account_dir="$ACCOUNTS_DIR"

  echo 'y' | nolusd keys export "$name" --unsafe --unarmored-hex --keyring-backend "test" --home "$account_dir"
}

getValidatorAddress() {
  local -r index="$1"
  nolusd query staking validators --output json --node "$NOLUS_DEV_NET"| jq '.validators['$index'].operator_address' | tr -d '"'
}

# Get dev-network information

COSMZONE_LATEST_VERSION=$(curl --silent "$NOLUS_DEV_NET/abci_info" | jq '.result.response.version' | tr -d '"')

downloadArtifact "$SETUP_DEV_NETWORK_ARTIFACT" "v$COSMZONE_LATEST_VERSION" "$COSMZONE_PROJECT_ID"
downloadArtifact "$NOLUS_BUILD_BINARY_ARTIFACT" "v$COSMZONE_LATEST_VERSION" "$COSMZONE_PROJECT_ID"

tar -xf $ARTIFACT_BIN
export PATH
PATH=$(pwd):$PATH

ACCOUNTS_DIR="$ROOT_DIR/accounts"

addKey "test-user-1"
addKey "test-user-2"

USER_1_PRIV_KEY=$(exportKey "treasury")
USER_2_PRIV_KEY=$(exportKey "test-user-1")
USER_3_PRIV_KEY=$(exportKey "test-user-2")
VALIDATOR_1_ADDRESS=$(getValidatorAddress "0")
VALIDATOR_2_ADDRESS=$(getValidatorAddress "1")

# Get contracts information

  if [[ -z ${TAG+x} ]]; then
    SMART_CONTRACTS_LATEST_VERSION=$(curl --header "PRIVATE-TOKEN: $TAGS_ENDPOINT_ACCESS_TOKEN" "$GITLAB_API/projects/$SMART_CONTRACTS_PROJECT_ID/repository/tags" | jq -r '.[0].name' | tr -d '"')
  else
    SMART_CONTRACTS_LATEST_VERSION="$TAG"
  fi

downloadArtifact  "$CONTRACTS_INFO_ARTIFACT" "$SMART_CONTRACTS_LATEST_VERSION" "$SMART_CONTRACTS_PROJECT_ID"
tar -xf $CONTRACTS_BIN

LPP_ADDRESS=$(jq .contracts_info[1].lpp.instance contracts-info.json | tr -d '"')
LEASER_ADDRESS=$(jq .contracts_info[2].leaser.instance contracts-info.json | tr -d '"')
ORACLE_ADDRESS=$(jq .contracts_info[3].oracle.instance contracts-info.json | tr -d '"')
TREASURY_ADDRESS=$(jq .contracts_info[4].treasury.instance contracts-info.json | tr -d '"')
PROFIT_ADDRESS=$(jq .contracts_info[5].profit.instance contracts-info.json | tr -d '"')
DISPATCHER_ADDRESS=$(jq .contracts_info[6].rewards_dispatcher.instance contracts-info.json | tr -d '"')

# Save the results

DOT_ENV=$(cat <<-EOF
NODE_URL=${NOLUS_DEV_NET}
IBC_TOKEN=${IBC_TOKEN}
STABLE_DENOM=${STABLE_DENOM}
USER_1_PRIV_KEY=${USER_1_PRIV_KEY}
USER_2_PRIV_KEY=${USER_2_PRIV_KEY}
USER_3_PRIV_KEY=${USER_3_PRIV_KEY}
VALIDATOR_1_ADDRESS=${VALIDATOR_1_ADDRESS}
VALIDATOR_2_ADDRESS=${VALIDATOR_2_ADDRESS}
ORACLE_ADDRESS=${ORACLE_ADDRESS}
LEASER_ADDRESS=${LEASER_ADDRESS}
LPP_ADDRESS=${LPP_ADDRESS}
TREASURY_ADDRESS=${TREASURY_ADDRESS}
DISPATCHER_ADDRESS=${DISPATCHER_ADDRESS}
PROFIT_ADDRESS=${PROFIT_ADDRESS}
EOF
  )
   echo "$DOT_ENV" > "$ROOT_DIR/.env"
