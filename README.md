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
yarn prepare-env-dev --test-wallet-mnemonic <mnemonic_phrase> --mnemonic-faucet <mnemonic_phrase> --protocol <protocol_to_test> --oracle-code-id-different-protocol <code_id>
```

* For more flags: ```yarn prepare-env-dev --help```

#### Local network

!!! On a local network, manual setup and startup of the feeder&&dispatcher is required before testing. Instructions for this can be found in our [**oracle-price-feeder**](https://github.com/Nolus-Protocol/oracle-price-feeder) repository and the name of the feeder key must be passed to the "--feeder-key" flag when running **yarn prepare-env-local** ([here](#local-network)). For some of the test cases, it is necessary to manually setup currencies for which this feeder does not provide a price (they are not in the swap_tree):

```sh
yarn prepare-env-local --feeder-key <feeder_key_name> --protocol <protocol_to_test> --dex-admin-key <dex_admin_key> --no-price-currency-ticker <no_price_ticker> --no-price-lease-currency-ticker <no_price_lease_currency_ticker> --no-price-lease-currency-denom <no_price_lease_currency_denom>
```

* TO DO: --no-price - meaning

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

## Compatibility

Example of suitable values when testing:

### Smart contracts

#### Leaser

```json
{"data":{"config":{....,"lease_interest_rate_margin":40,"lease_position_spec":{"liability":{"initial":600,"healthy":830,"first_liq_warn":850,"second_liq_warn":865,"third_liq_warn":880,"max":900,"recalc_time":432000000000000},"min_asset":{"amount":"150","ticker":"<lpn>"},"min_transaction":{"amount":"1000","ticker":"<lpn>"}},"lease_interest_payment":{"due_period":1209600000000000,"grace_period":172800000000000},....}}}
```

#### Oracle

```json
{"data":{....,"price_config":{"min_feeders":500,"sample_period_secs":10,"samples_number":12,"discount_factor":750}}}
```

#### LPP

```json
{"data":{....,"borrow_rate":{"base_interest_rate":100,"utilization_optimal":750,"addon_optimal_interest_rate":20},"min_utilization":0}}
```

#### Profit

```json
{"data":{"cadence_hours":7200}}
```

### Services

#### Feeder

```toml
tick_seconds = 60
between_tx_margin_seconds = 5
query_delivered_tx_tick_seconds = 15

....
```

#### Alarms dispatcher

```toml
poll_period_seconds = 60
between_tx_margin_seconds = 5
query_delivered_tx_tick_seconds = 15

....
```
