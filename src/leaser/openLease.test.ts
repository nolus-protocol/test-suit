import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import { customFees, undefinedHandler } from '../util/utils';
import {
  ChainConstants,
  NolusClient,
  NolusContracts,
  NolusWallet,
} from '@nolus/nolusjs';
import { sendInitExecuteFeeTokens } from '../util/transfer';
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

  let baseInterestRate: number;
  let utilizationOptimal: number;
  let addonOptimalInterestRate: number;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;

  const downpayment = '100';

  beforeAll(async () => {
    NATIVE_TOKEN_DENOM = ChainConstants.COIN_MINIMAL_DENOM;
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    borrowerWallet = await createWallet();

    const cosm = await NolusClient.getInstance().getCosmWasmClient();
    leaseInstance = new NolusContracts.Lease(cosm);

    const lppConfig = await leaseInstance.getLppConfig(lppContractAddress);
    baseInterestRate = lppConfig.base_interest_rate / 10; //%
    utilizationOptimal = lppConfig.utilization_optimal / 10; //%
    addonOptimalInterestRate = lppConfig.addon_optimal_interest_rate / 10; //%

    lppDenom = lppConfig.lpn_symbol;

    // send init tokens to lpp address to provide liquidity
    await user1Wallet.transferAmount(
      lppContractAddress,
      [{ denom: lppDenom, amount: '100000000' }],
      customFees.transfer,
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
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      user1Wallet,
      borrowerWallet.address as string,
    );
  });

  test('the successful scenario for opening a lease - should work as expected', async () => {
    // send some tokens to the borrower
    // for the downpayment and fees
    await user1Wallet.transferAmount(
      borrowerWallet.address as string,
      [
        {
          denom: lppDenom,
          amount: (
            +downpayment +
            +customFees.exec.amount[0].amount * 2
          ).toString(),
        },
      ],
      customFees.transfer,
    );

    const quote = await leaseInstance.makeLeaseApply(
      leaserContractAddress,
      downpayment,
      lppDenom,
    );

    expect(quote.borrow).toBeDefined();

    const lppInformation = await leaseInstance.getLppBalance(
      lppContractAddress,
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

    let leaserConfig = await leaseInstance.getLeaserConfig(
      leaserContractAddress,
    );
    console.log(leaserConfig);

    expect(
      calcQuoteAnnualInterestRate(
        utilization,
        utilizationOptimal,
        baseInterestRate,
        addonOptimalInterestRate,
        leaserConfig.config.lease_interest_rate_margin,
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
    leaserConfig = await leaseInstance.getLeaserConfig(leaserContractAddress);

    await leaseInstance.openLease(
      leaserContractAddress,
      borrowerWallet,
      lppDenom,
      customFees.exec,
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
    const cAmount = currentLeaseState.opened?.amount.amount;

    if (!cAmount) {
      undefinedHandler();
      return;
    }

    //check if this borrow<=init%*LeaseTotal(borrow+downpayment);
    expect(+cAmount - +downpayment).toBeLessThanOrEqual(
      (leaserConfig.config.liability.init_percent / 100) * +cAmount,
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
        (BigInt(cAmount) - BigInt(downpayment)),
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
      customFees.transfer,
    );
    await user1Wallet.transferAmount(
      borrower2wallet.address as string,
      [
        {
          denom: NATIVE_TOKEN_DENOM,
          amount: (+customFees.exec.amount[0].amount * 2).toString(),
        },
      ],
      customFees.transfer,
    );

    const quote = await leaseInstance.makeLeaseApply(
      leaserContractAddress,
      (+downpayment / 2).toString(),
      lppDenom,
    );

    expect(quote.borrow).toBeDefined();

    // test quote annual_interest_rate calculation

    const lppInformation = await leaseInstance.getLppBalance(
      lppContractAddress,
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

    const leaserConfig = await leaseInstance.getLeaserConfig(
      leaserContractAddress,
    );

    expect(
      calcQuoteAnnualInterestRate(
        utilization,
        utilizationOptimal,
        baseInterestRate,
        addonOptimalInterestRate,
        leaserConfig.config.lease_interest_rate_margin,
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
      customFees.exec,
      [{ denom: lppDenom, amount: (+downpayment / 2).toString() }],
    );
    opened_leases++;

    //test if can query a quote after open a lease

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
      customFees.exec,
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

    const cAmountFirstLease = secondLeaseState.opened?.amount.amount;
    const cAmountSecondLease = secondLeaseState.opened?.amount.amount;

    if (!cAmountFirstLease || !cAmountSecondLease) {
      undefinedHandler();
      return;
    }

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
        (BigInt(cAmountFirstLease) - BigInt(downpayment) / BigInt(2)) -
        (BigInt(cAmountSecondLease) - BigInt(downpayment) / BigInt(2)),
    );
  });

  test('the borrower tries to open lease with unsuported lpp currency - should produce an error', async () => {
    // get borrower balance
    const borrowerBalanceBefore = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );
    await sendInitExecuteFeeTokens(
      user1Wallet,
      borrowerWallet.address as string,
    );

    const openLease = () =>
      leaseInstance.openLease(
        leaserContractAddress,
        borrowerWallet,
        'not-existend',
        customFees.exec,
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
        customFees.exec,
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
        customFees.exec,
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
