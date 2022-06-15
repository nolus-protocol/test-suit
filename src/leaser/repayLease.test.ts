import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import { Coin } from '@cosmjs/amino';
import { DEFAULT_FEE } from '../util/utils';
import {
  NolusClient,
  NolusWallet,
  NolusContracts,
  ChainConstants,
} from '@nolus/nolusjs';
import { sendInitFeeTokens } from '../util/transfer';
import { LeaserConfig } from '@nolus/nolusjs/build/contracts';

describe('Leaser contract tests - Repay loan', () => {
  let user1Wallet: NolusWallet;
  let borrowerWallet: NolusWallet;
  let lppLiquidity: Coin;
  let lppDenom: string;
  let leaseInstance: NolusContracts.Lease;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;

  const downpayment = '100';

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    borrowerWallet = await createWallet();
    leaseInstance = new NolusContracts.Lease();

    // TO DO: We will have a message about that soon
    lppDenom = process.env.STABLE_DENOM as string;

    // send init tokens to lpp address to provide liquidity, otherwise cant send query
    await user1Wallet.transferAmount(
      lppContractAddress,
      [{ denom: lppDenom, amount: '1000000' }],
      DEFAULT_FEE,
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
      DEFAULT_FEE,
    );
    await sendInitFeeTokens(user1Wallet, borrowerWallet.address as string);

    // get the ~required liquidity
    const quote = await leaseInstance.makeLeaseApply(
      leaserContractAddress,
      downpayment,
      lppDenom,
    );

    expect(quote.borrow).toBeDefined();
    // provide it
    if (+quote.borrow.amount > +lppLiquidity.amount) {
      await user1Wallet.transferAmount(
        lppContractAddress,
        [{ denom: lppDenom, amount: quote.borrow.amount }],
        DEFAULT_FEE,
      );
    }

    expect(+lppLiquidity.amount).toBeGreaterThanOrEqual(+quote.borrow.amount);

    const leaserConfigMsg: LeaserConfig = {
      config: {
        lease_interest_rate_margin: 50,
        liability: {
          max: 90,
          healthy: 50,
          initial: 45,
        },
        repayment: {
          period_sec: 30000,
          grace_period_sec: 23000,
        },
      },
    };

    await leaseInstance.setLeaserConfig(
      leaserContractAddress,
      user1Wallet,
      leaserConfigMsg,
      DEFAULT_FEE,
    );

    // const leaserConfig = await leaseInstance.getLeaserConfig(
    //   leaserContractAddress,
    // );

    await sendInitFeeTokens(user1Wallet, borrowerWallet.address as string);

    //TO DO: calc how to get >0 interest

    const result = await leaseInstance.openLease(
      leaserContractAddress,
      borrowerWallet,
      lppDenom,
      DEFAULT_FEE,
      [{ denom: lppDenom, amount: downpayment }],
    );

    const leaseAddress = result.logs[0].events[7].attributes[3].value;

    expect(leaseAddress).not.toBe('');

    // get the new lease state
    const currentLeaseState = await leaseInstance.getLeaseStatus(leaseAddress);

    // get amount interest and principal due
    const currentLeaseInterest = currentLeaseState.interest_due.amount;
    const currentLeasePrincipal = currentLeaseState.principal_due.amount;
    // get the annual_interest before all payments
    const leaseAnnualInterestBeforeAll = currentLeaseState.annual_interest;

    // send some tokens to the borrower
    // for the payment and fees
    const firstPayment = {
      denom: lppDenom,
      amount: Math.floor(currentLeasePrincipal / 2).toString(),
    };
    await user1Wallet.transferAmount(
      borrowerWallet.address as string,
      [firstPayment],
      DEFAULT_FEE,
    );
    await sendInitFeeTokens(user1Wallet, borrowerWallet.address as string);

    // TO DO: check if the order for repayment steps is correct
    // pay only for interest

    const borrowerBalanceBeforeFirstPayment = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    const lppLiquidityBeforeFirstPayment = await user1Wallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    await leaseInstance.repayLease(leaseAddress, borrowerWallet, DEFAULT_FEE, [
      firstPayment,
    ]);

    const leaseStateAfterRepay = await leaseInstance.getLeaseStatus(
      leaseAddress,
    );

    expect(+leaseStateAfterRepay.principal_due.amount).toBe(
      +currentLeasePrincipal - +firstPayment.amount,
    );

    const borrowerBalanceAfterFirstPayment = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    expect(+borrowerBalanceAfterFirstPayment.amount).toBe(
      +borrowerBalanceBeforeFirstPayment.amount - +firstPayment.amount,
    );

    const lppLiquidityAfterFirstPayment = await user1Wallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    // TO DO: this only applies to the local network, because otherwise someone can open a lease at the same time
    expect(+lppLiquidityAfterFirstPayment.amount).toBeGreaterThan(
      +lppLiquidityBeforeFirstPayment.amount - +firstPayment.amount,
    );

    // get the annual_interest before the second payment
    const leaseAnnualInterestAfterFirstPayment =
      currentLeaseState.annual_interest;

    // TO DO: pay interest+amount

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
      amount: (1 + +DEFAULT_FEE.amount[0].amount).toString(),
    };
    await user1Wallet.transferAmount(
      borrowerWallet.address as string,
      [repayAll],
      DEFAULT_FEE,
    );

    const result = () =>
      leaseInstance.repayLease(
        leases[leases.length - 1],
        borrowerWallet,
        DEFAULT_FEE,
        [repayAll],
      );

    await expect(result).rejects.toThrow(/^.*Denoms are different.*/);
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
      DEFAULT_FEE,
    );
    await sendInitFeeTokens(user1Wallet, borrowerWallet.address as string);

    const result = () =>
      leaseInstance.repayLease(
        leases[leases.length - 1],
        borrowerWallet,
        DEFAULT_FEE,
        [repayMore],
      );

    await expect(result).rejects.toThrow(/^.*insufficient funds.*/);
  });

  test('the borrower tries to pay a lease with 0 amount - should produce an error', async () => {
    const leases = await leaseInstance.getCurrentOpenLeases(
      leaserContractAddress,
      borrowerWallet.address as string,
    );

    await sendInitFeeTokens(user1Wallet, borrowerWallet.address as string);

    const repayMore = {
      denom: lppDenom,
      amount: '0',
    };

    const result = () =>
      leaseInstance.repayLease(
        leases[leases.length - 1],
        borrowerWallet,
        DEFAULT_FEE,
        [repayMore],
      );

    await expect(result).rejects.toThrow(/^.*invalid coins.*/);
  });

  test('the borrower tries to close a lease before it is paid - should produce an error', async () => {
    const leasesBefore = await leaseInstance.getCurrentOpenLeases(
      leaserContractAddress,
      borrowerWallet.address as string,
    );

    await sendInitFeeTokens(user1Wallet, borrowerWallet.address as string);

    const result = () =>
      leaseInstance.closeLease(
        leasesBefore[leasesBefore.length - 1],
        borrowerWallet,
        DEFAULT_FEE,
      );

    await expect(result).rejects.toThrow(
      /^.*The underlying loan is not fully repaid.*/,
    );

    const leasesAfter = await leaseInstance.getCurrentOpenLeases(
      leaserContractAddress,
      borrowerWallet.address as string,
    );

    expect(leasesBefore.length).toEqual(leasesAfter.length);
  });

  test('the borrower tries to repay the lease at once', async () => {
    const leases = await leaseInstance.getCurrentOpenLeases(
      leaserContractAddress,
      borrowerWallet.address as string,
    );

    const borrowerBalanceBefore = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    const leaseStateBeforeRepay = await leaseInstance.getLeaseStatus(
      leases[leases.length - 1],
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
      DEFAULT_FEE,
    );
    await sendInitFeeTokens(user1Wallet, borrowerWallet.address as string);

    await leaseInstance.repayLease(
      leases[leases.length - 1],
      borrowerWallet,
      DEFAULT_FEE,
      [repayAll],
    );

    const leaseStateAfterRepay = await leaseInstance.getLeaseStatus(
      leases[leases.length - 1],
    );

    expect(leaseStateAfterRepay).toBe(null); // TO DO: one day maybe this will return 'Closed'

    const leasesAfterRepay = await leaseInstance.getCurrentOpenLeases(
      leaserContractAddress,
      borrowerWallet.address as string,
    );

    // close
    await leaseInstance.closeLease(
      leases[leases.length - 1],
      borrowerWallet,
      DEFAULT_FEE,
    );

    const leasesAfterClose = await leaseInstance.getCurrentOpenLeases(
      leaserContractAddress,
      borrowerWallet.address as string,
    );

    expect(leasesAfterClose.length).toEqual(leasesAfterRepay.length);

    const borrowerBalanceAfter = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    expect(+borrowerBalanceAfter.amount).toBe(
      +borrowerBalanceBefore.amount + +loanAmount,
    );

    console.log('The first lease address is:');
    console.log(leases[leases.length - 1]);
  });

  test('the borrower tries to close an already closed lease - should produce an error', async () => {
    const leases = await leaseInstance.getCurrentOpenLeases(
      leaserContractAddress,
      borrowerWallet.address as string,
    );

    await sendInitFeeTokens(user1Wallet, borrowerWallet.address as string);

    const result = () =>
      leaseInstance.closeLease(
        leases[leases.length - 1],
        borrowerWallet,
        DEFAULT_FEE,
      );

    await expect(result).rejects.toThrow(/^.*to do.*/); // to do
  });

  test('the borrower tries to close a brand new lease - should produce an error', async () => {
    // send some tokens to the borrower
    // for the downpayment and fees
    await user1Wallet.transferAmount(
      borrowerWallet.address as string,
      [{ denom: lppDenom, amount: downpayment }],
      DEFAULT_FEE,
    );
    await sendInitFeeTokens(user1Wallet, borrowerWallet.address as string);

    const openLeaseResult = await leaseInstance.openLease(
      leaserContractAddress,
      borrowerWallet,
      lppDenom,
      DEFAULT_FEE,
      [{ denom: lppDenom, amount: downpayment }],
    );

    const leaseAddress = openLeaseResult.logs[0].events[7].attributes[3].value;

    expect(leaseAddress).not.toBe('');

    await sendInitFeeTokens(user1Wallet, borrowerWallet.address as string);

    const result = () =>
      leaseInstance.closeLease(leaseAddress, borrowerWallet, DEFAULT_FEE);

    await expect(result).rejects.toThrow(
      /^.*The underlying loan is not fully repaid.*/,
    );
  });

  // TO DO: partial liquidation , complete liquidation; Liability max%

  // test('the borrower doesnt repay the interest during the grace period - ??', async () => {
  // //
  // });
});
