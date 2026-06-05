# test-suit — Nolus UAT integration tests

TypeScript/Jest user-acceptance integration-test suite for the Nolus Protocol
blockchain. Tests run against a real running `nolusd` node (local or dev network),
exercising on-chain behavior of the Nolus smart contracts — leases, oracle, LPP,
profit, treasury, vesting, staking, governance, transfers — via `@cosmjs` and
`@nolus/nolusjs`. Maintained by QA.

Global rules (task sizing, ceremonies, code quality, quality gate, etc.) come from
`~/.claude/CLAUDE.md` and the methodology it imports. This file carries only what is
project-specific.

## Tech stack

- Language: TypeScript 5.9 (CommonJS, target ESNext, `strict: true`)
- Test runner: Jest 30 + ts-jest (`testTimeout` ~2000s — on-chain settlement)
- Chain SDK: `@cosmjs` 0.39, `@nolus/nolusjs` 3.7, `cosmjs-types`
- Lint / format: ESLint 9 (flat config, `@typescript-eslint`) + Prettier 3
- Package manager: yarn (`yarn.lock`); `patch-package` applies `patches/` on postinstall
- Under test: a local/dev `nolusd` node (bundled `nolusd` binary + `nolus.tar.gz`)

## Build / test / deploy

```bash
# Typecheck
npx tsc --noEmit

# Format
npx prettier --write 'src/**/*.{js,ts}'

# Lint (warn-level; --fix auto-applies safe fixes)
yarn lint

# Prepare environment (needs flags/mnemonics — see README before running)
yarn prepare-env-dev   # dev network
yarn prepare-env-local # local network (feeder/dispatcher must be running first)

# Run a single suite (always --runInBand; tests share on-chain wallet state)
npx jest --runInBand <path-under-src>      # e.g. borrower/openLease.test.ts

# No deploy — this is a test suite.
```

## Structure

| Path | Purpose |
|---|---|
| `src/<domain>/*.test.ts` | Test suites grouped by protocol area (borrower, oracle, lender, staking, transfers, treasury, vesting, gov, profit, reserve, timealarms, admin) |
| `src/util/` | Shared test helpers and chain utilities |
| `src/manually/` | Tests requiring specific manual setup — run in isolation only |
| `scripts/` | Environment-prep and funding helper scripts |
| `accounts/` | Local test accounts (gitignored) |

## Conventions

@~/.claude/kit/snippets/typescript-style.md
@~/.claude/kit/snippets/tests-style.md
@~/.claude/kit/snippets/github-workflow-style.md

Additions and overrides for this repo:

- **Lint is warn-level, not error-level** (narrows the kit's strict TS rules): this
  repo's `eslint.config.mjs` sets `no-explicit-any`, `no-magic-numbers`, `no-console`,
  `prefer-const`, and `no-unused-vars` to `warn`. Follow the kit's `typescript-style`
  snippet for NEW code, but do not mass-rewrite existing `any`/magic-number usage. The
  enforced gate is `yarn lint` passing — warnings are tolerated, not failures.
- **Tests run serially (`--runInBand`)** (project rule, no kit equivalent): suites
  share a single funded on-chain wallet and sequential account nonce. Never run Jest in
  parallel — concurrent txs collide on sequence numbers and flake.
- **`tests-style` carve-outs for live integration tests** (project rule): this suite
  runs against a real `nolusd` node, so three `tests-style.md` rules do not apply —
  *Mock at the boundary* (nothing is mocked; hitting the real chain is the point), *fake
  the clock* (a real chain settles in wall-clock time, so waiting on block production via
  `sleep`/poll is unavoidable), and *no shared mutable fixture state* (suites deliberately
  share one funded wallet + sequential nonce — hence `--runInBand`). Everything else in the
  snippet still applies. Where feasible, prefer **poll-until-condition** over a fixed `sleep`.

## Gotchas

- **These are live on-chain integration tests, not mocked.** They require a running
  `nolusd` node and a funded test wallet. Run `yarn prepare-env-*` and the funding helper
  before testing. High `testTimeout` is intentional (txs settle on-chain).
- **Secrets live in gitignored `.env`, `.env-neutron`, `.env-osmosis`** (mnemonics,
  faucet keys). Never commit or print their contents. `.gitignore` covers all dotfiles
  (`.*`), `node_modules/`, the `nolusd` binary, `nolus.tar.gz`, and `accounts`.
- **`manually/` tests need bespoke configuration** (documented in each file) and must run
  in isolation — keep them out of the default run.
- **`yarn test` is pinned to one file** (`borrower/openLease.test.ts`) as a smoke default.
  Run other suites explicitly with `npx jest --runInBand <path>`.
- **Do not touch `jest.config.js` `transformIgnorePatterns`** — it allow-lists the CosmJS
  ESM deps (`@nolus/nolusjs`, `@cosmjs`, `@scure`, `@noble`); removing them breaks the run.
- **`yarn install` runs `patch-package`** against `patches/` — local dependency patches
  are applied on postinstall.
