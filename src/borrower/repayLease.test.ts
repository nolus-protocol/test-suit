import NODE_ENDPOINT, {
  getUser1Wallet,
  createWallet,
  getContractsOwnerWallet,
} from '../util/clients';
import { Coin } from '@cosmjs/amino';
import {
  customFees,
  NATIVE_TICKER,
  sleep,
  undefinedHandler,
} from '../util/utils';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import {
  sendInitExecuteFeeTokens,
  sendInitTransferFeeTokens,
} from '../util/transfer';
import {
  calcInterestRate,
  currencyTicker_To_IBC,
} from '../util/smart-contracts/calculations';
import { PreciseDate } from '@google-cloud/precise-date';
import { runOrSkip } from '../util/testingRules';
import {
  getChangeFromRepayResponse,
  getLeaseAddressFromOpenLeaseResponse,
  getLeaseGroupCurrencies,
  getLoanInterestPaidFromRepayResponse,
  getMarginInterestPaidFromRepayResponse,
  getMarginPaidTimeFromRepayResponse,
  getPrincipalPaidFromRepayResponse,
} from '../util/smart-contracts/getters';
import {
  checkLeaseBalance,
  provideEnoughLiquidity,
  waitLeaseOpeningProcess,
} from '../util/smart-contracts/actions';
import { LeaseInfo } from '@nolus/nolusjs/build/contracts';

runOrSkip(process.env.TEST_BORROWER as string)(
  'Borrower tests - Repay lease',
  () => {
    let userWithBalanceWallet: NolusWallet;
    let borrowerWallet: NolusWallet;
    let contractsOwnerWallet: NolusWallet;
    let lppCurrency: string;
    let lppCurrencyToIBC: string;
    let leaseCurrency: string;
    let downpaymentCurrency: string;
    let downpaymentCurrencyToIBC: string;
    let paymentCurrency: string;
    let paymentCurrencyToIBC: string;
    let lppInstance: NolusContracts.Lpp;
    let oracleInstance: NolusContracts.Oracle;
    let leaserInstance: NolusContracts.Leaser;
    let mainLeaseAddress: string;
    let marginInterestPaidTo: bigint;
    let cosm: any;

    const leaserContractAddress = process.env.LEASER_ADDRESS as string;
    const lppContractAddress = process.env.LPP_ADDRESS as string;
    const profitContractAddress = process.env.PROFIT_ADDRESS as string;
    const oracleContractAddress = process.env.ORACLE_ADDRESS as string;

    const downpayment = '10000000000';
    const outstandingBySec = 15;

    function verifyInterestDueCalc(
      principalDue: bigint,
      interestRate: bigint,
      interestPaidByNanoSec: bigint, // from
      outstandingByNanoSec: bigint, // to
      expectedResult: bigint,
    ): bigint {
      const calcInterest = calcInterestRate(
        principalDue,
        interestRate,
        interestPaidByNanoSec,
        outstandingByNanoSec,
      );

      expect(calcInterest).toBeGreaterThanOrEqual(BigInt(0));
      expect(calcInterest).toBe(expectedResult);

      return calcInterest;
    }

    async function verifyLeaseState(leaseState: LeaseInfo) {
      const loan = await lppInstance.getLoanInformation(mainLeaseAddress);

      if (!leaseState) {
        undefinedHandler();
        return;
      }

      const annualInterest = BigInt(leaseState.interest_rate);
      const interestRateMargin = BigInt(leaseState.interest_rate_margin);
      const PID_beforeRepay = leaseState.previous_interest_due.amount;
      const PMD_beforeRepay = leaseState.previous_margin_due.amount;
      const CID_beforeRepay = leaseState.current_interest_due.amount;
      const CMD_beforeRepay = leaseState.current_margin_due.amount;

      const leasePrincipalBeforeRepay = BigInt(leaseState.principal_due.amount);

      const outstandingInterest = await lppInstance.getOutstandingInterest(
        mainLeaseAddress,
        leaseState.validity,
      );

      // verify interest calc
      // loan interest due
      const calcLoanInterestDue = verifyInterestDueCalc(
        leasePrincipalBeforeRepay,
        annualInterest,
        BigInt(loan.interest_paid),
        BigInt(leaseState.validity),
        BigInt(CID_beforeRepay),
      );

      expect(BigInt(outstandingInterest.amount)).toBe(calcLoanInterestDue);

      // margin interest due
      verifyInterestDueCalc(
        leasePrincipalBeforeRepay,
        interestRateMargin,
        BigInt(marginInterestPaidTo),
        BigInt(leaseState.validity),
        BigInt(CMD_beforeRepay),
      );

      // period is still active
      expect(PID_beforeRepay).toBe('0');
      expect(PMD_beforeRepay).toBe('0');
    }

    async function verifyTransferAfterRepay(
      payerWallet: NolusWallet,
      payerBalanceBefore: bigint,
      profitBalanceBefore: bigint,
      paymentCurrencyToIBC: string,
      payment: Coin,
      exactMarginPaid: bigint,
    ): Promise<void> {
      const payerBalanceAfter = await payerWallet.getBalance(
        payerWallet.address as string,
        paymentCurrencyToIBC,
      );

      const profitBalanceAfter = await cosm.getBalance(
        profitContractAddress,
        lppCurrencyToIBC,
      );

      expect(BigInt(payerBalanceAfter.amount)).toBe(
        payerBalanceBefore - BigInt(payment.amount),
      );

      expect(BigInt(profitBalanceAfter.amount)).toBe(
        profitBalanceBefore + exactMarginPaid,
      );
    }

    function getTotalInterest(leaseState: LeaseInfo): bigint {
      return (
        BigInt(leaseState.previous_margin_due.amount) +
        BigInt(leaseState.previous_interest_due.amount) +
        BigInt(leaseState.current_interest_due.amount) +
        BigInt(leaseState.current_margin_due.amount)
      );
    }

    async function testRepayment(
      payerWallet: NolusWallet,
      leaseAddress: string,
      leaseStateBeforeRepay: LeaseInfo,
      payment: Coin,
    ) {
      const leaseInstance = new NolusContracts.Lease(cosm, mainLeaseAddress);

      // get the annual_interest before
      const leaseAnnualInterestBefore = leaseStateBeforeRepay.interest_rate;
      const interestRateMargin = BigInt(
        leaseStateBeforeRepay.interest_rate_margin,
      );

      const leaseInterestBeforeRepay = getTotalInterest(leaseStateBeforeRepay);
      const paymentCurrency = payment.denom;
      const paymentCurrencyToIBC = currencyTicker_To_IBC(paymentCurrency);

      // let paymentToLPN = +payment.amount;
      // if (payment.denom !== lppCurrency) {
      //   const paymentCurrencyPriceObj = await oracleInstance.getPriceFor(
      //     payment.denom,
      //   );
      //   const paymentPrice =
      //     +paymentCurrencyPriceObj.amount.amount /
      //     +paymentCurrencyPriceObj.amount_quote.amount;
      //   // paymentToLPN = +payment.amount / paymentPrice;
      // }

      await userWithBalanceWallet.transferAmount(
        payerWallet.address as string,
        [payment],
        customFees.transfer,
      );
      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        payerWallet.address as string,
      );
      const payerBalanceBeforeRepay = await payerWallet.getBalance(
        payerWallet.address as string,
        paymentCurrencyToIBC,
      );
      const profitBalanceBeforeRepay = await cosm.getBalance(
        profitContractAddress,
        lppCurrencyToIBC,
      );

      const repayTxResponse = await leaseInstance.repayLease(
        payerWallet,
        customFees.exec,
        [payment],
      );
      // check lease address balance - there shouldn't be any
      const leaseBalances = await checkLeaseBalance(leaseAddress, [
        NATIVE_TICKER,
        leaseCurrency,
        paymentCurrency,
        downpaymentCurrency,
      ]);
      expect(leaseBalances).toBe(false);

      marginInterestPaidTo =
        getMarginPaidTimeFromRepayResponse(repayTxResponse);
      const marginInterestPaid =
        getMarginInterestPaidFromRepayResponse(repayTxResponse);
      const loanInterestPaid =
        getLoanInterestPaidFromRepayResponse(repayTxResponse);
      const principalPaid = getPrincipalPaidFromRepayResponse(repayTxResponse);
      // TO DO: get previous interest from the response, and expect =0

      const loan = await lppInstance.getLoanInformation(mainLeaseAddress);

      const leaseStateAfterRepay = (await leaseInstance.getLeaseStatus())
        .opened;

      if (!leaseStateAfterRepay) {
        undefinedHandler();
        return;
      }

      const PID_afterRepay = leaseStateAfterRepay.previous_interest_due.amount;
      const PMD_afterRepay = leaseStateAfterRepay.previous_margin_due.amount;
      const CID_afterRepay = leaseStateAfterRepay.current_interest_due.amount;
      const CMD_afterRepay = leaseStateAfterRepay.current_margin_due.amount;

      const leasePrincipalAfterRepay = BigInt(
        leaseStateAfterRepay.principal_due.amount,
      );
      const leaseInterestAfterRepay =
        BigInt(PID_afterRepay) +
        BigInt(PMD_afterRepay) +
        BigInt(CID_afterRepay) +
        BigInt(CMD_afterRepay);

      if (!leasePrincipalAfterRepay) {
        undefinedHandler();
        return;
      }

      // the configured leaser repayment period is > --> no previous period, so:
      expect(PMD_afterRepay).toBe('0');
      // TO DO - issue - https://gitlab-nomo.credissimo.net/nomo/smart-contracts/-/issues/9
      expect(PID_afterRepay).toBe('0');

      expect(leasePrincipalAfterRepay).toBe(
        BigInt(leaseStateBeforeRepay.principal_due.amount) - principalPaid,
      );

      // verify loan interest due calc
      const loanInterestDueImmediatelyBeforeCheck = verifyInterestDueCalc(
        leasePrincipalAfterRepay,
        BigInt(leaseAnnualInterestBefore),
        BigInt(loan.interest_paid),
        BigInt(leaseStateAfterRepay.validity),
        BigInt(CID_afterRepay) + BigInt(PID_afterRepay),
      );

      // verify margin interest due calc
      const marginInterestDueImmediatelyBeforeCheck = verifyInterestDueCalc(
        leasePrincipalAfterRepay,
        interestRateMargin,
        marginInterestPaidTo,
        BigInt(leaseStateAfterRepay.validity),
        BigInt(CMD_afterRepay),
      );

      expect(BigInt(leaseInterestAfterRepay)).toBe(
        BigInt(leaseInterestBeforeRepay) -
          (loanInterestPaid +
            marginInterestPaid +
            loanInterestDueImmediatelyBeforeCheck +
            marginInterestDueImmediatelyBeforeCheck),
      );

      await verifyTransferAfterRepay(
        payerWallet,
        BigInt(payerBalanceBeforeRepay.amount),
        BigInt(profitBalanceBeforeRepay.amount),
        paymentCurrencyToIBC,
        payment,
        BigInt(marginInterestPaid),
      );

      // get the annual_interest after payment
      const leaseAnnualInterestAfter = leaseStateAfterRepay.interest_rate;
      expect(leaseAnnualInterestBefore).toBe(leaseAnnualInterestAfter);
    }

    async function testRepaymentWithInvalidParams(
      leaseAddress: string,
      paymentCurrency: string,
      paymentAmount: string,
      message: string,
    ) {
      const payment = {
        denom: currencyTicker_To_IBC(paymentCurrency),
        amount: paymentAmount,
      };
      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );

      await userWithBalanceWallet.transferAmount(
        borrowerWallet.address as string,
        [payment],
        customFees.transfer,
      );

      const leaseInstance = new NolusContracts.Lease(cosm, leaseAddress);
      const result = () =>
        leaseInstance.repayLease(borrowerWallet, customFees.exec, [payment]);

      await expect(result).rejects.toThrow(message);
    }

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      cosm = await NolusClient.getInstance().getCosmWasmClient();

      userWithBalanceWallet = await getUser1Wallet();
      borrowerWallet = await createWallet();
      contractsOwnerWallet = await getContractsOwnerWallet();

      leaserInstance = new NolusContracts.Leaser(cosm, leaserContractAddress);
      lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);

      oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);

      const lppConfig = await lppInstance.getLppConfig();
      lppCurrency = lppConfig.lpn_ticker;
      lppCurrencyToIBC = currencyTicker_To_IBC(lppCurrency);
      downpaymentCurrency = lppCurrency;
      downpaymentCurrencyToIBC = currencyTicker_To_IBC(downpaymentCurrency);
      leaseCurrency = getLeaseGroupCurrencies()[0];

      const leaserConfig = await leaserInstance.getLeaserConfig();
      const newPeriod = 5184000000000000;
      const newGracePeriod = 864000000000000;
      // provide enough time for the repay testing
      leaserConfig.config.repayment.period = newPeriod;
      leaserConfig.config.repayment.grace_period = newGracePeriod;

      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        contractsOwnerWallet.address as string,
      );

      await leaserInstance.setLeaserConfig(
        contractsOwnerWallet,
        leaserConfig,
        customFees.exec,
      );

      await provideEnoughLiquidity(
        leaserInstance,
        lppInstance,
        (+downpayment * 2).toString(),
        downpaymentCurrency,
        leaseCurrency,
      );
    });

    test('the successful lease repayment scenario - should work as expected', async () => {
      await userWithBalanceWallet.transferAmount(
        borrowerWallet.address as string,
        [{ denom: lppCurrencyToIBC, amount: downpayment }],
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

      const result = await leaserInstance.openLease(
        borrowerWallet,
        lppCurrency,
        customFees.exec,
        [{ denom: downpaymentCurrencyToIBC, amount: downpayment }],
      );

      mainLeaseAddress = getLeaseAddressFromOpenLeaseResponse(result);
      expect(mainLeaseAddress).not.toBe('');

      const leaseInstance = new NolusContracts.Lease(cosm, mainLeaseAddress);
      expect(await waitLeaseOpeningProcess(leaseInstance)).toBe(undefined);

      const leaseStateBeforeFirstRepay = (await leaseInstance.getLeaseStatus())
        .opened;

      if (!leaseStateBeforeFirstRepay) {
        undefinedHandler();
        return;
      }

      const loan = await lppInstance.getLoanInformation(mainLeaseAddress);
      marginInterestPaidTo = BigInt(loan.interest_paid);

      verifyLeaseState(leaseStateBeforeFirstRepay);

      // FIRST PAYMENT - interest only,  paymentCurrency == lppCurrency
      // wait for >0 interest
      await sleep(outstandingBySec);

      paymentCurrency = lppCurrency;
      paymentCurrencyToIBC = currencyTicker_To_IBC(paymentCurrency);

      const leaseInterestBeforeFirstRepay = getTotalInterest(
        leaseStateBeforeFirstRepay,
      );

      const payment = {
        denom: paymentCurrencyToIBC,
        amount: leaseInterestBeforeFirstRepay.toString(),
      };

      await testRepayment(
        borrowerWallet,
        mainLeaseAddress,
        leaseStateBeforeFirstRepay,
        payment,
      );

      // SECOND PAYMENT - principal + interest, paymentCurrency !== lppCurrency
      await sleep(outstandingBySec);

      const leaseStateBeforeSecondRepay = (await leaseInstance.getLeaseStatus())
        .opened;

      if (!leaseStateBeforeSecondRepay) {
        undefinedHandler();
        return;
      }

      verifyLeaseState(leaseStateBeforeSecondRepay);

      const leaseInterestBeforeSecondRepay = getTotalInterest(
        leaseStateBeforeSecondRepay,
      );

      const leasePrincipalBeforeSecondRepay = BigInt(
        leaseStateBeforeSecondRepay.principal_due.amount,
      );

      paymentCurrency = leaseCurrency;
      paymentCurrencyToIBC = currencyTicker_To_IBC(paymentCurrency);

      const paymentAmountInLPN =
        BigInt(leaseInterestBeforeSecondRepay) +
        BigInt(leasePrincipalBeforeSecondRepay) / BigInt(2);
      const paymentCurrencyPrice = await oracleInstance.getPriceFor(
        paymentCurrency,
      );
      const paymentAmountInPaymentCurrency =
        (paymentAmountInLPN * BigInt(paymentCurrencyPrice.amount.amount)) /
        BigInt(paymentCurrencyPrice.amount_quote.amount);

      const secondPayment = {
        denom: paymentCurrencyToIBC,
        amount: paymentAmountInPaymentCurrency.toString(),
      };

      await testRepayment(
        borrowerWallet,
        mainLeaseAddress,
        leaseStateBeforeSecondRepay,
        secondPayment,
      );

      // // principal < principal before repay && delay secs < outstandingBySec -->> interestAfterRepay < interestBeforeRepay
      // expect(BigInt(leaseInterestAfterSecondRepay)).toBeLessThan(
      //   leaseInterestBeforeSecondRepay,
      // );
    });

    test('the borrower tries to pay a lease with unsupported payment currency- should produce an error', async () => {
      const invalidPaymentCurrency = 'unsupported';

      await testRepaymentWithInvalidParams(
        mainLeaseAddress,
        invalidPaymentCurrency,
        '11',
        'TO DO',
      ); // any amount
    });

    test('the borrower tries to pay a lease with more amount than he owns - should produce an error', async () => {
      const forBalance = 5;

      await userWithBalanceWallet.transferAmount(
        borrowerWallet.address as string,
        [
          {
            denom: lppCurrencyToIBC,
            amount: forBalance.toString(),
          },
        ],
        customFees.transfer,
      );
      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );

      const repayMore = {
        denom: lppCurrencyToIBC,
        amount: (forBalance + 1).toString(),
      };

      const leaseInstance = new NolusContracts.Lease(cosm, mainLeaseAddress);
      const result = () =>
        leaseInstance.repayLease(borrowerWallet, customFees.exec, [repayMore]);

      await expect(result).rejects.toThrow(/^.*insufficient funds.*/);
    });

    test('the borrower tries to pay a lease with 0 amount - should produce an error', async () => {
      await testRepaymentWithInvalidParams(
        mainLeaseAddress,
        lppCurrency,
        '0',
        'invalid coins',
      );
    });

    test('a user other than the lease owner tries to pay - should work as expected', async () => {
      const newUserWallet = await createWallet();
      const leaseInstance = new NolusContracts.Lease(cosm, mainLeaseAddress);

      await sleep(outstandingBySec);

      const leaseStateBeforeRepay = (await leaseInstance.getLeaseStatus())
        .opened;

      if (!leaseStateBeforeRepay) {
        undefinedHandler();
        return;
      }

      paymentCurrency = lppCurrency;
      paymentCurrencyToIBC = currencyTicker_To_IBC(paymentCurrency);

      const leaseInterestBeforeRepay = getTotalInterest(leaseStateBeforeRepay);

      const payment = {
        denom: paymentCurrencyToIBC,
        amount: leaseInterestBeforeRepay.toString(),
      };

      await testRepayment(
        newUserWallet,
        mainLeaseAddress,
        leaseStateBeforeRepay,
        payment,
      );
    });

    test('the borrower tries to repay the lease at once and to pay excess', async () => {
      const leaseInstance = new NolusContracts.Lease(cosm, mainLeaseAddress);
      const leaseStateBeforeRepay = (await leaseInstance.getLeaseStatus())
        .opened;

      if (!leaseStateBeforeRepay) {
        undefinedHandler();
        return;
      }

      const leaseInterestBeforeRepay = getTotalInterest(leaseStateBeforeRepay);
      const leasePrincipalBeforeRepay = BigInt(
        leaseStateBeforeRepay.principal_due.amount,
      );
      const leaseAmountBeforeRepay = leaseStateBeforeRepay.amount.amount;

      const excess = leasePrincipalBeforeRepay;

      const repayWithExcess = {
        // +excess - make sure the lease principal will be paid
        denom: lppCurrencyToIBC,
        amount: (
          leaseInterestBeforeRepay +
          leasePrincipalBeforeRepay +
          excess
        ).toString(),
      };

      await userWithBalanceWallet.transferAmount(
        borrowerWallet.address as string,
        [repayWithExcess],
        customFees.transfer,
      );
      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );

      const repayTxReponse = await leaseInstance.repayLease(
        borrowerWallet,
        customFees.exec,
        [repayWithExcess],
      );

      const exactExcess = getChangeFromRepayResponse(repayTxReponse);

      const stateBeforeClose = await leaseInstance.getLeaseStatus();

      expect(stateBeforeClose.paid).toBeDefined();

      // try to pay already paid lease
      await userWithBalanceWallet.transferAmount(
        borrowerWallet.address as string,
        [repayWithExcess], // any amount
        customFees.transfer,
      );
      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );

      const result = () =>
        leaseInstance.repayLease(borrowerWallet, customFees.exec, [
          repayWithExcess,
        ]);

      await expect(result).rejects.toThrow(
        /^.*The underlying loan is closed.*/,
      );

      // close
      const borrowerBalanceBeforeClose = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        lppCurrency,
      );

      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );

      await leaseInstance.closeLease(borrowerWallet, customFees.exec);

      // try lpp.outstanding_interest
      const outstandingInterest = await lppInstance.getOutstandingInterest(
        mainLeaseAddress,
        new PreciseDate().getFullTime().toString(),
      );

      expect(outstandingInterest).toBe(null);

      const borrowerBalanceAfterClose = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        lppCurrency,
      );

      expect(BigInt(borrowerBalanceAfterClose.amount)).toBe(
        BigInt(borrowerBalanceBeforeClose.amount) +
          BigInt(leaseAmountBeforeRepay) +
          exactExcess,
      );

      // return amount to the main account (user with balance)
      await sendInitTransferFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );
      await borrowerWallet.transferAmount(
        userWithBalanceWallet.address as string,
        [borrowerBalanceAfterClose],
        customFees.transfer,
      );
    });

    test('the borrower tries to repay an already closed lease - should produce an error', async () => {
      await testRepaymentWithInvalidParams(
        mainLeaseAddress,
        lppCurrency,
        '11', // any amount
        'The underlying loan is closed',
      );
    });
  },
);
