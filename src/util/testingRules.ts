export function runOrSkip(testsFlag: string) {
  return testsFlag.toLowerCase() === 'false' ? describe.skip : describe;
}
