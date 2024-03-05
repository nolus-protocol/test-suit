import { ChainConstants } from '@nolus/nolusjs';

export const BLOCK_CREATION_TIME_DEV_SEC = 5;

export const TONANOSEC = 1000000000;
export const PERMILLE_TO_PERCENT = 10;

export const NATIVE_MINIMAL_DENOM = ChainConstants.COIN_MINIMAL_DENOM;
export const NATIVE_TICKER = ChainConstants.COIN_DENOM.toUpperCase();
export const GASPRICE = 0.0025;

export const GAS_LIMIT = '100000000';
export const MIN_DEPOSIT_AMOUNT = process.env.GOV_MIN_DEPOSIT_NATIVE as string;
export const VALIDATOR_PART = +(process.env.VALIDATOR_FEE_PART as string) / 100; // %

const alarmsOccurred = 100;

export const defaultTip = { amount: '300', denom: NATIVE_MINIMAL_DENOM };
export const noProvidedPriceFor = process.env.NO_PRICE_CURRENCY as string;

export const BORROWER_ATTEMPTS_TIMEOUT = 300;

export const customFees = {
  upload: {
    gas: '20000000',
    amount: [
      {
        amount: Math.floor((20000000 * GASPRICE) / VALIDATOR_PART).toString(),
        denom: NATIVE_MINIMAL_DENOM,
      },
    ],
  },
  init: {
    gas: '500000',
    amount: [
      {
        amount: Math.floor((500000 * GASPRICE) / VALIDATOR_PART).toString(),
        denom: NATIVE_MINIMAL_DENOM,
      },
    ],
  },
  exec: {
    gas: '1000000',
    amount: [
      {
        amount: Math.floor((1000000 * GASPRICE) / VALIDATOR_PART).toString(),
        denom: NATIVE_MINIMAL_DENOM,
      },
    ],
  },
  transfer: {
    gas: '200000',
    amount: [
      {
        amount: Math.floor((200000 * GASPRICE) / VALIDATOR_PART).toString(),
        denom: NATIVE_MINIMAL_DENOM,
      },
    ],
  },
  configs: {
    gas: '500000',
    amount: [
      {
        amount: Math.floor((500000 * GASPRICE) / VALIDATOR_PART).toString(),
        denom: NATIVE_MINIMAL_DENOM,
      },
    ],
  },
  feedPrice: {
    gas: '900000',
    amount: [
      {
        amount: Math.floor(
          (900000 * alarmsOccurred * GASPRICE) / VALIDATOR_PART,
        ).toString(),
        denom: NATIVE_MINIMAL_DENOM,
      },
    ],
  },
};

export async function sleep(secs: number): Promise<void> {
  await new Promise((r) => setTimeout(r, secs * 1000));
}

export function undefinedHandler() {
  console.error('Error: undefined object');
}
