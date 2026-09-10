# Integration tests

<br /><p align="center"><img alt="nolus-test-suit" src="docs/test-suit-logo.svg" width="100"/></p><br />

On-chain integration tests for the Nolus Protocol. They run against **one target: the deployed
contracts on the live `rila` network**, one protocol per env file.

Background and reasoning live in [`docs/README.md`](docs/README.md). This file is setup and
operation only.

---

## 1. Install

| Requirement | Notes |
| --- | --- |
| Node 18+ | Tested on 22 |
| [yarn](https://classic.yarnpkg.com/lang/en/docs/install/#debian-stable), [jq](https://stedolan.github.io/jq/download/) | |
| — | No `nolusd` needed: the prep downloads the nolus-core release into the repo root and every script uses that binary |
| `solray-admin` | Needed only by `yarn fund-main-account`. Built from `nolus-protocol/ibc-solray` at the ref the deployment runs; its sibling `solray` is not needed by anything here |

```sh
yarn
```

---

## 2. Set up

### 2.1 Generate the env file

```sh
yarn prepare-env \
  --test-wallet-mnemonic "$MNEMO" \
  --protocol SOLANA-METIS-USDC \
  --oracle-code-id-different-protocol <code_id>
```

Recovers the wallet, verifies the node really is `rila`, resolves every address, code id and
bridge channel by query, and writes the file. `--help` lists every flag.

- **The file is complete when the prep exits.** Nothing is appended by hand, so a re-prep loses
  nothing.
- **It funds nothing and takes no Solana settings.** It assumes the main key already holds the
  currencies the suites spend; putting them there is §2.2, which you do before the run.

### 2.2 Fund the main account

The prep prints the main account's address.
[`scripts/helpers/fund-main-account-from-solana.sh`](scripts/helpers/fund-main-account-from-solana.sh):

```sh
yarn fund-main-account \
  --recipient nolus1... \
  --keypair ~/solana/test-funded.json \
  --program-id <program id> \
  --cluster https://api.... \
  --channel-ordinal 0 \
  --solray-admin ~/path/to/solray-admin \
  --dry-run
```

### 2.3 Preflight

```sh
yarn preflight
```

Refuses a run that would fail or overspend: stale prices, a packet in flight, a main
account with no native currency for fees.

### 2.4 Contract config the suites are written against

The assertions assume these settings. A failure that looks arbitrary is often one of them having
moved on the deployment:

```jsonc
// leaser
{"lease_interest_rate_margin":40,
 "lease_position_spec":{"liability":{"initial":600,"healthy":830,"first_liq_warn":850,
   "second_liq_warn":865,"third_liq_warn":880,"max":900,"recalc_time":432000000000000},
   "min_asset":{"amount":"150","ticker":"<lpn>"},
   "min_transaction":{"amount":"1000","ticker":"<lpn>"}},
 "lease_interest_payment":{"due_period":1209600000000000,"grace_period":172800000000000}}

// oracle
{"price_config":{"min_feeders":500,"sample_period_secs":10,"samples_number":12,
  "discount_factor":750}}

// lpp
{"borrow_rate":{"base_interest_rate":100,"utilization_optimal":750,
  "addon_optimal_interest_rate":20},"min_utilization":0}

// profit
{"cadence_hours":7200}
```

---

## 3. Run tests

```sh
# everything: preflight, then the suites
yarn test

# narrowed to some paths
yarn test src/borrower src/lender

# a different env file
TEST_ENV_FILE=.env-osmosis yarn test
```

### From CI

[`.github/workflows/test-suit.yaml`](.github/workflows/test-suit.yaml) runs the same thing on
`workflow_dispatch` only — no push, no schedule. Repository variables hold the defaults and the
dispatch inputs override them per run; the domain checkboxes become the `TEST_<DOMAIN>` flags, and
a `suites` input narrows the paths.

---

## 4. Development

```sh
npx tsc --noEmit                          # typecheck
npx prettier --write 'src/**/*.{js,ts}'   # format
yarn lint                                 # lint
```
