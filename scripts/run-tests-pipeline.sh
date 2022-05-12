#!/bin/bash
set -euxo pipefail

yarn test src/app.test.ts

if [[ $TEST_VESTING == "true" ]] ; then
    yarn test src/vesting
fi

if [[ $TEST_GOV == "true" ]] ; then
    yarn test src/gov
fi

if [[ $TEST_TRANSFERS == "true" ]] ; then
    yarn test src/transfers
fi

if [[ $TEST_ORACLE == "true" ]] ; then
    yarn test src/oracle
fi

if [[ $TEST_STAKING == "true" ]] ; then
    yarn test src/staking
fi