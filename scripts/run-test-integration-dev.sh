#!/bin/bash
set -euxo pipefail

ROOT_DIR=$1
shift
if [[ -n ${ROOT_DIR+} ]]; then
  echo "root directory was not set"
  exit 1
fi

# get dev version, if there is new version - download artefact on that version
# then VAL_ACCOUNT_DIR will be formed from the account-+the version
VAL_ACCOUNTS_DIR="$ROOT_DIR/accounts-v0-1-15/accounts"
VALIDATOR_PRIV_KEY=$(echo 'y' | nolusd keys export treasury --unsafe --unarmored-hex --keyring-backend "test" --home "$VAL_ACCOUNTS_DIR" 2>&1)

DOT_ENV=$(cat <<-EOF
NODE_URL=https://net-dev.nolus.io:26612/
VALIDATOR_PRIV_KEY=${VALIDATOR_PRIV_KEY}
EOF
  )
   echo "$DOT_ENV" > "$ROOT_DIR/.env"
