# test-suit — Nolus UAT integration tests

TypeScript/Jest user-acceptance integration-test suite for the Nolus Protocol
blockchain. Tests run against a real running `nolusd` node, exercising on-chain behavior of
the Nolus smart contracts — leases, oracle, LPP, profit, treasury, vesting, staking,
governance, transfers — via `@cosmjs` and `@nolus/nolusjs`. Maintained by QA.

**One target: the deployed contracts on `rila`.** There is no local-network mode — anything a
live network cannot host is skipped in place and covered by the suites that stand up their own
localnet and test validator.

Global rules (task sizing, ceremonies, code quality, quality gate, etc.) come from
`~/.claude/CLAUDE.md` and the methodology it imports. This file carries only what is
project-specific.

## Tech stack

- Language: TypeScript 5.9 (CommonJS, target ESNext, `strict: true`)
- Test runner: Jest 30 + ts-jest (`testTimeout` ~2000s — on-chain settlement)
- Chain SDK: `@nolus/nolusjs` 3.7.7, `cosmjs-types`, and `@cosmjs` **0.39** — note
  `package.json` still pins the `@cosmjs/*` devDependencies at `0.36.0` while nolusjs 3.7.7
  hard-pins `0.39.0`, so 0.39 is what is installed and what `src/` is written against. The pins
  need a deliberate bump plus a lockfile update; 0.36 is not an option while nolusjs is a
  dependency.
- Lint / format: ESLint 9 (flat config, `@typescript-eslint`) + Prettier 3
- Package manager: yarn (`yarn.lock`)
- Under test: the deployed contracts on `rila`, reached through the `nolusd` the prep downloads
  into the repo root — the nolus-core release, latest unless `--nolus-core-version-tag` pins one

## Build / test / deploy

```bash
# Typecheck
npx tsc --noEmit

# Format
npx prettier --write 'src/**/*.{js,ts}'

# Lint (warn-level; --fix auto-applies safe fixes)
yarn lint

# Prepare environment (needs flags/mnemonics — see docs/README.md before running)
yarn prepare-env ...   # always writes .env; no flag to change the name

# Run everything — preflight, then the suites
yarn test
yarn test src/borrower             # narrowed to some suites

# Refuse a run that would obviously fail or overspend (read-only)
yarn preflight

# From CI: .github/workflows/test-suit.yaml, workflow_dispatch only. Same two commands.

# jest directly, no bracketing (always --runInBand; tests share on-chain wallet state)
npx jest --runInBand <path-under-src>          # reads .env; TEST_ENV_FILE overrides

# No deploy — this is a test suite.
```

## Structure

| Path | Purpose |
|---|---|
| `src/<domain>/*.test.ts` | Test suites grouped by protocol area (borrower, oracle, lender, staking, transfers, treasury, vesting, gov, profit, reserve, timealarms, admin) |
| `src/util/` | Shared test helpers and chain utilities |
| `src/manually/` | Tests requiring specific manual setup — run in isolation only |
| `src/preflight/` | The run's own gate rather than protocol tests. Excluded from every ordinary run and reached only by `preflight.sh` |
| `src/setup.ts` | jest `setupFiles`: loads the env file per worker |
| `scripts/` | Environment prep, preflight, the test runner, Solana funding |
| `.github/workflows/` | The manual-dispatch CI run |
| `accounts/` | Local test accounts (gitignored) |
| `.runs/<RUN_ID>/` | Per-run artefacts: spend ledger and per-suite summary (gitignored) |

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
  `nolusd` node and a funded test wallet. Run `yarn prepare-env` and the funding helper
  before testing. High `testTimeout` is intentional (txs settle on-chain).
- **LPP liquidity is not a precondition of a run.** Every operation deposits into the LPP what it
  needs before it needs it, so there is always liquidity by the time it matters. Do not add a
  preflight gate on it — one existed, produced only false refusals against a thin shared LPP that
  drifts as other people draw it down, and was removed.
- **The prep funds nothing and no run bridges anything in.** The main test key is expected to
  already hold the currencies the suites spend; putting them there is a deliberate hand-run step
  (`scripts/helpers/fund-main-account-from-solana.sh`, which reads no env file). So the prep takes
  no Solana settings and the preflight has no funder-solvency check — the numbering keeps a gap
  where check 5 was.
- **`Oracle.getPrices()` is mistyped in nolusjs 3.7.7 and the wrong shape typechecks.** It is
  declared `Promise<{ [key: string]: Price }>` but returns the raw `{"prices":{}}` result verbatim
  (`Oracle.js:49-51`), i.e. `{ prices: { amount, amount_quote }[] }`. So `Object.keys(prices)`
  compiles cleanly and yields `['prices']` — a ticker comparison against it reports **every**
  currency as unpriced. This shipped a false "no lease currency has a price" refusal in the
  preflight. Read `.prices[].amount.ticker`; `amount_quote.ticker` is the *quote* side (always the
  LPN, `USDC`) and reading it instead makes a hand-written `jq` diagnostic agree with the bug.
  `src/preflight/preflight.test.ts` narrows the response locally and asserts the list is
  non-empty, so the day nolusjs fixes the declaration the check fails loudly instead of silently
  passing on an empty list.
- **The CI workflow is manual-only and single-job.** Splitting prep from test would mean passing
  `.env` between jobs as an artifact, and it holds unarmored private keys; only `.runs/<RUN_ID>/`
  is uploaded. `gov`/`staking`/`vesting`/`admin` have no checkbox because the prep refuses an env
  file unless all four are `false`. Its `run` steps execute under `bash -e`, where
  `[[ … ]] && cmd` aborts the step when the test is false — use `if`.
- **`.gitignore`'s `.*` matches `.github/**`,** so a *new* workflow file is invisible to
  `git status`. The existing one is tracked, so edits to it do show. `!.github/` would fix it.
