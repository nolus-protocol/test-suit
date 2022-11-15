import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import { customFees, NATIVE_TICKER, undefinedHandler } from '../util/utils';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import {
  calcBorrow,
  currencyTicker_To_IBC,
} from '../util/smart-contracts/calculations';
import { InstantiateOptions } from '@cosmjs/cosmwasm-stargate';
import { runOrSkip } from '../util/testingRules';
import {
  getLeaseAddressFromOpenLeaseResponse,
  getLeaseGroupCurrencies,
  getOnlyPaymentCurrencies,
} from '../util/smart-contracts/getters';
import {
  checkLeaseBalance,
  provideEnoughLiquidity,
  waitLeaseOpeningProcess,
} from '../util/smart-contracts/actions';

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
    let cosm: any;

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

      const quote = await leaserInstance.leaseQuote(
        downpayment,
        downpaymentCurrency,
        leaseCurrency,
      );

      expect(quote.borrow).toBeDefined();

      // get borrower balance
      const borrowerBalanceBefore_LC = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        leaseCurrencyToIBC,
      );
      const borrowerBalanceBefore_PC = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        downpaymentCurrencyToIBC,
      );

      // get the liquidity before
      const lppLiquidityBefore = await cosm.getBalance(
        lppContractAddress,
        lppCurrencyToIBC,
      );

      const leasesBefore = await leaserInstance.getCurrentOpenLeasesByOwner(
        borrowerWallet.address as string,
      );

      // get config before open a lease
      const leaserConfig = await leaserInstance.getLeaserConfig();

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

      let downpaymentCurrencyPrice = 1;
      if (downpaymentCurrency !== lppCurrency) {
        // push OR get price
        // TO DO: get the exact price from the tx events (after openLease())
        const downnpaymentCurrencyPriceObj = await oracleInstance.getPriceFor(
          leaseCurrency,
        );
        downpaymentCurrencyPrice =
          +downnpaymentCurrencyPriceObj.amount.amount /
          +downnpaymentCurrencyPriceObj.amount_quote.amount;
      }

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

      // get the new lease state
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

      const downpaymentToLPN = +downpayment / downpaymentCurrencyPrice;
      const leaseToLPN = +leaseAmount / leaseCurrencyPrice;

      expect(BigInt(leaseAmount)).toBe(
        BigInt((downpaymentToLPN + +leasePrincipal) * leaseCurrencyPrice),
      );

      const calcBorrowAmount = calcBorrow(
        Math.trunc(+downpayment / downpaymentCurrencyPrice),
        +leaserConfig.config.liability.initial,
      );

      // borrow=init%*LeaseTotal(borrow+downpayment);
      expect(+leasePrincipal).toBe(calcBorrowAmount);

      expect(leaseToLPN - downpaymentToLPN).toBe(+leasePrincipal);

      // get borrower balance
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

      expect(lppLiquidityAfter.amount).toBe(
        BigInt(lppLiquidityBefore.amount) -
          (BigInt(leaseToLPN) - BigInt(downpayment)),
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

      await userWithBalanceWallet.transferAmount(
        borrowerWallet.address as string,
        [{ denom: downpaymentCurrencyToIBC, amount: downpaymentAmount }],
        customFees.transfer,
      );

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

    test('the borrower tries to open a lease with unsupported payment currency - should produce an error', async () => {
      await testOpeningWithInvalidParams(
        leaseCurrency,
        'unsupported',
        '10',
        'Found currency unsupported which is not defined in the payment currency group',
      );
    });

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
        open_loan: { amount: { amount: '10', symbol: leaseCurrency } }, // any amount
      };

      const openLoan = () =>
        userWithBalanceWallet.execute(
          userWithBalanceWallet.address as string,
          lppContractAddress,
          lppOpenLoanMsg,
          customFees.exec,
        );

      await expect(openLoan).rejects.toThrow(/^.*Unauthorized contract Id.*/);
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
