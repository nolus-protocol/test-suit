# test-suit — docs

Longer-form detail for the Nolus UAT integration tests. [`CLAUDE.md`](../CLAUDE.md) is the entry
point and carries the quick reference; [`README.md`](../README.md) is setup and operation.

- [The network under test](#the-network-under-test)
- [Architecture](#architecture) — how a suite reaches the chain
- [Runbooks](#runbooks) — prep, funding, running, CI
- [Deliberately absent](#deliberately-absent) — removed on purpose, so it is not re-added
- [Decisions](#decisions)

---

## The network under test

**One target: the deployed contracts on `rila`.** It runs after a protocol update, against a live
network.

---

## Architecture

These are **live on-chain integration tests**. Nothing is mocked — each test signs real
transactions against a running `nolusd` node and asserts on the on-chain result.

1. **Jest boot** ([`jest.config.js`](../jest.config.js)) — `ts-jest` transpiles the suites.
   `setupFiles` runs [`src/setup.ts`](../src/setup.ts) inside each worker, which loads the env file
   named by `TEST_ENV_FILE` (default `.env`) through [`src/util/env.ts`](../src/util/env.ts); a
   config-time load would not reach the workers. `testTimeout` is ~2000 s because on-chain
   settlement is wall-clock-bound.
2. **Client** ([`src/util/clients.ts`](../src/util/clients.ts)) — `NODE_ENDPOINT` comes from
   `process.env.NODE_URL`; each suite calls `NolusClient.setInstance()` in `beforeAll` and talks to
   the chain through `@nolus/nolusjs` contract wrappers.
3. **Wallets** — fixed funded keys from env private keys (`USER_1_PRIV_KEY`, …), which share
   on-chain account state across the run, plus fresh `createWallet()` wallets for actors that
   should start empty.
4. **Contract addresses** are never hardcoded — they come from env, which the prep resolves by
   querying the live admin contract.

### Suite gating

[`src/util/testingRules.ts`](../src/util/testingRules.ts) has two computed axes; everything else is
a hardcoded skip. Every gate names its reason in the skipped case's own name.

| Axis | Form | For |
|---|---|---|
| Domain | `runOrSkip(process.env.TEST_<DOMAIN>)` | A whole suite switched off from the env file. Only the literal `false` skips |
| Capability | `withLeaseAdmin` / `withFeeder` / `withDexAdmin`, each with a `…Test` form | A case needing a privileged key, so it runs wherever that key is configured |
| *(neither)* | `describe.skip` / `test.skip` with a comment | A case a network cannot host |

---

## Runbooks

> Mnemonics and private keys live in the gitignored `.env`. Never paste them into chat, a shared
> terminal, or a log that leaves the machine — see the Secrets gotcha in [`CLAUDE.md`](../CLAUDE.md).

### Install

```sh
yarn
```

Node 18+ (tested on 22), `yarn` and `jq`. No `nolusd` of your own: the prep downloads the
nolus-core release into the repo root, and [`cmd.sh`](../scripts/common/cmd.sh) points every
script at that one binary. `rila` always runs the latest nolus-core, so the latest release is
the right client; `--nolus-core-version-tag` pins another.

### Prepare the environment

```sh
read -rs MNEMO            # keeps the mnemonic out of shell history — and only there
yarn prepare-env \
  --test-wallet-mnemonic "$MNEMO" \
  --protocol SOLANA-METIS-USDC \
  --oracle-code-id-different-protocol <code_id>
unset MNEMO
```

Downloads the nolus-core release, recovers the wallet, resolves all 44 variables by query, and writes `.env`. `--help` lists every flag, including the per-domain
`--test-*-flag` toggles.

**Nothing in the file is hand-written**, so a re-prep loses nothing and there is no `env.example`.
It always writes `.env`; keep a per-protocol copy with `cp .env .env-osmosis` and point
`TEST_ENV_FILE` at it.

### Fund the test wallet

The prep funds nothing. Bridging in what the suites spend is a deliberate hand-run step with
[`fund-main-account-from-solana.sh`](../scripts/helpers/fund-main-account-from-solana.sh):

```sh
yarn fund-main-account --recipient nolus1... --keypair … --program-id … \
  --cluster … --channel-ordinal 0 --solray-admin … --dry-run
```

Sending needs `--confirm`; without it the script prints the plan and stops.

It reads **nothing** from this repo and nothing from an env file — every value arrives on the
command line or from the `SEND` table at the top of the script, so it works against any cluster
without an edit. Its header records where to get the mint and the channel ordinal.

### Run

```sh
yarn test                                  # preflight, then the suites
yarn test src/borrower src/lender          # narrowed to some paths
TEST_ENV_FILE=.env-osmosis yarn test       # a different env file
```

### Preflight — before a run spends anything

```sh
yarn preflight
```

Read-only, needs no environment variables and no Solana tooling. Three checks:

1. **Every lease currency has a price.** The oracle drops a price past its window, so presence *is*
   freshness.
2. **No packet is in flight** on `ICS20_CHANNEL_LOCAL` or `LEASE_CHANNEL` — one left over makes the
   next run fail ambiguously.
3. **The main account holds native currency.** `USER_1` only, and only that the balance is above
   zero, which also proves the account exists. No floor, deliberately: how much a pass needs
   depends on what it does, and every operation checks its own balance before it spends.

### CI

[`.github/workflows/test-suit.yaml`](../.github/workflows/test-suit.yaml) runs the same two
commands, on `workflow_dispatch` only. Repository variables supply the defaults and the dispatch
inputs override them per run; the domain checkboxes become the `TEST_<DOMAIN>` flags, and a
`suites` input narrows the paths.

Needs `secrets.TEST_WALLET_MNEMONIC`, `vars.PROTOCOL` and `vars.ORACLE_CODE_ID_DIFFERENT_PROTOCOL`
in a `rila` environment; a first step refuses the run if any is missing. `vars.NOLUS_CORE_TAG` is
optional and normally left unset — the prep downloads the latest nolus-core release, which is what
`rila` runs.

### The spend guards

> **Not yet on the spend path.** [`src/util/budget.ts`](../src/util/budget.ts) has no callers, so
> neither limit can fire — an empty ledger means nothing consulted it, not that nothing was spent.
> Stage 2 wires it into the journeys.


### After a run — returning what it gained

**Manual today.** Stage 2 gets a helper alongside the funder that returns **everything** from the
main Nolus key to the Solana funder. Until then each return is a plain ICS-20 transfer back over
`ICS20_CHANNEL_LOCAL`:

```sh
nolusd tx ibc-transfer transfer transfer <ICS20_CHANNEL_LOCAL> <solana funder pubkey> \
  <amount><ibc/denom> --from <key> --chain-id <chain id> --node <rpc> \
  --gas auto --gas-adjustment 1.5 --fees 5000unls -y
```
---

## Decisions

### Why nothing is mocked

The value of a UAT suite is exercising the real chain and real contracts. That makes three
otherwise-standard rules inapplicable, documented as carve-outs in [`CLAUDE.md`](../CLAUDE.md): no
mocking at the boundary, no fake clock, and a deliberately shared funded wallet. Where a wait is
needed, prefer polling until a condition holds over a fixed `sleep`.
