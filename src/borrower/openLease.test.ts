import { InstantiateOptions, CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { LeaserConfig } from '@nolus/nolusjs/build/contracts';
import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import {
  customFees,
  defaultTip,
  NATIVE_MINIMAL_DENOM,
  NATIVE_TICKER,
  undefinedHandler,
} from '../util/utils';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import {
  calcBorrowLTD,
  calcBorrowLTV,
  currencyPriceObjToNumbers,
  currencyTicker_To_IBC,
  LTVtoLTD,
} from '../util/smart-contracts/calculations';
import { runTestIfLocal, runOrSkip, ifLocal } from '../util/testingRules';
import {
  getCurrencyOtherThan,
  getLeaseAddressFromOpenLeaseResponse,
  getLeaseGroupCurrencies,
} from '../util/smart-contracts/getters';
import {
  checkLeaseBalance,
  findPriceLowerThanOneLPN,
  returnAmountToTheMainAccount,
  waitLeaseInProgressToBeNull,
  waitLeaseOpeningProcess,
} from '../util/smart-contracts/actions/borrower';
import { provideEnoughLiquidity } from '../util/smart-contracts/actions/lender';
import { addCoins, Coin } from '@cosmjs/amino';

runOrSkip(process.env.TEST_BORROWER as string)(
  'Borrower tests - Open a lease',
  () => {
    let userWithBalanceWallet: NolusWallet;
    let borrowerWallet: NolusWallet;
    let lppCurrency: string;
    let lppCurrencyToIBC: string;
    let leaseCurrency: string;
    let leaseCurrencyToIBC: string;
    let downpaymentCurrency: string;
    let downpaymentCurrencyToIBC: string;
    let lppInstance: NolusContracts.Lpp;
    let leaserInstance: NolusContracts.Leaser;
    let oracleInstance: NolusContracts.Oracle;
    let cosm: CosmWasmClient;
    let leaserConfig: LeaserConfig;

    const leaserContractAddress = process.env.LEASER_ADDRESS as string;
    const lppContractAddress = process.env.LPP_ADDRESS as string;
    const oracleContractAddress = process.env.ORACLE_ADDRESS as string;
    const leaseContractCodeId = 2;

    const downpayment = '10000';

    async function testOpening(
      leaseCurrency: string,
      downpaymentCurrency: string,
      downpaymentCurrencyToIBC: string,
      ltd?: number,
    ) {
      let fundsList: Coin[];

      if (downpaymentCurrencyToIBC === defaultTip.denom)
        fundsList = [
          addCoins(
            { denom: downpaymentCurrencyToIBC, amount: downpayment },
            defaultTip,
          ),
        ];
      else {
        fundsList = [
          { denom: downpaymentCurrencyToIBC, amount: downpayment },
          defaultTip,
        ];
      }
      await userWithBalanceWallet.transferAmount(
        borrowerWallet.address as string,
        fundsList,
        customFees.transfer,
      );

      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );

      const borrowerBalanceBefore_LC = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        leaseCurrencyToIBC,
      );
      const borrowerBalanceBefore_PC = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        downpaymentCurrencyToIBC,
      );

      const leasesBefore = await leaserInstance.getCurrentOpenLeasesByOwner(
        borrowerWallet.address as string,
      );

      const leaseCurrencyPriceObj = await oracleInstance.getPriceFor(
        leaseCurrency,
      );
      const [
        minToleranceCurrencyPrice_LC,
        exactCurrencyPrice_LC,
        maxToleranceCurrencyPrice_LC,
      ] = currencyPriceObjToNumbers(leaseCurrencyPriceObj, 1);

      let exactCurrencyPrice_PC = 1;
      let minToleranceCurrencyPrice_PC = 1;
      let maxToleranceCurrencyPrice_PC = 1;
      if (downpaymentCurrency !== lppCurrency) {
        const downnpaymentCurrencyPriceObj = await oracleInstance.getPriceFor(
          downpaymentCurrency,
        );
        [
          minToleranceCurrencyPrice_PC,
          exactCurrencyPrice_PC,
          maxToleranceCurrencyPrice_PC,
        ] = currencyPriceObjToNumbers(downnpaymentCurrencyPriceObj, 1);
      }

      await provideEnoughLiquidity(
        leaserInstance,
        lppInstance,
        downpayment,
        downpaymentCurrency,
        leaseCurrency,
      );

      const lppLiquidityBefore = await cosm.getBalance(
        lppContractAddress,
        lppCurrencyToIBC,
      );

      const response = await leaserInstance.openLease(
        borrowerWallet,
        leaseCurrency,
        customFees.exec,
        ltd,
        [{ denom: downpaymentCurrencyToIBC, amount: downpayment }, defaultTip],
      );

      const leasesAfter = await leaserInstance.getCurrentOpenLeasesByOwner(
        borrowerWallet.address as string,
      );

      expect(leasesAfter.length).toBe(leasesBefore.length + 1);

      const leaseAddress = getLeaseAddressFromOpenLeaseResponse(response);
      const leaseInstance = new NolusContracts.Lease(cosm, leaseAddress);

      expect(await waitLeaseOpeningProcess(leaseInstance)).toBe(undefined);

      // get the new lease state - opened
      const currentLeaseState = await leaseInstance.getLeaseStatus();

      // check lease address balance - there shouldn't be any
      const leaseBalances = await checkLeaseBalance(leaseAddress, [
        NATIVE_TICKER,
        leaseCurrency,
        downpaymentCurrency,
        lppCurrency,
      ]);
      expect(leaseBalances).toBe(false);

      const leaseAmount = currentLeaseState.opened?.amount.amount; // leaseCurrency
      const leasePrincipal = currentLeaseState.opened?.principal_due.amount; // lpn

      if (!leaseAmount || !leasePrincipal) {
        undefinedHandler();
        return;
      }

      const downpaymentToLPN_min = +downpayment / minToleranceCurrencyPrice_PC;
      const downpaymentToLPN_max = +downpayment / maxToleranceCurrencyPrice_PC;

      expect(BigInt(leaseAmount)).toBeGreaterThanOrEqual(
        BigInt(
          Math.trunc(
            (downpaymentToLPN_min + +leasePrincipal) *
              minToleranceCurrencyPrice_LC,
          ),
        ),
      );

      expect(BigInt(leaseAmount)).toBeLessThanOrEqual(
        BigInt(
          Math.trunc(
            (downpaymentToLPN_max + +leasePrincipal) *
              maxToleranceCurrencyPrice_LC,
          ),
        ),
      );

      let calcBorrowAmount_max;
      let calcBorrowAmount_min;

      if (ltd) {
        calcBorrowAmount_max = Math.trunc(
          calcBorrowLTD(downpaymentToLPN_min, ltd),
        );
        calcBorrowAmount_min = Math.trunc(
          calcBorrowLTD(downpaymentToLPN_max, ltd),
        );
      } else {
        const initPercent = +leaserConfig.config.liability.initial;

        calcBorrowAmount_max = Math.trunc(
          calcBorrowLTV(downpaymentToLPN_min, initPercent),
        );
        calcBorrowAmount_min = Math.trunc(
          calcBorrowLTV(downpaymentToLPN_max, initPercent),
        );
      }

      expect(+leasePrincipal).toBeGreaterThanOrEqual(calcBorrowAmount_min);
      expect(+leasePrincipal).toBeLessThanOrEqual(calcBorrowAmount_max);

      const borrowerBalanceAfter_LC = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        leaseCurrencyToIBC,
      );

      const borrowerBalanceAfter_PC = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        downpaymentCurrencyToIBC,
      );

      const lppLiquidityAfter = await cosm.getBalance(
        lppContractAddress,
        lppCurrencyToIBC,
      );

      expect(BigInt(borrowerBalanceAfter_PC.amount)).toBe(
        BigInt(borrowerBalanceBefore_PC.amount) - BigInt(downpayment),
      );

      if (downpaymentCurrency != leaseCurrency) {
        expect(borrowerBalanceAfter_LC.amount).toBe(
          borrowerBalanceBefore_LC.amount,
        );
      }
      if (ifLocal()) {
        expect(+lppLiquidityAfter.amount).toBe(
          +lppLiquidityBefore.amount - +leasePrincipal,
        );
      }

      await closeLease(leaseInstance, borrowerWallet);
    }

    async function testOpeningWithInvalidParams(
      leaseCurrency: string,
      downpaymentCurrencyIBC: string,
      downpaymentAmount: string,
      message: string,
    ) {
      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );

      if (+downpaymentAmount > 0) {
        await userWithBalanceWallet.transferAmount(
          borrowerWallet.address as string,
          [
            { denom: downpaymentCurrencyIBC, amount: downpaymentAmount },
            defaultTip,
          ],
          customFees.transfer,
        );
      }

      const openLease = () =>
        leaserInstance.openLease(
          borrowerWallet,
          leaseCurrency,
          customFees.exec,
          undefined,
          [
            { denom: downpaymentCurrencyIBC, amount: downpaymentAmount },
            defaultTip,
          ],
        );

      await expect(openLease).rejects.toThrow(message);

      // transfer the tip amount back
      await returnAmountToTheMainAccount(borrowerWallet, NATIVE_MINIMAL_DENOM);
    }

    async function closeLease(
      leaseInstance: NolusContracts.Lease,
      borrowerWallet: NolusWallet,
    ) {
      const excess = 1000;
      const currentLeaseState = await leaseInstance.getLeaseStatus();

      if (!currentLeaseState.opened) {
        undefinedHandler();
        return;
      }

      const paymentAmount =
        +currentLeaseState.opened?.principal_due.amount +
        +currentLeaseState.opened?.current_interest_due.amount +
        +currentLeaseState.opened?.current_margin_due.amount +
        +currentLeaseState.opened?.previous_interest_due.amount +
        +currentLeaseState.opened?.previous_margin_due.amount +
        excess;

      const payment = {
        amount: paymentAmount.toString(),
        denom: lppCurrencyToIBC,
      };

      await userWithBalanceWallet.transferAmount(
        borrowerWallet.address as string,
        [payment, defaultTip],
        customFees.transfer,
      );
      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );

      await leaseInstance.repayLease(borrowerWallet, customFees.exec, [
        payment,
        defaultTip,
      ]);

      expect(await waitLeaseInProgressToBeNull(leaseInstance)).toBe(undefined);

      const leaseStateAfterRepay = await leaseInstance.getLeaseStatus();
      expect(leaseStateAfterRepay.paid).toBeDefined();

      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );
      await userWithBalanceWallet.transferAmount(
        borrowerWallet.address as string,
        [defaultTip],
        customFees.transfer,
      );

      await leaseInstance.closeLease(borrowerWallet, customFees.exec, [
        defaultTip,
      ]);

      expect(await waitLeaseInProgressToBeNull(leaseInstance)).toBe(undefined);

      const leaseStateAfterClose = await leaseInstance.getLeaseStatus();
      expect(leaseStateAfterClose.closed).toBeDefined();

      await returnAmountToTheMainAccount(borrowerWallet, leaseCurrencyToIBC);
    }

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      cosm = await NolusClient.getInstance().getCosmWasmClient();

      userWithBalanceWallet = await getUser1Wallet();
      borrowerWallet = await createWallet();

      leaserInstance = new NolusContracts.Leaser(cosm, leaserContractAddress);
      lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);
      oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);

      const lppConfig = await lppInstance.getLppConfig();
      leaserConfig = await leaserInstance.getLeaserConfig();
      lppCurrency = lppConfig.lpn_ticker;
      lppCurrencyToIBC = currencyTicker_To_IBC(lppCurrency);
      leaseCurrency = getLeaseGroupCurrencies()[0];
      leaseCurrencyToIBC = currencyTicker_To_IBC(leaseCurrency);
      downpaymentCurrency = lppCurrency;
      downpaymentCurrencyToIBC = currencyTicker_To_IBC(downpaymentCurrency);

      await provideEnoughLiquidity(
        leaserInstance,
        lppInstance,
        downpayment,
        downpaymentCurrency,
        leaseCurrency,
      );
    });

    test('the successful scenario for opening a lease - downpayment currency === lpn currency - should work as expected', async () => {
      const currentLeaseCurrency = leaseCurrency;
      const currentDownpaymentCurrency = lppCurrency;
      const currentDownpaymentCurrencyToIBC = currencyTicker_To_IBC(
        currentDownpaymentCurrency,
      );

      await testOpening(
        currentLeaseCurrency,
        currentDownpaymentCurrency,
        currentDownpaymentCurrencyToIBC,
      );
    });

    test('the successful scenario for opening a lease - downpayment currency !== lpn currency !== lease currency- should work as expected', async () => {
      const currentLeaseCurrency = leaseCurrency;
      const currentDownpaymentCurrency = getCurrencyOtherThan([
        currentLeaseCurrency,
        lppCurrency,
        NATIVE_TICKER,
      ]);

      expect(currentDownpaymentCurrency).not.toBe('undefined');

      const currentDownpaymentCurrencyToIBC = currencyTicker_To_IBC(
        currentDownpaymentCurrency,
      );

      await testOpening(
        currentLeaseCurrency,
        currentDownpaymentCurrency,
        currentDownpaymentCurrencyToIBC,
      );
    });

    // TO DO - issue: duplicate denomination
    // test('the successful scenario for opening a lease - downpayment currency === native - should work as expected', async () => {
    //   const currentLeaseCurrency = leaseCurrency;
    //   const currentDownpaymentCurrency = NATIVE_TICKER;

    //   expect(currentDownpaymentCurrency).not.toBe('undefined');

    //   const currentDownpaymentCurrencyToIBC = currencyTicker_To_IBC(
    //     currentDownpaymentCurrency,
    //   );

    //   await testOpening(
    //     currentLeaseCurrency,
    //     currentDownpaymentCurrency,
    //     currentDownpaymentCurrencyToIBC,
    //   );
    // });

    test('the successful scenario for opening a lease - downpayment currency === lease currency- should work as expected', async () => {
      // !!! leaseCurrency balance > 0 is required for the main account
      const currentLeaseCurrency = leaseCurrency;
      const currentDownpaymentCurrency = currentLeaseCurrency;
      const currentDownpaymentCurrencyToIBC = currencyTicker_To_IBC(
        currentDownpaymentCurrency,
      );

      await testOpening(
        currentLeaseCurrency,
        currentDownpaymentCurrency,
        currentDownpaymentCurrencyToIBC,
      );
    });

    test('the borrower should be able to open a lease with preferred LTV', async () => {
      const currentLeaseCurrency = leaseCurrency;
      const currentDownpaymentCurrency = lppCurrency;
      const currentDownpaymentCurrencyToIBC = currencyTicker_To_IBC(
        currentDownpaymentCurrency,
      );

      const maxLTD = LTVtoLTD(+leaserConfig.config.liability.initial) - 100; // -10%

      await testOpening(
        currentLeaseCurrency,
        currentDownpaymentCurrency,
        currentDownpaymentCurrencyToIBC,
        maxLTD,
      );
    });

    test('the borrower tries to open lease with unsupported lease currency - should produce an error', async () => {
      await testOpeningWithInvalidParams(
        lppCurrency,
        downpaymentCurrencyToIBC,
        '10',
        `Found currency '${lppCurrency}' which is not defined in the lease currency group`,
      );

      const paymentOnlyCurrency = NATIVE_TICKER;
      await testOpeningWithInvalidParams(
        paymentOnlyCurrency,
        downpaymentCurrencyToIBC,
        '10',
        `Found currency '${paymentOnlyCurrency}' which is not defined in the lease currency group`,
      );
    });

    // TO DO: issue - #69
    // runTestIfLocal(
    //   'the borrower tries to open lease when there is no currency price provided by the Oracle - should produce an error',
    //   async () => {
    //     const leaseCurrencyPriceObj = () =>
    //       oracleInstance.getPriceFor(noProvidedPriceFor);
    //     await expect(leaseCurrencyPriceObj).rejects.toThrow('No price');

    //     await testOpeningWithInvalidParams(
    //       noProvidedPriceFor,
    //       downpaymentCurrencyToIBC,
    //       '10',
    //       `TO DO`,
    //     );

    //     // TO DO - no down payment currency price (when we have >1 onlyPaymentsCurrencies in the list of supported currencies)
    //     // await testOpeningWithInvalidParams(
    //     //   leaseCurrency,
    //     //   noProvidedPriceForPaymentOnly,
    //     //   '10',
    //     //   `TO DO`,
    //     // );
    //   },
    // );

    // runTestIfLocal(
    //   'the borrower tries to open a lease with an insufficient down payment (<1LPN) - should produce an error',
    //   async () => {
    //     const dpCurrency = await findPriceLowerThanOneLPN(oracleInstance);
    //     if (typeof dpCurrency != 'undefined') {
    //       await testOpeningWithInvalidParams(
    //         dpCurrency,
    //         downpaymentCurrencyToIBC,
    //         '1',
    //         'TO DO',
    //       );
    //     }
    //   },
    // );

    test('the borrower tries to open a lease with 0 down payment - should produce an error', async () => {
      await testOpeningWithInvalidParams(
        leaseCurrency,
        downpaymentCurrencyToIBC,
        '0',
        'invalid coins',
      );
    });

    test('the borrower tries to open a lease with more down payment amount than he owns - should produce an error', async () => {
      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );

      const borrowerBalanceBefore = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        lppCurrencyToIBC,
      );

      const openLease = () =>
        leaserInstance.openLease(
          borrowerWallet,
          leaseCurrency,
          customFees.exec,
          undefined,
          [
            {
              denom: lppCurrencyToIBC,
              amount: (
                BigInt(borrowerBalanceBefore.amount) + BigInt(1)
              ).toString(),
            },
            defaultTip,
          ],
        );

      await expect(openLease).rejects.toThrow(/^.*insufficient fund.*/);

      const borrowerBalanceAfter = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        lppCurrencyToIBC,
      );
      expect(borrowerBalanceAfter.amount).toBe(borrowerBalanceBefore.amount);
    });

    test('the lpp "open loan" functionality should be used only by the lease contract', async () => {
      const lppOpenLoanMsg = {
        open_loan: { amount: { amount: '10', ticker: lppCurrency } }, // any amount
      };

      const openLoan = () =>
        userWithBalanceWallet.execute(
          userWithBalanceWallet.address as string,
          lppContractAddress,
          lppOpenLoanMsg,
          customFees.exec,
        );

      await expect(openLoan).rejects.toThrow(/^.*No such contract.*/);
    });

    test('the lease instance can be created only by the leaser contract', async () => {
      const leaseInitMsg = {
        currency: 'OSMO',
        customer: userWithBalanceWallet.address as string,
        liability: {
          healthy_percent: 40,
          init_percent: 30,
          max_percent: 80,
          recalc_secs: 720000,
        },
        loan: {
          annual_margin_interest: 30,
          grace_period_secs: 1230,
          interest_due_period_secs: 10000,
          lpp: lppContractAddress,
        },
      };

      const options: InstantiateOptions = {
        funds: [{ amount: '10', denom: lppCurrencyToIBC }], // any amount
      };

      const init = () =>
        userWithBalanceWallet.instantiate(
          userWithBalanceWallet.address as string,
          leaseContractCodeId,
          leaseInitMsg,
          'test_lease_uat',
          customFees.init,
          options,
        );

      await expect(init).rejects.toThrow(
        /^.*can not instantiate: unauthorized.*/,
      );
    });

    // TO DO
    // test('the borrower tries to open a lease whose total value is too small - should produce an error', async () => {
    // });
  },
);
