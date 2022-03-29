#!/bin/bash
set -euxo pipefail

ARTIFACT_BIN="nolus.tar.gz"
NOLUS_DEV_NET="https://net-dev.nolus.io:26612"

if [[ $# -eq 0 ]]; then
 if [[ -z ${CI_JOB_TOKEN+x} ]]; then
    echo "Error: there is no PRIVATE or CI_JOB token"
    exit 1
  else
    TOKEN_TYPE="JOB-TOKEN"
    TOKEN_VALUE="$CI_JOB_TOKEN"
  fi
else
  TOKEN_TYPE="PRIVATE-TOKEN"
  TOKEN_VALUE="$1"
fi

ROOT_DIR=$(pwd)
IBC_TOKEN='ibc/0954E1C28EB7AF5B72D24F3BC2B47BBB2FDF91BDDFD57B74B99E133AED40972A'
VERSION=$(curl --silent "$NOLUS_DEV_NET/abci_info" | jq '.result.response.version' | tr -d '"')

curl --output artifacts.zip --header "$TOKEN_TYPE: $TOKEN_VALUE" "https://gitlab-nomo.credissimo.net/api/v4/projects/3/jobs/artifacts/v$VERSION/download?job=setup-dev-network"
echo 'A' | unzip artifacts.zip

curl --output binary.zip --header "$TOKEN_TYPE: $TOKEN_VALUE" "https://gitlab-nomo.credissimo.net/api/v4/projects/3/jobs/artifacts/v$VERSION/download?job=build-binary"
echo 'A' | unzip binary.zip
tar -xf $ARTIFACT_BIN
export PATH=$(pwd):$PATH

ACCOUNTS_DIR="$ROOT_DIR/accounts"

USER_1_PRIV_KEY=$(echo 'y' | nolusd keys export treasury --unsafe --unarmored-hex --keyring-backend "test" --home "$ACCOUNTS_DIR" 2>&1)

echo 'y' | nolusd keys add test-user-1 --keyring-backend "test" --home "$ACCOUNTS_DIR"
echo 'y' | nolusd keys add test-user-2 --keyring-backend "test" --home "$ACCOUNTS_DIR"

USER_2_PRIV_KEY=$(echo 'y' | nolusd keys export test-user-1 --unsafe --unarmored-hex --keyring-backend "test" --home "$ACCOUNTS_DIR" 2>&1)
USER_3_PRIV_KEY=$(echo 'y' | nolusd keys export test-user-2 --unsafe --unarmored-hex --keyring-backend "test" --home "$ACCOUNTS_DIR" 2>&1)

# create DELAYED_VESTING account
DELAYED_VESTING_PRIV_KEY=$(echo 'y' | nolusd keys export treasury --unsafe --unarmored-hex --keyring-backend "test" --home "$ACCOUNTS_DIR" 2>&1)

DOT_ENV=$(cat <<-EOF
NODE_URL=${NOLUS_DEV_NET}
USER_1_PRIV_KEY=${USER_1_PRIV_KEY}
USER_2_PRIV_KEY=${USER_2_PRIV_KEY}
USER_3_PRIV_KEY=${USER_3_PRIV_KEY}
IBC_TOKEN=${IBC_TOKEN}
DELAYED_VESTING_PRIV_KEY=${DELAYED_VESTING_PRIV_KEY}
EOF
  )
   echo "$DOT_ENV" > "$ROOT_DIR/.env"
