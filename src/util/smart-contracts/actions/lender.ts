import { getUser1Wallet } from '../../clients';
import { customFees } from '../../utils';
import { currencyTicker_To_IBC } from '../calculations';
import { Leaser, Lpp } from '../../contracts';

const DEPOSIT_AMOUNT_LPP = '100000';

const NO_LIQUIDITY = 'No Liquidity';
const MAX_DEPOSITS = 20;

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function provideEnoughLiquidity(
  leaserInstance: Leaser,
  lppInstance: Lpp,
  downpayment: string,
  downpaymentCurrency: string,
  leaseCurrency: string,
) {
  const userWithBalanceWallet = await getUser1Wallet();
  const lppCurrencyToIBC = await currencyTicker_To_IBC(
    process.env.LPP_BASE_CURRENCY as string,
  );

  for (let deposits = 0; deposits <= MAX_DEPOSITS; deposits++) {
    try {
      await leaserInstance.leaseQuote(
        downpayment,
        downpaymentCurrency,
        leaseCurrency,
      );

      return;
    } catch (error) {
      const reason = reasonOf(error);

      if (!reason.includes(NO_LIQUIDITY)) {
        throw error;
      }

      if (deposits === MAX_DEPOSITS) {
        throw new Error(
          `The LPP still cannot quote a ${downpayment} ${downpaymentCurrency} downpayment into ` +
            `${leaseCurrency} after ${MAX_DEPOSITS} deposits of ${DEPOSIT_AMOUNT_LPP}. Top the ` +
            `LPP up by hand, or lower the downpayment — this stops here rather than depositing ` +
            `the account dry.`,
        );
      }

      const held = BigInt(
        (
          await userWithBalanceWallet.getBalance(
            userWithBalanceWallet.address as string,
            lppCurrencyToIBC,
          )
        ).amount,
      );

      if (held < BigInt(DEPOSIT_AMOUNT_LPP)) {
        throw new Error(
          `The LPP cannot quote a ${downpayment} ${downpaymentCurrency} downpayment into ` +
            `${leaseCurrency} for want of liquidity, and the main account holds ${held} of ` +
            `${lppCurrencyToIBC} — less than the ${DEPOSIT_AMOUNT_LPP} one deposit costs. Fund ` +
            `the account or top the LPP up by hand.`,
        );
      }

      await lppInstance.deposit(userWithBalanceWallet, customFees.exec, [
        { denom: lppCurrencyToIBC, amount: DEPOSIT_AMOUNT_LPP },
      ]);
    }
  }
}
