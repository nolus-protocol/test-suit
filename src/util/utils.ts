import { ChainConstants } from '@nolus/nolusjs';

export const BLOCK_CREATION_TIME_DEV_SEC = 5;

export const TONANOSEC = 1000000000;
export const PERMILLE_TO_PERCENT = 10;

export const NATIVE_MINIMAL_DENOM = ChainConstants.COIN_MINIMAL_DENOM;
export const NATIVE_TICKER = ChainConstants.COIN_DENOM.toUpperCase();
export const GASPRICE = 0.0025;

export const GAS_LIMIT = '100000000';
export const MIN_DEPOSIT_AMOUNT = process.env.GOV_MIN_DEPOSIT_NATIVE as string;
const rawValidatorPart = Number(process.env.VALIDATOR_FEE_PART);
export const VALIDATOR_PART = rawValidatorPart > 0 ? rawValidatorPart / 100 : 0;

export const BORROWER_ATTEMPTS_TIMEOUT = 300;

export const fee_divisor = VALIDATOR_PART === 0 ? 1 : VALIDATOR_PART;
export const customFees = {
  exec: {
    gas: '1300000',
    amount: [
      {
        amount: Math.floor((1300000 * GASPRICE) / fee_divisor).toString(),
        denom: NATIVE_MINIMAL_DENOM,
      },
    ],
  },
  transfer: {
    gas: '200000',
    amount: [
      {
        amount: Math.floor((200000 * GASPRICE) / fee_divisor).toString(),
        denom: NATIVE_MINIMAL_DENOM,
      },
    ],
  },
  configs: {
    gas: '500000',
    amount: [
      {
        amount: Math.floor((500000 * GASPRICE) / fee_divisor).toString(),
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
