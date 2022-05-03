import { Coin } from './codec/cosmos/base/v1beta1/coin';

export const NOLUS_PREFIX = 'nolus';

export const NATIVE_TOKEN_DENOM = 'unolus';

export const DEFAULT_FEE = {
  amount: [{ denom: 'unolus', amount: '12' }],
  gas: '210000',
};

export const TEN_NOLUS: Coin[] = [{ denom: 'unolus', amount: '10_000_000' }];

export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export function undefinedHandler() {
  console.error('Error: undefined object');
}
