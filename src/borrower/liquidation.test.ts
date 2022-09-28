import NODE_ENDPOINT, {
  createWallet,
  getUser1Wallet,
  getWasmAdminWallet,
} from '../util/clients';
import {
  customFees,
  NATIVE_MINIMAL_DENOM,
  sleep,
  undefinedHandler,
} from '../util/utils';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import { LeaserConfig } from '@nolus/nolusjs/build/contracts';
import {
  getLeaseAddressFromOpenLeaseResponse,
  removeAllFeeders,
} from '../util/smart-contracts';

describe('Borrower tests - Liquidation', () => {
  let wasmAdminWallet: NolusWallet;
  let cosm: any;
  let borrowerWallet: NolusWallet;
  let feederWallet: NolusWallet;
  let priceFeederWallet: NolusWallet;
  let leaserInstance: NolusContracts.Leaser;
  let oracleInstance: NolusContracts.Oracle;
  let lppInstance: NolusContracts.Lpp;
  let leaserConfigBefore: NolusContracts.LeaserConfig;
  let oracleConfigBefore: NolusContracts.Config;
  let lppDenom: string;
  let mainLeaseAddress: string;
  let liquidatedLeaseAddress: string;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;
  const oracleContractAddress = process.env.ORACLE_ADDRESS as string;

  let leaserConfigMsg: LeaserConfig;

  const newPeriodNanosec = 10000000000;
  const newGracePeriodNanosec = 5000000000;
  const nanosec = 1000000000;
  const downpayment = '1000000000';

  async function pushPrice(priceFeederWallet: NolusWallet) {
    //remove all feeders
    await removeAllFeeders(oracleInstance, wasmAdminWallet);

    //add feeder
    await sendInitExecuteFeeTokens(
      feederWallet,
      wasmAdminWallet.address as string,
    );

    await oracleInstance.addFeeder(
      wasmAdminWallet,
      priceFeederWallet.address as string,
      customFees.exec,
    );

    const isFeeder = await oracleInstance.isFeeder(
      priceFeederWallet.address as string,
    );
    expect(isFeeder).toBe(true);

    const supportedPairsBefore = await oracleInstance.getSupportedPairs();

    const newSupportedPairs = supportedPairsBefore.slice();
    newSupportedPairs.push([NATIVE_MINIMAL_DENOM, lppDenom]);

    await sendInitExecuteFeeTokens(
      feederWallet,
      wasmAdminWallet.address as string,
    );

    await oracleInstance.updateSupportPairs(
      wasmAdminWallet,
      newSupportedPairs,
      customFees.exec,
    );

    const feedPrices = {
      prices: [
        {
          amount: { amount: '11', symbol: NATIVE_MINIMAL_DENOM }, // any amount
          amount_quote: { amount: '1', symbol: lppDenom }, // any amount
        },
      ],
    };

    await sendInitExecuteFeeTokens(
      feederWallet,
      priceFeederWallet.address as string,
    );

    await oracleInstance.feedPrices(
      priceFeederWallet,
      feedPrices,
      customFees.exec,
    );

    const priceResult = await oracleInstance.getPriceFor(NATIVE_MINIMAL_DENOM);
    expect(priceResult).toBeDefined();
  }

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    cosm = await NolusClient.getInstance().getCosmWasmClient();

    leaserInstance = new NolusContracts.Leaser(cosm, leaserContractAddress);
    lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);
    oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);

    wasmAdminWallet = await getWasmAdminWallet();
    borrowerWallet = await createWallet();

    // feed the wasm admin
    feederWallet = await getUser1Wallet();
    priceFeederWallet = await createWallet();

    const adminBalanceAmount = '10000000000';
    const adminBalance = {
      amount: adminBalanceAmount,
      denom: NATIVE_MINIMAL_DENOM,
    };
    await feederWallet.transferAmount(
      wasmAdminWallet.address as string,
      [adminBalance],
      customFees.transfer,
    );

    const lppConfig = await lppInstance.getLppConfig();
    lppDenom = lppConfig.lpn_symbol;

    // change leaser config
    leaserConfigBefore = await leaserInstance.getLeaserConfig();
    leaserConfigMsg = JSON.parse(JSON.stringify(leaserConfigBefore));
    leaserConfigMsg.config.repayment.period = newPeriodNanosec;
    leaserConfigMsg.config.repayment.grace_period = newGracePeriodNanosec;
    await leaserInstance.setLeaserConfig(
      wasmAdminWallet,
      leaserConfigMsg,
      customFees.exec,
    );

    // change oracle config
    oracleConfigBefore = await oracleInstance.getConfig();
    const fiveHours = 18000;
    const feedersNeededPercentage = 1;
    await oracleInstance.setConfig(
      wasmAdminWallet,
      fiveHours,
      feedersNeededPercentage,
      customFees.exec,
    );

    const deposit = +downpayment * 10;
    await lppInstance.deposit(feederWallet, customFees.exec, [
      {
        denom: lppDenom,
        amount: deposit.toString(),
      },
    ]);
  });

  afterAll(async () => {
    await sendInitExecuteFeeTokens(
      feederWallet,
      wasmAdminWallet.address as string,
    );

    await leaserInstance.setLeaserConfig(
      wasmAdminWallet,
      leaserConfigBefore,
      customFees.exec,
    );

    const leaserConfigAfter = await leaserInstance.getLeaserConfig();
    expect(leaserConfigAfter).toStrictEqual(leaserConfigBefore);

    await sendInitExecuteFeeTokens(
      feederWallet,
      wasmAdminWallet.address as string,
    );

    await oracleInstance.setConfig(
      wasmAdminWallet,
      oracleConfigBefore.price_feed_period / 1000000000, //nanosec to sec
      oracleConfigBefore.feeders_percentage_needed,
      customFees.exec,
    );

    const oracleConfigAfter = await oracleInstance.getConfig();
    expect(oracleConfigAfter).toStrictEqual(oracleConfigBefore);
  });

  test('partial liquidation due to expiry of the grace period - should work as expected', async () => {
    await sendInitExecuteFeeTokens(
      feederWallet,
      borrowerWallet.address as string,
    );
    await feederWallet.transferAmount(
      borrowerWallet.address as string,
      [{ denom: lppDenom, amount: downpayment }],
      customFees.transfer,
    );

    // open lease
    const result = await leaserInstance.openLease(
      borrowerWallet,
      lppDenom,
      customFees.exec,
      [{ denom: lppDenom, amount: downpayment }],
    );

    mainLeaseAddress = getLeaseAddressFromOpenLeaseResponse(result);
    const leaseInstance = new NolusContracts.Lease(cosm, mainLeaseAddress);

    const stateBefore = await leaseInstance.getLeaseStatus();

    // wait main period to expires
    await sleep(newPeriodNanosec / nanosec + 1); //+1sec

    const stateAfterMainPeriod = (await leaseInstance.getLeaseStatus()).opened;
    if (!stateAfterMainPeriod) {
      undefinedHandler();
      return;
    }

    //TO DO - verify previous interest cacl

    const PID_afterMainPeriod =
      stateAfterMainPeriod.previous_interest_due.amount;
    const PMD_afterMainPeriod = stateAfterMainPeriod.previous_margin_due.amount;

    expect(PMD_afterMainPeriod).not.toBe('0');
    expect(PID_afterMainPeriod).not.toBe('0');

    // it is not liquidation time yet, so:
    expect(stateBefore.opened?.amount.amount).toBe(
      stateAfterMainPeriod.amount.amount,
    );

    // wait grace period to expires
    await sleep(newGracePeriodNanosec / nanosec + 1); //+1sec

    // feed price - oracle will trigger a time alarm
    await pushPrice(priceFeederWallet);

    const stateAfterGracePeriod = (await leaseInstance.getLeaseStatus()).opened;
    if (!stateAfterGracePeriod) {
      undefinedHandler();
      return;
    }

    // it is liquidation time yet, so:
    expect(BigInt(stateAfterGracePeriod.amount.amount)).toBe(
      BigInt(stateAfterMainPeriod.amount.amount) -
        (BigInt(PID_afterMainPeriod) + BigInt(PMD_afterMainPeriod)),
    );
  });

  test('partial liquidation due to expiry of more than one period - should work as expected', async () => {
    const leaseInstance = new NolusContracts.Lease(cosm, mainLeaseAddress);

    const periodsCount = 5;

    // wait for several periods to expire
    await sleep(
      ((newPeriodNanosec + newGracePeriodNanosec) / nanosec) * periodsCount,
    );

    const stateAfterSeveralPeriods = (await leaseInstance.getLeaseStatus())
      .opened;
    if (!stateAfterSeveralPeriods) {
      undefinedHandler();
      return;
    }

    const PID_afterSeveralPeriods =
      stateAfterSeveralPeriods.previous_interest_due.amount;
    const PMD_afterSeveralPeriods =
      stateAfterSeveralPeriods.previous_margin_due.amount;
    expect(PMD_afterSeveralPeriods).not.toBe('0');
    expect(PID_afterSeveralPeriods).not.toBe('0');

    // feed price - oracle will trigger alarm
    await pushPrice(priceFeederWallet);

    const stateAfterAlarm = (await leaseInstance.getLeaseStatus()).opened;
    if (!stateAfterAlarm) {
      undefinedHandler();
      return;
    }

    expect(BigInt(stateAfterAlarm.amount.amount)).toBe(
      BigInt(stateAfterSeveralPeriods.amount.amount) -
        (BigInt(PID_afterSeveralPeriods) + BigInt(PMD_afterSeveralPeriods)),
    );
  });

  test('full liquidation due to expiry of the grace period - should work as expected', async () => {
    await sendInitExecuteFeeTokens(
      feederWallet,
      borrowerWallet.address as string,
    );
    await feederWallet.transferAmount(
      borrowerWallet.address as string,
      [{ denom: lppDenom, amount: downpayment }],
      customFees.transfer,
    );

    // change margin interest rate % - more easily simulate full liquidation
    const leaserConfigBefore = await leaserInstance.getLeaserConfig();
    const leaserConfigMsg: LeaserConfig = JSON.parse(
      JSON.stringify(leaserConfigBefore),
    );
    leaserConfigMsg.config.lease_interest_rate_margin = 1000000000; //100000000%

    await leaserInstance.setLeaserConfig(
      wasmAdminWallet,
      leaserConfigMsg,
      customFees.exec,
    );

    // open lease
    const result = await leaserInstance.openLease(
      borrowerWallet,
      lppDenom,
      customFees.exec,
      [{ denom: lppDenom, amount: downpayment }],
    );

    const leaseAddress = getLeaseAddressFromOpenLeaseResponse(result);
    const leaseInstance = new NolusContracts.Lease(cosm, leaseAddress);

    const stateBeforePeriodExpiry = (await leaseInstance.getLeaseStatus())
      .opened;
    if (!stateBeforePeriodExpiry) {
      undefinedHandler();
      return;
    }

    const borrowerBalanceBefore = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    let leaseAmount = BigInt(stateBeforePeriodExpiry.amount.amount);

    while (leaseAmount > BigInt(0)) {
      console.log('Waiting for a full liquidation...');
      // wait for the entire period to expire
      await sleep((newPeriodNanosec + newGracePeriodNanosec) / nanosec + 1); //+1sec

      // feed price - oracle will trigger alarm
      await pushPrice(priceFeederWallet);

      const stateAfterPeriodExpiry = await leaseInstance.getLeaseStatus();

      if (stateAfterPeriodExpiry.opened) {
        expect(
          BigInt(stateAfterPeriodExpiry.opened.amount.amount),
        ).toBeLessThan(BigInt(leaseAmount));
        leaseAmount = BigInt(stateAfterPeriodExpiry.opened.amount.amount);
      } else {
        leaseAmount = BigInt(0);
      }
    }

    const stateAfterFullLiquidation = await leaseInstance.getLeaseStatus();
    expect(stateAfterFullLiquidation.closed).toBeDefined();
    liquidatedLeaseAddress = leaseAddress;

    const borrowerBalanceAfter = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );
    expect(borrowerBalanceAfter.amount).toBe(borrowerBalanceBefore.amount);
  });

  test('borrower tries to pay or close liquidated lease - should produce an error', async () => {
    const leaseInstance = new NolusContracts.Lease(
      cosm,
      liquidatedLeaseAddress,
    );

    const payment = {
      denom: lppDenom,
      amount: '1', // any amount
    };

    await feederWallet.transferAmount(
      borrowerWallet.address as string,
      [payment],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      feederWallet,
      borrowerWallet.address as string,
    );

    const paymentResult = () =>
      leaseInstance.repayLease(borrowerWallet, customFees.exec, [payment]);

    await expect(paymentResult).rejects.toThrow(
      /^.*The underlying loan is closed.*/,
    );

    await sendInitExecuteFeeTokens(
      feederWallet,
      borrowerWallet.address as string,
    );

    const closeResult = () =>
      leaseInstance.closeLease(borrowerWallet, customFees.exec);

    await expect(closeResult).rejects.toThrow(
      /^.*The underlying loan is closed.*/,
    );
  });

  // test('partial liquidation due to drop in price - should work as expected', async () => {
  //   // change leaser.liability to be liquidation possible
  //   const leaserConfig = await leaserInstance.getLeaserConfig();
  //   leaserConfig.config.liability.recalc_secs = 1;
  //   leaserConfig.config.liability.healthy_percent =
  //     leaserConfig.config.liability.init_percent + 10; // +1%
  //   leaserConfig.config.liability.first_liq_warn =
  //     leaserConfig.config.liability.healthy_percent + 10; // +1%
  //   leaserConfig.config.liability.second_liq_warn =
  //     leaserConfig.config.liability.first_liq_warn + 10; // +1%
  //   leaserConfig.config.liability.third_liq_warn =
  //     leaserConfig.config.liability.second_liq_warn + 10; // +1%
  //   leaserConfig.config.liability.max_percent =
  //     leaserConfig.config.liability.third_liq_warn + 10; // +1%
  //   await leaserInstance.setLeaserConfig(
  //     wasmAdminWallet,
  //     leaserConfig,
  //     customFees.exec,
  //   );

  //   console.log(await leaserInstance.getLeaserConfig());
  //   // open lease
  //   const result = await leaserInstance.openLease(
  //     borrowerWallet,
  //     lppDenom,
  //     customFees.exec,
  //     [{ denom: lppDenom, amount: downpayment }],
  //   );

  //   mainLeaseAddress = getLeaseAddressFromOpenLeaseResponse(result);
  //   const leaseInstance = new NolusContracts.Lease(cosm, mainLeaseAddress);

  //   const stateBeforeW1 = await leaseInstance.getLeaseStatus();

  //   // feedPrice until principal+interest / amount  = w1%
  //   // expect w1 in feedPrice response and expect no liquidation yet
  //   await liquidationWarningCheck(
  //     stateBeforeW1,
  //     leaserConfig.config.liability.first_liq_warn,
  //   );

  //   // loop feedPrice until principal+interest / amount  = w2%
  //   // liquidationWarningCheck(state, warningPercent);

  //   // get state after w2

  //   // expect w2 in feedPrice response and expect no liquidation yet

  //   // loop feedPrice until principal+interest / amount  = w3%
  //   // liquidationWarningWaiting(state, warningPercent);

  //   // expect w3 in feedPrice response and expect no liquidation yet

  //   // loop feedPrice until principal+interest / amount  = max%
  //   // liquidationWarningWaiting(state, warningPercent);

  //   // expect liquidation
  // });
});
