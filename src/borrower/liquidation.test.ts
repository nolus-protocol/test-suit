import NODE_ENDPOINT, {
  createWallet,
  getUser1Wallet,
  getContractsOwnerWallet,
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
import {
  Lease,
  LeaserConfig,
  LeaseStatus,
} from '@nolus/nolusjs/build/contracts';
import {
  calcInterestRate,
  currencyTicker_To_IBC,
} from '../util/smart-contracts/calculations';
import { runOrSkip } from '../util/testingRules';
import {
  getLeaseAddressFromOpenLeaseResponse,
  getLeaseGroupCurrencies,
} from '../util/smart-contracts/getters';
import {
  pushPrice,
  updateOracleConfig,
} from '../util/smart-contracts/actions/oracle';
import { provideEnoughLiquidity } from '../util/smart-contracts/actions/lender';

//TO DO
runOrSkip(process.env.TEST_BORROWER as string)(
  'Borrower tests - Liquidation',
  () => {
    let contractsOwnerWallet: NolusWallet;
    let cosm: any;
    let borrowerWallet: NolusWallet;
    let userWithBalanceWallet: NolusWallet;
    let priceFeederWallet: NolusWallet;
    let leaserInstance: NolusContracts.Leaser;
    let oracleInstance: NolusContracts.Oracle;
    let lppInstance: NolusContracts.Lpp;
    let leaserConfigBefore: NolusContracts.LeaserConfig;
    let oracleConfigBefore: NolusContracts.OracleConfig;
    let lppCurrency: string;
    let lppCurrencyToIBC: string;
    let leaseCurrency: string;
    let leaseCurrencyToIBC: string;
    let downpaymentCurrency: string;
    let downpaymentCurrencyToIBC: string;
    let mainLeaseAddress: string;
    let liquidatedLeaseAddress: string;
    let marginInterestPaidByNanoSec: number;

    const leaserContractAddress = process.env.LEASER_ADDRESS as string;
    const lppContractAddress = process.env.LPP_ADDRESS as string;
    const oracleContractAddress = process.env.ORACLE_ADDRESS as string;

    let leaserConfigMsg: LeaserConfig;

    const newPeriodSec = 60;
    const newGracePeriodSec = 50;
    const downpayment = '100000000000';
    const fiveHoursSec = 18000;

    // async function priceLiquidationCheck(
    //   leaseInstance: any,
    //   leaseAddress: string,
    //   stateBefore: NolusContracts.LeaseStatus,
    //   liquidationW: bigint,
    //   liqStep: number, // 1-warn1%, 2-warn2%, 3-warn3%, 4-max%
    // ) {
    //   const leaseState = stateBefore.opened;
    //   if (!leaseState) {
    //     undefinedHandler();
    //     return;
    //   }

    //   // feedPrice until principal+interest / amount  = w1%
    //   let leaseLiabilityLPN =
    //     +leaseState.principal_due.amount +
    //     +leaseState.current_interest_due.amount +
    //     +leaseState.previous_interest_due.amount +
    //     +leaseState.previous_margin_due.amount +
    //     +leaseState.current_margin_due.amount;

    //   const leaseAmount = +leaseState.amount.amount;

    //   while (
    //     BigInt(Math.trunc((leaseLiabilityLPN / leaseAmount) * 100)) <
    //     liquidationW / BigInt(10)
    //   ) {
    //     console.log('Waiting for a warning...');

    //     // feed price - oracle will trigger alarm
    //     await pushPrice(
    //       oracleInstance,
    //       priceFeederWallet,
    //       NATIVE_MINIMAL_DENOM,
    //       leaseCurrency,
    //       '10',
    //       '100',
    //     ); // any price

    //     const stateAfter = (await leaseInstance.getLeaseStatus()).opened;
    //     console.log(stateAfter);

    //     expect(BigInt(stateAfter.amount.amount)).toBe(BigInt(leaseAmount));

    //     leaseLiabilityLPN =
    //       +stateAfter.principal_due.amount +
    //       +stateAfter.current_interest_due.amount +
    //       +stateAfter.previous_interest_due.amount +
    //       +stateAfter.previous_margin_due.amount +
    //       +stateAfter.current_margin_due.amount;
    //   }
    //   await pushPrice(
    //     oracleInstance,
    //     priceFeederWallet,
    //     NATIVE_MINIMAL_DENOM,
    //     leaseCurrency,
    //     '10',
    //     '100',
    //   ); // any price

    //   const stateAfter = await leaseInstance.getLeaseStatus();
    //   if (liqStep === 4) {
    //     console.log('max% is reached!');
    //     //expect(stateAfter.closed).toBeDefined();
    //     // TO DO: expect liquidation info about mainLeaseAddress in feedPriceResult
    //   } else {
    //     console.log(`warning ${liqStep} is reached!`);
    //     expect(+stateAfter.opened.amount.amount).toBe(leaseAmount);
    //     // TO DO: expect W alarm about mainLeaseAddress in feedPriceResult
    //   }
    // }

    async function timeLiquidationCheck(
      leaseInstance: Lease,
      stateBefore: LeaseStatus,
      timeByNanoSec: number,
    ) {
      // wait main period to expires
      await sleep(newPeriodSec + 1); //+1sec
      await pushPrice(
        oracleInstance,
        priceFeederWallet,
        leaseCurrency,
        lppCurrency,
        '10',
        '100',
      ); // any price

      const stateAfterMainPeriod = (await leaseInstance.getLeaseStatus())
        .opened;
      if (!stateAfterMainPeriod) {
        undefinedHandler();
        return;
      }

      const PID_afterMainPeriod =
        stateAfterMainPeriod.previous_interest_due.amount;
      const PMD_afterMainPeriod =
        stateAfterMainPeriod.previous_margin_due.amount;

      expect(PMD_afterMainPeriod).not.toBe('0');
      expect(PID_afterMainPeriod).not.toBe('0');

      const loanInterestPaidByNanoSec = (
        await lppInstance.getLoanInformation(mainLeaseAddress)
      ).interest_paid;

      const loanRate = (await lppInstance.getLoanInformation(mainLeaseAddress))
        .annual_interest_rate;

      const newPeriodByNanoSec = timeByNanoSec + newPeriodSec * NANOSEC;

      const PID_calcudated = calcInterestRate(
        BigInt(stateAfterMainPeriod.principal_due.amount),
        BigInt(loanRate),
        BigInt(loanInterestPaidByNanoSec),
        BigInt(newPeriodByNanoSec),
      );

      expect(PID_calcudated).toBe(BigInt(PID_afterMainPeriod));

      const PMD_calcudated = calcInterestRate(
        BigInt(stateAfterMainPeriod.principal_due.amount),
        BigInt(stateAfterMainPeriod.interest_rate_margin),
        BigInt(marginInterestPaidByNanoSec),
        BigInt(newPeriodByNanoSec),
      );

      expect(PMD_calcudated).toBe(BigInt(PMD_afterMainPeriod));

      // it is not liquidation time yet, so:
      expect(stateBefore.opened?.amount.amount).toBe(
        stateAfterMainPeriod.amount.amount,
      );

      // wait grace period to expires
      await sleep(newGracePeriodSec + 1); //+1sec

      // feed price - oracle will trigger a time alarm
      const pushPriceResult = await pushPrice(
        oracleInstance,
        priceFeederWallet,
        leaseCurrency,
        lppCurrency,
        '10',
        '100',
      ); // any price
      console.log(pushPriceResult);

      const stateAfterGracePeriod = (await leaseInstance.getLeaseStatus())
        .opened;
      if (!stateAfterGracePeriod) {
        undefinedHandler();
        return;
      }

      marginInterestPaidByNanoSec =
        +pushPriceResult.logs[0].events[7].attributes[2].value;

      const leaseCurrencyPrice = await oracleInstance.getPriceFor(
        leaseCurrency,
      );
      const previousInterestToLeaseCurrency =
        ((BigInt(PID_afterMainPeriod) + BigInt(PMD_afterMainPeriod)) *
          BigInt(leaseCurrencyPrice.amount.amount)) /
        BigInt(leaseCurrencyPrice.amount_quote.amount);

      // it is liquidation time, so:
      expect(BigInt(stateAfterGracePeriod.amount.amount)).toBe(
        BigInt(stateAfterMainPeriod.amount.amount) -
          previousInterestToLeaseCurrency,
      );
    }

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      cosm = await NolusClient.getInstance().getCosmWasmClient();

      leaserInstance = new NolusContracts.Leaser(cosm, leaserContractAddress);
      lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);
      oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);

      contractsOwnerWallet = await getContractsOwnerWallet();
      borrowerWallet = await createWallet();

      // feed the contract owner
      userWithBalanceWallet = await getUser1Wallet();
      priceFeederWallet = await createWallet();

      const adminBalanceAmount = '10000';
      const adminBalance = {
        amount: adminBalanceAmount,
        denom: NATIVE_MINIMAL_DENOM,
      };
      await userWithBalanceWallet.transferAmount(
        contractsOwnerWallet.address as string,
        [adminBalance],
        customFees.transfer,
      );

      const lppConfig = await lppInstance.getLppConfig();
      lppCurrency = lppConfig.lpn_ticker;
      lppCurrencyToIBC = currencyTicker_To_IBC(lppCurrency);
      leaseCurrency = getLeaseGroupCurrencies()[0];
      leaseCurrencyToIBC = currencyTicker_To_IBC(leaseCurrency);
      downpaymentCurrency = lppCurrency;
      downpaymentCurrencyToIBC = currencyTicker_To_IBC(downpaymentCurrency);

      // change leaser config
      leaserConfigBefore = await leaserInstance.getLeaserConfig();
      leaserConfigMsg = JSON.parse(JSON.stringify(leaserConfigBefore));
      leaserConfigMsg.config.lease_interest_payment.due_period =
        newPeriodSec * NANOSEC;
      leaserConfigMsg.config.lease_interest_payment.grace_period =
        newGracePeriodSec * NANOSEC;
      await leaserInstance.setLeaserConfig(
        contractsOwnerWallet,
        leaserConfigMsg,
        customFees.exec,
      );

      // change oracle config
      oracleConfigBefore = await oracleInstance.getConfig();
      const feedersNeededPermille = 10;
      await updateOracleConfig(
        oracleInstance,
        oracleConfigBefore,
        feedersNeededPermille,
        fiveHoursSec / 2,
        2,
      );

      await provideEnoughLiquidity(
        leaserInstance,
        lppInstance,
        downpayment,
        downpaymentCurrency,
        leaseCurrency,
      );
      //TO DO
      // await removeAllFeeders(oracleInstance, contractsOwnerWallet);
    });

    afterAll(async () => {
      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        contractsOwnerWallet.address as string,
      );

      await leaserInstance.setLeaserConfig(
        contractsOwnerWallet,
        leaserConfigBefore,
        customFees.exec,
      );

      const leaserConfigAfter = await leaserInstance.getLeaserConfig();
      expect(leaserConfigAfter).toStrictEqual(leaserConfigBefore);

      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        contractsOwnerWallet.address as string,
      );

      await updateOracleConfig(oracleInstance, oracleConfigBefore);

      const oracleConfigAfter = await oracleInstance.getConfig();
      expect(oracleConfigAfter).toStrictEqual(oracleConfigBefore);

      //TO DO - register all feeders
      // await registerAllFeeders(oracleInstance, contractsOwnerWallet);
    });

    test('partial liquidation due to expiry of the grace period - should work as expected', async () => {
      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );
      await userWithBalanceWallet.transferAmount(
        borrowerWallet.address as string,
        [{ denom: downpaymentCurrencyToIBC, amount: downpayment }],
        customFees.transfer,
      );

      // open lease
      const result = await leaserInstance.openLease(
        borrowerWallet,
        leaseCurrency,
        customFees.exec,
        [{ denom: downpaymentCurrencyToIBC, amount: downpayment }],
      );

      mainLeaseAddress = getLeaseAddressFromOpenLeaseResponse(result);
      const leaseInstance = new NolusContracts.Lease(cosm, mainLeaseAddress);

      const openingTimeByNanoSec = (
        await lppInstance.getLoanInformation(mainLeaseAddress)
      ).interest_paid;
      marginInterestPaidByNanoSec = +openingTimeByNanoSec;

      const stateBeforeFirstLiquidation = await leaseInstance.getLeaseStatus();
      await timeLiquidationCheck(
        leaseInstance,
        stateBeforeFirstLiquidation,
        +openingTimeByNanoSec,
      );

      // second liquidation
      const stateBeforeSecondLiquidation = await leaseInstance.getLeaseStatus();
      await timeLiquidationCheck(
        leaseInstance,
        stateBeforeSecondLiquidation,
        +openingTimeByNanoSec + (newPeriodSec + newGracePeriodSec) * NANOSEC,
      );
    });

    test('partial liquidation due to expiry of more than one period - should work as expected', async () => {
      const leaseInstance = new NolusContracts.Lease(cosm, mainLeaseAddress);

      const periodsCount = 3;

      // wait for several periods to expire
      await sleep((newPeriodSec + newGracePeriodSec) * periodsCount);

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

      // feed price - oracle should trigger alarm
      await pushPrice(
        oracleInstance,
        priceFeederWallet,
        leaseCurrency,
        lppCurrency,
        '10',
        '100',
      ); // any price

      const stateAfterAlarm = (await leaseInstance.getLeaseStatus()).opened;
      if (!stateAfterAlarm) {
        undefinedHandler();
        return;
      }

      const leaseCurrencyPrice = await oracleInstance.getPriceFor(
        leaseCurrency,
      );

      const previousInterestToLeaseCurrency =
        ((BigInt(PID_afterSeveralPeriods) + BigInt(PMD_afterSeveralPeriods)) *
          BigInt(leaseCurrencyPrice.amount.amount)) /
        BigInt(leaseCurrencyPrice.amount_quote.amount);

      expect(BigInt(stateAfterAlarm.amount.amount)).toBe(
        BigInt(stateAfterSeveralPeriods.amount.amount) -
          previousInterestToLeaseCurrency,
      );
    });

    test('full liquidation due to expiry of the grace period - should work as expected', async () => {
      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );
      await userWithBalanceWallet.transferAmount(
        borrowerWallet.address as string,
        [{ denom: downpaymentCurrencyToIBC, amount: downpayment }],
        customFees.transfer,
      );

      // change margin interest rate % - easier simulation of total liquidation
      const leaserConfigBefore = await leaserInstance.getLeaserConfig();
      const leaserConfigMsg: LeaserConfig = JSON.parse(
        JSON.stringify(leaserConfigBefore),
      );
      leaserConfigMsg.config.lease_interest_rate_margin = 1000000000;

      await leaserInstance.setLeaserConfig(
        contractsOwnerWallet,
        leaserConfigMsg,
        customFees.exec,
      );

      // open lease
      const result = await leaserInstance.openLease(
        borrowerWallet,
        leaseCurrency,
        customFees.exec,
        [{ denom: downpaymentCurrencyToIBC, amount: downpayment }],
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
        leaseCurrencyToIBC,
      );

      let leaseAmount = BigInt(stateBeforePeriodExpiry.amount.amount);

      while (leaseAmount > BigInt(0)) {
        console.log('Waiting for a full liquidation...');
        // wait for the entire period to expire
        await sleep(newPeriodSec + newGracePeriodSec + 1); //+1sec

        // feed price - oracle should trigger alarm
        await pushPrice(
          oracleInstance,
          priceFeederWallet,
          leaseCurrency,
          lppCurrency,
          '10',
          '100',
        ); // any price

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
        leaseCurrencyToIBC,
      );
      expect(borrowerBalanceAfter.amount).toBe(borrowerBalanceBefore.amount);
    });

    test('borrower tries to pay or close liquidated lease - should produce an error', async () => {
      const leaseInstance = new NolusContracts.Lease(
        cosm,
        liquidatedLeaseAddress,
      );

      const payment = {
        denom: lppCurrencyToIBC,
        amount: '1', // any amount
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

      const paymentResult = () =>
        leaseInstance.repayLease(borrowerWallet, customFees.exec, [payment]);

      // TO DO: issue - https://gitlab-nomo.credissimo.net/nomo/smart-contracts/-/issues/14
      await expect(paymentResult).rejects.toThrow(
        /^.*The underlying loan is closed.*/,
      );

      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );

      const closeResult = () =>
        leaseInstance.closeLease(borrowerWallet, customFees.exec);

      await expect(closeResult).rejects.toThrow(
        /^.*The underlying loan is closed.*/,
      );
    });

    // test('liquidation due to drop in price - should work as expected', async () => {
    //   const leaserConfig = await leaserInstance.getLeaserConfig();
    //   leaserConfig.config.lease_interest_rate_margin = 10000000; //1000000%
    //   leaserConfig.config.liability.healthy =
    //     leaserConfig.config.liability.initial + 10; // +1%
    //   leaserConfig.config.liability.first_liq_warn =
    //     leaserConfig.config.liability.healthy + 10; // +1%
    //   leaserConfig.config.liability.second_liq_warn =
    //     leaserConfig.config.liability.first_liq_warn + 10; // +1%
    //   leaserConfig.config.liability.third_liq_warn =
    //     leaserConfig.config.liability.second_liq_warn + 10; // +1%
    //   leaserConfig.config.liability.max =
    //     leaserConfig.config.liability.third_liq_warn + 10; // +1%
    //   leaserConfig.config.repayment.period = fiveHoursSec * NANOSEC;

    //   await leaserInstance.setLeaserConfig(
    //     contractsOwnerWallet,
    //     leaserConfig,
    //     customFees.exec,
    //   );

    //   console.log(await leaserInstance.getLeaserConfig());

    //   // open lease
    //   await userWithBalanceWallet.transferAmount(
    //     borrowerWallet.address as string,
    //     [{ denom: downpaymentCurrencyToIBC, amount: downpayment }],
    //     customFees.transfer,
    //   );
    //   await sendInitExecuteFeeTokens(
    //     userWithBalanceWallet,
    //     borrowerWallet.address as string,
    //   );

    //   const result = await leaserInstance.openLease(
    //     borrowerWallet,
    //     leaseCurrency,
    //     customFees.exec,
    //     [{ denom: leaseCurrencyToIBC, amount: downpayment }],
    //   );

    //   mainLeaseAddress = getLeaseAddressFromOpenLeaseResponse(result);
    //   const leaseInstance = new NolusContracts.Lease(cosm, mainLeaseAddress);
    //   console.log(mainLeaseAddress);

    //   const stateBeforeW1 = await leaseInstance.getLeaseStatus();

    //   // w1
    //   await priceLiquidationCheck(
    //     leaseInstance,
    //     mainLeaseAddress,
    //     stateBeforeW1,
    //     BigInt(leaserConfig.config.liability.first_liq_warn),
    //     1,
    //   );

    //   console.log('W2');
    //   const stateBeforeW2 = await leaseInstance.getLeaseStatus();
    //   // w2
    //   await priceLiquidationCheck(
    //     leaseInstance,
    //     mainLeaseAddress,
    //     stateBeforeW2,
    //     BigInt(leaserConfig.config.liability.second_liq_warn),
    //     2,
    //   );

    //   const stateBeforeW3 = await leaseInstance.getLeaseStatus();
    //   // w3
    //   console.log('W3');
    //   await priceLiquidationCheck(
    //     leaseInstance,
    //     mainLeaseAddress,
    //     stateBeforeW3,
    //     BigInt(leaserConfig.config.liability.third_liq_warn),
    //     3,
    //   );

    //   const stateBeforeMax = await leaseInstance.getLeaseStatus();
    //   // max
    //   console.log('MAX');
    //   await priceLiquidationCheck(
    //     leaseInstance,
    //     mainLeaseAddress,
    //     stateBeforeMax,
    //     BigInt(leaserConfig.config.liability.max),
    //     4,
    //   );
    // });
  },
);
