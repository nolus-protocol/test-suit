import NODE_ENDPOINT, { createWallet } from '../util/clients';
import { Coin } from '@cosmjs/amino';

import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import {
  calcBorrow,
  calcQuoteAnnualInterestRate,
  calcUtilization,
  currencyTicker_To_IBC,
} from '../util/smart-contracts/calculations';
import { runOrSkip } from '../util/testingRules';
import { getLeaseGroupCurrencies } from '../util/smart-contracts/getters';
import { provideEnoughLiquidity } from '../util/smart-contracts/actions/lender';

runOrSkip(process.env.TEST_BORROWER as string)(
  'Borrower tests - Quote lease',
  () => {
    let borrowerWallet: NolusWallet;
    let lppLiquidity: Coin;
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

    const leaserContractAddress = process.env.LEASER_ADDRESS as string;
    const lppContractAddress = process.env.LPP_ADDRESS as string;
    const oracleContractAddress = process.env.ORACLE_ADDRESS as string;
    let cosm: any;

    const downpayment = '10';
    const toPercent = 10;

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

      baseInterestRate = lppConfig.base_interest_rate / toPercent; //%
      utilizationOptimal = lppConfig.utilization_optimal / toPercent; //%
      addonOptimalInterestRate =
        lppConfig.addon_optimal_interest_rate / toPercent; //%

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

      // push price for leaseCurrency
      // const leaseCurrencyPrice = await provideLeasePrices(
      //   oracleInstance,
      //   leaseCurrency,
      //   lppCurrency,
      // );
      // OR get price
      // TO DO: get the exact price from the open tx events
      const leaseCurrencyPriceObj = await oracleInstance.getPriceFor(
        leaseCurrency,
      );
      const leaseCurrencyPrice =
        +leaseCurrencyPriceObj.amount.amount /
        +leaseCurrencyPriceObj.amount_quote.amount;

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

      const leaserConfig = await leaserInstance.getLeaserConfig();

      const calcBorrowAmount = calcBorrow(
        +downpayment,
        +leaserConfig.config.liability.initial,
      );
      expect(BigInt(quote.borrow.amount)).toBe(
        BigInt(calcBorrowAmount * leaseCurrencyPrice),
      );

      expect(BigInt(quote.total.amount)).toBe(
        (BigInt(quote.borrow.amount) + BigInt(downpayment)) *
          BigInt(leaseCurrencyPrice),
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
          +utilization,
          +utilizationOptimal,
          +baseInterestRate,
          +addonOptimalInterestRate,
        ),
      ).toBe(quote.annual_interest_rate);

      expect(borrowerBalanceAfter.amount).toBe(borrowerBalanceBefore.amount);
    });

    test('the borrower tries to apply for a lease with 0 down payment - should produce an error', async () => {
      const quoteQueryResult = () =>
        leaserInstance.leaseQuote('0', downpaymentCurrency, leaseCurrency);
      await expect(quoteQueryResult).rejects.toThrow(
        /^.*Cannot open lease with zero downpayment.*/,
      );
    });

    test('the borrower tries to apply for a loan with tokens more than the liquidity in lpp - should be rejected with an information message', async () => {
      // push price for leaseCurrency
      // await provideLeasePrices(oracleInstance, leaseCurrency, lppCurrency);
      // OR assume the price exists

      // get the liquidity
      lppLiquidity = await cosm.getBalance(lppContractAddress, lppCurrency);

      const quoteQueryResult = () =>
        leaserInstance.leaseQuote(
          (BigInt(lppLiquidity.amount) + BigInt(1)).toString(),
          downpaymentCurrency,
          leaseCurrency,
        );
      await expect(quoteQueryResult).rejects.toThrow(/^.*No Liquidity.*/);
    });

    test('the borrower tries to apply for a lease with unsupported currency as a down payment - should produce an error', async () => {
      const invalidPaymentCurrency = 'unsupported';

      const quoteQueryResult = () =>
        leaserInstance.leaseQuote('100', invalidPaymentCurrency, leaseCurrency);
      await expect(quoteQueryResult).rejects.toThrow(/^.*TO DO.*/);
    });

    test('the borrower tries to apply for a lease with leaseCurrency === lpp native - should produce an error', async () => {
      const quoteQueryResult = () =>
        leaserInstance.leaseQuote('100', downpaymentCurrency, lppCurrency);
      await expect(quoteQueryResult).rejects.toThrow(/^.*TO DO.*/);
    });
  },
);
