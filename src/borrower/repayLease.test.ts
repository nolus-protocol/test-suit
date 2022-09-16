import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import { Coin } from '@cosmjs/amino';
import { customFees, sleep, undefinedHandler } from '../util/utils';
import {
  NolusClient,
  NolusWallet,
  NolusContracts,
  ChainConstants,
} from '@nolus/nolusjs';
import {
  sendInitExecuteFeeTokens,
  sendInitTransferFeeTokens,
} from '../util/transfer';
import {
  calcInterestRate,
  getLeaseAddressFromOpenLeaseResponse,
  getLoanInterestPaidFromRepayResponse,
  getMarginInterestPaidFromRepayResponse,
  getMarginPaidTimeFromRepayResponse,
  getPrincipalPaidFromRepayResponse,
} from '../util/smart-contracts';
import { PreciseDate } from '@google-cloud/precise-date';

describe('Leaser contract tests - Repay lease', () => {
  let feederWallet: NolusWallet;
  let borrowerWallet: NolusWallet;
  let lppLiquidity: Coin;
  let lppDenom: string;
  let lppInstance: NolusContracts.Lpp;
  let leaserInstance: NolusContracts.Leaser;
  let mainLeaseAddress: string;
  let leaserRepaymentPeriod: number;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;

  const downpayment = '10000000000';
  const outstandingBySec = 15; // good to be >= 10

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

  async function verifyTransferAfterRepay(
    lppLiquidityBefore: bigint,
    borrowerBalanceBefore: bigint,
    borrowerAddress: string,
    payment: bigint,
  ): Promise<void> {
    const borrowerBalanceAfter = await borrowerWallet.getBalance(
      borrowerAddress,
      lppDenom,
    );

    const lppLiquidityAfter = await feederWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    if (process.env.NODE_URL?.includes('localhost')) {
      expect(+lppLiquidityAfter.amount).toBeGreaterThan(
        BigInt(lppLiquidityBefore) - payment,
      );
    }
    expect(BigInt(borrowerBalanceAfter.amount)).toBe(
      borrowerBalanceBefore - payment,
    );
  }

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    const cosm = await NolusClient.getInstance().getCosmWasmClient();

    feederWallet = await getUser1Wallet();
    borrowerWallet = await createWallet();

    leaserInstance = new NolusContracts.Leaser(cosm, leaserContractAddress);
    lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);

    const lppConfig = await lppInstance.getLppConfig();
    lppDenom = lppConfig.lpn_symbol;

    const leaserConfig = await leaserInstance.getLeaserConfig();
    leaserRepaymentPeriod = leaserConfig.config.repayment.period_sec;
    const fiveMinsInSecs = 300;
    expect(leaserRepaymentPeriod).toBeGreaterThan(fiveMinsInSecs); // enough time for the whole test

    await lppInstance.deposit(feederWallet, customFees.exec, [
      {
        denom: lppDenom,
        amount: (+downpayment * 2).toString(),
      },
    ]);

    // get the liquidity
    lppLiquidity = await cosm.getBalance(lppContractAddress, lppDenom);
    expect(lppLiquidity.amount).not.toBe('0');
  });

  test('the successful lease repayment scenario - should work as expected', async () => {
    // send some tokens to the borrower
    // for the downpayment and fees
    await feederWallet.transferAmount(
      borrowerWallet.address as string,
      [{ denom: lppDenom, amount: downpayment }],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      feederWallet,
      borrowerWallet.address as string,
    );

    const quote = await leaserInstance.leaseQuote(downpayment, lppDenom);

    expect(quote.borrow).toBeDefined();
    // ensure that the LPP has liquidity to open a current loan
    expect(BigInt(lppLiquidity.amount)).toBeGreaterThanOrEqual(
      BigInt(quote.borrow.amount),
    );

    const result = await leaserInstance.openLease(
      borrowerWallet,
      lppDenom,
      customFees.exec,
      [{ denom: lppDenom, amount: downpayment }],
    );

    mainLeaseAddress = getLeaseAddressFromOpenLeaseResponse(result);
    expect(mainLeaseAddress).not.toBe('');

    // wait for >0 interest
    await sleep(outstandingBySec);

    let loan = await lppInstance.getLoanInformation(mainLeaseAddress);

    const leaseInstance = new NolusContracts.Lease(
      await NolusClient.getInstance().getCosmWasmClient(),
      mainLeaseAddress,
    );
    const leaseStateBeforeFirstRepay = (await leaseInstance.getLeaseStatus())
      .opened;

    if (!leaseStateBeforeFirstRepay) {
      undefinedHandler();
      return;
    }

    const annualInterest = BigInt(leaseStateBeforeFirstRepay.interest_rate);
    const interestRateMargin = BigInt(
      leaseStateBeforeFirstRepay.interest_rate_margin,
    );
    const PID_beforeFirstRepay =
      leaseStateBeforeFirstRepay.previous_interest_due.amount;
    const PMD_beforeFirstRepay =
      leaseStateBeforeFirstRepay.previous_margin_due.amount;
    const CID_beforeFirstRepay =
      leaseStateBeforeFirstRepay.current_interest_due.amount;
    const CMD_beforeFirstRepay =
      leaseStateBeforeFirstRepay.current_margin_due.amount;

    const leasePrincipalBeforeFirstRepay = BigInt(
      leaseStateBeforeFirstRepay.principal_due.amount,
    );
    const leaseInterestBeforeFirstRepay =
      BigInt(PID_beforeFirstRepay) +
      BigInt(PMD_beforeFirstRepay) +
      BigInt(CID_beforeFirstRepay) +
      BigInt(CMD_beforeFirstRepay);

    const outstandingInterest = await lppInstance.getOutstandingInterest(
      mainLeaseAddress,
      leaseStateBeforeFirstRepay.validity,
    );

    // verify interest calc

    // loan interest due
    const calcLoanInterestDue = verifyInterestDueCalc(
      leasePrincipalBeforeFirstRepay,
      annualInterest,
      BigInt(loan.interest_paid),
      BigInt(leaseStateBeforeFirstRepay.validity),
      BigInt(CID_beforeFirstRepay),
    );

    expect(BigInt(outstandingInterest.amount)).toBe(calcLoanInterestDue);

    // margin interest due
    verifyInterestDueCalc(
      leasePrincipalBeforeFirstRepay,
      interestRateMargin,
      BigInt(loan.interest_paid),
      BigInt(leaseStateBeforeFirstRepay.validity),
      BigInt(CMD_beforeFirstRepay),
    );

    expect(PID_beforeFirstRepay).toBe('0');
    expect(PMD_beforeFirstRepay).toBe('0');

    // get the annual_interest before all payments
    const leaseAnnualInterestBeforeAll =
      leaseStateBeforeFirstRepay.interest_rate;

    const firstPayment = {
      denom: lppDenom,
      amount: leaseInterestBeforeFirstRepay.toString(),
    };

    // send some tokens to the borrower
    // for the payment and fees
    await feederWallet.transferAmount(
      borrowerWallet.address as string,
      [firstPayment],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      feederWallet,
      borrowerWallet.address as string,
    );
    const borrowerBalanceBeforeFirstRepay = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );
    const lppLiquidityBeforeFirstRepay = await feederWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    let repayTxResponse = await leaseInstance.repayLease(
      borrowerWallet,
      customFees.exec,
      [firstPayment],
    );
    const marginInterestPaidTo =
      getMarginPaidTimeFromRepayResponse(repayTxResponse);

    loan = await lppInstance.getLoanInformation(mainLeaseAddress);

    const leaseStateAfterFirstRepay = (await leaseInstance.getLeaseStatus())
      .opened;

    if (!leaseStateAfterFirstRepay) {
      undefinedHandler();
      return;
    }

    const PID_afterFirstRepay =
      leaseStateAfterFirstRepay.previous_interest_due.amount;
    const PMD_afterFirstRepay =
      leaseStateAfterFirstRepay.previous_margin_due.amount;
    const CID_afterFirstRepay =
      leaseStateAfterFirstRepay.current_interest_due.amount;
    const CMD_afterFirstRepay =
      leaseStateAfterFirstRepay.current_margin_due.amount;

    const leasePrincipalAfterFirstRepay = BigInt(
      leaseStateAfterFirstRepay.principal_due.amount,
    );
    const leaseInterestAfterFirstRepay =
      BigInt(PID_afterFirstRepay) +
      BigInt(PMD_afterFirstRepay) +
      BigInt(CID_afterFirstRepay) +
      BigInt(CMD_afterFirstRepay);

    if (!leasePrincipalAfterFirstRepay) {
      undefinedHandler();
      return;
    }

    // the configured leaser repayment period is > 1min --> no previous period, so:
    expect(PMD_afterFirstRepay).toBe('0');
    // TO DO - issue - https://gitlab-nomo.credissimo.net/nomo/smart-contracts/-/issues/9
    // expect(PID_afterFirstRepay).toBe('0');

    expect(leasePrincipalAfterFirstRepay).toBe(leasePrincipalBeforeFirstRepay);

    // verify loan interest due calc
    const loanInterestDueImmediatelyBeforeFirstCheck = verifyInterestDueCalc(
      leasePrincipalAfterFirstRepay,
      annualInterest,
      BigInt(loan.interest_paid),
      BigInt(leaseStateAfterFirstRepay.validity),
      BigInt(CID_afterFirstRepay) + BigInt(PID_afterFirstRepay),
    );

    // verify margin interest due calc
    const marginInterestDueImmediatelyBeforeFirstCheck = verifyInterestDueCalc(
      leasePrincipalAfterFirstRepay,
      interestRateMargin,
      marginInterestPaidTo,
      BigInt(leaseStateAfterFirstRepay.validity),
      BigInt(CMD_afterFirstRepay),
    );

    expect(BigInt(leaseInterestAfterFirstRepay)).toBe(
      BigInt(leaseInterestBeforeFirstRepay) -
        BigInt(firstPayment.amount) +
        loanInterestDueImmediatelyBeforeFirstCheck +
        marginInterestDueImmediatelyBeforeFirstCheck,
    );

    await verifyTransferAfterRepay(
      BigInt(lppLiquidityBeforeFirstRepay.amount),
      BigInt(borrowerBalanceBeforeFirstRepay.amount),
      borrowerWallet.address as string,
      BigInt(firstPayment.amount),
    );

    // get the annual_interest before the second payment
    const leaseAnnualInterestAfterFirstRepay =
      leaseStateAfterFirstRepay.interest_rate;

    // pay interest+principal
    // wait for >0 interest
    await sleep(outstandingBySec);

    const leaseStateBeforeSecondRepay = (await leaseInstance.getLeaseStatus())
      .opened;

    if (!leaseStateBeforeSecondRepay) {
      undefinedHandler();
      return;
    }

    const PID_beforeSecondRepay =
      leaseStateBeforeSecondRepay.previous_interest_due.amount;
    const PMD_beforeSecondRepay =
      leaseStateBeforeSecondRepay.previous_margin_due.amount;
    const CID_beforeSecondRepay =
      leaseStateBeforeSecondRepay.current_interest_due.amount;
    const CMD_beforeSecondRepay =
      leaseStateBeforeSecondRepay.current_margin_due.amount;

    const leaseInterestBeforeSecondRepay =
      BigInt(PID_beforeSecondRepay) +
      BigInt(PMD_beforeSecondRepay) +
      BigInt(CID_beforeSecondRepay) +
      BigInt(CMD_beforeSecondRepay);
    const leasePrincipalBeforeSecondRepay = BigInt(
      leaseStateBeforeSecondRepay.principal_due.amount,
    );

    if (!leasePrincipalBeforeSecondRepay) {
      undefinedHandler();
      return;
    }

    // pay half of the principal + all interest
    const secondPayment = {
      denom: lppDenom,
      amount: (
        BigInt(leaseInterestBeforeSecondRepay) +
        BigInt(leasePrincipalBeforeSecondRepay) / BigInt(2)
      ).toString(),
    };

    await feederWallet.transferAmount(
      borrowerWallet.address as string,
      [secondPayment],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      feederWallet,
      borrowerWallet.address as string,
    );
    const borrowerBalanceBeforeSecondRepay = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );
    const lppLiquidityBeforeSecondRepay = await feederWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    repayTxResponse = await leaseInstance.repayLease(
      borrowerWallet,
      customFees.exec,
      [secondPayment],
    );
    const loanInterestPaid =
      getLoanInterestPaidFromRepayResponse(repayTxResponse);
    const marginInterestPaid =
      getMarginInterestPaidFromRepayResponse(repayTxResponse);
    const principalPaid = getPrincipalPaidFromRepayResponse(repayTxResponse);

    loan = await lppInstance.getLoanInformation(mainLeaseAddress);

    const leaseStateAfterSecondRepay = (await leaseInstance.getLeaseStatus())
      .opened;

    if (!leaseStateAfterSecondRepay) {
      undefinedHandler();
      return;
    }

    const PID_afterSecondRepay =
      leaseStateAfterSecondRepay.previous_interest_due.amount;
    const PMD_afterSecondRepay =
      leaseStateAfterSecondRepay.previous_margin_due.amount;
    const CID_afterSecondRepay =
      leaseStateAfterSecondRepay.current_interest_due.amount;
    const CMD_afterSecondRepay =
      leaseStateAfterSecondRepay.current_margin_due.amount;

    const leaseInterestAfterSecondRepay =
      BigInt(PID_afterSecondRepay) +
      BigInt(PMD_afterSecondRepay) +
      BigInt(CID_afterSecondRepay) +
      BigInt(CMD_afterSecondRepay);
    const leasePrincipalAfterSecondRepay =
      leaseStateAfterSecondRepay.principal_due.amount;

    if (!leasePrincipalAfterSecondRepay) {
      undefinedHandler();
      return;
    }

    // check that the repayment sequence is correct
    expect(BigInt(leasePrincipalAfterSecondRepay)).toBeGreaterThanOrEqual(
      BigInt(leasePrincipalBeforeSecondRepay) - BigInt(principalPaid),
    );

    expect(BigInt(marginInterestPaid)).toBeGreaterThan(BigInt(0));
    expect(BigInt(loanInterestPaid)).toBeGreaterThan(BigInt(0));

    // principal < principal before repay && delay secs < outstandingBySec -->> interestAfterRepay < interestBeforeRepay
    expect(BigInt(leaseInterestAfterSecondRepay)).toBeLessThan(
      leaseInterestBeforeSecondRepay,
    );

    await verifyTransferAfterRepay(
      BigInt(lppLiquidityBeforeSecondRepay.amount),
      BigInt(borrowerBalanceBeforeSecondRepay.amount),
      borrowerWallet.address as string,
      BigInt(secondPayment.amount),
    );

    //get the annual_interest after the second payment and expect these annual_interests to be equal
    const leaseAnnualInterestAfterSecondRepay =
      leaseStateAfterSecondRepay.interest_rate;

    expect(leaseAnnualInterestBeforeAll).toBe(
      leaseAnnualInterestAfterFirstRepay,
    );
    expect(leaseAnnualInterestBeforeAll).toBe(
      leaseAnnualInterestAfterSecondRepay,
    );
  });

  test('the borrower tries to pay a lease with an invalid denom - should produce an error', async () => {
    const invalidLppDenom = ChainConstants.COIN_MINIMAL_DENOM;

    expect(invalidLppDenom).not.toBe(lppDenom);

    // send some tokens to the borrower
    // for the payment and fees
    const payment = {
      denom: invalidLppDenom,
      amount: '1', // any amount
    };
    await sendInitExecuteFeeTokens(
      feederWallet,
      borrowerWallet.address as string,
    );

    await feederWallet.transferAmount(
      borrowerWallet.address as string,
      [payment],
      customFees.transfer,
    );

    const leaseInstance = new NolusContracts.Lease(
      await NolusClient.getInstance().getCosmWasmClient(),
      mainLeaseAddress,
    );
    const result = () =>
      leaseInstance.repayLease(borrowerWallet, customFees.exec, [payment]);

    await expect(result).rejects.toThrow(
      `Found currency ${invalidLppDenom} expecting ${lppDenom}`,
    );
  });

  test('the borrower tries to pay a lease with more amount than he has - should produce an error', async () => {
    const forBalance = 5;

    // send some tokens to the borrower
    // for the payment and fees
    await feederWallet.transferAmount(
      borrowerWallet.address as string,
      [
        {
          denom: lppDenom,
          amount: forBalance.toString(),
        },
      ],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      feederWallet,
      borrowerWallet.address as string,
    );

    const repayMore = {
      denom: lppDenom,
      amount: (forBalance + 1).toString(),
    };

    const leaseInstance = new NolusContracts.Lease(
      await NolusClient.getInstance().getCosmWasmClient(),
      mainLeaseAddress,
    );
    const result = () =>
      leaseInstance.repayLease(borrowerWallet, customFees.exec, [repayMore]);

    await expect(result).rejects.toThrow(/^.*insufficient funds.*/);
  });

  test('the borrower tries to pay a lease with 0 amount - should produce an error', async () => {
    // send some tokens for fees
    await sendInitExecuteFeeTokens(
      feederWallet,
      borrowerWallet.address as string,
    );
    const payment = {
      denom: lppDenom,
      amount: '0',
    };

    const leaseInstance = new NolusContracts.Lease(
      await NolusClient.getInstance().getCosmWasmClient(),
      mainLeaseAddress,
    );
    const result = () =>
      leaseInstance.repayLease(borrowerWallet, customFees.exec, [payment]);

    await expect(result).rejects.toThrow(/^.*invalid coins.*/);
  });

  test('a user, other than the lease owner, tries to pay - should work as expected', async () => {
    const newUserWallet = await createWallet();

    const leaseInstance = new NolusContracts.Lease(
      await NolusClient.getInstance().getCosmWasmClient(),
      mainLeaseAddress,
    );
    const leaseStateBeforeRepay = (await leaseInstance.getLeaseStatus()).opened;

    if (!leaseStateBeforeRepay) {
      undefinedHandler();
      return;
    }

    const PID_beforeRepay = leaseStateBeforeRepay.previous_interest_due.amount;
    const PMD_beforeRepay = leaseStateBeforeRepay.previous_margin_due.amount;
    const CID_beforeRepay = leaseStateBeforeRepay.current_interest_due.amount;
    const CMD_beforeRepay = leaseStateBeforeRepay.current_margin_due.amount;

    const leasePrincipalBeforeRepay =
      leaseStateBeforeRepay.principal_due.amount;
    const leaseInterestBeforeRepay =
      BigInt(PID_beforeRepay) +
      BigInt(PMD_beforeRepay) +
      BigInt(CID_beforeRepay) +
      BigInt(CMD_beforeRepay);

    const payment = {
      denom: lppDenom,
      amount: Math.floor(+leasePrincipalBeforeRepay / 2).toString(),
    };

    // send some tokens to the borrower
    // for the payment and fees
    await feederWallet.transferAmount(
      newUserWallet.address as string,
      [payment],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      feederWallet,
      newUserWallet.address as string,
    );

    const userBalanceBeforeRepay = await newUserWallet.getBalance(
      newUserWallet.address as string,
      lppDenom,
    );

    await leaseInstance.repayLease(newUserWallet, customFees.exec, [payment]);

    const leaseStateAfterRepay = (await leaseInstance.getLeaseStatus()).opened;

    if (!leaseStateAfterRepay) {
      undefinedHandler();
      return;
    }
    const PID_afterRepay = leaseStateAfterRepay.previous_interest_due.amount;
    const PMD_afterRepay = leaseStateAfterRepay.previous_margin_due.amount;
    const CID_afterRepay = leaseStateAfterRepay.current_interest_due.amount;
    const CMD_afterRepay = leaseStateAfterRepay.current_margin_due.amount;

    const leasePrincipalAfterRepay = leaseStateAfterRepay.principal_due.amount;
    const leaseInterestAfterRepay =
      BigInt(PID_afterRepay) +
      BigInt(PMD_afterRepay) +
      BigInt(CID_afterRepay) +
      BigInt(CMD_afterRepay);

    const userBalanceAfterRepay = await newUserWallet.getBalance(
      newUserWallet.address as string,
      lppDenom,
    );

    expect(
      BigInt(leasePrincipalAfterRepay) + leaseInterestAfterRepay,
    ).toBeGreaterThanOrEqual(
      BigInt(leasePrincipalBeforeRepay) +
        leaseInterestBeforeRepay -
        BigInt(payment.amount),
    );
    expect(BigInt(userBalanceAfterRepay.amount)).toBe(
      BigInt(userBalanceBeforeRepay.amount) - BigInt(+payment.amount),
    );
  });

  test('the borrower tries to repay the lease at once and to pay excess', async () => {
    const leaseInstance = new NolusContracts.Lease(
      await NolusClient.getInstance().getCosmWasmClient(),
      mainLeaseAddress,
    );
    const leaseStateBeforeRepay = (await leaseInstance.getLeaseStatus()).opened;

    if (!leaseStateBeforeRepay) {
      undefinedHandler();
      return;
    }

    const PID_beforeRepay = leaseStateBeforeRepay.previous_interest_due.amount;
    const PMD_beforeRepay = leaseStateBeforeRepay.previous_margin_due.amount;
    const CID_beforeRepay = leaseStateBeforeRepay.current_interest_due.amount;
    const CMD_beforeRepay = leaseStateBeforeRepay.current_margin_due.amount;

    const leaseInterestBeforeRepay =
      BigInt(PID_beforeRepay) +
      BigInt(PMD_beforeRepay) +
      BigInt(CID_beforeRepay) +
      BigInt(CMD_beforeRepay);
    const leasePrincipalBeforeRepay = BigInt(
      leaseStateBeforeRepay.principal_due.amount,
    );
    const leaseAmountBeforeRepay = leaseStateBeforeRepay.amount.amount;

    const excess = leasePrincipalBeforeRepay;

    // send some tokens to the borrower
    // for the payment and fees
    const repayWithExcess = {
      // +excess - make sure the lease principal will be paid
      denom: lppDenom,
      amount: (
        leaseInterestBeforeRepay +
        leasePrincipalBeforeRepay +
        excess
      ).toString(),
    };

    await feederWallet.transferAmount(
      borrowerWallet.address as string,
      [repayWithExcess],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      feederWallet,
      borrowerWallet.address as string,
    );

    const repayTxReponse = await leaseInstance.repayLease(
      borrowerWallet,
      customFees.exec,
      [repayWithExcess],
    );

    const principalPaid = getPrincipalPaidFromRepayResponse(repayTxReponse);

    const exactExcess =
      BigInt(principalPaid) - BigInt(leasePrincipalBeforeRepay);

    const stateBeforeClose = await leaseInstance.getLeaseStatus();

    expect(stateBeforeClose.paid).toBeDefined();

    // try to pay already paid lease
    await feederWallet.transferAmount(
      borrowerWallet.address as string,
      [repayWithExcess], // any amount
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      feederWallet,
      borrowerWallet.address as string,
    );

    const result = () =>
      leaseInstance.repayLease(borrowerWallet, customFees.exec, [
        repayWithExcess,
      ]);

    await expect(result).rejects.toThrow(/^.*The underlying loan is closed.*/);

    // close
    const borrowerBalanceBeforeClose = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    await sendInitExecuteFeeTokens(
      feederWallet,
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
      lppDenom,
    );

    // fails due to - TO DO - https://app.clickup.com/t/2t2zd3v
    expect(BigInt(borrowerBalanceAfterClose.amount)).toBe(
      BigInt(borrowerBalanceBeforeClose.amount) +
        BigInt(leaseAmountBeforeRepay) +
        exactExcess,
    );

    // return amount to the main-feeder address
    await sendInitTransferFeeTokens(
      feederWallet,
      borrowerWallet.address as string,
    );
    await borrowerWallet.transferAmount(
      feederWallet.address as string,
      [borrowerBalanceAfterClose],
      customFees.transfer,
    );
  });

  test('the borrower tries to repay an already closed lease - should produce an error', async () => {
    const payment = {
      denom: lppDenom,
      amount: '10', // any amount
    };

    await feederWallet.transferAmount(
      borrowerWallet.address as string,
      [payment],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      feederWallet,
      borrowerWallet.address as string,
    );

    const leaseInstance = new NolusContracts.Lease(
      await NolusClient.getInstance().getCosmWasmClient(),
      mainLeaseAddress,
    );
    const result = () =>
      leaseInstance.repayLease(borrowerWallet, customFees.exec, [payment]);

    await expect(result).rejects.toThrow(/^.*The underlying loan is closed.*/);
  });

  // TO DO: partial liquidation , complete liquidation; Liability max% - in a new file
});
