#!/bin/bash
set -euxo pipefail

ROOT_DIR=$(pwd)
ARTIFACT_BIN="nolus.tar.gz"
NOLUS_DEV_NET="https://net-dev.nolus.io:26612"
GITLAB_API="https://gitlab-nomo.credissimo.net/api/v4"
IBC_TOKEN='ibc/8A34AF0C1943FD0DFCDE9ADBF0B2C9959C45E87E6088EA2FC6ADACD59261B8A2'
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
  local name="$1"
  local version="$2"
  local project_id="$3"
  local response

  response=$(curl --output "$name".zip -w '%{http_code}' --header "$TOKEN_TYPE: $TOKEN_VALUE" "$GITLAB_API/projects/$project_id/jobs/artifacts/$version/download?job=$name")
  if [[ $response -ne 200 ]]; then
    echo "Error: failed to retrieve artifact $name, version $version from the project with ID $project_id. Are you sure the artifact and tag exist?"
    exit 1
  fi
   echo 'A' | unzip "$name".zip
}

addKey() {
  local name="$1"
  local account_dir="$ACCOUNTS_DIR"

  echo 'y' | nolusd keys add "$name" --keyring-backend "test" --home "$account_dir"
}

exportKey() {
  local name="$1"
  local account_dir="$ACCOUNTS_DIR"

  echo 'y' | nolusd keys export "$name" --unsafe --unarmored-hex --keyring-backend "test" --home "$account_dir"
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

# Get contracts information

  if [[ -z ${TAG+x} ]]; then
    SMART_CONTRACTS_LATEST_VERSION=$(curl --header "PRIVATE-TOKEN: $TAGS_ENDPOINT_ACCESS_TOKEN" "$GITLAB_API/projects/$SMART_CONTRACTS_PROJECT_ID/repository/tags" | jq -r '.[0].name' | tr -d '"')
  else
    SMART_CONTRACTS_LATEST_VERSION="$TAG"
  fi

downloadArtifact  "$CONTRACTS_INFO_ARTIFACT" "$SMART_CONTRACTS_LATEST_VERSION" "$SMART_CONTRACTS_PROJECT_ID"

#TO DO: when we have access to the json file -> read the contracts addresses from it

#TO DO ?: Download the contracts schemas? Do we need this here, in the script. Or maybe i can add instructions
#in the README.md about how to get these schemas if we need them?

# Save the results

DOT_ENV=$(cat <<-EOF
NODE_URL=${NOLUS_DEV_NET}
USER_1_PRIV_KEY=${USER_1_PRIV_KEY}
USER_2_PRIV_KEY=${USER_2_PRIV_KEY}
USER_3_PRIV_KEY=${USER_3_PRIV_KEY}
IBC_TOKEN=${IBC_TOKEN}
EOF
  )
   echo "$DOT_ENV" > "$ROOT_DIR/.env"
