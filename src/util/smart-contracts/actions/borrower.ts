import { NolusClient, NolusContracts } from '@nolus/nolusjs';
import { sleep } from '../../../util/utils';
import { currencyTicker_To_IBC } from '../calculations';

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
  const allOpeningStates = ['open_ica_account', 'transfer_out', 'buy_asset'];
  let indexLastState = 0;
  let newState;
  let timeout = 30;

  do {
    await sleep(5);
    const fullState = await leaseInstance.getLeaseStatus();
    if (!fullState.opening) return undefined;

    newState = JSON.stringify(fullState.opening.in_progress);
    const indexNewState = allOpeningStates.indexOf(Object.keys(newState)[0]);
    if (indexLastState > indexNewState) {
      return new Error('Error');
    }
    indexLastState = indexNewState;
    timeout -= 1;
  } while (timeout > 0);

  return undefined;
}
