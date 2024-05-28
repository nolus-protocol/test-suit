import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import {
  sendInitExecuteFeeTokens,
  sendInitTransferFeeTokens,
} from '../../../util/transfer';
import { getUser1Wallet } from '../../../util/clients';
import {
  BLOCK_CREATION_TIME_DEV_SEC,
  BORROWER_ATTEMPTS_TIMEOUT,
  customFees,
  defaultTip,
  sleep,
} from '../../../util/utils';
import { currencyTicker_To_IBC } from '../calculations';
import { provideEnoughLiquidity } from './lender';
import { getLeaseAddressFromOpenLeaseResponse } from '../getters';

export async function checkLeaseBalance(
  leaseAddress: string,
  currenciesTickers: string[],
): Promise<boolean> {
  const cosm = await NolusClient.getInstance().getCosmWasmClient();
  let balanceState = false;
  currenciesTickers.forEach((ticker) => async () => {
    const tickerToIbc = await currencyTicker_To_IBC(ticker);
    const leaseBalance = await cosm.getBalance(leaseAddress, tickerToIbc);

    if (leaseBalance.amount) balanceState = true;
  });

  return balanceState;
}

export async function returnAmountToTheMainAccount(
  from: NolusWallet,
  denom: string,
) {
  const balance = await from.getBalance(from.address as string, denom);

  if (+balance.amount > 0) {
    const mainAccount = await getUser1Wallet();
    await sendInitTransferFeeTokens(mainAccount, from.address as string);
    await from.transferAmount(
      mainAccount.address as string,
      [balance],
      customFees.transfer,
    );
  }
}

export async function waitLeaseOpeningProcess(
  leaseInstance: NolusContracts.Lease,
): Promise<Error | undefined> {
  let newState;
  let timeout = BORROWER_ATTEMPTS_TIMEOUT;

  do {
    await sleep(BLOCK_CREATION_TIME_DEV_SEC);
    const fullState = await leaseInstance.getLeaseStatus();
    if (!fullState.opening) {
      console.log('Lease state - opened!');
      return undefined;
    }
    newState = JSON.stringify(fullState.opening.in_progress);
    console.log('Lease opening is in progress: ', newState);

    timeout--;
  } while (timeout > 0);

  return new Error('Timeout');
}

export async function waitLeaseInProgressToBeNull(
  leaseInstance: NolusContracts.Lease,
): Promise<Error | undefined> {
  let newState;
  let timeout = BORROWER_ATTEMPTS_TIMEOUT;

  do {
    await sleep(BLOCK_CREATION_TIME_DEV_SEC);
    const fullState = await leaseInstance.getLeaseStatus();
    if (
      fullState.opened?.in_progress === null ||
      fullState.paid?.in_progress === null ||
      fullState.closed ||
      fullState.liquidated
    ) {
      console.log('Lease state in_progress = null!');
      return undefined;
    }
    newState = JSON.stringify(
      fullState.opened?.in_progress || fullState.paid?.in_progress,
    );
    console.log('Lease is in progress: ', newState);
    timeout--;
  } while (timeout > 0);

  return new Error('Timeout');
}

export async function calcMinAllowablePaymentAmount(
  leaserInstance: NolusContracts.Leaser,
  oracleInstance: NolusContracts.Oracle,
  paymentCurrencyTicker: string,
  preferredPaymentAmount: string,
): Promise<string> {
  const minTransactionAmount = +(await leaserInstance.getLeaserConfig()).config
    .lease_position_spec.min_transaction.amount;

  const priceObj = await oracleInstance.getBasePrice(paymentCurrencyTicker);
  const price = +priceObj.amount.amount / +priceObj.amount_quote.amount;

  const additionAmount = 20;
  const payment = Math.floor(
    price * +minTransactionAmount + additionAmount,
  ).toString();

  return payment > preferredPaymentAmount ? payment : preferredPaymentAmount;
}

export async function openLease(
  leaserInstance: NolusContracts.Leaser,
  lppInstance: NolusContracts.Lpp,
  downpayment: string,
  downpaymentCurrency: string,
  leaseCurrency: string,
  borrowerWallet: NolusWallet,
): Promise<string> {
  const userWithBalanceWallet = await getUser1Wallet();
  const downpaymentCurrencyToIBC =
    await currencyTicker_To_IBC(downpaymentCurrency);

  await provideEnoughLiquidity(
    leaserInstance,
    lppInstance,
    downpayment,
    downpaymentCurrency,
    leaseCurrency,
  );

  await userWithBalanceWallet.transferAmount(
    borrowerWallet.address as string,
    [{ denom: downpaymentCurrencyToIBC, amount: downpayment }, defaultTip],
    customFees.transfer,
  );
  await sendInitExecuteFeeTokens(
    userWithBalanceWallet,
    borrowerWallet.address as string,
  );

  const result = await leaserInstance.openLease(
    borrowerWallet,
    leaseCurrency,
    customFees.exec,
    undefined,
    [{ denom: downpaymentCurrencyToIBC, amount: downpayment }, defaultTip],
  );

  return getLeaseAddressFromOpenLeaseResponse(result);
}
