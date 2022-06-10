#!/bin/bash
set -euxo pipefail

yarn test-dev src/app.test.ts

if [[ $TEST_VESTING == "true" ]] ; then
    yarn test-dev src/vesting
fi

if [[ $TEST_GOV == "true" ]] ; then
    yarn test-dev src/gov
fi

if [[ $TEST_TRANSFERS == "true" ]] ; then
    yarn test-dev src/transfers
fi

if [[ $TEST_STAKING == "true" ]] ; then
    yarn test-dev src/staking
fi

if [[ $TEST_CW20 == "true" ]] ; then
    yarn test-dev src/cw20
fi

if [[ $TEST_ORACLE == "true" ]] ; then
    yarn test-dev src/oracle
fi

if [[ $TEST_LEASER == "true" ]] ; then
    yarn test-dev src/leaser
fi

