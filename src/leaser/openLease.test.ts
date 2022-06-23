import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import { Coin } from '@cosmjs/amino';
import { DEFAULT_FEE, sleep } from '../util/utils';
import {
  ChainConstants,
  NolusClient,
  NolusContracts,
  NolusWallet,
} from '@nolus/nolusjs';
import { sendInitFeeTokens } from '../util/transfer';
import {
  calcQuoteAnnualInterestRate,
  calcUtilization,
} from '../util/smart-contracts';

describe('Leaser contract tests - Open a lease', () => {
  let NATIVE_TOKEN_DENOM: string;
  let user1Wallet: NolusWallet;
  let borrowerWallet: NolusWallet;
  let lppDenom: string;
  let leaseInstance: NolusContracts.Lease;

  // TO DO: nolusjs
  const lppBalanceMsg = {
    lpp_balance: [],
  };

  // TO DO: message about that soon
  const baseInterestRate = 7; //%
  const utilizationOptimal = 70; //%
  const addonOptimalInterestRate = 2; //%

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;

  const downpayment = '100';

  beforeAll(async () => {
    NATIVE_TOKEN_DENOM = ChainConstants.COIN_MINIMAL_DENOM;
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    borrowerWallet = await createWallet();
    leaseInstance = new NolusContracts.Lease();

    // TO DO: We will have a message about that soon
    lppDenom = process.env.STABLE_DENOM as string;

    // send init tokens to lpp address to provide liquidity, otherwise cant send query
    await user1Wallet.transferAmount(
      lppContractAddress,
      [{ denom: lppDenom, amount: '1000' }],
      DEFAULT_FEE,
    );

    const lppLiquidity = await borrowerWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    expect(lppLiquidity.amount).not.toBe('0');

    //  send some tokens to the borrower
    // for the downpayment and fees
    await user1Wallet.transferAmount(
      borrowerWallet.address as string,
      [{ denom: lppDenom, amount: downpayment }],
      DEFAULT_FEE,
    );
    await sendInitFeeTokens(user1Wallet, borrowerWallet.address as string);
  });

  test('the successful scenario for opening a lease - should work as expected', async () => {
    // send some tokens to the borrower
    // for the downpayment and fees
    await user1Wallet.transferAmount(
      borrowerWallet.address as string,
      [
        {
          denom: lppDenom,
          amount: (+downpayment + +DEFAULT_FEE.amount[0].amount * 2).toString(),
        },
      ],
      DEFAULT_FEE,
    );

    const quote = await leaseInstance.makeLeaseApply(
      leaserContractAddress,
      downpayment,
      lppDenom,
    );

    expect(quote.borrow).toBeDefined();

    const lppInformation = await borrowerWallet.queryContractSmart(
      lppContractAddress,
      lppBalanceMsg,
    );
    const totalPrincipalDueByNow = lppInformation.total_principal_due;
    const totalInterestDueByNow = lppInformation.total_interest_due;
    const lppLiquidity = lppInformation.balance;

    // console.log(totalPrincipalDueByNow);
    // console.log(totalInterestDueByNow);
    // console.log(lppLiquidity);

    expect(lppLiquidity.amount).not.toBe('0');

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
    ).toBe(quote.annual_interest_rate);

    // get borrower balance
    const borrowerBalanceBefore = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    // get the liquidity before
    const lppLiquidityBefore = await borrowerWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    const leasesBefore = await leaseInstance.getCurrentOpenLeases(
      leaserContractAddress,
      borrowerWallet.address as string,
    );

    //get config before open a lease
    const leaserConfig = await leaseInstance.getLeaserConfig(
      leaserContractAddress,
    );

    await leaseInstance.openLease(
      leaserContractAddress,
      borrowerWallet,
      lppDenom,
      DEFAULT_FEE,
      [{ denom: lppDenom, amount: downpayment }],
    );

    const leasesAfter = await leaseInstance.getCurrentOpenLeases(
      leaserContractAddress,
      borrowerWallet.address as string,
    );

    expect(leasesAfter.length).toBe(leasesBefore.length + 1);

    // get the new lease state
    const currentLeaseState = await leaseInstance.getLeaseStatus(
      leasesAfter[leasesAfter.length - 1],
    );

    //check if this borrow<=init%*LeaseTotal(borrow+downpayment);
    expect(+currentLeaseState.amount.amount - +downpayment).toBeLessThanOrEqual(
      (leaserConfig.config.liability.initial / 100) *
        +currentLeaseState.amount.amount,
    );

    const borrowerBalanceAfter = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    // get the liquidity after
    const lppLiquidityAfter = await borrowerWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    expect(BigInt(borrowerBalanceAfter.amount)).toBe(
      BigInt(borrowerBalanceBefore.amount) - BigInt(downpayment),
    );

    expect(BigInt(lppLiquidityAfter.amount)).toBe(
      BigInt(lppLiquidityBefore.amount) -
        (BigInt(currentLeaseState.amount.amount) - BigInt(downpayment)),
    );
  });

  test('the borrower should be able to open more than one leases', async () => {
    const borrower2wallet = await createWallet();
    let opened_leases = 0;

    // send some tokens to the borrower
    // for the downpayment and fees
    await user1Wallet.transferAmount(
      borrower2wallet.address as string,
      [{ denom: lppDenom, amount: downpayment }],
      DEFAULT_FEE,
    );
    await user1Wallet.transferAmount(
      borrower2wallet.address as string,
      [
        {
          denom: NATIVE_TOKEN_DENOM,
          amount: (+DEFAULT_FEE.amount[0].amount * 2).toString(),
        },
      ],
      DEFAULT_FEE,
    );

    const quote = await leaseInstance.makeLeaseApply(
      leaserContractAddress,
      (+downpayment / 2).toString(),
      lppDenom,
    );

    expect(quote.borrow).toBeDefined();

    // test quote annual_interest_rate calculation

    const lppInformation = await borrowerWallet.queryContractSmart(
      lppContractAddress,
      lppBalanceMsg,
    );
    const totalPrincipalDueByNow = lppInformation.total_principal_due;
    const totalInterestDueByNow = lppInformation.total_interest_due;
    const lppLiquidity = lppInformation.balance;

    expect(lppLiquidity.amount).not.toBe('0');

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
    ).toBe(quote.annual_interest_rate);

    // get borrower balance before
    const borrowerBalanceBefore = await borrower2wallet.getBalance(
      borrower2wallet.address as string,
      lppDenom,
    );

    // get the liquidity before
    const lppLiquidityBefore = await borrower2wallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    const leasesBefore = await leaseInstance.getCurrentOpenLeases(
      leaserContractAddress,
      borrower2wallet.address as string,
    );

    await leaseInstance.openLease(
      leaserContractAddress,
      borrower2wallet,
      lppDenom,
      DEFAULT_FEE,
      [{ denom: lppDenom, amount: (+downpayment / 2).toString() }],
    );
    opened_leases++;

    //test if can query a quote after open a lease
    await sleep(6000);

    const quote2 = await leaseInstance.makeLeaseApply(
      leaserContractAddress,
      (+downpayment / 2).toString(),
      lppDenom,
    );
    expect(quote2.borrow).toBeDefined();

    const leasesAfter = await leaseInstance.getCurrentOpenLeases(
      leaserContractAddress,
      borrower2wallet.address as string,
    );
    expect(leasesAfter.length).toBe(leasesBefore.length + opened_leases);

    // get the new lease1 state
    const firstLeaseState = await leaseInstance.getLeaseStatus(
      leasesAfter[leasesAfter.length - 1],
    );

    await leaseInstance.openLease(
      leaserContractAddress,
      borrower2wallet,
      lppDenom,
      DEFAULT_FEE,
      [{ denom: lppDenom, amount: (+downpayment / 2).toString() }],
    );
    opened_leases++;

    const finalLeases = await leaseInstance.getCurrentOpenLeases(
      leaserContractAddress,
      borrower2wallet.address as string,
    );
    expect(finalLeases.length).toBe(leasesBefore.length + opened_leases);

    // get the new lease2 state
    const secondLeaseState = await leaseInstance.getLeaseStatus(
      leasesAfter[leasesAfter.length - 1],
    );

    const borrowerBalanceAfter = await borrower2wallet.getBalance(
      borrower2wallet.address as string,
      lppDenom,
    );

    // get the liquidity after
    const lppLiquidityAfter = await borrower2wallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    expect(BigInt(borrowerBalanceAfter.amount)).toBe(
      BigInt(borrowerBalanceBefore.amount) - BigInt(downpayment),
    );

    expect(BigInt(lppLiquidityAfter.amount)).toBe(
      BigInt(lppLiquidityBefore.amount) -
        (BigInt(firstLeaseState.amount.amount) -
          BigInt(downpayment) / BigInt(2)) -
        (BigInt(secondLeaseState.amount.amount) -
          BigInt(downpayment) / BigInt(2)),
    );
  });

  test('the borrower tries to open lease with unsuported lpp currency - should produce an error', async () => {
    // get borrower balance
    const borrowerBalanceBefore = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );
    await sendInitFeeTokens(user1Wallet, borrowerWallet.address as string);

    const openLease = () =>
      leaseInstance.openLease(
        leaserContractAddress,
        borrowerWallet,
        'not-existend',
        DEFAULT_FEE,
        [{ denom: lppDenom, amount: '1' }],
      );

    await expect(openLease).rejects.toThrow(
      /^.*Aborted: panicked at 'assertion failed.*/,
    );

    // get borrower balance
    const borrowerBalanceAfter = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );
    expect(borrowerBalanceAfter.amount).toBe(borrowerBalanceBefore.amount);
  });

  test('the borrower tries to open a lease with 0 down payment - should produce an error', async () => {
    // get borrower balance
    const borrowerBalanceBefore = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    const openLease = () =>
      leaseInstance.openLease(
        leaserContractAddress,
        borrowerWallet,
        lppDenom,
        DEFAULT_FEE,
        [{ denom: lppDenom, amount: '0' }],
      );

    await expect(openLease).rejects.toThrow(/^.*invalid coins.*/);
    // get borrower balance
    const borrowerBalanceAfter = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );
    expect(borrowerBalanceAfter.amount).toBe(borrowerBalanceBefore.amount);
  });

  test('the borrower tries to open a lease with more down payment amount than he owns - should produce an error', async () => {
    // get borrower balance
    const borrowerBalanceBefore = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    const openLease = () =>
      leaseInstance.openLease(
        leaserContractAddress,
        borrowerWallet,
        lppDenom,
        DEFAULT_FEE,
        [
          {
            denom: lppDenom,
            amount: (+borrowerBalanceBefore.amount + 1).toString(),
          },
        ],
      );

    await expect(openLease).rejects.toThrow(/^.*insufficient fund.*/);
    // get borrower balance
    const borrowerBalanceAfter = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );
    expect(borrowerBalanceAfter.amount).toBe(borrowerBalanceBefore.amount);
  });
});
