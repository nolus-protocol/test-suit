import { ChainConstants } from '@nolus/nolusjs';

export const BLOCK_CREATION_TIME_DEV_SEC = 5;

export const NANOSEC = 1000000000;

export const NATIVE_MINIMAL_DENOM = ChainConstants.COIN_MINIMAL_DENOM;

export const gasPrice = 0.0025;
export const validatorPart = 0.6; // 60%

export const customFees = {
  upload: {
    gas: '20000000',
    amount: [
      {
        amount: Math.floor((20000000 * gasPrice) / validatorPart).toString(),
        denom: NATIVE_MINIMAL_DENOM,
      },
    ],
  },
  init: {
    gas: '500000',
    amount: [
      {
        amount: Math.floor((500000 * gasPrice) / validatorPart).toString(),
        denom: NATIVE_MINIMAL_DENOM,
      },
    ],
  },
  exec: {
    gas: '55000000',
    amount: [
      {
        amount: Math.floor((55000000 * gasPrice) / validatorPart).toString(),
        denom: NATIVE_MINIMAL_DENOM,
      },
    ],
  },
  transfer: {
    gas: '200000',
    amount: [
      {
        amount: Math.floor((200000 * gasPrice) / validatorPart).toString(),
        denom: NATIVE_MINIMAL_DENOM,
      },
    ],
  },
  configs: {
    gas: '300000',
    amount: [
      {
        amount: Math.floor((300000 * gasPrice) / validatorPart).toString(),
        denom: NATIVE_MINIMAL_DENOM,
      },
    ],
  },
};
export async function sleep(s: number): Promise<void> {
  await new Promise((r) => setTimeout(r, s * 1000));
}

export function undefinedHandler() {
  console.error('Error: undefined object');
}
