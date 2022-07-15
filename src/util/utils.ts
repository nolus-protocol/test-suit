import { ChainConstants } from '@nolus/nolusjs';

export const BLOCK_CREATION_TIME_DEV = 5000;

const NATIVE_MINIMAL_DENOM = ChainConstants.COIN_MINIMAL_DENOM;

export const customFees = {
  upload: {
    amount: [{ amount: '3000', denom: NATIVE_MINIMAL_DENOM }],
    gas: '500000',
  },
  init: {
    amount: [{ amount: '3000', denom: NATIVE_MINIMAL_DENOM }],
    gas: '500000',
  },
  exec: {
    amount: [{ amount: '5000', denom: NATIVE_MINIMAL_DENOM }],
    gas: '600000',
  },
  transfer: {
    amount: [{ denom: NATIVE_MINIMAL_DENOM, amount: '700' }],
    gas: '150000',
  },
  configs: {
    amount: [{ denom: NATIVE_MINIMAL_DENOM, amount: '1500' }],
    gas: '300000',
  },
};
export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export function undefinedHandler() {
  console.error('Error: undefined object');
}
