#!/bin/bash
set -euxo pipefail

if [[ $# -eq 0 ]]; then
 # if [[ -z ${CI_JOB_TOKEN} ]]; then
    #echo "Error: there is no PRIVATE or CI_JOB token"
    #exit 1
  #else
    TOKEN_TYPE="JOB-TOKEN"
    TOKEN_VALUE="$CI_JOB_TOKEN"
  #fi
else
  TOKEN_TYPE="PRIVATE-TOKEN"
  TOKEN_VALUE="$1"
fi

ROOT_DIR=$(pwd)

VERSION=$(curl --silent "https://net-dev.nolus.io:26612/abci_info" | jq '.result.response.version' | tr -d '"')
curl --output artifacts.zip --header "$TOKEN_TYPE: $TOKEN_VALUE" "https://gitlab-nomo.credissimo.net/api/v4/projects/3/jobs/artifacts/v$VERSION/download?job=setup-dev-network"
echo 'A' | unzip artifacts.zip

USER_1_ACCOUNTS_DIR="$ROOT_DIR/accounts"
USER_1_PRIV_KEY=$(echo 'y' | nolusd keys export treasury --unsafe --unarmored-hex --keyring-backend "test" --home "$USER_1_ACCOUNTS_DIR" 2>&1)

DOT_ENV=$(cat <<-EOF
NODE_URL=https://net-dev.nolus.io:26612/
USER_1_PRIV_KEY=${USER_1_PRIV_KEY}
EOF
  )
   echo "$DOT_ENV" > "$ROOT_DIR/.env"
