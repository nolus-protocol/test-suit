import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate/';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import { runTestIfLocal, runOrSkip } from '../util/testingRules';
import NODE_ENDPOINT, { createWallet } from '../util/clients';
import {
  calcBorrowLTD,
  calcBorrowLTV,
  calcQuoteAnnualInterestRate,
  calcUtilization,
  currencyPriceObjToNumbers,
  currencyTicker_To_IBC,
  LTVtoLTD,
} from '../util/smart-contracts/calculations';
import { getLeaseGroupCurrencies } from '../util/smart-contracts/getters';
import { provideEnoughLiquidity } from '../util/smart-contracts/actions/lender';
import { noProvidedPriceFor, PERMILLE_TO_PERCENT } from '../util/utils';

runOrSkip(process.env.TEST_BORROWER as string)(
  'Borrower tests - Quote lease',
  () => {
    let borrowerWallet: NolusWallet;
    let lppCurrency: string;
    let downpaymentCurrency: string;
    let downpaymentCurrencyToIBC: string;
    let leaseCurrency: string;
    let leaserInstance: NolusContracts.Leaser;
    let oracleInstance: NolusContracts.Oracle;
    let lppInstance: NolusContracts.Lpp;
    let baseInterestRate: number;
    let utilizationOptimal: number;
    let addonOptimalInterestRate: number;
    let liabilityInitialPercent: number;
    let cosm: CosmWasmClient;

    const leaserContractAddress = process.env.LEASER_ADDRESS as string;
    const lppContractAddress = process.env.LPP_ADDRESS as string;
    const oracleContractAddress = process.env.ORACLE_ADDRESS as string;

    const downpayment = '10000';

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      cosm = await NolusClient.getInstance().getCosmWasmClient();
      borrowerWallet = await createWallet();

      leaserInstance = new NolusContracts.Leaser(cosm, leaserContractAddress);
      lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);
      oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);

      const lppConfig = await lppInstance.getLppConfig();
      lppCurrency = lppConfig.lpn_ticker;
      downpaymentCurrency = lppCurrency;
      downpaymentCurrencyToIBC = currencyTicker_To_IBC(downpaymentCurrency);
      leaseCurrency = getLeaseGroupCurrencies()[0];

      baseInterestRate =
        lppConfig.borrow_rate.base_interest_rate / PERMILLE_TO_PERCENT; //%
      utilizationOptimal =
        lppConfig.borrow_rate.utilization_optimal / PERMILLE_TO_PERCENT; //%
      addonOptimalInterestRate =
        lppConfig.borrow_rate.addon_optimal_interest_rate / PERMILLE_TO_PERCENT; //%

      const leaserConfig = (await leaserInstance.getLeaserConfig()).config;
      liabilityInitialPercent =
        +leaserConfig.lease_position_spec.liability.initial;

      await provideEnoughLiquidity(
        leaserInstance,
        lppInstance,
        downpayment,
        downpaymentCurrency,
        leaseCurrency,
      );
    });

    test('the borrower should be able to get information depending on the down payment', async () => {
      const borrowerBalanceBefore = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        downpaymentCurrencyToIBC,
      );

      const leaseCurrencyPriceObj =
        await oracleInstance.getPriceFor(leaseCurrency);

      const [
        minToleranceCurrencyPrice,
        exactCurrencyPrice,
        maxToleranceCurrencyPrice,
      ] = currencyPriceObjToNumbers(leaseCurrencyPriceObj, 1);

      const quote = await leaserInstance.leaseQuote(
        downpayment,
        downpaymentCurrency,
        leaseCurrency,
      );

      const borrowerBalanceAfter = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        downpaymentCurrencyToIBC,
      );

      expect(quote.total).toBeDefined();
      expect(quote.borrow).toBeDefined();
      expect(quote.annual_interest_rate).toBeDefined();

      const calcBorrowAmount = calcBorrowLTV(
        +downpayment,
        liabilityInitialPercent,
      );
      expect(+quote.borrow.amount).toBe(Math.trunc(calcBorrowAmount));

      expect(+quote.total.amount).toBeGreaterThanOrEqual(
        Math.trunc(
          (+quote.borrow.amount + +downpayment) * minToleranceCurrencyPrice,
        ),
      );
      expect(+quote.total.amount).toBeLessThanOrEqual(
        Math.trunc(
          (+quote.borrow.amount + +downpayment) * maxToleranceCurrencyPrice,
        ),
      );

      const lppInformation = await lppInstance.getLppBalance();
      const totalPrincipalDueByNow = lppInformation.total_principal_due;
      const totalInterestDueByNow = lppInformation.total_interest_due;
      const lppLiquidity = lppInformation.balance;

      const utilization = calcUtilization(
        +totalPrincipalDueByNow.amount,
        +quote.borrow.amount,
        +totalInterestDueByNow.amount,
        +lppLiquidity.amount,
        utilizationOptimal,
      );

      expect(
        calcQuoteAnnualInterestRate(
          utilization,
          utilizationOptimal,
          baseInterestRate,
          addonOptimalInterestRate,
        ),
      ).toBe(quote.annual_interest_rate);

      expect(borrowerBalanceAfter.amount).toBe(borrowerBalanceBefore.amount);
    });

    test('the borrower should be able to get information depending on the optional max ltv', async () => {
      const initLTD = LTVtoLTD(liabilityInitialPercent);
      let maxLTD = initLTD - 50; // -5%

      let quote = await leaserInstance.leaseQuote(
        downpayment,
        downpaymentCurrency,
        leaseCurrency,
        maxLTD,
      );

      let calcBorrowAmount = calcBorrowLTD(+downpayment, maxLTD);
      expect(+quote.borrow.amount).toBe(Math.trunc(calcBorrowAmount));

      // if maxLTV > the liability initPercent --> use the second one
      maxLTD = initLTD + 100; // +10%

      quote = await leaserInstance.leaseQuote(
        downpayment,
        downpaymentCurrency,
        leaseCurrency,
        maxLTD,
      );

      calcBorrowAmount = calcBorrowLTV(+downpayment, liabilityInitialPercent);
      expect(+quote.borrow.amount).toBe(Math.trunc(calcBorrowAmount));
    });

    test('the borrower tries to apply for a lease with 0 down payment - should produce an error', async () => {
      const quoteQueryResult = () =>
        leaserInstance.leaseQuote('0', downpaymentCurrency, leaseCurrency);
      await expect(quoteQueryResult).rejects.toThrow(
        /^.*Cannot open lease with zero downpayment.*/,
      );
    });

    test('the borrower tries to apply for a lease with max ltv = 0 - should produce an error', async () => {
      const quoteQueryResult = () =>
        leaserInstance.leaseQuote(
          downpayment,
          downpaymentCurrency,
          leaseCurrency,
          0,
        );
      await expect(quoteQueryResult).rejects.toThrow(
        /^.*Cannot open lease with zero downpayment.*/,
      );
    });

    test('the borrower tries to apply for a lease with tokens more than the liquidity in lpp - should be rejected with an information message', async () => {
      const lppLiquidity = (await lppInstance.getLppBalance()).balance;

      const unavailableAmount = Math.ceil(
        ((+lppLiquidity.amount + 1) * (1000 - liabilityInitialPercent)) /
          liabilityInitialPercent,
      );

      const quoteQueryResult = () =>
        leaserInstance.leaseQuote(
          unavailableAmount.toString(),
          downpaymentCurrency,
          leaseCurrency,
        );
      await expect(quoteQueryResult).rejects.toThrow(/^.*No Liquidity.*/);
    });

    test('the borrower tries to apply for a lease with unsupported currency as a down payment - should produce an error', async () => {
      const invalidPaymentCurrency = 'unsupported';

      const quoteQueryResult = () =>
        leaserInstance.leaseQuote('100', invalidPaymentCurrency, leaseCurrency);
      await expect(quoteQueryResult).rejects.toThrow(
        `Found a symbol '${invalidPaymentCurrency}' pretending to be ticker of a currency pertaining to the payment group`,
      );
    });

    test('the borrower tries to apply for a lease with leaseCurrency === lpp native - should produce an error', async () => {
      const quoteQueryResult = () =>
        leaserInstance.leaseQuote('100', downpaymentCurrency, lppCurrency);
      await expect(quoteQueryResult).rejects.toThrow(
        /^.*Unknown currency symbol.*/,
      );
    });

    runTestIfLocal(
      'the borrower tries to apply for a lease when there is no currency price provided by the Oracle - should produce an error',
      async () => {
        const leaseCurrencyPriceObj = () =>
          oracleInstance.getPriceFor(noProvidedPriceFor);
        await expect(leaseCurrencyPriceObj).rejects.toThrow(
          `Unsupported currency '${noProvidedPriceFor}'`,
        );

        const quoteQueryResult = () =>
          leaserInstance.leaseQuote(
            '100', // any amount
            downpaymentCurrency,
            noProvidedPriceFor,
          );
        await expect(quoteQueryResult).rejects.toThrow(
          /^.*Failed to fetch price for the pair.*/,
        );

        // TO DO - no down payment currency price (when we have >1 onlyPaymentsCurrencies in the list of supported currencies)
        // quoteQueryResult = () =>
        //   leaserInstance.leaseQuote('100', noProvidedPriceForPaymentOnly, leaseCurrency);
        // await expect(quoteQueryResult).rejects.toThrow(
        //   /^.*TO DO".*/,
        // );
      },
    );
  },
);
