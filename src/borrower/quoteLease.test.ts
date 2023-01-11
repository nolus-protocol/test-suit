import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate/';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import { runOrSkip } from '../util/testingRules';
import NODE_ENDPOINT, { createWallet } from '../util/clients';
import {
  calcBorrow,
  calcQuoteAnnualInterestRate,
  calcUtilization,
  currencyPriceObjToNumbers,
  currencyTicker_To_IBC,
} from '../util/smart-contracts/calculations';
import { getLeaseGroupCurrencies } from '../util/smart-contracts/getters';
import { provideEnoughLiquidity } from '../util/smart-contracts/actions/lender';
import { PERMILLE_TO_PERCENT } from '../util/utils';

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

    const downpayment = '10';

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

      const leaserConfig = await leaserInstance.getLeaserConfig();
      liabilityInitialPercent = +leaserConfig.config.liability.initial;

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

      const leaseCurrencyPriceObj = await oracleInstance.getPriceFor(
        leaseCurrency,
      );

      const {
        minToleranceCurrencyPrice,
        exactCurrencyPrice,
        maxToleranceCurrencyPrice,
      } = currencyPriceObjToNumbers(leaseCurrencyPriceObj, 1);

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

      const calcBorrowAmount = calcBorrow(
        +downpayment,
        liabilityInitialPercent,
      );
      expect(+quote.borrow.amount).toBe(Math.trunc(calcBorrowAmount));

      expect(+quote.total.amount).toBeGreaterThanOrEqual(
        Math.trunc(
          (+quote.borrow.amount + +downpayment) / minToleranceCurrencyPrice,
        ),
      );
      expect(+quote.total.amount).toBeLessThanOrEqual(
        Math.trunc(
          (+quote.borrow.amount + +downpayment) / maxToleranceCurrencyPrice,
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
      );

      expect(
        calcQuoteAnnualInterestRate(
          utilization,
          utilizationOptimal,
          baseInterestRate,
          addonOptimalInterestRate,
        ),
      ).toBe(Math.trunc(quote.annual_interest_rate / 10));

      expect(borrowerBalanceAfter.amount).toBe(borrowerBalanceBefore.amount);
    });

    test('the borrower tries to apply for a lease with 0 down payment - should produce an error', async () => {
      const quoteQueryResult = () =>
        leaserInstance.leaseQuote('0', downpaymentCurrency, leaseCurrency);
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
        /^.*Unknown currency symbol: \"unsupported\".*/,
      );
    });

    test('the borrower tries to apply for a lease with leaseCurrency === lpp native - should produce an error', async () => {
      const quoteQueryResult = () =>
        leaserInstance.leaseQuote('100', downpaymentCurrency, lppCurrency);
      await expect(quoteQueryResult).rejects.toThrow(
        /^.*Unknown currency symbol: \"USDC\".*/,
      );
    });
  },
);
