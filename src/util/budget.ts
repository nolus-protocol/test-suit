import * as fs from 'fs';
import * as path from 'path';

/**
 * Per-run spend ledger plus a swap floor and a run ceiling.
 *
 * Not yet called from any spend site — Stage 2 routes the journeys through it.
 */

/** Raw minimal-denom units. */
export type Raw = bigint;

/** A union, not a boolean, so `crossesSwap: true` cannot be declared without the floor's input. */
export type Spend = {
  readonly ticker: string;
  readonly amount: Raw;
  readonly note: string;
} & (
  | { readonly crossesSwap: false }
  | { readonly crossesSwap: true; readonly usdValue: number }
);

interface LedgerEntry {
  readonly ticker: string;
  readonly amount: string;
  readonly crossesSwap: boolean;
  readonly note: string;
  readonly at: string;
}

const DECIMALS: Readonly<Record<string, number>> = {
  USDC: 6,
  SOL: 9,
  CB_BTC: 8,
  NLS: 6,
};

/** Per-ticker ceiling for one run, in human units. */
const RUN_CEILING: Readonly<Record<string, number>> = {
  USDC: 10,
  SOL: 0.12,
  CB_BTC: 0.001,
  NLS: 50,
};

/**
 * The contract minimums are dust, so an amount can clear every check and still die inside the
 * swap on rounding or slippage.
 */
export const SWAP_FLOOR_USD = 1;

/** Both limits apply by default: this suite spends real funds on a live network. */
export function isEnforced(): boolean {
  const override = process.env.BUDGET_ENFORCED?.trim().toLowerCase();

  if (override === undefined || override === '') {
    return true;
  }

  if (override === 'true') {
    return true;
  }

  if (override === 'false') {
    return false;
  }

  // Throws rather than reading an unrecognised value as "not true", which would disarm both
  // guards on a live network over a typo.
  throw new Error(
    `BUDGET_ENFORCED must be 'true' or 'false' when set, not ` +
      `'${process.env.BUDGET_ENFORCED}'. Unset it to leave both limits enforced.`,
  );
}

export function ledgerPath(): string {
  return (
    process.env.BUDGET_LEDGER ??
    path.join(process.cwd(), '.budget', `${runId()}.jsonl`)
  );
}

export function runId(): string {
  return process.env.RUN_ID ?? 'adhoc';
}

/** Refuses a spend that would breach either limit. Call before broadcasting, not after. */
export function recordSpend(spend: Spend): void {
  if (spend.amount <= 0n) {
    throw new Error(
      `Refusing to record a non-positive spend of ${spend.amount} ${spend.ticker} (${spend.note}).`,
    );
  }

  if (!isEnforced()) {
    return;
  }

  const ceiling = RUN_CEILING[spend.ticker];

  if (ceiling === undefined) {
    throw new Error(
      `No run ceiling is defined for ${spend.ticker}. Add one to RUN_CEILING in util/budget.ts ` +
        `before spending it on a live network.`,
    );
  }

  const decimals = decimalsOf(spend.ticker);

  if (spend.crossesSwap) {
    requireSwapFloor(spend.ticker, spend.amount, spend.usdValue, spend.note);
  }

  withLock(() => {
    const spentSoFar = totalSpent(spend.ticker);
    const ceilingRaw = toRaw(ceiling, decimals);
    const after = spentSoFar + spend.amount;

    if (after > ceilingRaw) {
      throw new Error(
        `Run ceiling for ${spend.ticker} exceeded: ${format(after, decimals)} would be spent, ` +
          `the ceiling is ${ceiling}. Already spent ${format(spentSoFar, decimals)} in run ` +
          `'${runId()}'; this spend is ${format(spend.amount, decimals)} (${spend.note}). ` +
          `Ledger: ${ledgerPath()}`,
      );
    }

    append(spend);
  });
}

/** `usdValue` must come from the oracle at run time — a hardcoded one defeats the purpose. */
export function requireSwapFloor(
  ticker: string,
  amount: Raw,
  usdValue: number,
  note: string,
): void {
  // Resolved before the early return so a mistyped ticker fails the same way either way.
  const decimals = decimalsOf(ticker);

  if (!isEnforced()) {
    return;
  }

  // Inverted comparison: `NaN < 1` is false, and the natural miscalculations all produce NaN.
  if (!(usdValue >= SWAP_FLOOR_USD)) {
    throw new Error(
      `${format(amount, decimals)} ${ticker} is worth $${usdValue}, ` +
        `below the $${SWAP_FLOOR_USD} swap floor (${note}). An amount this small clears the ` +
        `contract minimum and then dies in the swap on rounding or slippage.`,
    );
  }
}

/** Rounds **up**: rounding down lands under the minimum the amount was sized to clear. */
export function rawAmountForUsd(
  usd: number,
  price: number,
  decimals: number,
): Raw {
  if (!(price > 0)) {
    throw new Error(`A price of ${price} cannot size an amount.`);
  }

  if (!(usd > 0)) {
    throw new Error(`A target value of $${usd} cannot size an amount.`);
  }

  const scale = 10 ** decimals;

  return BigInt(Math.ceil((usd / price) * scale));
}

export function decimalsOf(ticker: string): number {
  const decimals = DECIMALS[ticker];

  if (decimals === undefined) {
    throw new Error(
      `Unknown decimals for ${ticker}. Add it to DECIMALS in util/budget.ts or read it from ` +
        `the oracle's currencies.`,
    );
  }

  return decimals;
}

export function totalSpent(ticker: string): Raw {
  return entries()
    .filter((entry) => entry.ticker === ticker)
    .reduce((sum, entry) => sum + BigInt(entry.amount), 0n);
}

export function entries(): LedgerEntry[] {
  const file = ledgerPath();

  if (!fs.existsSync(file)) {
    return [];
  }

  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as LedgerEntry);
}

function append(spend: Spend): void {
  const file = ledgerPath();

  fs.mkdirSync(path.dirname(file), { recursive: true });

  const entry: LedgerEntry = {
    ticker: spend.ticker,
    amount: spend.amount.toString(),
    crossesSwap: spend.crossesSwap,
    note: spend.note,
    at: new Date().toISOString(),
  };

  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

/**
 * The ledger is a file, not process state: a per-file runner would otherwise reset a
 * module-level counter and enforce the ceiling once per file instead of once per run.
 */
function withLock<T>(action: () => T): T {
  const lock = `${ledgerPath()}.lock`;

  fs.mkdirSync(path.dirname(lock), { recursive: true });

  // Acquisition and action are separate try blocks: nesting them would route an error from
  // `action()` through the EEXIST check and silently retry a refusal.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let acquired = false;

    try {
      fs.mkdirSync(lock);
      acquired = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }

      sleepBriefly();
    }

    if (acquired) {
      try {
        return action();
      } finally {
        fs.rmSync(lock, { recursive: true, force: true });
      }
    }
  }

  throw new Error(
    `Could not take the budget lock at ${lock}. Remove it if no run is in progress.`,
  );
}

// Synchronous: an async wait would let a second spend start before the first was recorded.
function sleepBriefly(): void {
  const until = Date.now() + 20;

  while (Date.now() < until) {
    /* spin */
  }
}

function toRaw(human: number, decimals: number): Raw {
  return BigInt(Math.round(human * 10 ** decimals));
}

function format(amount: Raw, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, '0');

  return `${whole}.${fraction}`;
}
