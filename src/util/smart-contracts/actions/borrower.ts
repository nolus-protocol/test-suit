import { NolusClient, NolusWallet } from '../../nolus';
import {
  sendInitExecuteFeeTokens,
  sendInitTransferFeeTokens,
} from '../../../util/transfer';
import { getUser1Wallet } from '../../../util/clients';
import {
  BLOCK_CREATION_TIME_DEV_SEC,
  LEASE_SETTLEMENT_TIMEOUT_SEC,
  customFees,
  NATIVE_MINIMAL_DENOM,
  sleep,
  undefinedHandler,
} from '../../../util/utils';
import { currencyTicker_To_IBC } from '../calculations';
import { provideEnoughLiquidity } from './lender';
import {
  getLeaseAddressFromOpenLeaseResponse,
  getLeaseObligations,
} from '../getters';
import {
  configLeasesMsg,
  Lease,
  LeaseConfig,
  Leaser,
  Lpp,
  Oracle,
} from '../../contracts';

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

async function pollLeaseStatus(
  leaseInstance: Lease,
): Promise<Awaited<ReturnType<Lease['getLeaseStatus']>> | undefined> {
  try {
    return await leaseInstance.getLeaseStatus();
  } catch (error) {
    console.log(
      `Lease state query failed, retrying on the next tick: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );

    return undefined;
  }
}

function timedOut(waitingFor: string, lastState: string | undefined): Error {
  return new Error(
    `Timed out after ${LEASE_SETTLEMENT_TIMEOUT_SEC}s waiting for the lease to ${waitingFor}. ` +
      `Last state: ${lastState ?? 'never read — every query failed'}.`,
  );
}

export async function waitLeaseOpeningProcess(
  leaseInstance: Lease,
): Promise<void> {
  let newState;
  const deadline = Date.now() + LEASE_SETTLEMENT_TIMEOUT_SEC * 1000;

  do {
    await sleep(BLOCK_CREATION_TIME_DEV_SEC);

    const fullState = await pollLeaseStatus(leaseInstance);

    if (fullState === undefined) {
      continue;
    }

    if (!fullState.opening) {
      console.log('Lease state - opened!');
      return;
    }
    newState = JSON.stringify(fullState.opening.in_progress);
    console.log('Lease opening is in progress: ', newState);
  } while (Date.now() < deadline);

  throw timedOut('open', newState);
}

export async function dispatchAlarms(timealarmsContractAddress: string) {
  const dispatchAlarmMsg = { dispatch_alarms: { max_count: 32000000 } };

  const userWithBalanceWallet = await getUser1Wallet();

  await userWithBalanceWallet.execute(
    userWithBalanceWallet.address as string,
    timealarmsContractAddress,
    dispatchAlarmMsg,
    {
      gas: '200000000',
      amount: [
        {
          amount: '200000000',
          denom: NATIVE_MINIMAL_DENOM,
        },
      ],
    },
  );
}

export async function waitLeaseInProgressToBeNull(
  leaseInstance: Lease,
  selfDispatch: boolean = false,
): Promise<void> {
  let newState;
  const deadline = Date.now() + LEASE_SETTLEMENT_TIMEOUT_SEC * 1000;

  do {
    if (selfDispatch) {
      await dispatchAlarms(process.env.TIMEALARMS_ADDRESS as string);
    }
    await sleep(BLOCK_CREATION_TIME_DEV_SEC);

    const fullState = await pollLeaseStatus(leaseInstance);

    if (fullState === undefined) {
      continue;
    }

    const settled =
      typeof fullState.opened?.status === 'string'
        ? fullState.opened.status
        : fullState.closed
          ? 'closed'
          : fullState.liquidated
            ? 'liquidated'
            : fullState.open_failed
              ? `open_failed: ${fullState.open_failed.reason}`
              : undefined;

    if (settled !== undefined) {
      console.log(`Lease state in_progress = null! Settled as: ${settled}`);
      return;
    }

    newState = JSON.stringify(
      fullState.opened?.status ??
        fullState.opening?.in_progress ??
        fullState.paid?.in_progress ??
        (fullState.closing && 'closing'),
    );
    console.log('Lease is in progress: ', newState);
  } while (Date.now() < deadline);

  throw timedOut('settle', newState);
}

export async function calcMinAllowablePaymentAmount(
  leaserInstance: Leaser,
  oracleInstance: Oracle,
  paymentCurrencyTicker: string,
  preferredPaymentAmount: string,
): Promise<string> {
  const minTransactionAmount = +(await leaserInstance.getLeaserConfig()).config
    .lease_config.position_spec.min_transaction.amount;

  const priceObj = await oracleInstance.getBasePrice(paymentCurrencyTicker);
  const price = +priceObj.amount.amount / +priceObj.amount_quote.amount;

  const additionAmount = 20;
  const payment = Math.floor(
    price * +minTransactionAmount + additionAmount,
  ).toString();

  return +payment > +preferredPaymentAmount ? payment : preferredPaymentAmount;
}

export async function openLease(
  leaserInstance: Leaser,
  lppInstance: Lpp,
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
    [{ denom: downpaymentCurrencyToIBC, amount: downpayment }],
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
    [{ denom: downpaymentCurrencyToIBC, amount: downpayment }],
  );

  return getLeaseAddressFromOpenLeaseResponse(result);
}

export async function closeLease(
  leaseInstance: Lease,
  borrowerWallet: NolusWallet,
  lppCurrency: string,
) {
  const userWithBalanceWallet = await getUser1Wallet();
  const excess = 1000;

  const lppCurrencyToIBC = await currencyTicker_To_IBC(lppCurrency);
  const currentLeaseState = (await leaseInstance.getLeaseStatus()).opened;

  if (!currentLeaseState) {
    undefinedHandler();
    return;
  }

  const leaseObligations = getLeaseObligations(currentLeaseState, true);

  if (!leaseObligations) {
    undefinedHandler();
    return;
  }

  const paymentAmount = leaseObligations + excess;

  const payment = {
    amount: paymentAmount.toString(),
    denom: lppCurrencyToIBC,
  };

  await userWithBalanceWallet.transferAmount(
    borrowerWallet.address as string,
    [payment],
    customFees.transfer,
  );
  await sendInitExecuteFeeTokens(
    userWithBalanceWallet,
    borrowerWallet.address as string,
  );

  await leaseInstance.repayLease(borrowerWallet, customFees.exec, [payment]);

  expect(await waitLeaseInProgressToBeNull(leaseInstance)).toBe(undefined);

  const leaseStateAfterRepay = await leaseInstance.getLeaseStatus();
  expect(leaseStateAfterRepay.closed).toBeDefined();

  const leaseCurrencyToIBC = await currencyTicker_To_IBC(
    currentLeaseState.amount.ticker as string,
  );

  await returnAmountToTheMainAccount(borrowerWallet, leaseCurrencyToIBC);
}

export async function restoreLeaserConfig(
  leaseAdminWallet: NolusWallet,
  expected: LeaseConfig,
): Promise<boolean> {
  const cosm = await NolusClient.getInstance().getCosmWasmClient();
  const leaserInstance = new Leaser(cosm, process.env.LEASER_ADDRESS as string);

  const current = (await leaserInstance.getLeaserConfig()).config.lease_config;

  if (JSON.stringify(current) === JSON.stringify(expected)) {
    return false;
  }

  const userWithBalance = await getUser1Wallet();
  await sendInitExecuteFeeTokens(
    userWithBalance,
    leaseAdminWallet.address as string,
  );

  await leaseAdminWallet.executeContract(
    process.env.LEASER_ADDRESS as string,
    configLeasesMsg(expected),
    customFees.configs,
  );

  return true;
}
