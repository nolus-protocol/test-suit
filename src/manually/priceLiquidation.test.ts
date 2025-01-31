import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import NODE_ENDPOINT, {
  createWallet,
  getFeederWallet,
  getUser1Wallet,
  txSearchByEvents,
} from '../util/clients';
import { customFees, sleep, undefinedHandler } from '../util/utils';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import {
  findWasmEventPositions,
  getLeaseObligations,
} from '../util/smart-contracts/getters';
import { provideEnoughLiquidity } from '../util/smart-contracts/actions/lender';
import {
  openLease,
  waitLeaseInProgressToBeNull,
  waitLeaseOpeningProcess,
} from '../util/smart-contracts/actions/borrower';

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

describe.skip('Lease - Price Liquidation tests', () => {
  let cosm: CosmWasmClient;
  let borrowerWallet: NolusWallet;
  let userWithBalanceWallet: NolusWallet;
  let leaserInstance: NolusContracts.Leaser;
  let oracleInstance: NolusContracts.Oracle;
  let lppInstance: NolusContracts.Lpp;
  let feederWallet: NolusWallet;
  let leaserConfig: NolusContracts.LeaserConfig;
  let lpnCurrency: string;
  let downpaymentCurrency: string;
  let leaseAddress: string;
  let maxLiability: number;
  let w1Liability: number;
  let w2Liability: number;
  let w3Liability: number;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;
  const oracleContractAddress = process.env.ORACLE_ADDRESS as string;

  const alarmDispatcherPeriod = 15; // DispatcherBot:poll_period_seconds + 5
  const periodSecs = 265; // Oracle:sample_period_secs + 5sec
  const leaseCurrency = 'OSMO';
  const validPriceLCtoLPN = 0.1931;
  const downpayment = '1000000';

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    cosm = await NolusClient.getInstance().getCosmWasmClient();

    leaserInstance = new NolusContracts.Leaser(cosm, leaserContractAddress);
    lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);
    oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);

    borrowerWallet = await createWallet();
    userWithBalanceWallet = await getUser1Wallet();
    feederWallet = await getFeederWallet();

    leaserConfig = await leaserInstance.getLeaserConfig();
    maxLiability = leaserConfig.config.lease_position_spec.liability.max;
    w1Liability =
      leaserConfig.config.lease_position_spec.liability.first_liq_warn;
    w2Liability =
      leaserConfig.config.lease_position_spec.liability.second_liq_warn;
    w3Liability =
      leaserConfig.config.lease_position_spec.liability.third_liq_warn;

    lpnCurrency = process.env.LPP_BASE_CURRENCY as string;
    downpaymentCurrency = lpnCurrency;

    console.log('Waiting for the price to expire...');
    await sleep(periodSecs);
    console.log('Done');

    const leaseCurrencyPriceObj = () =>
      oracleInstance.getBasePrice(leaseCurrency);
    await expect(leaseCurrencyPriceObj).rejects.toThrow('No price');

    await pushPrice(validPriceLCtoLPN);

    await provideEnoughLiquidity(
      leaserInstance,
      lppInstance,
      downpayment,
      downpaymentCurrency,
      leaseCurrency,
    );
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

    // const priceAfterConfig = await oracleInstance.getPriceFor(leaseCurrency);

    // expect(
    //   +priceAfterConfig.amount_quote.amount / +priceAfterConfig.amount.amount,
    // ).toBe(price);
  }

  async function checkForLiquidationWarning(
    wPrice: number,
    warningLevel: number,
  ) {
    console.log('Waiting for the price to expire...');
    await sleep(periodSecs);
    console.log('Done');
    await pushPrice(wPrice);

    console.log('Waiting for the dispatcher bot...');
    await sleep(alarmDispatcherPeriod);
    console.log('Done');

    const txsCount = (
      await txSearchByEvents(
        `wasm-ls-liquidation-warning._contract_address='${leaseAddress}'`,
        undefined,
        undefined,
      )
    ).totalCount;

    const repayTxResponse = (
      await txSearchByEvents(
        `wasm-ls-liquidation-warning._contract_address='${leaseAddress}'`,
        txsCount,
        1,
      )
    ).txs;

    const wasmEventIndex = findWasmEventPositions(
      repayTxResponse[0].result,
      'wasm-ls-liquidation-warning',
    );

    expect(
      +repayTxResponse[0].result.events[
        wasmEventIndex[wasmEventIndex.length - 1]
      ].attributes[4].value,
    ).toBe(warningLevel);
  }

  test('liquidation due to a drop in price - should work as expected', async () => {
    leaseAddress = await openLease(
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

    const leasesBefore = await leaserInstance.getCurrentOpenLeasesByOwner(
      borrowerWallet.address as string,
    );

    await sendInitExecuteFeeTokens(
      userWithBalanceWallet,
      borrowerWallet.address as string,
    );

    const stateBeforeLiquidation = (await leaseInstance.getLeaseStatus())
      .opened;
    if (!stateBeforeLiquidation) {
      undefinedHandler();
      return;
    }

    const leaseAmount = +stateBeforeLiquidation.amount.amount;
    const leaseDue = getLeaseObligations(stateBeforeLiquidation, true);

    if (!leaseDue) {
      undefinedHandler();
      return;
    }

    const w1Price = (leaseDue * 1000) / (leaseAmount * w1Liability);
    const w2Price = (leaseDue * 1000) / (leaseAmount * w2Liability);
    const w3Price = (leaseDue * 1000) / (leaseAmount * w3Liability);

    const liquidationPrice = (leaseDue * 1000) / (leaseAmount * maxLiability);

    // w1
    console.log('Waiting for warning level 1...');
    await checkForLiquidationWarning(w1Price, 1);

    // w2
    console.log('Waiting for warning level 2...');
    await checkForLiquidationWarning(w2Price, 2);

    //w3
    console.log('Waiting for warning level 3...');
    await checkForLiquidationWarning(w3Price, 3);

    //max
    console.log('Waiting for the liquidation...');
    console.log('Waiting for the price to expire...');
    await sleep(periodSecs);
    console.log('Done');
    await pushPrice(liquidationPrice);

    console.log('Waiting for the dispatcher bot...');
    await sleep(alarmDispatcherPeriod);
    await waitLeaseInProgressToBeNull(leaseInstance);

    const stateAfterLiquidation = await leaseInstance.getLeaseStatus();

    if (stateAfterLiquidation.opened) {
      expect(+stateAfterLiquidation.opened.amount.amount).toBeLessThan(
        +stateBeforeLiquidation.amount.amount,
      );
    } else {
      expect(stateAfterLiquidation.liquidated).toBeDefined();

      const leasesAfter = await leaserInstance.getCurrentOpenLeasesByOwner(
        borrowerWallet.address as string,
      );
      expect(leasesAfter.length).toEqual(leasesBefore.length - 1);
    }
  });
});
