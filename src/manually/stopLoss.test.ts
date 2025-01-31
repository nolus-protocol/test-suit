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
import { calcLTV } from '../util/smart-contracts/calculations';

// These tests require the network to be specifically configured
// That`s why, they only work locally and in isolation, and only if this requirement is met!
// Suitable values are (Osmosis protocol):
// - for the Leaser config - {...,"lease_interest_rate_margin":30,"lease_position_spec":{"liability":{"initial":650,"healthy":700,"first_liq_warn":720,"second_liq_warn":750,"third_liq_warn":780,"max":800,"recalc_time":7200000000000},"min_asset":{"amount":"150","ticker":"<lpn>"},"min_transaction":{"amount":"1000","ticker":"<lpn>"}},..."lease_interest_payment":"lease_due_period":5184000000000000}
// - for the Oracle  config - {"config":{....,"price_config":{"min_feeders":500,"sample_period_secs":260,"samples_number":1,"discount_factor":750}},....}
// - for the LPP - {...,"min_utilization":0}
// - working dispatcher bot
// - !!! non-working feeder

// Before running -> update:
// - "alarmDispatcherPeriod" = the configured "poll_period_seconds" + 5 /take from the alarms-dispatcher bot config/
// - check and fill "leaseCurrency" and "validPriceLCtoLPN" (LC = "leaseCurrency")
// - "periodSecs" = configured "sample_period_secs" /take from the Oracle smart contract config/

describe.skip('Lease - Stop Loss tests', () => {
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

  const alarmDispatcherPeriod = 20; // DispatcherBot:poll_period_seconds + 5
  const periodSecs = 265; // Oracle:sample_period_secs + 5sec
  const leaseCurrency = 'NTRN';
  const validPriceLCtoLPN = 0.365; // amount_quote / amount
  const downpayment = '100000';

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

  async function executeStopLoss(
    leaseInstance: NolusContracts.Lease,
    SL: number,
  ) {
    await sendInitExecuteFeeTokens(
      userWithBalanceWallet,
      borrowerWallet.address as string,
    );

    await leaseInstance.changeClosePolicy(
      borrowerWallet,
      customFees.exec,
      SL,
      null,
    );

    const policy = (await leaseInstance.getLeaseStatus()).opened?.close_policy;

    expect(policy?.stop_loss).toBe(SL);

    const leaseCurrency = (await leaseInstance.getLeaseStatus()).opened?.amount
      .ticker;

    if (!leaseCurrency) {
      undefinedHandler();
      return;
    }

    const stateBeforeClose = (await leaseInstance.getLeaseStatus()).opened;

    if (!stateBeforeClose) {
      undefinedHandler();
      return;
    }

    const leaseAmount = +stateBeforeClose.amount.amount;
    const leaseDue = getLeaseObligations(stateBeforeClose, true);

    if (!leaseDue) {
      undefinedHandler();
      return;
    }

    const slPrice = (leaseDue * 1000) / (leaseAmount * SL);

    console.log('Waiting for the price to expire...');
    await sleep(periodSecs);
    console.log('Done');

    await pushPrice(slPrice);

    console.log('Waiting for the dispatcher bot...');
    await sleep(alarmDispatcherPeriod);
    await waitLeaseInProgressToBeNull(leaseInstance);

    const stateAfteClose = await leaseInstance.getLeaseStatus();
    expect(stateAfteClose.closed).toBeDefined();
  }

  async function prepareLease(): Promise<NolusContracts.Lease> {
    console.log('Waiting for the price to expire...');
    await sleep(periodSecs);
    console.log('Done');
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

  test('the lease is closed due to stop loss - should work as expected', async () => {
    const leaseInstance = await prepareLease();

    const currentLTV = await calcLTV(leaseInstance, oracleInstance);
    if (!currentLTV) {
      undefinedHandler();
      return;
    }
    const SL = currentLTV + 50; // +5%

    await executeStopLoss(leaseInstance, SL);
  });
});
