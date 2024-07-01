import { InstantiateOptions, CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { LeaserConfigInfo } from '@nolus/nolusjs/build/contracts';
import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import {
  customFees,
  defaultTip,
  NATIVE_TICKER,
  noProvidedPriceFor,
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
  getLeaseObligations,
} from '../util/smart-contracts/getters';
import {
  checkLeaseBalance,
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
    let leaserConfig: LeaserConfigInfo;
    let minAsset: string;
    let minTransaction: string;

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
      dp?: string,
    ) {
      let fundsList: Coin[];

      const downpaymentAmount = dp ? dp : downpayment;

      if (downpaymentCurrencyToIBC === defaultTip.denom)
        fundsList = [
          addCoins(
            { denom: downpaymentCurrencyToIBC, amount: downpaymentAmount },
            defaultTip,
          ),
        ];
      else {
        fundsList = [
          { denom: downpaymentCurrencyToIBC, amount: downpaymentAmount },
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

      const leaseCurrencyPriceObj =
        await oracleInstance.getBasePrice(leaseCurrency);
      const [
        minToleranceCurrencyPrice_LC,
        exactCurrencyPrice_LC,
        maxToleranceCurrencyPrice_LC,
      ] = currencyPriceObjToNumbers(leaseCurrencyPriceObj, 1);

      let exactCurrencyPrice_PC = 1;
      let minToleranceCurrencyPrice_PC = 1;
      let maxToleranceCurrencyPrice_PC = 1;
      if (downpaymentCurrency !== lppCurrency) {
        const downnpaymentCurrencyPriceObj =
          await oracleInstance.getBasePrice(downpaymentCurrency);
        [
          minToleranceCurrencyPrice_PC,
          exactCurrencyPrice_PC,
          maxToleranceCurrencyPrice_PC,
        ] = currencyPriceObjToNumbers(downnpaymentCurrencyPriceObj, 1);
      }

      await provideEnoughLiquidity(
        leaserInstance,
        lppInstance,
        downpaymentAmount,
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
        [
          { denom: downpaymentCurrencyToIBC, amount: downpaymentAmount },
          defaultTip,
        ],
      );

      const leasesAfter = await leaserInstance.getCurrentOpenLeasesByOwner(
        borrowerWallet.address as string,
      );

      expect(leasesAfter.length).toBe(leasesBefore.length + 1);

      const leaseAddress = getLeaseAddressFromOpenLeaseResponse(response);
      console.log('Lease addres: ', leaseAddress);
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

      const downpaymentToLPN_min =
        +downpaymentAmount / minToleranceCurrencyPrice_PC;
      const downpaymentToLPN_max =
        +downpaymentAmount / maxToleranceCurrencyPrice_PC;

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
        const initPercent = +leaserConfig.lease_position_spec.liability.initial;

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
        BigInt(borrowerBalanceBefore_PC.amount) - BigInt(downpaymentAmount),
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
      maxLTD?: number,
    ) {
      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );

      if (+downpaymentAmount > 0) {
        await userWithBalanceWallet.transferAmount(
          borrowerWallet.address as string,
          [{ denom: downpaymentCurrencyIBC, amount: downpaymentAmount }],
          customFees.transfer,
        );
      }

      const openLease = () =>
        leaserInstance.openLease(
          borrowerWallet,
          leaseCurrency,
          customFees.exec,
          maxLTD,
          [{ denom: downpaymentCurrencyIBC, amount: downpaymentAmount }],
        );

      await expect(openLease).rejects.toThrow(message);
    }

    async function closeLease(
      leaseInstance: NolusContracts.Lease,
      borrowerWallet: NolusWallet,
    ) {
      const excess = 1000;
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
      oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);
      lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);

      leaserConfig = (await leaserInstance.getLeaserConfig()).config;
      minAsset = leaserConfig.lease_position_spec.min_asset.amount;
      minTransaction = leaserConfig.lease_position_spec.min_transaction.amount;

      lppCurrency = process.env.LPP_BASE_CURRENCY as string;
      lppCurrencyToIBC = await currencyTicker_To_IBC(lppCurrency);
      leaseCurrency = (await getLeaseGroupCurrencies(oracleInstance))[0];
      leaseCurrencyToIBC = await currencyTicker_To_IBC(leaseCurrency);
      downpaymentCurrency = lppCurrency;
      downpaymentCurrencyToIBC =
        await currencyTicker_To_IBC(downpaymentCurrency);

      expect(leaseCurrencyToIBC).not.toBe('');
      expect(downpaymentCurrencyToIBC).not.toBe('');

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
      const currentDownpaymentCurrencyToIBC = await currencyTicker_To_IBC(
        currentDownpaymentCurrency,
      );

      expect(currentDownpaymentCurrencyToIBC).not.toBe('');

      await testOpening(
        currentLeaseCurrency,
        currentDownpaymentCurrency,
        currentDownpaymentCurrencyToIBC,
      );
    });

    test('the successful scenario for opening a lease - downpayment currency !== lpn currency !== lease currency- should work as expected', async () => {
      const currentDPAmount = '1000000';

      const currentLeaseCurrency = leaseCurrency;
      const currentDownpaymentCurrency = await getCurrencyOtherThan(
        [currentLeaseCurrency, lppCurrency, NATIVE_TICKER],
        oracleInstance,
      );

      expect(currentDownpaymentCurrency).not.toBe('undefined');

      const currentDownpaymentCurrencyToIBC = await currencyTicker_To_IBC(
        currentDownpaymentCurrency,
      );

      expect(currentDownpaymentCurrencyToIBC).not.toBe('');
      await testOpening(
        currentLeaseCurrency,
        currentDownpaymentCurrency,
        currentDownpaymentCurrencyToIBC,
        undefined,
        currentDPAmount,
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

      const currentDPAmount = '1000000';

      const currentLeaseCurrency = leaseCurrency;
      const currentDownpaymentCurrency = currentLeaseCurrency;
      const currentDownpaymentCurrencyToIBC = await currencyTicker_To_IBC(
        currentDownpaymentCurrency,
      );

      expect(currentDownpaymentCurrencyToIBC).not.toBe('');

      await testOpening(
        currentLeaseCurrency,
        currentDownpaymentCurrency,
        currentDownpaymentCurrencyToIBC,
        undefined,
        currentDPAmount,
      );
    });

    test('the borrower should be able to open a lease with preferred LTV', async () => {
      const currentLeaseCurrency = leaseCurrency;
      const currentDownpaymentCurrency = lppCurrency;
      const currentDownpaymentCurrencyToIBC = await currencyTicker_To_IBC(
        currentDownpaymentCurrency,
      );

      expect(currentDownpaymentCurrencyToIBC).not.toBe('');

      const maxLTD =
        LTVtoLTD(+leaserConfig.lease_position_spec.liability.initial) - 100; // -10%

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
        `Found a symbol '${lppCurrency}' pretending to be ticker of a currency pertaining to the lease group`,
      );

      const paymentOnlyCurrency = NATIVE_TICKER;
      await testOpeningWithInvalidParams(
        paymentOnlyCurrency,
        downpaymentCurrencyToIBC,
        '10',
        `Found a symbol '${paymentOnlyCurrency}' pretending to be ticker of a currency pertaining to the lease group`,
      );
    });

    runTestIfLocal(
      'the borrower tries to open lease when there is no currency price provided by the Oracle - should produce an error',
      async () => {
        // // TO DO: issue - #69
        // const leaseCurrencyPriceObj = () =>
        //   oracleInstance.getPriceFor(noProvidedPriceFor);
        // await expect(leaseCurrencyPriceObj).rejects.toThrow(
        //   `Unsupported currency '${noProvidedPriceFor}'`,
        // );

        // await testOpeningWithInvalidParams(
        //   noProvidedPriceFor,
        //   lppCurrencyToIBC,
        //   '1000',
        //   `TO DO`,
        // );

        const noProvidedPriceForToIBC =
          await currencyTicker_To_IBC(noProvidedPriceFor);

        expect(noProvidedPriceForToIBC).not.toBe('');

        await testOpeningWithInvalidParams(
          leaseCurrency,
          noProvidedPriceForToIBC,
          '1000',
          `Failed to fetch price for the pair ${noProvidedPriceFor}/${lppCurrency}`,
        );
      },
    );

    test('the borrower tries to open a lease with 0 down payment - should produce an error', async () => {
      await testOpeningWithInvalidParams(
        leaseCurrency,
        downpaymentCurrencyToIBC,
        '0',
        'amount is not positive',
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
          ],
        );

      await expect(openLease).rejects.toThrow(/^.*insufficient fund.*/);

      const borrowerBalanceAfter = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        lppCurrencyToIBC,
      );
      expect(borrowerBalanceAfter.amount).toBe(borrowerBalanceBefore.amount);
    });

    // min_transaction <= 1000, min_asset>=15000
    test('the borrower tries to open a lease whose amount is less than the "min_asset" - should produce an error', async () => {
      const downpaymentCurrency = lppCurrency;
      const downpaymentCurrencyToIBC =
        await currencyTicker_To_IBC(downpaymentCurrency);
      const downpaymentCurrencyPriceObj =
        await oracleInstance.getBasePrice(downpaymentCurrency);
      const [
        minToleranceCurrencyPrice_LC,
        exactCurrencyPrice_LC,
        maxToleranceCurrencyPrice_LC,
      ] = currencyPriceObjToNumbers(downpaymentCurrencyPriceObj, 1);

      expect(downpaymentCurrencyToIBC).not.toBe('');

      const downpaymentAmount = minTransaction;
      const maxLTD = 1000;

      const quoteLease = await leaserInstance.leaseQuote(
        downpaymentAmount,
        downpaymentCurrency,
        leaseCurrency,
        maxLTD,
      );

      expect(
        Math.trunc(+quoteLease.total.amount / minToleranceCurrencyPrice_LC),
      ).toBeLessThanOrEqual(+minAsset);

      await testOpeningWithInvalidParams(
        leaseCurrency,
        downpaymentCurrencyToIBC,
        downpaymentAmount.toString(),
        `The asset amount should worth at least ${minAsset} ${lppCurrency}`,
        maxLTD,
      );
    });

    test('the borrower tries to open a lease by sending a downpayment which is less than the "min_transaction" - should produce an error', async () => {
      const downpaymentCurrency = leaseCurrency;
      const downpaymentCurrencyToIBC =
        await currencyTicker_To_IBC(downpaymentCurrency);
      const downpaymentCurrencyPriceObj =
        await oracleInstance.getBasePrice(downpaymentCurrency);
      const [
        minToleranceCurrencyPrice_DPC,
        exactCurrencyPrice_DPC,
        maxToleranceCurrencyPrice_DPC,
      ] = currencyPriceObjToNumbers(downpaymentCurrencyPriceObj, 1);

      expect(downpaymentCurrencyToIBC).not.toBe('');

      const downpaymentAmount = Math.trunc(
        (+minTransaction - 1) * minToleranceCurrencyPrice_DPC,
      );

      await testOpeningWithInvalidParams(
        leaseCurrency,
        downpaymentCurrencyToIBC,
        downpaymentAmount.toString(),
        `The transaction amount should worth at least ${minTransaction} ${lppCurrency}`,
      );
    });

    test('the borrower tries to open a lease whose borrowed amount is less than the "min_transaction" - should produce an error', async () => {
      const downpaymentCurrencyToIBC = await currencyTicker_To_IBC(lppCurrency);
      const downpaymentAmount = +minTransaction;

      expect(downpaymentCurrencyToIBC).not.toBe('');

      const maxLTD = 10;

      await testOpeningWithInvalidParams(
        leaseCurrency,
        downpaymentCurrencyToIBC,
        downpaymentAmount.toString(),
        `The transaction amount should worth at least ${minTransaction} ${lppCurrency}`,
        maxLTD,
      );
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

    test('the lpp "repay loan" functionality should be used only by the lease contract', async () => {
      const lppRepayLoanMsg = { repay_loan: [] };

      const repayLoan = () =>
        userWithBalanceWallet.execute(
          userWithBalanceWallet.address as string,
          lppContractAddress,
          lppRepayLoanMsg,
          customFees.exec,
          undefined,
          [{ amount: '10', denom: lppCurrencyToIBC }],
        );

      await expect(repayLoan).rejects.toThrow(/^.*No such contract.*/);
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
  },
);
