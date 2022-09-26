import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import {
  customFees,
  NATIVE_MINIMAL_DENOM,
  undefinedHandler,
} from '../util/utils';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import {
  calcBorrow,
  getLeaseAddressFromOpenLeaseResponse,
} from '../util/smart-contracts';
import { InstantiateOptions } from '@cosmjs/cosmwasm-stargate';
import { Coin } from '@cosmjs/proto-signing';

describe('Borrower contract tests - Open a lease', () => {
  let feederWallet: NolusWallet;
  let borrowerWallet: NolusWallet;
  let lppDenom: string;
  let lppInstance: NolusContracts.Lpp;
  let leaserInstance: NolusContracts.Leaser;
  let lppBalance: Coin;
  let cosm: any;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;
  const leaseContractCodeId = 2;

  const downpayment = '100';
  const minimalAmountLpp = '100000000';

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    cosm = await NolusClient.getInstance().getCosmWasmClient();

    feederWallet = await getUser1Wallet();
    borrowerWallet = await createWallet();

    leaserInstance = new NolusContracts.Leaser(cosm, leaserContractAddress);
    lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);

    const lppConfig = await lppInstance.getLppConfig();

    lppDenom = lppConfig.lpn_symbol;

    await lppInstance.deposit(feederWallet, customFees.exec, [
      { denom: lppDenom, amount: minimalAmountLpp },
    ]);
    lppBalance = await cosm.getBalance(lppContractAddress, lppDenom);

    expect(lppBalance.amount).not.toBe('0');
  });

  test('the successful scenario for opening a lease - should work as expected', async () => {
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

    // get borrower balance
    const borrowerBalanceBefore = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    // get the liquidity before
    const lppLiquidityBefore = await cosm.getBalance(
      lppContractAddress,
      lppDenom,
    );

    const leasesBefore = await leaserInstance.getCurrentOpenLeasesByOwner(
      borrowerWallet.address as string,
    );

    //get config before open a lease
    const leaserConfig = await leaserInstance.getLeaserConfig();

    const response = await leaserInstance.openLease(
      borrowerWallet,
      lppDenom,
      customFees.exec,
      [{ denom: lppDenom, amount: downpayment }],
    );

    const leasesAfter = await leaserInstance.getCurrentOpenLeasesByOwner(
      borrowerWallet.address as string,
    );

    expect(leasesAfter.length).toBe(leasesBefore.length + 1);

    const leaseInstance = new NolusContracts.Lease(
      cosm,
      getLeaseAddressFromOpenLeaseResponse(response),
    );
    // get the new lease state
    const currentLeaseState = await leaseInstance.getLeaseStatus();

    const leaseAmount = currentLeaseState.opened?.amount.amount;
    const leasePrincipal = currentLeaseState.opened?.principal_due.amount;

    if (!leaseAmount || !leasePrincipal) {
      undefinedHandler();
      return;
    }

    expect(BigInt(leaseAmount) - BigInt(downpayment)).toBe(
      BigInt(leasePrincipal),
    );

    //check if this borrow<=init%*LeaseTotal(borrow+downpayment);
    expect(BigInt(leaseAmount) - BigInt(downpayment)).toBe(
      calcBorrow(
        BigInt(downpayment),
        BigInt(leaserConfig.config.liability.init_percent),
      ),
    );

    const borrowerBalanceAfter = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    // get the liquidity after
    const lppLiquidityAfter = await cosm.getBalance(
      lppContractAddress,
      lppDenom,
    );

    expect(BigInt(borrowerBalanceAfter.amount)).toBe(
      BigInt(borrowerBalanceBefore.amount) - BigInt(downpayment),
    );

    expect(BigInt(lppLiquidityAfter.amount)).toBe(
      BigInt(lppLiquidityBefore.amount) -
        (BigInt(leaseAmount) - BigInt(downpayment)),
    );
  });

  test('the borrower should be able to open more than one leases', async () => {
    const borrower2wallet = await createWallet();
    let openedLeases = 0;

    // send some tokens to the borrower
    // for the downpayment and fees
    await feederWallet.transferAmount(
      borrower2wallet.address as string,
      [{ denom: lppDenom, amount: downpayment }],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      feederWallet,
      borrower2wallet.address as string,
    );

    const quote = await leaserInstance.leaseQuote(
      (BigInt(downpayment) / BigInt(2)).toString(),
      lppDenom,
    );

    expect(quote.borrow).toBeDefined();

    // get borrower balance before
    const borrowerBalanceBefore = await borrower2wallet.getBalance(
      borrower2wallet.address as string,
      lppDenom,
    );

    // get the liquidity before
    const lppLiquidityBefore = await cosm.getBalance(
      lppContractAddress,
      lppDenom,
    );

    const leasesBefore = await leaserInstance.getCurrentOpenLeasesByOwner(
      borrower2wallet.address as string,
    );

    const firstLeaseOpenResponse = await leaserInstance.openLease(
      borrower2wallet,
      lppDenom,
      customFees.exec,
      [
        {
          denom: lppDenom,
          amount: (BigInt(downpayment) / BigInt(2)).toString(),
        },
      ],
    );
    openedLeases++;

    //test - query a quote after open a lease
    const quoteAfterLeaseOpen = await leaserInstance.leaseQuote(
      (BigInt(downpayment) / BigInt(2)).toString(),
      lppDenom,
    );
    expect(quoteAfterLeaseOpen.borrow).toBeDefined();

    const leasesAfter = await leaserInstance.getCurrentOpenLeasesByOwner(
      borrower2wallet.address as string,
    );
    expect(leasesAfter.length).toBe(leasesBefore.length + openedLeases);

    const leaseInstance = new NolusContracts.Lease(
      cosm,
      getLeaseAddressFromOpenLeaseResponse(firstLeaseOpenResponse),
    );
    // get the lease1 state
    const firstLeaseState = await leaseInstance.getLeaseStatus();

    await sendInitExecuteFeeTokens(
      feederWallet,
      borrower2wallet.address as string,
    );

    const secondLeaseOpenResponse = await leaserInstance.openLease(
      borrower2wallet,
      lppDenom,
      customFees.exec,
      [
        {
          denom: lppDenom,
          amount: (BigInt(downpayment) / BigInt(2)).toString(),
        },
      ],
    );
    openedLeases++;

    const finalLeasesCount = await leaserInstance.getCurrentOpenLeasesByOwner(
      borrower2wallet.address as string,
    );
    expect(finalLeasesCount.length).toBe(leasesBefore.length + openedLeases);

    const secondLeaseInstance = new NolusContracts.Lease(
      cosm,
      getLeaseAddressFromOpenLeaseResponse(secondLeaseOpenResponse),
    );

    // get lease2 state
    const secondLeaseState = await secondLeaseInstance.getLeaseStatus();

    const leaseAmountFirstLease = firstLeaseState.opened?.amount.amount;
    const leaseAmountSecondLease = secondLeaseState.opened?.amount.amount;

    if (!leaseAmountFirstLease || !leaseAmountSecondLease) {
      undefinedHandler();
      return;
    }

    const borrowerBalanceAfter = await borrower2wallet.getBalance(
      borrower2wallet.address as string,
      lppDenom,
    );

    // get the liquidity after
    const lppLiquidityAfter = await cosm.getBalance(
      lppContractAddress,
      lppDenom,
    );

    expect(BigInt(borrowerBalanceAfter.amount)).toBe(
      BigInt(borrowerBalanceBefore.amount) - BigInt(downpayment),
    );

    expect(BigInt(lppLiquidityAfter.amount)).toBe(
      BigInt(lppLiquidityBefore.amount) -
        (BigInt(leaseAmountFirstLease) - BigInt(downpayment) / BigInt(2)) -
        (BigInt(leaseAmountSecondLease) - BigInt(downpayment) / BigInt(2)),
    );
  });

  test('the borrower tries to open lease with unsupported lpp currency - should produce an error', async () => {
    await sendInitExecuteFeeTokens(
      feederWallet,
      borrowerWallet.address as string,
    );

    const anyAmount = '1';

    await feederWallet.transferAmount(
      borrowerWallet.address as string,
      [{ denom: lppDenom, amount: anyAmount }],
      customFees.transfer,
    );

    const borrowerBalanceBefore = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    const unsupported = NATIVE_MINIMAL_DENOM;

    const openLease = () =>
      leaserInstance.openLease(borrowerWallet, unsupported, customFees.exec, [
        { denom: lppDenom, amount: anyAmount },
      ]);

    await expect(openLease).rejects.toThrow('Unknown currency symbol');

    const borrowerBalanceAfter = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );
    expect(borrowerBalanceAfter.amount).toBe(borrowerBalanceBefore.amount);
  });

  test('the borrower tries to open a lease with 0 down payment - should produce an error', async () => {
    await sendInitExecuteFeeTokens(
      feederWallet,
      borrowerWallet.address as string,
    );

    const borrowerBalanceBefore = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    const openLease = () =>
      leaserInstance.openLease(borrowerWallet, lppDenom, customFees.exec, [
        { denom: lppDenom, amount: '0' },
      ]);

    await expect(openLease).rejects.toThrow(/^.*invalid coins.*/);

    const borrowerBalanceAfter = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );
    expect(borrowerBalanceAfter.amount).toBe(borrowerBalanceBefore.amount);
  });

  test('the borrower tries to open a lease with more down payment amount than he owns - should produce an error', async () => {
    await sendInitExecuteFeeTokens(
      feederWallet,
      borrowerWallet.address as string,
    );

    const borrowerBalanceBefore = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    const openLease = () =>
      leaserInstance.openLease(borrowerWallet, lppDenom, customFees.exec, [
        {
          denom: lppDenom,
          amount: (BigInt(borrowerBalanceBefore.amount) + BigInt(1)).toString(),
        },
      ]);

    await expect(openLease).rejects.toThrow(/^.*insufficient fund.*/);

    const borrowerBalanceAfter = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );
    expect(borrowerBalanceAfter.amount).toBe(borrowerBalanceBefore.amount);
  });

  test('the lpp "open loan" functionality should be used only by the lease contract', async () => {
    const lppOpenLoanMsg = {
      open_loan: { amount: { amount: '10', symbol: lppDenom } }, // any amount
    };

    const openLoan = () =>
      feederWallet.execute(
        feederWallet.address as string,
        lppContractAddress,
        lppOpenLoanMsg,
        customFees.exec,
      );

    await expect(openLoan).rejects.toThrow(/^.*Unauthorized contract Id.*/);
  });

  test('the lease instance can be created only by the leaser contract', async () => {
    const leaseInitMsg = {
      currency: lppDenom,
      customer: feederWallet.address as string,
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
        lpp: lppContractAddress,
      },
    };

    const options: InstantiateOptions = {
      funds: [{ amount: '10', denom: lppDenom }], // any amount
    };

    const init = () =>
      feederWallet.instantiate(
        feederWallet.address as string,
        leaseContractCodeId,
        leaseInitMsg,
        'test_lease_uat',
        customFees.init,
        options,
      );

    await expect(init).rejects.toThrow(
      /^.*can not instantiate: unauthorized.*/,
    );
  });
});
