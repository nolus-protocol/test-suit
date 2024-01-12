# Integration tests

<br /><p align="center"><img alt="nolus-test-suit" src="docs/test-suit-logo.svg" width="100"/></p><br />

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
yarn prepare-env-dev --mnemonic-faucet <mnemonic_phrase> --protocol <protocol_to_test>
```

* For more flags: ```yarn prepare-env-dev --help```

#### Local network

!!! On a local network, manual setup and startup of the feeder&&dispatcher is required before testing. Instructions for this can be found in our [**oracle-price-feeder**](https://github.com/Nolus-Protocol/oracle-price-feeder) repository and the name of the feeder key must be passed to the "--feeder-key" flag when running **yarn prepare-env-local** ([here](#local-network)). For some of the test cases, it is necessary to choose a currency for which this feeder does not provide a price. By default, here in the tests, this is set to be the "STARS" currency. So when you configure the feeder, in the configuration file there, please remove this currency from the **currencies** section. An option is provided here to select and specify a currency other than "STARS" via the flag "--no-price-currency" when running **yarn prepare-env-local**.

```sh
yarn prepare-env-local --feeder-key "<feeder_key_name> "--protocol "<protocol_to_test>"
```

* The 'reserve' account must have funds (in nolus native currency), so be sure to reflect this when starting a local network : **/nolus-core/scripts/init-local-network.sh**

* For more flags: ```yarn prepare-env-local --help```

### Fund wallet with supported currencies

To run the tests, regardless of the exact currency, it is necessary to load the test wallet with all currencies supported by the system. On a local network for this purpose you can use the script below, or to do that manually.

!!! Before running the script, you have to fill in it the currencies with which you want the account to be funded. [Look in the script for more](./scripts/helpers/fund-with-supported-currencies.sh).

!!! DEX network binary is required.

```sh
yarn run fund-main-account "<mnemonic_of_dex_account_you_have_preloaded>" "<address_of_dex_account_you_have_preloaded>" "<dex_network_name>" "<dex_node_url>" "<dex_binary_dir_path>" "<dex_home_dir>" "<dex_native_minimal_denom>" "<leaser_contract_address>" "<receiver_nolus_address>"
```

* There must also be a native currency balance on the DEX network for the account whose information is passed to the script
### Run

```sh
yarn test
```

* In **manually/** can be found tests which require specific configuration to work as expected. They require to be run in isolation. The requirements can be found in the relevant files there.
