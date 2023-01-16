export const runTestIfLocal = ifLocal() ? test : test.skip;

export function runOrSkip(testsFlag: string) {
  return testsFlag.toLowerCase() === 'false' ? describe.skip : describe;
}

export function ifLocal() {
  return (process.env.ENV as string) === 'local';
}
