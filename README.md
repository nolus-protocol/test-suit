# Integration tests

## Prerequisites

* Node v14+

* [yarn](https://classic.yarnpkg.com/lang/en/docs/install/#debian-stable)

* [jq](https://stedolan.github.io/jq/download/)

* [jest](https://jestjs.io/docs/getting-started)

    You can run Jest directly from the CLI if it is globally available in your PATH:

    ```sh
    yarn global add jest
    ```

## Dependencies

First config your npm token. This is required to install Nolus.js:

```sh
npm config set //registry.npmjs.org/:_authToken <YOUR_NPM_ACCESS_TOKEN>
```

```sh
yarn
```

## Run tests

### Prepare the environment

#### Dev network

```sh
yarn prepare-env-dev --mnemonic-faucet <mnemonic_phrase> --mnemonic-wasm-admin <mnemonic_phrase> --token-type "PRIVATE-TOKEN" --token-value <your_gitlab_access_token>
```

* For more flags: ```yarn prepare-env-dev --help```

#### Local network

```sh
yarn prepare-env-local --contracts-result-file-path <contracts_info_file_path>
```

* **--contracts-result-file-path** - path to the directory where the smart contracts information file is located (thе file produced by **nolusd-core/scripts/init-local-network.sh**)

* For more flags: ```yarn prepare-env-local --help```

* The 'reserve' account must have funds (in nolus native currency && lpp base currency), so be sure to reflect this when starting a local network : **/nolus-core/scripts/init-local-network.sh**

Example:

```sh
./scripts/init-local-network.sh --reserve-tokens 100000000000000ibc/7FBDBEEEBA9C50C4BCDF7BF438EAB99E64360833D240B32655C96E319559E911 (lpp base ibc/ representation),10000000000000unls --hermes-mnemonic <hermes_account_mnemonic>
```

### Save feeders

```sh
yarn save-feeders
```

### Run

```sh
yarn test
```
