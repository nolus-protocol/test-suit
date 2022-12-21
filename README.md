# Integration tests

<br /><p align="center"><img alt="Nolus.js" src="docs/test-suit-logo.svg" width="100"/></p><br />

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

```sh
yarn
```

## Run tests

### Prepare the environment

#### Dev network

```sh
yarn prepare-env-dev --mnemonic-faucet <mnemonic_phrase> --mnemonic-contracts-owner <mnemonic_phrase> --token-type "PRIVATE-TOKEN" --token-value <your_gitlab_access_token>
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

On dev add *--nolus-net https://net-dev.nolus.io:26612*

### Run

```sh
yarn test
```
