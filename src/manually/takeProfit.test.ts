import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import NODE_ENDPOINT, {
  createWallet,
  getFeederWallet,
  getUser1Wallet,
} from '../util/clients';
import { customFees, sleep, undefinedHandler } from '../util/utils';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import { getLeaseObligations } from '../util/smart-contracts/getters';
import { provideEnoughLiquidity } from '../util/smart-contracts/actions/lender';
import {
  openLease,
  waitLeaseInProgressToBeNull,
  waitLeaseOpeningProcess,
} from '../util/smart-contracts/actions/borrower';
import {
  calcLTV,
  currencyTicker_To_IBC,
} from '../util/smart-contracts/calculations';

// These tests require the network to be specifically configured
// That`s why, they only work locally and in isolation, and only if this requirement is met!
// Suitable values are (Osmosis protocol):
// - for the Leaser config - {...,"lease_max_slippage":{"liquidation":900},"lease_interest_rate_margin":30,"lease_position_spec":{"liability":{"initial":650,"healthy":700,"first_liq_warn":720,"second_liq_warn":750,"third_liq_warn":780,"max":800,"recalc_time":7200000000000},"min_asset":{"amount":"150","ticker":"<lpn>"},"min_transaction":{"amount":"1000","ticker":"<lpn>"}},..."lease_interest_payment":"lease_due_period":5184000000000000}
// - for the Oracle  config - {"config":{....,"price_config":{"min_feeders":500,"sample_period_secs":260,"samples_number":1,"discount_factor":750}},....}
// - for the LPP - {...,"min_utilization":0}
// - working dispatcher bot
// - !!! non-working feeder

// Before running -> update:
// - "alarmDispatcherPeriod" = the configured "poll_period_seconds" + 5 /take from the alarms-dispatcher bot config/
// - check and fill "leaseCurrency" and "validPriceLCtoLPN" (LC = "leaseCurrency")
// - "periodSecs" = configured "sample_period_secs" /take from the Oracle smart contract config/

describe.skip('Lease - Take Profit tests', () => {
  let cosm: CosmWasmClient;
  let borrowerWallet: NolusWallet;
  let userWithBalanceWallet: NolusWallet;
  let leaserInstance: NolusContracts.Leaser;
  let oracleInstance: NolusContracts.Oracle;
  let lppInstance: NolusContracts.Lpp;
  let feederWallet: NolusWallet;
  let lpnCurrency: string;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;
  const oracleContractAddress = process.env.ORACLE_ADDRESS as string;

  const alarmDispatcherPeriod = 100; // DispatcherBot:poll_period_seconds + 5
  const leaseCurrency = 'NTRN';
  const validPriceLCtoLPN = 0.284; // amount_quote / amount
  const downpayment = '500000';

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    cosm = await NolusClient.getInstance().getCosmWasmClient();

    leaserInstance = new NolusContracts.Leaser(cosm, leaserContractAddress);
    lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);
    oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);

    borrowerWallet = await createWallet();
    userWithBalanceWallet = await getUser1Wallet();
    feederWallet = await getFeederWallet();

    lpnCurrency = process.env.LPP_BASE_CURRENCY as string;
  });

  async function pushPrice(price: number) {
    let amount = 2;

    const length = price.toString().split('.')[1].length;
    const amountQuote = Math.trunc(price * Math.pow(10, length) * amount);
    amount = amount * Math.pow(10, length);

    const priceObj = {
      prices: [
        {
          amount: { amount: amount.toString(), ticker: leaseCurrency },
          amount_quote: {
            amount: amountQuote.toString(),
            ticker: lpnCurrency,
          },
        },
      ],
    };

    await userWithBalanceWallet.transferAmount(
      feederWallet.address as string,
      customFees.exec.amount,
      customFees.transfer,
    );

    await oracleInstance.feedPrices(feederWallet, priceObj, customFees.exec);
  }

  async function prepareLease(): Promise<NolusContracts.Lease> {
    await pushPrice(validPriceLCtoLPN);

    const downpaymentCurrency = lpnCurrency;

    await provideEnoughLiquidity(
      leaserInstance,
      lppInstance,
      downpayment,
      downpaymentCurrency,
      leaseCurrency,
    );

    const leaseAddress = await openLease(
      leaserInstance,
      lppInstance,
      downpayment,
      downpaymentCurrency,
      leaseCurrency,
      borrowerWallet,
    );

    console.log('Lease address: ', leaseAddress);

    const leaseInstance = new NolusContracts.Lease(cosm, leaseAddress);
    expect(await waitLeaseOpeningProcess(leaseInstance)).toBe(undefined);

    return leaseInstance;
  }

  async function checkIfTPisReset(
    leaseInstance: NolusContracts.Lease,
    TP: number,
  ) {
    const LTVafterPayment = await calcLTV(leaseInstance, oracleInstance);
    expect(LTVafterPayment).toBeLessThan(TP);

    const policyAfterPayment = (await leaseInstance.getLeaseStatus()).opened
      ?.close_policy;

    expect(policyAfterPayment?.take_profit).toBe(null);
  }

  async function changeTP(leaseInstance: NolusContracts.Lease, TP: number) {
    await sendInitExecuteFeeTokens(
      userWithBalanceWallet,
      borrowerWallet.address as string,
    );

    await leaseInstance.changeClosePolicy(
      borrowerWallet,
      customFees.exec,
      null,
      TP,
    );

    const policy = (await leaseInstance.getLeaseStatus()).opened?.close_policy;
    expect(policy?.take_profit).toBe(TP);
  }

  test('take profit reached after repayment should not be triggered - should work as expected', async () => {
    const leaseInstance = await prepareLease();

    const currentLTV = await calcLTV(leaseInstance, oracleInstance);
    if (!currentLTV) {
      undefinedHandler();
      return;
    }
    const TP = currentLTV - 10; // -1%
    await changeTP(leaseInstance, TP);

    await pushPrice(validPriceLCtoLPN);

    const leaseState = (await leaseInstance.getLeaseStatus()).opened;

    if (!leaseState) {
      undefinedHandler();
      return;
    }

    const paymentCurrency = lpnCurrency;
    const paymentCurrencyToIBC = await currencyTicker_To_IBC(paymentCurrency);

    expect(paymentCurrencyToIBC).not.toBe('');

    const paymentAmount = Math.trunc(+leaseState.principal_due.amount / 3);

    const payment = {
      denom: paymentCurrencyToIBC,
      amount: paymentAmount.toString(),
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

    expect(await waitLeaseInProgressToBeNull(leaseInstance, true)).toBe(
      undefined,
    );

    await checkIfTPisReset(leaseInstance, TP);

    const leaseStateAfter = await leaseInstance.getLeaseStatus();
    expect(leaseStateAfter.opened).toBeDefined();
  });

  test('take profit reached after liquidation should not be triggered - should work as expected', async () => {
    const leaseInstance = await prepareLease();

    const leaserConfig = await leaserInstance.getLeaserConfig();
    const maxLiability = leaserConfig.config.lease_position_spec.liability.max;

    const currentLTV = await calcLTV(leaseInstance, oracleInstance);
    if (!currentLTV) {
      undefinedHandler();
      return;
    }
    const TP = currentLTV - 50; // -5%
    await changeTP(leaseInstance, TP);

    const stateBeforeLiquidation = (await leaseInstance.getLeaseStatus())
      .opened;

    if (!stateBeforeLiquidation) {
      undefinedHandler();
      return;
    }

    const leaseAmountBeforeLiquidation = +stateBeforeLiquidation.amount.amount;
    const leaseDueBeforeLiquidation = getLeaseObligations(
      stateBeforeLiquidation,
      true,
    );

    if (!leaseDueBeforeLiquidation) {
      undefinedHandler();
      return;
    }

    const price =
      (leaseDueBeforeLiquidation * 1000) /
      (leaseAmountBeforeLiquidation * maxLiability);

    await pushPrice(price);

    console.log('Waiting for the dispatcher bot...');
    await sleep(alarmDispatcherPeriod);
    await waitLeaseInProgressToBeNull(leaseInstance, true);

    const stateAfterLiquidation = await leaseInstance.getLeaseStatus();

    if (stateAfterLiquidation.opened) {
      expect(+stateAfterLiquidation.opened.amount.amount).toBeLessThan(
        +stateBeforeLiquidation.amount.amount,
      );

      await checkIfTPisReset(leaseInstance, TP);
    } else {
      expect(stateAfterLiquidation.liquidated).toBeDefined();
    }
  });

  test('take profit reached after partial close should not be triggered - should work as expected', async () => {
    const leaseInstance = await prepareLease();

    const currentLTV = await calcLTV(leaseInstance, oracleInstance);
    if (!currentLTV) {
      undefinedHandler();
      return;
    }
    const TP = currentLTV - 50; // -5%

    await changeTP(leaseInstance, TP);

    const stateBeforeClose = (await leaseInstance.getLeaseStatus()).opened;

    if (!stateBeforeClose) {
      undefinedHandler();
      return;
    }

    const leaseAmountBeforeClose = +stateBeforeClose.amount.amount;

    const closeAmountValue = Math.trunc(leaseAmountBeforeClose / 2);

    const amountToClose = {
      amount: closeAmountValue.toString(),
      ticker: stateBeforeClose.amount.ticker,
    };

    await sendInitExecuteFeeTokens(
      userWithBalanceWallet,
      borrowerWallet.address as string,
    );

    await leaseInstance.closePositionLease(
      borrowerWallet,
      customFees.exec,
      amountToClose,
    );

    expect(await waitLeaseInProgressToBeNull(leaseInstance, true)).toBe(
      undefined,
    );

    await checkIfTPisReset(leaseInstance, TP);

    const leaseStateAfter = await leaseInstance.getLeaseStatus();
    expect(leaseStateAfter.opened).toBeDefined();
  });

  test('the lease is closed due to take profit - should work as expected', async () => {
    const leaseInstance = await prepareLease();

    const currentLTV = await calcLTV(leaseInstance, oracleInstance);
    if (!currentLTV) {
      undefinedHandler();
      return;
    }

    const TP = currentLTV - 50; // -5%
    await changeTP(leaseInstance, TP);

    const leaseState = (await leaseInstance.getLeaseStatus()).opened;

    if (!leaseState) {
      undefinedHandler();
      return;
    }

    const leaseAmountBeforeLiquidation = +leaseState.amount.amount;
    const leaseDueBeforeLiquidation = getLeaseObligations(leaseState, true);

    if (!leaseDueBeforeLiquidation) {
      undefinedHandler();
      return;
    }

    const tpPrice =
      (leaseDueBeforeLiquidation * 1000) /
      (leaseAmountBeforeLiquidation * (TP - 50)); // -5%, TP should be < LTV, not equal

    await pushPrice(tpPrice);

    console.log('Waiting for the dispatcher bot...');
    await sleep(alarmDispatcherPeriod);
    await waitLeaseInProgressToBeNull(leaseInstance, true);

    const leaseStateAfter = await leaseInstance.getLeaseStatus();
    expect(leaseStateAfter.closed).toBeDefined();
  });
});
