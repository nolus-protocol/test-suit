import { NolusContracts } from '@nolus/nolusjs';
import { getUser1Wallet } from '../../clients';
import { customFees } from '../../utils';
import { currencyTicker_To_IBC } from '../calculations';

export async function provideEnoughLiquidity(
  leaserInstance: NolusContracts.Leaser,
  lppInstance: NolusContracts.Lpp,
  downpayment: string,
  downpaymentCurrency: string,
  leaseCurrency: string,
) {
  const depositAmountLPP = '1000';
  const userWithBalanceWallet = await getUser1Wallet();
  const lppCurrencyToIBC = currencyTicker_To_IBC(
    (await lppInstance.getLppConfig()).lpn_ticker,
  );
  let quote;
  do {
    try {
      quote = await leaserInstance.leaseQuote(
        downpayment,
        downpaymentCurrency,
        leaseCurrency,
      );
    } catch (err) {
      console.log(err);
      await lppInstance.deposit(userWithBalanceWallet, customFees.exec, [
        { denom: lppCurrencyToIBC, amount: depositAmountLPP },
      ]);
    }
  } while (!quote);
}
