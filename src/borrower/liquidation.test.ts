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
  NANOSEC,
} from '../util/utils';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import { LeaserConfig, LeaseStatus } from '@nolus/nolusjs/build/contracts';
import {
  getLeaseAddressFromOpenLeaseResponse,
  removeAllFeeders,
} from '../util/smart-contracts';

//TO DO
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

  const newPeriodNanosec = 15 * NANOSEC;
  const newGracePeriodNanosec = 10 * NANOSEC;
  const downpayment = '1000000000';
  const fiveHoursSec = 18000;

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

    await oracleInstance.updateCurrencyPaths(
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

    await feederWallet.transferAmount(
      priceFeederWallet.address as string,
      customFees.feedPrice.amount,
      customFees.transfer,
      '',
    );

    console.log(
      await oracleInstance.feedPrices(
        priceFeederWallet,
        feedPrices,
        customFees.feedPrice,
      ),
    );

    const priceResult = await oracleInstance.getPriceFor(NATIVE_MINIMAL_DENOM);
    expect(priceResult).toBeDefined();
  }

  async function priceLiquidationCheck(
    leaseInstance: any,
    leaseAddress: string,
    stateBefore: NolusContracts.LeaseStatus,
    liquidationW: bigint,
    liqStep: number, // 1-warn1%, 2-warn2%, 3-warn3%, 4-max%
  ) {
    const leaseState = stateBefore.opened;
    if (!leaseState) {
      undefinedHandler();
      return;
    }

    // feedPrice until principal+interest / amount  = w1%
    let leaseLiabilityLPN =
      +leaseState.principal_due.amount +
      +leaseState.current_interest_due.amount +
      +leaseState.previous_interest_due.amount +
      +leaseState.previous_margin_due.amount +
      +leaseState.current_margin_due.amount;

    const leaseAmount = +leaseState.amount.amount;

    while (
      BigInt(Math.trunc((leaseLiabilityLPN / leaseAmount) * 100)) <
      liquidationW / BigInt(10)
    ) {
      console.log('Waiting for a warning...');

      // feed price - oracle will trigger alarm
      await pushPrice(priceFeederWallet);

      const stateAfter = (await leaseInstance.getLeaseStatus()).opened;
      console.log(stateAfter);

      expect(BigInt(stateAfter.amount.amount)).toBe(BigInt(leaseAmount));

      leaseLiabilityLPN =
        +stateAfter.principal_due.amount +
        +stateAfter.current_interest_due.amount +
        +stateAfter.previous_interest_due.amount +
        +stateAfter.previous_margin_due.amount +
        +stateAfter.current_margin_due.amount;
    }
    await pushPrice(priceFeederWallet);

    const stateAfter = await leaseInstance.getLeaseStatus();
    if (liqStep === 4) {
      console.log('max% is reached!');
      //expect(stateAfter.closed).toBeDefined();
      // TO DO: expect liquidation info about mainLeaseAddress in feedPriceResult
    } else {
      console.log(`warning ${liqStep} is reached!`);
      expect(+stateAfter.opened.amount.amount).toBe(leaseAmount);
      // TO DO: expect W alarm about mainLeaseAddress in feedPriceResult
    }
  }

  async function timeLiquidationCheck(
    leaseInstance: any,
    stateBefore: LeaseStatus,
  ) {
    // wait main period to expires
    await sleep(newPeriodNanosec / NANOSEC + 1); //+1sec
    await pushPrice(priceFeederWallet);

    const stateAfterMainPeriod = (await leaseInstance.getLeaseStatus()).opened;
    if (!stateAfterMainPeriod) {
      undefinedHandler();
      return;
    }

    //TO DO - verify previous interest calc

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
    await sleep(newGracePeriodNanosec / NANOSEC + 1); //+1sec

    // feed price - oracle will trigger a time alarm
    await pushPrice(priceFeederWallet);

    const stateAfterFirstGracePeriod = (await leaseInstance.getLeaseStatus())
      .opened;
    if (!stateAfterFirstGracePeriod) {
      undefinedHandler();
      return;
    }

    // it is liquidation time, so:
    expect(BigInt(stateAfterFirstGracePeriod.amount.amount)).toBe(
      BigInt(stateAfterMainPeriod.amount.amount) -
        (BigInt(PID_afterMainPeriod) + BigInt(PMD_afterMainPeriod)),
    );
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
    const feedersNeededPermille = 10;
    await oracleInstance.setConfig(
      wasmAdminWallet,
      fiveHoursSec,
      feedersNeededPermille,
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
      oracleConfigBefore.expected_feeders,
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

    const stateBeforeFirstLiquidation = await leaseInstance.getLeaseStatus();
    await timeLiquidationCheck(leaseInstance, stateBeforeFirstLiquidation);

    // try second liquidation
    const stateBeforeSecondLiquidation = await leaseInstance.getLeaseStatus();
    await timeLiquidationCheck(leaseInstance, stateBeforeSecondLiquidation);
  });

  test('partial liquidation due to expiry of more than one period - should work as expected', async () => {
    const leaseInstance = new NolusContracts.Lease(cosm, mainLeaseAddress);

    const periodsCount = 5;

    // wait for several periods to expire
    await sleep(
      ((newPeriodNanosec + newGracePeriodNanosec) / NANOSEC) * periodsCount,
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
    leaserConfigMsg.config.lease_interest_rate_margin = 1000000000; // 100000000%

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
      await sleep((newPeriodNanosec + newGracePeriodNanosec) / NANOSEC + 1); //+1sec

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

    // TO DO: issue - https://gitlab-nomo.credissimo.net/nomo/smart-contracts/-/issues/14
    // await expect(paymentResult).rejects.toThrow(
    //   /^.*The underlying loan is closed.*/,
    // );

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

  test('liquidation due to drop in price - should work as expected', async () => {
    const leaserConfig = await leaserInstance.getLeaserConfig();
    leaserConfig.config.lease_interest_rate_margin = 10000000; //1000000%
    leaserConfig.config.liability.healthy =
      leaserConfig.config.liability.initial + 10; // +1%
    leaserConfig.config.liability.first_liq_warn =
      leaserConfig.config.liability.healthy + 10; // +1%
    leaserConfig.config.liability.second_liq_warn =
      leaserConfig.config.liability.first_liq_warn + 10; // +1%
    leaserConfig.config.liability.third_liq_warn =
      leaserConfig.config.liability.second_liq_warn + 10; // +1%
    leaserConfig.config.liability.max =
      leaserConfig.config.liability.third_liq_warn + 10; // +1%
    leaserConfig.config.repayment.period = fiveHoursSec * NANOSEC;

    await leaserInstance.setLeaserConfig(
      wasmAdminWallet,
      leaserConfig,
      customFees.exec,
    );

    console.log(await leaserInstance.getLeaserConfig());

    // open lease
    await feederWallet.transferAmount(
      borrowerWallet.address as string,
      [{ denom: lppDenom, amount: downpayment }],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      feederWallet,
      borrowerWallet.address as string,
    );

    const result = await leaserInstance.openLease(
      borrowerWallet,
      lppDenom,
      customFees.exec,
      [{ denom: lppDenom, amount: downpayment }],
    );

    mainLeaseAddress = getLeaseAddressFromOpenLeaseResponse(result);
    const leaseInstance = new NolusContracts.Lease(cosm, mainLeaseAddress);
    console.log(mainLeaseAddress);

    const stateBeforeW1 = await leaseInstance.getLeaseStatus();

    // w1
    await priceLiquidationCheck(
      leaseInstance,
      mainLeaseAddress,
      stateBeforeW1,
      BigInt(leaserConfig.config.liability.first_liq_warn),
      1,
    );

    console.log('W2');
    const stateBeforeW2 = await leaseInstance.getLeaseStatus();
    // w2
    await priceLiquidationCheck(
      leaseInstance,
      mainLeaseAddress,
      stateBeforeW2,
      BigInt(leaserConfig.config.liability.second_liq_warn),
      2,
    );

    const stateBeforeW3 = await leaseInstance.getLeaseStatus();
    // w3
    console.log('W3');
    await priceLiquidationCheck(
      leaseInstance,
      mainLeaseAddress,
      stateBeforeW3,
      BigInt(leaserConfig.config.liability.third_liq_warn),
      3,
    );

    const stateBeforeMax = await leaseInstance.getLeaseStatus();
    // max
    console.log('MAX');
    await priceLiquidationCheck(
      leaseInstance,
      mainLeaseAddress,
      stateBeforeMax,
      BigInt(leaserConfig.config.liability.max),
      4,
    );
  });
});
