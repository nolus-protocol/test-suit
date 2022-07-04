import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import { Coin } from '@cosmjs/amino';
import { customFees, sleep } from '../util/utils';
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

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;

  const downpayment = '10000000';
  const outstandingBySec = 60;

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    borrowerWallet = await createWallet();

    const cosm = await NolusClient.getInstance().getCosmWasmClient();
    leaseInstance = new NolusContracts.Lease(cosm);

    // TO DO: We will have a message about that soon
    lppDenom = process.env.STABLE_DENOM as string;

    // send init tokens to lpp address to provide liquidity
    await user1Wallet.transferAmount(
      lppContractAddress,
      [{ denom: lppDenom, amount: '20000000' }],
      customFees.transfer,
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

    //wait for >0 interest
    await sleep(outstandingBySec * 1000);
    const outstandingTimestamp = (new Date().getTime() * 1000000).toString();

    let currentLeaseState = await leaseInstance.getLeaseStatus(
      mainLeaseAddress,
    );
    let currentLeaseInterest = currentLeaseState.interest_due.amount;
    let currentLeasePrincipal = currentLeaseState.principal_due.amount;

    // get annual_interest for loan
    const leaserConfig = await leaseInstance.getLeaserConfig(
      leaserContractAddress,
    );

    const anualInterest =
      +currentLeaseState.annual_interest -
      +leaserConfig.config.lease_interest_rate_margin;

    const outstandingInterestMsg = {
      loan_outstanding_interest: {
        lease_addr: mainLeaseAddress,
        outstanding_time: outstandingTimestamp,
      },
    };

    const loanMsg = {
      loan: {
        lease_addr: mainLeaseAddress,
      },
    };

    const loan = await borrowerWallet.queryContractSmart(
      lppContractAddress,
      loanMsg,
    );

    const outstandingInterest = await borrowerWallet.queryContractSmart(
      lppContractAddress,
      outstandingInterestMsg,
    );

    // verify interest calc
    expect(+outstandingInterest.amount).toBe(
      calcInterestRate(
        +currentLeasePrincipal,
        anualInterest / 10,
        +outstandingTimestamp,
        loan.interest_paid,
      ),
    );

    expect(+loan.interest_due.amount).toBe(
      calcInterestRate(
        +currentLeasePrincipal,
        anualInterest / 10,
        +outstandingTimestamp,
        loan.interest_paid,
      ),
    );

    // get the annual_interest before all payments
    const leaseAnnualInterestBeforeAll = currentLeaseState.annual_interest;

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
    let leaseStateAfterRepay = await leaseInstance.getLeaseStatus(
      mainLeaseAddress,
    );

    expect(leaseStateAfterRepay.principal_due.amount).toBe(
      currentLeasePrincipal,
    );

    expect(+leaseStateAfterRepay.interest_due.amount).toBe(
      +currentLeaseInterest - +firstPayment.amount,
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
      currentLeaseState.annual_interest;

    // pay interest+amount

    // wait for >0 interest
    await sleep(outstandingBySec * 1000);

    // get the new lease state
    currentLeaseState = await leaseInstance.getLeaseStatus(mainLeaseAddress);
    currentLeaseInterest = currentLeaseState.interest_due.amount;
    currentLeasePrincipal = currentLeaseState.principal_due.amount;

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

    currentLeaseState = await leaseInstance.getLeaseStatus(mainLeaseAddress);
    console.log(
      'The exact amount of interest immediately before repayment',
      currentLeaseState.interest_due,
    );

    await leaseInstance.repayLease(
      mainLeaseAddress,
      borrowerWallet,
      customFees.exec,
      [secondPayment],
    );

    leaseStateAfterRepay = await leaseInstance.getLeaseStatus(mainLeaseAddress);

    // check that the repayment sequence is correct
    expect(+leaseStateAfterRepay.principal_due.amount).toBe(
      +currentLeasePrincipal - Math.floor(+currentLeasePrincipal / 2),
    );
    expect(+leaseStateAfterRepay.interest_due.amount).toBe(0);

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
      expect(+lppLiquidityAfter.amount).toBeGreaterThan(
        +lppLiquidityBefore.amount - +secondPayment.amount,
      );
    }

    //get the annual_interest after the second payment and expect these annual_interests to be equal
    const leaseAnnualInterestAfterSecondPayment =
      currentLeaseState.annual_interest;

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
      /^.*Found currency unolus expecting uusdc.*/,
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

    const pay = {
      denom: lppDenom,
      amount: Math.floor(
        +leaseStateBeforeRepay.principal_due.amount / 2,
      ).toString(),
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

    const userBalanceAfter = await userWallet.getBalance(
      userWallet.address as string,
      lppDenom,
    );

    expect(
      +(
        +leaseStateAfterRepay.principal_due.amount +
        +leaseStateAfterRepay.interest_due.amount
      ),
    ).toBe(
      +leaseStateBeforeRepay.principal_due.amount +
        +leaseStateBeforeRepay.interest_due.amount -
        +pay.amount,
    );

    expect(+userBalanceAfter.amount).toBe(
      +userBalanceBefore.amount - +pay.amount,
    );
  });

  test('the borrower tries to repay the lease at once', async () => {
    const borrowerBalanceBefore = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    const leaseStateBeforeRepay = await leaseInstance.getLeaseStatus(
      mainLeaseAddress,
    );

    const loanAmount = leaseStateBeforeRepay.amount.amount;

    // send some tokens to the borrower
    // for the payment and fees
    const repayAll = {
      denom: lppDenom,
      amount: Math.floor(
        +leaseStateBeforeRepay.interest_due.amount +
          +leaseStateBeforeRepay.principal_due.amount,
      ).toString(),
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
      +borrowerBalanceBefore.amount + +loanAmount,
    );

    //return amount to the main - reserv address
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
