import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { sendInitTransferFeeTokens } from '../../../util/transfer';
import { getUser1Wallet } from '../../../util/clients';
import {
  BLOCK_CREATION_TIME_DEV_SEC,
  BORROWER_ATTEMPTS_TIMEOUT,
  customFees,
  sleep,
} from '../../../util/utils';
import { currencyTicker_To_IBC } from '../calculations';
import { getPaymentGroupCurrencies } from '../getters';

export async function checkLeaseBalance(
  leaseAddress: string,
  currenciesTickers: string[],
): Promise<boolean> {
  const cosm = await NolusClient.getInstance().getCosmWasmClient();
  let balanceState = false;
  currenciesTickers.forEach((ticker) => async () => {
    const tickerToIbc = currencyTicker_To_IBC(ticker);
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
  const allOpeningStates = [
    'open_ica_account',
    'transfer_out',
    'buy_asset',
    'transfer_in_init',
    'transfer_in_finish',
  ];
  let indexLastState = 0;
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

    // TO DO
    // const indexNewState = allOpeningStates.indexOf(newState);
    // if (indexLastState > indexNewState) {
    //   return new Error('The lease has been returned to its previous state');
    // }
    // indexLastState = indexNewState;
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

export async function findPriceLowerThanOneLPN(
  oracleInstance: NolusContracts.Oracle,
): Promise<string | undefined> {
  const paymentCurrencies = getPaymentGroupCurrencies();

  let result;
  for (let i = 0; i < paymentCurrencies.length; i++) {
    let priceObj;
    try {
      priceObj = await oracleInstance.getPriceFor(paymentCurrencies[i]);
    } catch (err) {
      console.log('No price for ', paymentCurrencies[i]);
    }

    if (typeof priceObj != 'undefined') {
      const price = +priceObj.amount.amount / +priceObj.amount_quote.amount;

      if (price < 1) {
        result = paymentCurrencies[i];
        console.log('Found ', result, ' price < 1 LPN = ', price);
      }
    }
  }

  return result;
}
