import { Coin, addCoins } from '@cosmjs/amino';
import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import { OpenedLeaseInfo } from '@nolus/nolusjs/build/contracts';
import {
  customFees,
  defaultTip,
  NATIVE_MINIMAL_DENOM,
  NATIVE_TICKER,
  noProvidedPriceFor,
  undefinedHandler,
} from '../util/utils';
import NODE_ENDPOINT, {
  getUser1Wallet,
  createWallet,
  txSearchByEvents,
} from '../util/clients';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import {
  currencyPriceObjToNumbers,
  currencyTicker_To_IBC,
} from '../util/smart-contracts/calculations';
import { runOrSkip, runTestIfLocal } from '../util/testingRules';
import {
  getChangeFromRepayTx,
  getLeaseGroupCurrencies,
  getMarginInterestPaidFromRepayTx,
  getPrincipalPaidFromRepayTx,
} from '../util/smart-contracts/getters';
import {
  checkLeaseBalance,
  openLease,
  returnAmountToTheMainAccount,
  waitLeaseInProgressToBeNull,
  waitLeaseOpeningProcess,
} from '../util/smart-contracts/actions/borrower';

runOrSkip(process.env.TEST_BORROWER as string)(
  'Borrower tests - Repay lease',
  () => {
    let userWithBalanceWallet: NolusWallet;
    let borrowerWallet: NolusWallet;
    let lppCurrency: string;
    let lppCurrencyToIBC: string;
    let leaseCurrency: string;
    let downpaymentCurrency: string;
    let paymentCurrency: string;
    let paymentCurrencyToIBC: string;
    let cosm: CosmWasmClient;
    let lppInstance: NolusContracts.Lpp;
    let oracleInstance: NolusContracts.Oracle;
    let leaserInstance: NolusContracts.Leaser;
    let leaseInstance: NolusContracts.Lease;
    let leaseAddress: string;

    const leaserContractAddress = process.env.LEASER_ADDRESS as string;
    const lppContractAddress = process.env.LPP_ADDRESS as string;
    const profitContractAddress = process.env.PROFIT_ADDRESS as string;
    const oracleContractAddress = process.env.ORACLE_ADDRESS as string;

    const downpayment = '100000';
    let paymentsCount = 0;

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

    async function testRepayment(
      payerWallet: NolusWallet,
      leaseStateBeforeRepay: OpenedLeaseInfo,
      payment: Coin,
    ) {
      const leaseAnnualInterestBefore =
        leaseStateBeforeRepay.loan_interest_rate;

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

      await userWithBalanceWallet.transferAmount(
        leaseAddress as string,
        [defaultTip],
        customFees.transfer,
      );

      await leaseInstance.repayLease(payerWallet, customFees.exec, [payment]);

      expect(await waitLeaseInProgressToBeNull(leaseInstance)).toBe(undefined);

      paymentsCount++;

      // check lease address balance - there shouldn't be any
      const leaseBalances = await checkLeaseBalance(leaseAddress, [
        NATIVE_TICKER,
        leaseCurrency,
        paymentCurrency,
        downpaymentCurrency,
      ]);
      expect(leaseBalances).toBe(false);

      const repayTxResponse = (
        await txSearchByEvents(
          `wasm-ls-repay._contract_address='${leaseAddress}'`,
          paymentsCount,
          1,
        )
      ).txs[0];

      const marginInterestPaid =
        getMarginInterestPaidFromRepayTx(repayTxResponse);
      const principalPaid = getPrincipalPaidFromRepayTx(repayTxResponse);

      const leaseStateAfterRepay = (await leaseInstance.getLeaseStatus())
        .opened;

      if (!leaseStateAfterRepay) {
        undefinedHandler();
        return;
      }

      const PID_afterRepay = leaseStateAfterRepay.overdue_interest.amount;
      const PMD_afterRepay = leaseStateAfterRepay.overdue_margin.amount;
      const CID_afterRepay = leaseStateAfterRepay.due_interest.amount;
      const CMD_afterRepay = leaseStateAfterRepay.due_margin.amount;

      const leasePrincipalAfterRepay = BigInt(
        leaseStateAfterRepay.principal_due.amount,
      );

      if (!leasePrincipalAfterRepay) {
        undefinedHandler();
        return;
      }

      // dp too small && interest rate too low && time is not enough --> no interest:
      expect(CMD_afterRepay).toBe('0');
      expect(CID_afterRepay).toBe('0');
      expect(PMD_afterRepay).toBe('0');
      expect(PID_afterRepay).toBe('0');

      expect(leasePrincipalAfterRepay).toBe(
        BigInt(leaseStateBeforeRepay.principal_due.amount) - principalPaid,
      );

      const transferredAmount =
        payment.denom === NATIVE_MINIMAL_DENOM
          ? addCoins(payment, customFees.exec.amount[0])
          : payment;

      await verifyTransferAfterRepay(
        payerWallet,
        BigInt(payerBalanceBeforeRepay.amount),
        BigInt(profitBalanceBeforeRepay.amount),
        paymentCurrencyToIBC,
        transferredAmount,
        BigInt(marginInterestPaid),
      );

      const leaseAnnualInterestAfter = leaseStateAfterRepay.loan_interest_rate;
      expect(leaseAnnualInterestBefore).toBe(leaseAnnualInterestAfter);
    }

    async function testRepaymentWithInvalidParams(
      payment: Coin,
      message: string,
    ) {
      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );

      if (+payment.amount > 0) {
        await userWithBalanceWallet.transferAmount(
          borrowerWallet.address as string,
          [payment],
          customFees.transfer,
        );
      }

      const result = () =>
        leaseInstance.repayLease(borrowerWallet, customFees.exec, [payment]);

      await expect(result).rejects.toThrow(message);
    }

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      cosm = await NolusClient.getInstance().getCosmWasmClient();

      userWithBalanceWallet = await getUser1Wallet();
      borrowerWallet = await createWallet();

      leaserInstance = new NolusContracts.Leaser(cosm, leaserContractAddress);
      lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);

      oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);

      lppCurrency = process.env.LPP_BASE_CURRENCY as string;
      lppCurrencyToIBC = await currencyTicker_To_IBC(lppCurrency);
      downpaymentCurrency = lppCurrency;
      leaseCurrency = (await getLeaseGroupCurrencies(oracleInstance))[0];

      expect(lppCurrencyToIBC).not.toBe('');

      leaseAddress = await openLease(
        leaserInstance,
        lppInstance,
        downpayment,
        downpaymentCurrency,
        leaseCurrency,
        borrowerWallet,
      );
      leaseInstance = new NolusContracts.Lease(cosm, leaseAddress);

      console.log('REPAY tests --- Lease address: ', leaseAddress);
      expect(await waitLeaseOpeningProcess(leaseInstance)).toBe(undefined);
    });

    afterAll(async () => {
      await returnAmountToTheMainAccount(borrowerWallet, lppCurrency);
    });

    test('the successful lease repayment scenario - payment currency === lpn currency - should work as expected', async () => {
      const leaseStateBeforeFirstRepay = (await leaseInstance.getLeaseStatus())
        .opened;

      if (!leaseStateBeforeFirstRepay) {
        undefinedHandler();
        return;
      }

      paymentCurrency = lppCurrency;
      paymentCurrencyToIBC = await currencyTicker_To_IBC(paymentCurrency);

      expect(paymentCurrencyToIBC).not.toBe('');

      const paymentAmount = Math.trunc(
        +leaseStateBeforeFirstRepay.principal_due.amount / 3,
      );

      const payment = {
        denom: paymentCurrencyToIBC,
        amount: paymentAmount.toString(),
      };

      await testRepayment(borrowerWallet, leaseStateBeforeFirstRepay, payment);
    });

    test('the successful lease repayment scenario - payment currency != lpn currency - should work as expected', async () => {
      const leaseStateBeforeSecondRepay = (await leaseInstance.getLeaseStatus())
        .opened;

      expect(leaseStateBeforeSecondRepay).toBeDefined();

      if (!leaseStateBeforeSecondRepay) {
        undefinedHandler();
        return;
      }

      paymentCurrency = leaseCurrency;
      paymentCurrencyToIBC = await currencyTicker_To_IBC(paymentCurrency);

      expect(paymentCurrencyToIBC).not.toBe('');

      const paymentAmountLPN =
        +leaseStateBeforeSecondRepay.principal_due.amount / 2;

      const paymentCurrencyPriceObj =
        await oracleInstance.getPriceFor(paymentCurrency);

      const [
        minToleranceCurrencyPrice,
        exactCurrencyPrice,
        maxToleranceCurrencyPrice,
      ] = currencyPriceObjToNumbers(paymentCurrencyPriceObj, 1);

      const paymentAmount = Math.trunc(paymentAmountLPN * exactCurrencyPrice);
      expect(paymentAmount).toBeGreaterThan(0);

      const secondPayment = {
        denom: paymentCurrencyToIBC,
        amount: paymentAmount.toString(),
      };

      await testRepayment(
        borrowerWallet,
        leaseStateBeforeSecondRepay,
        secondPayment,
      );
    });

    test('the borrower tries to pay a lease with more amount than he owns - should produce an error', async () => {
      const forBalance = 5;

      const borrowerBalance = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        lppCurrencyToIBC,
      );

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
        amount: (+borrowerBalance.amount + forBalance + 1).toString(),
      };

      const result = () =>
        leaseInstance.repayLease(borrowerWallet, customFees.exec, [repayMore]);

      await expect(result).rejects.toThrow(/^.*insufficient funds.*/);
    });

    test('the borrower tries to pay a lease with 0 amount - should produce an error', async () => {
      await testRepaymentWithInvalidParams(
        { denom: lppCurrencyToIBC, amount: '0' },
        'invalid coins',
      );
    });

    runTestIfLocal(
      'the borrower tries to pay when there is no payment currency price provided by the Oracle - should produce an error',
      async () => {
        const leaseCurrencyPriceObj = () =>
          oracleInstance.getPriceFor(noProvidedPriceFor);
        await expect(leaseCurrencyPriceObj).rejects.toThrow(
          `Unsupported currency '${noProvidedPriceFor}'`,
        );
        const noProvidedPriceForToIBC =
          await currencyTicker_To_IBC(noProvidedPriceFor);

        expect(noProvidedPriceFor).not.toBe('');

        const borrowerBalance = await borrowerWallet.getBalance(
          borrowerWallet.address as string,
          noProvidedPriceForToIBC,
        );

        await testRepaymentWithInvalidParams(
          {
            denom: noProvidedPriceForToIBC,
            amount: borrowerBalance.amount,
          },
          `Failed to fetch price for the pair ${noProvidedPriceFor}/${lppCurrency}`,
        );
      },
    );

    test('a user other than the lease owner tries to pay - should work as expected', async () => {
      const newUserWallet = await createWallet();

      const leaseStateBeforeRepay = (await leaseInstance.getLeaseStatus())
        .opened;

      expect(leaseStateBeforeRepay).toBeDefined();

      if (!leaseStateBeforeRepay) {
        undefinedHandler();
        return;
      }

      expect(leaseStateBeforeRepay).toBeDefined();

      paymentCurrency = lppCurrency;
      paymentCurrencyToIBC = await currencyTicker_To_IBC(paymentCurrency);

      expect(paymentCurrencyToIBC).not.toBe('');

      const payment = {
        denom: paymentCurrencyToIBC,
        amount: '1',
      };

      await testRepayment(newUserWallet, leaseStateBeforeRepay, payment);
    });

    test('the borrower tries to pay less than the "min_transaction" - should produce an error', async () => {
      const minTransaction = (await leaserInstance.getLeaserConfig()).config
        .lease_position_spec.min_transaction.amount;

      const paymentCurrency = leaseCurrency;
      const paymentCurrencyToIBC = await currencyTicker_To_IBC(paymentCurrency);
      expect(paymentCurrencyToIBC).not.toBe('');
      const paymentCurrencyPriceObj =
        await oracleInstance.getPriceFor(paymentCurrency);
      const [
        minToleranceCurrencyPrice_PC,
        exactCurrencyPrice_PC,
        maxToleranceCurrencyPrice_PC,
      ] = currencyPriceObjToNumbers(paymentCurrencyPriceObj, 1);

      const paymentAmount = Math.trunc(
        (+minTransaction - 1) * minToleranceCurrencyPrice_PC,
      );

      const payment = {
        amount: paymentAmount.toString(),
        denom: paymentCurrencyToIBC,
      };

      await testRepaymentWithInvalidParams(
        payment,
        'Insufficient payment amount',
      );
    });

    test('the borrower tries to repay the lease at once and to pay excess', async () => {
      const leaseStateBeforeRepay = (await leaseInstance.getLeaseStatus())
        .opened;

      expect(leaseStateBeforeRepay).toBeDefined();

      if (!leaseStateBeforeRepay) {
        undefinedHandler();
        return;
      }

      const leasePrincipalBeforeRepay = BigInt(
        leaseStateBeforeRepay.principal_due.amount,
      );

      const excess = '100';

      const repayWithExcess = {
        denom: lppCurrencyToIBC,
        amount: (leasePrincipalBeforeRepay + BigInt(excess)).toString(),
      };

      await userWithBalanceWallet.transferAmount(
        borrowerWallet.address as string,
        [repayWithExcess, defaultTip],
        customFees.transfer,
      );

      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );

      await leaseInstance.repayLease(borrowerWallet, customFees.exec, [
        repayWithExcess,
        defaultTip,
      ]);

      expect(await waitLeaseInProgressToBeNull(leaseInstance)).toBe(undefined);

      paymentsCount += 1;

      const repayTxResponse = (
        await txSearchByEvents(
          `wasm-ls-repay._contract_address='${leaseAddress}'`,
          paymentsCount,
          1,
        )
      ).txs[0];

      const exactExcess = getChangeFromRepayTx(repayTxResponse);

      const stateBeforeClose = await leaseInstance.getLeaseStatus();
      expect(stateBeforeClose.paid).toBeDefined();

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
        /^.*The operation 'repay' is not supported in the current state.*/,
      );

      // close lease
      const borrowerBalanceBeforeClose = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        lppCurrencyToIBC,
      );

      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );

      await userWithBalanceWallet.transferAmount(
        borrowerWallet.address as string,
        [defaultTip],
        customFees.transfer,
      );

      await leaseInstance.closeLease(borrowerWallet, customFees.exec),
        [defaultTip];

      await waitLeaseInProgressToBeNull(leaseInstance);

      const leaseStateAfterClose = await leaseInstance.getLeaseStatus();
      expect(leaseStateAfterClose.closed).toBeDefined();

      const borrowerBalanceAfterClose = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        lppCurrencyToIBC,
      );

      expect(BigInt(borrowerBalanceAfterClose.amount)).toBe(
        BigInt(borrowerBalanceBeforeClose.amount) + BigInt(exactExcess),
      );

      const leaseCurrencyToIBC = await currencyTicker_To_IBC(leaseCurrency);
      expect(leaseCurrencyToIBC).not.toBe('');

      await returnAmountToTheMainAccount(borrowerWallet, leaseCurrencyToIBC);

      const borrowerBalanceInTheEnd = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        leaseCurrencyToIBC,
      );

      expect(BigInt(borrowerBalanceInTheEnd.amount)).toBe(BigInt(0));
    });

    test('the borrower tries to repay an already closed lease - should produce an error', async () => {
      await testRepaymentWithInvalidParams(
        { denom: lppCurrencyToIBC, amount: '11' }, // any amount
        `The operation 'repay' is not supported in the current state`,
      );
    });
  },
);
