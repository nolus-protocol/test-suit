# test-suit — docs

Per-component and deeper documentation for the Nolus UAT integration tests. The project
root [`CLAUDE.md`](../CLAUDE.md) is the entry point and carries the quick reference (stack,
commands, conventions, gotchas); this directory holds the longer-form detail that doesn't
belong inline there.

## Index

- [Architecture](#architecture) — how a suite reaches the chain
- [Runbooks](#runbooks) — environment setup, funding, running suites
- [Decisions](#decisions) — why the suite is built the way it is

---

## Architecture

These are **live on-chain integration tests**. There is no system-under-test process of
our own and nothing is mocked — each test signs real transactions against a running
`nolusd` node and asserts on the on-chain result (query responses, balances, emitted
events, rejected txs).

### From `jest` to the chain

1. **Jest boot** ([`jest.config.js`](../jest.config.js)) — `ts-jest` transpiles the
   suites; `setupFiles: ['dotenv/config']` loads the generated `.env` into
   `process.env` before any test runs; `testTimeout` is ~2000 s because on-chain
   settlement is wall-clock-bound. `transformIgnorePatterns` allow-lists `@nolus/nolusjs`
   so its ESM ships through the transform — do not remove it.
2. **Client** ([`src/util/clients.ts`](../src/util/clients.ts)) — `NODE_ENDPOINT` comes
   from `process.env.NODE_URL`. Each suite calls `NolusClient.setInstance(NODE_ENDPOINT)`
   in `beforeAll`, then talks to the chain through `@nolus/nolusjs` contract wrappers
   (`NolusContracts.Leaser`, `Oracle`, `Lpp`, …).
3. **Wallets** — two flavours:
   - **Fixed funded keys** read from env private keys (`USER_1_PRIV_KEY`,
     `FEEDER_PRIV_KEY`, …) via `DirectSecp256k1Wallet`. These share on-chain account
     state across the run.
   - **Fresh wallets** from `createWallet()` (random mnemonic) for actors that should
     start empty, e.g. a new borrower.
4. **Contract addresses** are not hard-coded in tests — they're read from env
   (`LEASER_ADDRESS`, `LPP_ADDRESS`, `ORACLE_ADDRESS`, …), which the env-prep scripts
   populate by querying the live admin contract.

### Suite gating

Suites are switched on/off by env flags:

- `runOrSkip(process.env.TEST_<DOMAIN>)` resolves to `describe` or `describe.skip`, so a
  suite whose flag is `"false"` is skipped wholesale. The env-prep scripts write every
  `TEST_TRANSFER` / `TEST_BORROWER` / … flag.
- `runTestIfLocal` / `runTestIfDev` (driven by `process.env.ENV`) gate individual cases
  that only make sense on one network.

---

## Runbooks

> The funded keys, faucet keys, and mnemonics these procedures need live in gitignored
> `.env*` files — never paste them into chat, a terminal you're screen-sharing, or a
> commit. See the Secrets gotcha in [`CLAUDE.md`](../CLAUDE.md).

### Install

```sh
yarn            # installs deps; postinstall runs patch-package (see Decisions)
```

Prereqs: Node 14+, `yarn`, `jq`, and `jest` on PATH (`yarn global add jest`).

### Prepare the environment — dev network

Downloads the `nolusd` binary (`nolus.tar.gz`) from the matching `nolus-core` release,
recovers the test wallet, queries contract addresses, and writes `.env`:

```sh
yarn prepare-env-dev \
  --test-wallet-mnemonic <mnemonic> \
  --mnemonic-faucet <mnemonic> \
  --protocol <protocol> \
  --oracle-code-id-different-protocol <code_id>
```

`yarn prepare-env-dev --help` lists every flag, including the per-domain `--test-*-flag`
toggles that become the `TEST_<DOMAIN>` gates above.

### Prepare the environment — local network

A local run has external prerequisites this repo does **not** start for you:

- A local `nolusd` network running (default RPC `http://localhost:26612`). The `reserve`
  account must be funded with native currency — reflect this when you start the network
  via `nolus-core`'s `scripts/init-local-network.sh`.
- The **feeder & dispatcher** must be started manually first — see the
  [oracle-price-feeder](https://github.com/Nolus-Protocol/oracle-price-feeder) repo. The
  feeder key name is passed via `--feeder-key`.

```sh
yarn prepare-env-local \
  --feeder-key <feeder_key_name> \
  --dex-admin-key <dex_admin_key> \
  --lease-admin-key <lease_admin_key> \
  --protocol <protocol> \
  --no-price-currency-ticker <ticker> \
  --no-price-lease-currency-ticker <ticker> \
  --no-price-lease-currency-denom <denom>
```

### Fund the test wallet

The wallet must hold every system-supported currency regardless of which suite runs.
Edit [`scripts/helpers/fund-with-supported-currencies.sh`](../scripts/helpers/fund-with-supported-currencies.sh)
to list the currencies first (a DEX-network binary and a pre-funded DEX account are
required):

```sh
yarn fund-main-account "<dex_mnemonic>" "<dex_address>" "<dex_network>" \
  "<dex_node_url>" "<dex_binary_dir>" "<dex_home_dir>" "<dex_native_denom>" \
  "<leaser_address>" "<receiver_nolus_address>"
```

### Run

```sh
# default smoke test (pinned to one file)
yarn test

# a specific suite — ALWAYS --runInBand (see Decisions)
npx jest --runInBand src/borrower/quoteLease.test.ts
```

`manually/` suites need bespoke setup documented in each file and must be run in
isolation — keep them out of the default run.

---

## Decisions

### Why we patch CosmJS (`patch-package`) instead of forking or pinning

Two upstream bugs in the published `@cosmjs` versions break the suite, so
[`patches/`](../patches/) carries minimal fixes reapplied on every install via the
`postinstall` hook:

- **`accountNumber` read as `bigint`.** CosmJS read the on-chain account number with
  `.toNumber()`, which truncates above 2^53. On a long-lived chain the account number
  grows past that, the wrong number gets signed, and **every tx fails verification.** The
  patch switches it to `.toBigInt()`.
- **`cosmwasm-stargate` resolution.** The package shipped only an `exports` map with no
  legacy `main`/`types`; some resolution paths (incl. ts-jest) need those entry points or
  the import fails. The patch adds them.

A patch is the smallest durable fix: no fork to maintain, no waiting on an upstream
release, and it self-documents the exact lines that differ. Revisit when CosmJS ships
versions that include both fixes.

### Why `--runInBand` (serial) is mandatory

Suites share a single funded wallet and a sequential account nonce. Run in parallel and
concurrent txs collide on sequence numbers and flake. Serial execution is the price of
sharing on-chain state — it is not negotiable for this suite.

### Why nothing is mocked / why real-clock waits exist

The entire value of a UAT suite is exercising the real chain and real contracts. That
makes three otherwise-standard unit-test rules inapplicable here (documented as carve-outs
in [`CLAUDE.md`](../CLAUDE.md)): no mocking at the boundary, no fake clock (a real chain
settles in wall-clock time, so waiting on block production is unavoidable), and a
deliberately shared funded wallet. Where a wait is needed, prefer polling until a
condition holds over a fixed `sleep`.

### Why suites self-skip on env flags

Which domains run depends on the target network and what's been set up. Gating through
`TEST_<DOMAIN>` flags + `ENV`-based `runTestIf*` lets one `.env` describe a run without
editing test files or juggling jest path filters — the env-prep scripts own the policy.
