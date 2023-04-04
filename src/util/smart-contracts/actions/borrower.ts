import { NolusClient, NolusContracts } from '@nolus/nolusjs';
import { BLOCK_CREATION_TIME_DEV_SEC, sleep } from '../../../util/utils';
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
  let timeout = 30;

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
    timeout = timeout - 1;
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
        console.log('Found ', result, ' price = ', price);
      }
    }
  }
  return result;
}
