export const runTestIfLocal = ifLocal() ? test : test.skip;
export const runTestIfDev = ifDev() ? test : test.skip;
export const runIfLenderDepositRestriction = ifDepositCapacity()
  ? test
  : test.skip;

export function runOrSkip(testsFlag: string) {
  return testsFlag.toLowerCase() === 'false' ? describe.skip : describe;
}

export function ifLocal() {
  return (process.env.ENV as string) === 'local';
}

export function ifDev() {
  return (process.env.ENV as string) === 'dev';
}

function ifDepositCapacity() {
  const capacity = process.env.LENDER_DEPOSIT_CAPACITY as string;

  return +capacity !== 0 && capacity != null;
}
