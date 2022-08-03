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

describe('Leaser contract tests - Repay lease', () => {
  let user1Wallet: NolusWallet;
  let borrowerWallet: NolusWallet;
  let lppLiquidity: Coin;
  let lppDenom: string;
  let leaseInstance: NolusContracts.Lease;
  let mainLeaseAddress: string;
  let annualInterest: number;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;

  const downpayment = '1000000000';
  const outstandingBySec = 15;

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    borrowerWallet = await createWallet();

    const cosm = await NolusClient.getInstance().getCosmWasmClient();
    leaseInstance = new NolusContracts.Lease(cosm);

    const lppConfig = await leaseInstance.getLppConfig(lppContractAddress);
    lppDenom = lppConfig.lpn_symbol;

    await leaseInstance.lenderDeposit(
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

    const quote = await leaseInstance.makeLeaseApply(
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

    const result = await leaseInstance.openLease(
      leaserContractAddress,
      borrowerWallet,
      lppDenom,
      customFees.exec,
      [{ denom: lppDenom, amount: downpayment }],
    );

    mainLeaseAddress = result.logs[0].events[7].attributes[3].value;

    expect(mainLeaseAddress).not.toBe('');

    let currentLeaseState = await leaseInstance.getLeaseStatus(
      mainLeaseAddress,
    );

    const cInteresRate = currentLeaseState.opened?.interest_rate;

    if (!cInteresRate) {
      undefinedHandler();
      return;
    }

    // get annual_interest for loan
    const leaserConfig = await leaseInstance.getLeaserConfig(
      leaserContractAddress,
    );
    annualInterest =
      +cInteresRate - +leaserConfig.config.lease_interest_rate_margin;

    //wait for >0 interest
    await sleep(outstandingBySec * 1000);

    let loan = await leaseInstance.getLoanInformation(
      lppContractAddress,
      mainLeaseAddress,
    );

    const timeImmediatlyBeforeOutsQuery = (
      new Date().getTime() * 1000000
    ).toString();

    const outstandingInterest = await leaseInstance.getOutstandingInterest(
      lppContractAddress,
      mainLeaseAddress,
      timeImmediatlyBeforeOutsQuery,
    );

    currentLeaseState = await leaseInstance.getLeaseStatus(mainLeaseAddress);

    let currentLeaseInterest = currentLeaseState.opened?.interest_due.amount;
    let currentLeasePrincipal = currentLeaseState.opened?.principal_due.amount;

    if (!currentLeaseInterest || !currentLeasePrincipal) {
      undefinedHandler();
      return;
    }

    // verify interest calc
    expect(+outstandingInterest.amount).toBe(
      calcInterestRate(
        +currentLeasePrincipal,
        annualInterest / 10,
        +timeImmediatlyBeforeOutsQuery,
        loan.interest_paid,
      ),
    );

    // get the annual_interest before all payments
    const leaseAnnualInterestBeforeAll =
      currentLeaseState.opened?.interest_rate;

    const firstPayment = {
      denom: lppDenom,
      amount: currentLeaseInterest,
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

    loan = await leaseInstance.getLoanInformation(
      lppContractAddress,
      mainLeaseAddress,
    );

    const leaseStateAfterFirstRepay = await leaseInstance.getLeaseStatus(
      mainLeaseAddress,
    );

    const cPrincipalFirstRepay =
      leaseStateAfterFirstRepay.opened?.principal_due.amount;
    const cInterestFirstRepay =
      leaseStateAfterFirstRepay.opened?.interest_due.amount;

    if (!cPrincipalFirstRepay || !cInterestFirstRepay) {
      undefinedHandler();
      return;
    }
    let timeBeforeCheck = (new Date().getTime() * 1000000).toString();

    const interestImmediatelyBeforeFirstCheck = calcInterestRate(
      +cPrincipalFirstRepay,
      annualInterest / 10,
      +timeBeforeCheck,
      loan.interest_paid,
    );

    //TO DO: to be!
    expect(+cInterestFirstRepay).toBeGreaterThanOrEqual(
      +currentLeaseInterest -
        +firstPayment.amount +
        interestImmediatelyBeforeFirstCheck,
    );

    expect(leaseStateAfterFirstRepay.opened?.principal_due.amount).toBe(
      currentLeasePrincipal,
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
    currentLeaseInterest = currentLeaseState.opened?.interest_due.amount;
    currentLeasePrincipal = currentLeaseState.opened?.principal_due.amount;

    if (!currentLeaseInterest || !currentLeasePrincipal) {
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
    const cPrincipalAfterSecondRepay =
      leaseStateAfterSecondRepay.opened?.principal_due.amount;
    const cInterestAfterSecondRepay =
      leaseStateAfterSecondRepay.opened?.interest_due.amount;
    if (!cInterestAfterSecondRepay || !cPrincipalAfterSecondRepay) {
      undefinedHandler();
      return;
    }

    timeBeforeCheck = (new Date().getTime() * 1000000).toString();

    const interestImmediatelyBeforeCheck = calcInterestRate(
      +cPrincipalAfterSecondRepay,
      annualInterest / 10,
      +timeBeforeCheck,
      +timeOfLeaseStateCheck,
    );

    // check that the repayment sequence is correct
    expect(+cPrincipalAfterSecondRepay).toBeGreaterThanOrEqual(
      +currentLeasePrincipal - Math.floor(+currentLeasePrincipal / 2),
    );

    // TO DO: to be!
    expect(+cInterestAfterSecondRepay).toBeGreaterThanOrEqual(
      interestImmediatelyBeforeCheck,
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
    const leases = await leaseInstance.getCurrentOpenLeases(
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
    const leases = await leaseInstance.getCurrentOpenLeases(
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
    const leases = await leaseInstance.getCurrentOpenLeases(
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

    const cPrincipalBeforeRepay =
      leaseStateBeforeRepay.opened?.principal_due.amount;
    const cInterestBeforeRepay =
      leaseStateBeforeRepay.opened?.interest_due.amount;

    if (!cPrincipalBeforeRepay || !cInterestBeforeRepay) {
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

    const cPrincipalAfterRepay =
      leaseStateAfterRepay.opened?.principal_due.amount;
    const cInterestAfterRepay =
      leaseStateAfterRepay.opened?.interest_due.amount;

    if (!cPrincipalAfterRepay || !cInterestAfterRepay) {
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
    const cInterestBeforeRepay =
      leaseStateBeforeRepay.opened?.interest_due.amount;
    const cPrincipalBeforeRepay =
      leaseStateBeforeRepay.opened?.principal_due.amount;
    const loanAmount = leaseStateBeforeRepay.opened?.amount.amount;

    if (!cPrincipalBeforeRepay || !cInterestBeforeRepay || !loanAmount) {
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
    const leaseStateAfterRepay = await leaseInstance.getLeaseStatus(
      mainLeaseAddress,
    );

    await sendInitExecuteFeeTokens(
      user1Wallet,
      borrowerWallet.address as string,
    );

    const borrowerBalanceBeforeClose = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    // close
    await leaseInstance.closeLease(
      mainLeaseAddress,
      borrowerWallet,
      customFees.exec,
    );

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

  // TO DO: partial liquidation , complete liquidation; Liability max% - in a new file

  // test('the borrower doesnt repay the interest during the grace period - ??', async () => {
  // //
  // });
});
