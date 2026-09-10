type DescribeBlock = (name: string, fn: jest.EmptyFunction) => void;
type TestBlock = (
  name: string,
  fn?: jest.ProvidesCallback,
  timeout?: number,
) => void;

/**
 * Exact fee-profit and liquidity deltas only hold where nothing else moves on the chain. This
 * suite runs against a live network, where other traffic settles between the two reads, so the
 * assertions guarded by this constant are off. Kept rather than deleted: stage 2 decides whether
 * they survive.
 */
export const ASSERT_EXACT_DELTAS: boolean = false;

/**
 * Needs a privileged key, so it runs wherever that key is configured. For a case that attempts a
 * mutation and is *rejected*; a case that would succeed cannot run against a live network and is
 * skipped outright at its call site.
 */
export const withLeaseAdmin = describeWhen(
  keyIsSet('LEASE_ADMIN_PRIV_KEY'),
  'needs LEASE_ADMIN_PRIV_KEY',
);
export const withLeaseAdminTest = testWhen(
  keyIsSet('LEASE_ADMIN_PRIV_KEY'),
  'needs LEASE_ADMIN_PRIV_KEY',
);
export const withFeeder = describeWhen(
  keyIsSet('FEEDER_PRIV_KEY'),
  'needs FEEDER_PRIV_KEY',
);
export const withFeederTest = testWhen(
  keyIsSet('FEEDER_PRIV_KEY'),
  'needs FEEDER_PRIV_KEY',
);
export const withDexAdmin = describeWhen(
  keyIsSet('DEX_ADMIN_PRIV_KEY'),
  'needs DEX_ADMIN_PRIV_KEY',
);
export const withDexAdminTest = testWhen(
  keyIsSet('DEX_ADMIN_PRIV_KEY'),
  'needs DEX_ADMIN_PRIV_KEY',
);

export const runIfLenderDepositRestriction = testWhen(
  hasDepositCapacity,
  'needs a non-zero LENDER_DEPOSIT_CAPACITY',
);

export const describeIfLenderDepositRestriction = describeWhen(
  hasDepositCapacity,
  'needs a non-zero LENDER_DEPOSIT_CAPACITY',
);

export function runOrSkip(testsFlag: string) {
  return testsFlag.toLowerCase() === 'false' ? describe.skip : describe;
}

// Gates resolve on use, not on import: a key read at import time would be read before the env
// file is loaded.
function describeWhen(allowed: () => boolean, reason: string): DescribeBlock {
  return (name, fn) => {
    if (allowed()) {
      describe(name, synchronousOnly(name, fn));
      return;
    }

    describe.skip(`${name} [skipped: ${reason}]`, synchronousOnly(name, fn));
  };
}

// TypeScript accepts an `async () => …` where `() => void` is expected, and jest would invoke it
// at collection and never await it — so a spend written under `withFeeder` instead of
// `withFeederTest` would broadcast outside any test.
function synchronousOnly(
  name: string,
  fn: jest.EmptyFunction,
): jest.EmptyFunction {
  return () => {
    const returned = fn() as unknown;

    if (returned !== undefined) {
      throw new Error(
        `The body of '${name}' returned a value, so it is asynchronous. A describe body must be ` +
          `synchronous — use the matching *Test gate for a single asynchronous case.`,
      );
    }
  };
}

function testWhen(allowed: () => boolean, reason: string): TestBlock {
  return (name, fn, timeout) => {
    if (allowed()) {
      test(name, fn, timeout);
      return;
    }

    test.skip(`${name} [skipped: ${reason}]`, fn, timeout);
  };
}

/** Whether a privileged key is configured. Placeholders count as absent. */
function hasCapabilityKey(name: string): boolean {
  return isSet(process.env[name]);
}

function keyIsSet(name: string) {
  return () => hasCapabilityKey(name);
}

// The env prep writes jq's `null` for a field it could not resolve, so a gate must not read that
// as a real key.
function isSet(value: string | undefined) {
  const trimmed = value?.trim();

  return (
    trimmed !== undefined &&
    trimmed !== '' &&
    trimmed !== 'null' &&
    trimmed !== 'undefined'
  );
}

// `+('null')` is NaN and `NaN !== 0` is true, which would report a capacity that does not exist.
function hasDepositCapacity() {
  const capacity = process.env.LENDER_DEPOSIT_CAPACITY;

  return isSet(capacity) && +(capacity as string) !== 0;
}
