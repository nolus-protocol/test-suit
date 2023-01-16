import { InstantiateOptions, CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import {
  customFees,
  NATIVE_TICKER,
  noProvidedPriceFor,
  undefinedHandler,
} from '../util/utils';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import {
  calcBorrow,
  currencyPriceObjToNumbers,
  currencyTicker_To_IBC,
} from '../util/smart-contracts/calculations';
import { runTestIfLocal, runOrSkip } from '../util/testingRules';
import {
  getLeaseAddressFromOpenLeaseResponse,
  getLeaseGroupCurrencies,
  getOnlyPaymentCurrencies,
} from '../util/smart-contracts/getters';
import {
  checkLeaseBalance,
  waitLeaseOpeningProcess,
} from '../util/smart-contracts/actions/borrower';
import { provideEnoughLiquidity } from '../util/smart-contracts/actions/lender';

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

    const leaserContractAddress = process.env.LEASER_ADDRESS as string;
    const lppContractAddress = process.env.LPP_ADDRESS as string;
    const oracleContractAddress = process.env.ORACLE_ADDRESS as string;
    const leaseContractCodeId = 2;

    const downpayment = '100';

    async function testOpening(
      leaseCurrency: string,
      downpaymentCurrency: string,
      downpaymentCurrencyToIBC: string,
    ) {
      await userWithBalanceWallet.transferAmount(
        borrowerWallet.address as string,
        [{ denom: downpaymentCurrencyToIBC, amount: downpayment }],
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

      const lppLiquidityBefore = await cosm.getBalance(
        lppContractAddress,
        lppCurrencyToIBC,
      );

      const leasesBefore = await leaserInstance.getCurrentOpenLeasesByOwner(
        borrowerWallet.address as string,
      );

      const leaserConfig = await leaserInstance.getLeaserConfig();

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
          leaseCurrency,
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

      const response = await leaserInstance.openLease(
        borrowerWallet,
        leaseCurrency,
        customFees.exec,
        [{ denom: downpaymentCurrencyToIBC, amount: downpayment }],
      );

      // quotе right after the open (related to an issue we had)
      await leaserInstance.leaseQuote('1', downpaymentCurrency, leaseCurrency);

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
      const leaseToLPN_min = +leaseAmount / minToleranceCurrencyPrice_LC;
      const leaseToLPN_max = +leaseAmount / maxToleranceCurrencyPrice_LC;

      expect(BigInt(leaseAmount)).toBeGreaterThan(
        BigInt(
          (downpaymentToLPN_min + +leasePrincipal) *
            minToleranceCurrencyPrice_LC,
        ),
      );
      expect(BigInt(leaseAmount)).toBeLessThan(
        BigInt(
          (downpaymentToLPN_max + +leasePrincipal) *
            maxToleranceCurrencyPrice_LC,
        ),
      );

      const calcBorrowAmount_min = calcBorrow(
        downpaymentToLPN_min,
        +leaserConfig.config.liability.initial,
      );
      const calcBorrowAmount_max = calcBorrow(
        downpaymentToLPN_max,
        +leaserConfig.config.liability.initial,
      );

      // borrow=init%*LeaseTotal(borrow+downpayment);
      expect(+leasePrincipal).toBeGreaterThan(calcBorrowAmount_min);
      expect(+leasePrincipal).toBeLessThan(calcBorrowAmount_max);

      const borrowerBalanceAfter_LC = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        leaseCurrencyToIBC,
      );

      const borrowerBalanceAfter_PC = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        downpaymentCurrencyToIBC,
      );

      // get the liquidity after
      const lppLiquidityAfter = await cosm.getBalance(
        lppContractAddress,
        lppCurrencyToIBC,
      );

      expect(BigInt(borrowerBalanceAfter_PC.amount)).toBe(
        BigInt(borrowerBalanceBefore_PC.amount) - BigInt(downpayment),
      );

      expect(borrowerBalanceAfter_LC.amount).toBe(
        borrowerBalanceBefore_LC.amount,
      );

      expect(lppLiquidityAfter.amount).toBeGreaterThan(
        BigInt(lppLiquidityBefore.amount) -
          (BigInt(leaseToLPN_min) - BigInt(downpayment)),
      );
      expect(lppLiquidityAfter.amount).toBeLessThan(
        BigInt(lppLiquidityBefore.amount) -
          (BigInt(leaseToLPN_max) - BigInt(downpayment)),
      );
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
          [{ denom: downpaymentCurrencyIBC, amount: downpaymentAmount }],
          customFees.transfer,
        );
      }

      const borrowerBalanceBefore = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        downpaymentCurrencyToIBC,
      );

      const openLease = () =>
        leaserInstance.openLease(
          borrowerWallet,
          leaseCurrency,
          customFees.exec,
          [{ denom: downpaymentCurrencyIBC, amount: downpaymentAmount }],
        );

      await expect(openLease).rejects.toThrow(message);

      const borrowerBalanceAfter = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        downpaymentCurrencyToIBC,
      );
      expect(borrowerBalanceAfter.amount).toBe(borrowerBalanceBefore.amount);
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
      const currentDownpaymentCurrency = getOnlyPaymentCurrencies()[0];
      const currentDownpaymentCurrencyToIBC = currencyTicker_To_IBC(
        currentDownpaymentCurrency,
      );

      await testOpening(
        currentLeaseCurrency,
        currentDownpaymentCurrency,
        currentDownpaymentCurrencyToIBC,
      );
    });

    test('the successful scenario for opening a lease - downpayment currency === lease currency- should work as expected', async () => {
      // TO DO !!!!!!!!!!!!!! leaseCurrency balance > 0 is required for the reserve account
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

    runTestIfLocal(
      'the borrower tries to open lease when there is no currency price provided by the Oracle - should produce an error',
      async () => {
        const leaseCurrencyPriceObj = () =>
          oracleInstance.getPriceFor(noProvidedPriceFor);
        await expect(leaseCurrencyPriceObj).rejects.toThrow('No price');

        await testOpeningWithInvalidParams(
          noProvidedPriceFor,
          downpaymentCurrencyToIBC,
          '10',
          `TO DO`,
        );

        // TO DO - no downpayment currency price (when we have >1 onlyPaymentsCurrencies in the list of supported currencies)
        // await testOpeningWithInvalidParams(
        //   leaseCurrency,
        //   noProvidedPriceForPaymentOnly,
        //   '10',
        //   `TO DO`,
        // );
      },
    );

    runTestIfLocal(
      'the borrower tries to open a lease with unsupported payment currency - should produce an error',
      async () => {
        await testOpeningWithInvalidParams(
          leaseCurrency,
          'unsupported',
          '10',
          `Found currency 'unsupported' which is not defined in the payment currency group`,
        );
      },
    );

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
    // test('the borrower tries to open lease whose total value is too small - should produce an error', async () => {
    // });
  },
);
