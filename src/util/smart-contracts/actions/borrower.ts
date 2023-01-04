import { NolusClient, NolusContracts } from '@nolus/nolusjs';
import { sleep } from '../../../util/utils';
import { createWallet } from '../../clients';
import { currencyTicker_To_IBC } from '../calculations';
import { pushPrice } from './oracle';

export async function provideLeasePrices(
  oracleInstance: NolusContracts.Oracle,
  leaseOrPaymentCurrency: string,
  lppCurrency: string,
): Promise<number> {
  // push price for leaseCurrency
  const feeder = await createWallet();
  const firstPriceMemberValue = '6000';
  const secondPriceMemberValue = '3000';
  await pushPrice(
    oracleInstance,
    feeder,
    leaseOrPaymentCurrency,
    lppCurrency,
    firstPriceMemberValue,
    secondPriceMemberValue,
  );
  const leaseCurrencyPrice = +firstPriceMemberValue / +secondPriceMemberValue;

  return leaseCurrencyPrice;
}

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
  const allStates = [
    'connecting',
    'account creating',
    'transfer-1',
    'transfer-2',
    'opened',
  ];
  let indexLastState = 0;
  let newState;

  do {
    await sleep(5);
    newState = JSON.stringify(await leaseInstance.getLeaseStatus());
    const indexNewState = allStates.indexOf(Object.keys(newState)[0]);
    if (indexLastState > indexNewState) {
      return new Error('Error');
    }
    indexLastState = indexNewState;
  } while (indexLastState != allStates.length - 1);

  return undefined;
}
