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
import { calcInterestRate } from '../util/smart-contracts';

// TO DO: fix..
describe('Leaser contract tests - Repay lease', () => {
  let user1Wallet: NolusWallet;
  let borrowerWallet: NolusWallet;
  let lppLiquidity: Coin;
  let lppDenom: string;
  let leaseInstance: NolusContracts.Lease;
  let lppInstance: NolusContracts.Lpp;
  let leaserInstance: NolusContracts.Leaser;
  let mainLeaseAddress: string;
  let mainLeaseTimeOpen: number;
  let leaserRepaymentPeriod: number;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;

  const downpayment = '1000000000000';
  const outstandingBySec = 15;

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    borrowerWallet = await createWallet();

    const cosm = await NolusClient.getInstance().getCosmWasmClient();
    leaseInstance = new NolusContracts.Lease(cosm);
    leaserInstance = new NolusContracts.Leaser(cosm);
    lppInstance = new NolusContracts.Lpp(cosm);

    const lppConfig = await lppInstance.getLppConfig(lppContractAddress);
    lppDenom = lppConfig.lpn_symbol;

    const leaserConfig = await leaserInstance.getLeaserConfig(
      leaserContractAddress,
    );

    leaserRepaymentPeriod = leaserConfig.config.repayment.period_sec;

    expect(leaserRepaymentPeriod).toBeGreaterThan(200); // > ~3 min

    await lppInstance.lenderDeposit(
      lppContractAddress,
      user1Wallet,
      customFees.exec,
      [
        {
          denom: lppDenom,
          amount: (+downpayment * 2).toString(),
        },
      ],
    );

    // get the liquidity
    lppLiquidity = await user1Wallet.getBalance(lppContractAddress, lppDenom);
    expect(lppLiquidity.amount).not.toBe('0');
  });

  test('the successful lease repayment scenario - should work as expected', async () => {
    // send some tokens to the borrower
    // for the downpayment and fees
    await user1Wallet.transferAmount(
      borrowerWallet.address as string,
      [{ denom: lppDenom, amount: downpayment }],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      user1Wallet,
      borrowerWallet.address as string,
    );

    const quote = await leaserInstance.makeLeaseApply(
      leaserContractAddress,
      downpayment,
      lppDenom,
    );

    expect(quote.borrow).toBeDefined();
    expect(+lppLiquidity.amount).toBeGreaterThanOrEqual(+quote.borrow.amount);

    await sendInitExecuteFeeTokens(
      user1Wallet,
      borrowerWallet.address as string,
    );

    const result = await leaserInstance.openLease(
      leaserContractAddress,
      borrowerWallet,
      lppDenom,
      customFees.exec,
      [{ denom: lppDenom, amount: downpayment }],
    );

    mainLeaseAddress = result.logs[0].events[7].attributes[3].value;

    expect(mainLeaseAddress).not.toBe('');

    // wait for >0 interest
    await sleep(outstandingBySec * 1000);

    const dateBefore = (await borrowerWallet.getBlock()).header.time;
    const timeBeforeFirstRepay = (Date.parse(dateBefore) * 1000000).toString();

    let loan = await lppInstance.getLoanInformation(
      lppContractAddress,
      mainLeaseAddress,
    );

    mainLeaseTimeOpen = loan.interest_paid;

    const outstandingInterest = await lppInstance.getOutstandingInterest(
      lppContractAddress,
      mainLeaseAddress,
      timeBeforeFirstRepay,
    );

    let currentLeaseState = await leaseInstance.getLeaseStatus(
      mainLeaseAddress,
    );

    const annualInterest = currentLeaseState.opened?.interest_rate;
    const interestRateMargin = currentLeaseState.opened?.interest_rate_margin;

    if (!annualInterest || !interestRateMargin) {
      undefinedHandler();
      return;
    }

    let currentPID = currentLeaseState.opened?.previous_interest_due.amount;
    let currentPMD = currentLeaseState.opened?.previous_margin_due.amount;
    let currentCID = currentLeaseState.opened?.current_interest_due.amount;
    let currentCMD = currentLeaseState.opened?.current_margin_due.amount;
    let currentLeasePrincipal = currentLeaseState.opened?.principal_due.amount;

    if (
      !currentPID ||
      !currentPMD ||
      !currentCID ||
      !currentCMD ||
      !currentLeasePrincipal
    ) {
      undefinedHandler();
      return;
    }

    let currentLeaseInterest =
      +currentPID + +currentPMD + +currentCID + +currentCMD;

    // verify interest calc
    const calcLoanInterestDue = calcInterestRate(
      +currentLeasePrincipal,
      annualInterest / 10,
      +timeBeforeFirstRepay,
      loan.interest_paid,
    );

    expect(+currentCID).toBe(calcLoanInterestDue);

    const calcLoanInterestOverdue = calcInterestRate(
      +currentLeasePrincipal,
      annualInterest / 10,
      loan.interest_paid,
      loan.interest_paid,
    );

    expect(+currentPID).toBe(calcLoanInterestOverdue);

    expect(+outstandingInterest.amount).toBe(
      calcLoanInterestOverdue + calcLoanInterestDue,
    );

    const calcMarginInterestDue = calcInterestRate(
      +currentLeasePrincipal,
      interestRateMargin / 10,
      +timeBeforeFirstRepay,
      loan.interest_paid,
    );

    expect(+currentCMD).toBe(calcMarginInterestDue);

    const calcMarginInterestOverdue = calcInterestRate(
      +currentLeasePrincipal,
      interestRateMargin / 10,
      loan.interest_paid,
      loan.interest_paid,
    );

    expect(+currentPMD).toBe(calcMarginInterestOverdue);

    // get the annual_interest before all payments
    const leaseAnnualInterestBeforeAll =
      currentLeaseState.opened?.interest_rate;

    const firstPayment = {
      denom: lppDenom,
      amount: currentLeaseInterest.toString(),
    };

    // send some tokens to the borrower
    // for the payment and fees
    await user1Wallet.transferAmount(
      borrowerWallet.address as string,
      [firstPayment],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      user1Wallet,
      borrowerWallet.address as string,
    );
    let borrowerBalanceBefore = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );
    let lppLiquidityBefore = await user1Wallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    await leaseInstance.repayLease(
      mainLeaseAddress,
      borrowerWallet,
      customFees.exec,
      [firstPayment],
    );

    loan = await lppInstance.getLoanInformation(
      lppContractAddress,
      mainLeaseAddress,
    );

    const leaseStateAfterFirstRepay = await leaseInstance.getLeaseStatus(
      mainLeaseAddress,
    );

    currentPID = leaseStateAfterFirstRepay.opened?.previous_interest_due.amount;
    currentPMD = leaseStateAfterFirstRepay.opened?.previous_margin_due.amount;
    currentCID = leaseStateAfterFirstRepay.opened?.current_interest_due.amount;
    currentCMD = leaseStateAfterFirstRepay.opened?.current_margin_due.amount;

    if (!currentPID || !currentPMD || !currentCID || !currentCMD) {
      undefinedHandler();
      return;
    }

    const cPrincipalFirstRepay =
      leaseStateAfterFirstRepay.opened?.principal_due.amount;
    const cInterestFirstRepay =
      +currentPID + +currentPMD + +currentCID + +currentCMD;

    if (!cPrincipalFirstRepay) {
      undefinedHandler();
      return;
    }

    expect(+currentPMD).toBe(0);
    expect(+currentPID).toBe(0);

    let dateBeforeCheck = (await borrowerWallet.getBlock()).header.time;
    let timeBeforeCheck = (Date.parse(dateBeforeCheck) * 1000000).toString();

    const loanInterestDueImmediatelyBeforeFirstCheck = calcInterestRate(
      +currentLeasePrincipal,
      annualInterest / 10,
      +timeBeforeCheck,
      loan.interest_paid,
    );

    const marginInterestDueImmediatelyBeforeFirstCheck = calcInterestRate(
      +currentLeasePrincipal,
      interestRateMargin / 10,
      +timeBeforeCheck,
      +timeBeforeFirstRepay,
    );

    expect(loanInterestDueImmediatelyBeforeFirstCheck).toBe(
      +currentCID + +currentPID,
    );

    // expect(marginInterestDueImmediatelyBeforeFirstCheck).toBe(
    //   +currentCMD + +currentPMD,
    // );

    expect(leaseStateAfterFirstRepay.opened?.principal_due.amount).toBe(
      currentLeasePrincipal,
    );

    //TO DO:
    expect(+cInterestFirstRepay).toBe(
      //GreaterThanOrEqual
      +currentLeaseInterest -
        +firstPayment.amount +
        loanInterestDueImmediatelyBeforeFirstCheck +
        marginInterestDueImmediatelyBeforeFirstCheck,
    );

    let borrowerBalanceAfter = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    expect(+borrowerBalanceAfter.amount).toBe(
      +borrowerBalanceBefore.amount - +firstPayment.amount,
    );
    let lppLiquidityAfter = await user1Wallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    if (process.env.NODE_URL?.includes('localhost')) {
      console.log('Its local network');
      expect(+lppLiquidityAfter.amount).toBeGreaterThan(
        +lppLiquidityBefore.amount - +firstPayment.amount,
      );
    }

    // get the annual_interest before the second payment
    const leaseAnnualInterestAfterFirstPayment =
      currentLeaseState.opened?.interest_rate;

    // pay interest+amount

    // wait for >0 interest
    await sleep(outstandingBySec * 1000);

    // get the new lease state
    const timeOfLeaseStateCheck = (new Date().getTime() * 1000000).toString();
    currentLeaseState = await leaseInstance.getLeaseStatus(mainLeaseAddress);

    currentPID = currentLeaseState.opened?.previous_interest_due.amount;
    currentPMD = currentLeaseState.opened?.previous_margin_due.amount;
    currentCID = currentLeaseState.opened?.current_interest_due.amount;
    currentCMD = currentLeaseState.opened?.current_margin_due.amount;

    if (!currentPID || !currentPMD || !currentCID || !currentCMD) {
      undefinedHandler();
      return;
    }

    currentLeaseInterest =
      +currentPID + +currentPMD + +currentCID + +currentCMD;
    currentLeasePrincipal = currentLeaseState.opened?.principal_due.amount;

    if (!currentLeasePrincipal) {
      undefinedHandler();
      return;
    }

    const secondPayment = {
      denom: lppDenom,
      amount: (
        +currentLeaseInterest + Math.floor(+currentLeasePrincipal / 2)
      ).toString(),
    };

    await user1Wallet.transferAmount(
      borrowerWallet.address as string,
      [secondPayment],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      user1Wallet,
      borrowerWallet.address as string,
    );

    borrowerBalanceBefore = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    lppLiquidityBefore = await user1Wallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    await leaseInstance.repayLease(
      mainLeaseAddress,
      borrowerWallet,
      customFees.exec,
      [secondPayment],
    );

    const leaseStateAfterSecondRepay = await leaseInstance.getLeaseStatus(
      mainLeaseAddress,
    );

    currentPID =
      leaseStateAfterSecondRepay.opened?.previous_interest_due.amount;
    currentPMD = leaseStateAfterSecondRepay.opened?.previous_margin_due.amount;
    currentCID = leaseStateAfterSecondRepay.opened?.current_interest_due.amount;
    currentCMD = leaseStateAfterSecondRepay.opened?.current_margin_due.amount;

    if (!currentPID || !currentPMD || !currentCID || !currentCMD) {
      undefinedHandler();
      return;
    }

    const cInterestAfterSecondRepay =
      +currentPID + +currentPMD + +currentCID + +currentCMD;
    const cPrincipalAfterSecondRepay =
      leaseStateAfterSecondRepay.opened?.principal_due.amount;

    if (!cPrincipalAfterSecondRepay) {
      undefinedHandler();
      return;
    }

    timeBeforeCheck = (new Date().getTime() * 1000000).toString();

    const loanInterestImmediatelyBeforeCheck = calcInterestRate(
      +cPrincipalAfterSecondRepay,
      annualInterest / 10,
      +timeBeforeCheck,
      +timeOfLeaseStateCheck,
    );

    // const marginInterestImmediatelyBeforeCheck = calcInterestRate(
    //   +cPrincipalAfterSecondRepay,
    //   marginInterestRate / 10,
    //   +timeBeforeCheck,
    //   +timeOfLeaseStateCheck,
    // );

    // check that the repayment sequence is correct
    expect(+cPrincipalAfterSecondRepay).toBeGreaterThanOrEqual(
      +currentLeasePrincipal - Math.floor(+currentLeasePrincipal / 2),
    );

    // TO DO: to be!
    expect(+cInterestAfterSecondRepay).toBeGreaterThanOrEqual(
      loanInterestImmediatelyBeforeCheck, // +marginInterestImmediatelyBeforeCheck
    );

    borrowerBalanceAfter = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    expect(+borrowerBalanceAfter.amount).toBe(
      +borrowerBalanceBefore.amount - +secondPayment.amount,
    );

    lppLiquidityAfter = await user1Wallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    if (process.env.NODE_URL?.includes('localhost')) {
      console.log('Its local network');
      expect(+lppLiquidityAfter.amount).toBeGreaterThan(
        +lppLiquidityBefore.amount - +secondPayment.amount,
      );
    }

    //get the annual_interest after the second payment and expect these annual_interests to be equal
    const leaseAnnualInterestAfterSecondPayment =
      currentLeaseState.opened?.interest_rate;

    expect(leaseAnnualInterestBeforeAll).toBe(
      leaseAnnualInterestAfterFirstPayment,
    );
    expect(leaseAnnualInterestBeforeAll).toBe(
      leaseAnnualInterestAfterSecondPayment,
    );
  });

  test('the borrower tries to pay a lease with an invalid denom - should produce an error', async () => {
    const leases = await leaserInstance.getCurrentOpenLeases(
      leaserContractAddress,
      borrowerWallet.address as string,
    );

    // send some tokens to the borrower
    // for the payment and fees
    const repayAll = {
      denom: ChainConstants.COIN_MINIMAL_DENOM,
      amount: (1 + +customFees.exec.amount[0].amount).toString(),
    };
    await user1Wallet.transferAmount(
      borrowerWallet.address as string,
      [repayAll],
      customFees.transfer,
    );

    const result = () =>
      leaseInstance.repayLease(
        leases[leases.length - 1],
        borrowerWallet,
        customFees.exec,
        [repayAll],
      );

    await expect(result).rejects.toThrow(
      /^.*Found currency unls expecting uusdc.*/,
    );
  });

  test('the borrower tries to pay a lease with more amount than he has - should produce an error', async () => {
    const leases = await leaserInstance.getCurrentOpenLeases(
      leaserContractAddress,
      borrowerWallet.address as string,
    );

    const forBalance = 5;
    // send some tokens to the borrower
    // for the payment and fees
    const repayMore = {
      denom: lppDenom,
      amount: (forBalance + 1).toString(),
    };
    await user1Wallet.transferAmount(
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
      user1Wallet,
      borrowerWallet.address as string,
    );

    const result = () =>
      leaseInstance.repayLease(
        leases[leases.length - 1],
        borrowerWallet,
        customFees.exec,
        [repayMore],
      );

    await expect(result).rejects.toThrow(/^.*insufficient funds.*/);
  });

  test('the borrower tries to pay a lease with 0 amount - should produce an error', async () => {
    const leases = await leaserInstance.getCurrentOpenLeases(
      leaserContractAddress,
      borrowerWallet.address as string,
    );

    await sendInitExecuteFeeTokens(
      user1Wallet,
      borrowerWallet.address as string,
    );

    const repayMore = {
      denom: lppDenom,
      amount: '0',
    };

    const result = () =>
      leaseInstance.repayLease(
        leases[leases.length - 1],
        borrowerWallet,
        customFees.exec,
        [repayMore],
      );

    await expect(result).rejects.toThrow(/^.*invalid coins.*/);
  });

  test('a user, other than the lease owner, tries to pay', async () => {
    const userWallet = await createWallet();

    const leaseStateBeforeRepay = await leaseInstance.getLeaseStatus(
      mainLeaseAddress,
    );

    let currentPID = leaseStateBeforeRepay.opened?.previous_interest_due.amount;
    let currentPMD = leaseStateBeforeRepay.opened?.previous_margin_due.amount;
    let currentCID = leaseStateBeforeRepay.opened?.current_interest_due.amount;
    let currentCMD = leaseStateBeforeRepay.opened?.current_margin_due.amount;

    if (!currentPID || !currentPMD || !currentCID || !currentCMD) {
      undefinedHandler();
      return;
    }

    const cPrincipalBeforeRepay =
      leaseStateBeforeRepay.opened?.principal_due.amount;
    const cInterestBeforeRepay =
      +currentPID + +currentPMD + +currentCID + +currentCMD;

    if (!cPrincipalBeforeRepay) {
      undefinedHandler();
      return;
    }

    const pay = {
      denom: lppDenom,
      amount: Math.floor(+cPrincipalBeforeRepay / 2).toString(),
    };

    // send some tokens to the borrower
    // for the payment and fees
    await user1Wallet.transferAmount(
      userWallet.address as string,
      [pay],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(user1Wallet, userWallet.address as string);

    const userBalanceBefore = await userWallet.getBalance(
      userWallet.address as string,
      lppDenom,
    );

    await leaseInstance.repayLease(
      mainLeaseAddress,
      userWallet,
      customFees.exec,
      [pay],
    );

    const leaseStateAfterRepay = await leaseInstance.getLeaseStatus(
      mainLeaseAddress,
    );
    currentPID = leaseStateAfterRepay.opened?.previous_interest_due.amount;
    currentPMD = leaseStateAfterRepay.opened?.previous_margin_due.amount;
    currentCID = leaseStateAfterRepay.opened?.current_interest_due.amount;
    currentCMD = leaseStateAfterRepay.opened?.current_margin_due.amount;

    if (!currentPID || !currentPMD || !currentCID || !currentCMD) {
      undefinedHandler();
      return;
    }

    const cPrincipalAfterRepay =
      leaseStateAfterRepay.opened?.principal_due.amount;
    const cInterestAfterRepay =
      +currentPID + +currentPMD + +currentCID + +currentCMD;

    if (!cPrincipalAfterRepay) {
      undefinedHandler();
      return;
    }

    const userBalanceAfter = await userWallet.getBalance(
      userWallet.address as string,
      lppDenom,
    );

    expect(
      +(+cPrincipalAfterRepay) + +cInterestAfterRepay,
    ).toBeGreaterThanOrEqual(
      +cPrincipalBeforeRepay + +cInterestBeforeRepay - +pay.amount,
    );

    expect(+userBalanceAfter.amount).toBe(
      +userBalanceBefore.amount - +pay.amount,
    );
  });

  test('the borrower tries to repay the lease at once', async () => {
    const leaseStateBeforeRepay = await leaseInstance.getLeaseStatus(
      mainLeaseAddress,
    );

    const currentPID =
      leaseStateBeforeRepay.opened?.previous_interest_due.amount;
    const currentPMD = leaseStateBeforeRepay.opened?.previous_margin_due.amount;
    const currentCID =
      leaseStateBeforeRepay.opened?.current_interest_due.amount;
    const currentCMD = leaseStateBeforeRepay.opened?.current_margin_due.amount;

    if (!currentPID || !currentPMD || !currentCID || !currentCMD) {
      undefinedHandler();
      return;
    }

    const cInterestBeforeRepay =
      +currentPID + +currentPMD + +currentCID + +currentCMD;
    const cPrincipalBeforeRepay =
      leaseStateBeforeRepay.opened?.principal_due.amount;
    const loanAmount = leaseStateBeforeRepay.opened?.amount.amount;

    if (!cPrincipalBeforeRepay || !loanAmount) {
      undefinedHandler();
      return;
    }

    // send some tokens to the borrower
    // for the payment and fees
    const repayAll = {
      denom: lppDenom,
      amount: (+cInterestBeforeRepay + +cPrincipalBeforeRepay).toString(),
    };

    await user1Wallet.transferAmount(
      borrowerWallet.address as string,
      [repayAll],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      user1Wallet,
      borrowerWallet.address as string,
    );

    await leaseInstance.repayLease(
      mainLeaseAddress,
      borrowerWallet,
      customFees.exec,
      [repayAll],
    );

    await sendInitExecuteFeeTokens(
      user1Wallet,
      borrowerWallet.address as string,
    );

    const borrowerBalanceBeforeClose = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    // try lpp.outstanding_interest
    let getOutstandingInterest = await lppInstance.getOutstandingInterest(
      lppContractAddress,
      mainLeaseAddress,
      (new Date().getTime() * 1000000).toString(),
    );

    expect(getOutstandingInterest.amount).toBe('0');

    // close
    await leaseInstance.closeLease(
      mainLeaseAddress,
      borrowerWallet,
      customFees.exec,
    );

    // try lpp.outstanding_interest
    getOutstandingInterest = await lppInstance.getOutstandingInterest(
      lppContractAddress,
      mainLeaseAddress,
      (new Date().getTime() * 1000000).toString(),
    );

    expect(getOutstandingInterest).toBe(null);

    const borrowerBalanceAfter = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    expect(+borrowerBalanceAfter.amount).toBe(
      +borrowerBalanceBeforeClose.amount + +loanAmount,
    );

    //return amount to the main address
    await sendInitTransferFeeTokens(
      user1Wallet,
      borrowerWallet.address as string,
    );
    await borrowerWallet.transferAmount(
      user1Wallet.address as string,
      [borrowerBalanceAfter],
      customFees.transfer,
    );
  });

  test('the borrower tries to repay an already closed lease - should produce an error', async () => {
    const repay = {
      denom: lppDenom,
      amount: '10',
    };

    await user1Wallet.transferAmount(
      borrowerWallet.address as string,
      [repay],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      user1Wallet,
      borrowerWallet.address as string,
    );

    const result = () =>
      leaseInstance.repayLease(
        mainLeaseAddress,
        borrowerWallet,
        customFees.exec,
        [repay],
      );

    await expect(result).rejects.toThrow(/^.*The underlying loan is closed.*/);
  });

  test('the borrower sends excess amount - should work as expected', async () => {
    const borrowerWallet = await createWallet();

    await user1Wallet.transferAmount(
      borrowerWallet.address as string,
      [{ denom: lppDenom, amount: downpayment }],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      user1Wallet,
      borrowerWallet.address as string,
    );

    const result = await leaserInstance.openLease(
      leaserContractAddress,
      borrowerWallet,
      lppDenom,
      customFees.exec,
      [{ denom: lppDenom, amount: downpayment }],
    );

    const leaseAddress = result.logs[0].events[7].attributes[3].value;

    expect(leaseAddress).not.toBe('');

    const currentLeaseState = await leaseInstance.getLeaseStatus(leaseAddress);

    const currentPID = currentLeaseState.opened?.previous_interest_due.amount;
    const currentPMD = currentLeaseState.opened?.previous_margin_due.amount;
    const currentCID = currentLeaseState.opened?.current_interest_due.amount;
    const currentCMD = currentLeaseState.opened?.current_margin_due.amount;

    if (!currentPID || !currentPMD || !currentCID || !currentCMD) {
      undefinedHandler();
      return;
    }

    const currentLeaseInterest =
      +currentPID + +currentPMD + +currentCID + +currentCMD;
    const currentLeasePrincipal =
      currentLeaseState.opened?.principal_due.amount;
    const currentLeaseAmount = currentLeaseState.opened?.amount.amount;

    if (!currentLeasePrincipal || !currentLeaseAmount) {
      undefinedHandler();
      return;
    }

    const excess = 100000;
    const payment = {
      denom: lppDenom,
      amount: (
        +currentLeaseInterest +
        +currentLeasePrincipal +
        excess
      ).toString(),
    };

    await user1Wallet.transferAmount(
      borrowerWallet.address as string,
      [payment],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      user1Wallet,
      borrowerWallet.address as string,
    );

    const borrowerBalanceBefore = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    await leaseInstance.repayLease(
      leaseAddress,
      borrowerWallet,
      customFees.exec,
      [payment],
    );

    const leaseStateAfterRepay = await leaseInstance.getLeaseStatus(
      leaseAddress,
    );

    const currentLeaseAmountAfter = leaseStateAfterRepay.paid?.amount;

    if (!currentLeaseAmountAfter) {
      undefinedHandler();
      return;
    }

    const borrowerBalanceAfter = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    expect(+borrowerBalanceAfter.amount).toBe(
      +borrowerBalanceBefore.amount - +payment.amount,
    );

    expect(+currentLeaseAmountAfter).toBe(+currentLeaseAmount + excess);

    // try to pay paid loan
    await user1Wallet.transferAmount(
      borrowerWallet.address as string,
      [payment],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      user1Wallet,
      borrowerWallet.address as string,
    );

    const result2 = () =>
      leaseInstance.repayLease(leaseAddress, borrowerWallet, customFees.exec, [
        payment,
      ]);

    // the lpp loan instance must be closed
    await expect(result2).rejects.toThrow(/^.*The underlying loan is closed.*/);

    expect(
      (await leaseInstance.getLeaseStatus(leaseAddress)).paid,
    ).toBeDefined();
  });

  // TO DO: partial liquidation , complete liquidation; Liability max% - in a new file

  // test('the borrower doesnt repay the interest during the grace period - ??', async () => {
  // //
  // });
});
