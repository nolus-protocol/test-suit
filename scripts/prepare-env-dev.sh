#!/bin/bash
set -euxo pipefail

ROOT_DIR=$(pwd)
ARTIFACT_BIN="nolus.tar.gz"
NOLUS_DEV_NET="https://net-dev.nolus.io:26612"
GITLAB_API="https://gitlab-nomo.credissimo.net/api/v4"
IBC_TOKEN='ibc/0954E1C28EB7AF5B72D24F3BC2B47BBB2FDF91BDDFD57B74B99E133AED40972A'
SMART_CONTRACTS_PROJECT_ID="8"
COSMZONE_PROJECT_ID="3"

if [[ $# -eq 0 ]]; then
 if [[ -z ${CI_JOB_TOKEN+x} ]]; then
    echo "Error: there is no PRIVATE or CI_JOB token"
    exit 1
  fi
    TOKEN_TYPE="JOB-TOKEN"
    TOKEN_VALUE="$CI_JOB_TOKEN"
else
  TOKEN_TYPE="PRIVATE-TOKEN"
  TOKEN_VALUE="$1"
fi

downloadArtifact() {
  local name="$1"
  local version="$2"
  local project_id="$3"

  curl --output "$name".zip --header "$TOKEN_TYPE: $TOKEN_VALUE" "$GITLAB_API/projects/$project_id/jobs/artifacts/v$version/download?job=$name"
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

COSMZONE_LATEST_VERSION=$(curl --silent "$NOLUS_DEV_NET/abci_info" | jq '.result.response.version' | tr -d '"')

downloadArtifact "setup-dev-network" "$COSMZONE_LATEST_VERSION" "$COSMZONE_PROJECT_ID"
downloadArtifact "build-binary" "$COSMZONE_LATEST_VERSION" "$COSMZONE_PROJECT_ID"

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
# download artifact from smart-contracts

SMART_CONTRACTS_LATEST_VERSION=$(curl --header "$TOKEN_TYPE: $TOKEN_VALUE" "$GITLAB_API/projects/$COSMZONE_PROJECT_ID/repository/tags" | jq -r '.[1].name' | tr -d '"')
echo SMART_CONTRACTS_LATEST_VERSION

#downloadArtifact "deploy:cargo" "$SMART_CONTRACTS_LATEST_VERSION" "$SMART_CONTRACTS_PROJECT_ID"

# download the schemas

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
