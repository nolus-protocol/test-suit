# Integration tests

## Prerequisites

You need Node v14+ installed on your machine.
You also need to install:

* [yarn](https://classic.yarnpkg.com/lang/en/docs/install/#debian-stable)

```sh
npm install --global yarn
```

* [jest](https://jestjs.io/docs/getting-started)

You can run Jest directly from the CLI if it's globally available in your PATH:

```sh
yarn global add jest
```

* [jq](https://stedolan.github.io/jq/download/):

```sh
sudo apt-get install jq
```

* the project's dependencies:

First config your npm token. This is required to install Nolusjs:

```sh
npm config set //registry.npmjs.org/:_authToken <YOUR_NPM_ACCESS_TOKEN>
```

```sh
yarn
```

## Linting the code

We use the [TypeScript-Eslint](https://github.com/typescript-eslint) and [Prettier](https://prettier.io/).

```sh
yarn lint
```

This will show you the results of the ESLint analysis.

Ref: [Using ESLint and Prettier in a TypeScript Project, ROBERT COOPER](https://robertcooper.me/post/using-eslint-and-prettier-in-a-typescript-project).

## Run integration tests

1. On dev-net:

    ```sh
    yarn prepare-env-dev --mnemonic-faucet <mnemonic_phrase> --mnemonic-wasm-admin <mnemonic_phrase> --token-type "PRIVATE-TOKEN" --token-value <your_gitlab_access_token> --test-transfer "true"/"false" --test-oracle "true"/"false" --test-staking "true"/"false" --test-borrower "true"/"false" --test-lender "true"/"false" --test-treasury "true"/"false" --test-vesting "true"/"false" --test-gov "true"/"false"
    ```

    ```sh
    yarn test
    ```

2. On local-net:

    ```sh
    yarn prepare-env-local --contracts-result-file-path <path_to_contracts_info_file>
    ```

    * **--contracts-result-file-path** - you must pass the path to the directory where the smart contracts information file is located (thе file produced by **cosmzone/scripts/init-local-network.sh**)

    More flags:

    * **--nolus-local-network <nolus-local-net-url>**, by default this is: http://localhost:26612

    * **--stable-denom <stable-denom>**, (ticker) by default this is: USDC

    * **--home-dir <nolus-accounts-dir>**, by default this is: home/.nolus

    You can get selected lpp-native/stable-denom in reserve account through: **/cosmzone/scripts/init-local-network.sh**.
    Example:

    ``./scripts/init-local-network.sh --wasm-code-path <path_to_contracts_wasm_files> --wasm-script-path <path_to_"smart-contracts/scripts/deploy-contracts-genesis.sh"> --lpp-native "USDC" --reserve-tokens 10000000000000ibc/7FBDBEEEBA9C50C4BCDF7BF438EAB99E64360833D240B32655C96E319559E911 (USDC ibc/ representation),10000000000000unls``

    ```sh
    yarn test
    ```
