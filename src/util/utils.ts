import { Coin } from './codec/cosmos/base/v1beta1/coin';

export const BLOCK_CREATION_TIME_DEV = 5000;

export const DEFAULT_FEE = {
  amount: [{ denom: 'unolus', amount: '12' }],
  gas: '2000000',
};

export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export function undefinedHandler() {
  console.error('Error: undefined object');
}
