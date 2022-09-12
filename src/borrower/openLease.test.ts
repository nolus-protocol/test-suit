import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import {
  customFees,
  NATIVE_MINIMAL_DENOM,
  undefinedHandler,
} from '../util/utils';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import {
  calcQuoteAnnualInterestRate,
  calcUtilization,
} from '../util/smart-contracts';
import { InstantiateOptions } from '@cosmjs/cosmwasm-stargate';

describe('Leaser contract tests - Open a lease', () => {
  let user1Wallet: NolusWallet;
  let borrowerWallet: NolusWallet;
  let lppDenom: string;
  let leaseInstance: NolusContracts.Lease;
  let lppInstance: NolusContracts.Lpp;
  let leaserInstance: NolusContracts.Leaser;

  let baseInterestRate: number;
  let utilizationOptimal: number;
  let addonOptimalInterestRate: number;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;

  const downpayment = '100';

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    borrowerWallet = await createWallet();

    const cosm = await NolusClient.getInstance().getCosmWasmClient();
    leaseInstance = new NolusContracts.Lease(cosm);
    leaserInstance = new NolusContracts.Leaser(cosm);
    lppInstance = new NolusContracts.Lpp(cosm);

    const lppConfig = await lppInstance.getLppConfig(lppContractAddress);
    baseInterestRate = lppConfig.base_interest_rate / 10; //%
    utilizationOptimal = lppConfig.utilization_optimal / 10; //%
    addonOptimalInterestRate = lppConfig.addon_optimal_interest_rate / 10; //%

    lppDenom = lppConfig.lpn_symbol;

    await lppInstance.lenderDeposit(
      lppContractAddress,
      user1Wallet,
      customFees.exec,
      [{ denom: lppDenom, amount: '100000000' }],
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

    const quote = await leaserInstance.makeLeaseApply(
      leaserContractAddress,
      downpayment,
      lppDenom,
    );

    expect(quote.borrow).toBeDefined();

    const lppInformation = await lppInstance.getLppBalance(lppContractAddress);

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

    let leaserConfig = await leaserInstance.getLeaserConfig(
      leaserContractAddress,
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

    const leasesBefore = await leaserInstance.getCurrentOpenLeases(
      leaserContractAddress,
      borrowerWallet.address as string,
    );

    //get config before open a lease
    leaserConfig = await leaserInstance.getLeaserConfig(leaserContractAddress);

    await leaserInstance.openLease(
      leaserContractAddress,
      borrowerWallet,
      lppDenom,
      customFees.exec,
      [{ denom: lppDenom, amount: downpayment }],
    );

    const leasesAfter = await leaserInstance.getCurrentOpenLeases(
      leaserContractAddress,
      borrowerWallet.address as string,
    );

    expect(leasesAfter.length).toBe(leasesBefore.length + 1);

    // get the new lease state
    const currentLeaseState = await leaseInstance.getLeaseStatus(
      leasesAfter[leasesAfter.length - 1],
    );
    const cAmount = currentLeaseState.opened?.amount.amount;
    const cPrincipal = currentLeaseState.opened?.principal_due.amount;

    if (!cAmount || !cPrincipal) {
      undefinedHandler();
      return;
    }

    expect(+cAmount - +downpayment).toBe(+cPrincipal);

    //check if this borrow<=init%*LeaseTotal(borrow+downpayment);
    expect(+cAmount - +downpayment).toBe(
      Math.trunc(
        (+downpayment * leaserConfig.config.liability.init_percent) /
          (1000 - leaserConfig.config.liability.init_percent),
      ),
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
          denom: NATIVE_MINIMAL_DENOM,
          amount: (+customFees.exec.amount[0].amount * 2).toString(),
        },
      ],
      customFees.transfer,
    );

    const quote = await leaserInstance.makeLeaseApply(
      leaserContractAddress,
      (+downpayment / 2).toString(),
      lppDenom,
    );

    expect(quote.borrow).toBeDefined();

    // test quote annual_interest_rate calculation

    const lppInformation = await lppInstance.getLppBalance(lppContractAddress);
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

    const leaserConfig = await leaserInstance.getLeaserConfig(
      leaserContractAddress,
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

    const leasesBefore = await leaserInstance.getCurrentOpenLeases(
      leaserContractAddress,
      borrower2wallet.address as string,
    );

    await leaserInstance.openLease(
      leaserContractAddress,
      borrower2wallet,
      lppDenom,
      customFees.exec,
      [{ denom: lppDenom, amount: (+downpayment / 2).toString() }],
    );
    opened_leases++;

    //test if can query a quote after open a lease

    const quote2 = await leaserInstance.makeLeaseApply(
      leaserContractAddress,
      (+downpayment / 2).toString(),
      lppDenom,
    );
    expect(quote2.borrow).toBeDefined();

    const leasesAfter = await leaserInstance.getCurrentOpenLeases(
      leaserContractAddress,
      borrower2wallet.address as string,
    );
    expect(leasesAfter.length).toBe(leasesBefore.length + opened_leases);

    // get the new lease1 state
    const firstLeaseState = await leaseInstance.getLeaseStatus(
      leasesAfter[leasesAfter.length - 1],
    );

    await leaserInstance.openLease(
      leaserContractAddress,
      borrower2wallet,
      lppDenom,
      customFees.exec,
      [{ denom: lppDenom, amount: (+downpayment / 2).toString() }],
    );
    opened_leases++;

    const finalLeases = await leaserInstance.getCurrentOpenLeases(
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

  test('the borrower tries to open lease with unsupported lpp currency - should produce an error', async () => {
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
      leaserInstance.openLease(
        leaserContractAddress,
        borrowerWallet,
        'unsupported',
        customFees.exec,
        [{ denom: lppDenom, amount: '1' }],
      );

    await expect(openLease).rejects.toThrow(/^.*TO DO:.*/);

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
      leaserInstance.openLease(
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
      leaserInstance.openLease(
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

  test('the lpp "open loan" functionality should be used only by the lease contract', async () => {
    const lppOpenLoanMsg = {
      open_loan: { amount: { amount: '10', symbol: lppDenom } },
    };

    const openLoan = () =>
      user1Wallet.execute(
        user1Wallet.address as string,
        lppContractAddress,
        lppOpenLoanMsg,
        customFees.exec,
      );

    await expect(openLoan).rejects.toThrow(/^.*Unauthorized contract Id.*/);
  });

  test('the lease instance can be created only by the leaser contract', async () => {
    const leaseInitMsg = {
      currency: 'uusdc',
      customer: user1Wallet.address as string,
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
        lpp: 'nolus1qg5ega6dykkxc307y25pecuufrjkxkaggkkxh7nad0vhyhtuhw3sqaa3c5',
      },
    };

    const options: InstantiateOptions = {
      funds: [{ amount: '200000', denom: 'uusdc' }],
    };

    const init = () =>
      user1Wallet.instantiate(
        user1Wallet.address as string,
        2,
        leaseInitMsg,
        'lease_uat',
        customFees.init,
        options,
      );

    await expect(init).rejects.toThrow(
      /^.*can not instantiate: unauthorized.*/,
    );
  });
});
