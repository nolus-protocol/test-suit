import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import { Coin } from '@cosmjs/amino';
import { DEFAULT_FEE, sleep } from '../util/utils';
import { ChainConstants, NolusClient, NolusWallet } from '@nolus/nolusjs';

describe('Leaser contract tests - Open a lease', () => {
  let user1Wallet: NolusWallet;
  let borrowerWallet: NolusWallet;
  let lppLiquidity: Coin;
  let lppDenom: string;
  let NATIVE_TOKEN_DENOM: string;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;

  const downpayment = '100';

  beforeAll(async () => {
    NATIVE_TOKEN_DENOM = ChainConstants.COIN_MINIMAL_DENOM;
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    borrowerWallet = await createWallet();

    // TO DO: We will have a message about that soon
    lppDenom = process.env.STABLE_DENOM as string;

    // if the leaseOpening tests start first, the current tests will fail due to a problem with the qoute request, so sleep()
    await sleep(6000);

    // send init tokens to lpp address to provide liquidity, otherwise cant send query
    await user1Wallet.sendTokens(
      user1Wallet.address as string,
      lppContractAddress,
      [{ denom: lppDenom, amount: '1000' }],
      DEFAULT_FEE,
    );

    lppLiquidity = await borrowerWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    expect(lppLiquidity.amount).not.toBe('0');

    //  send some tokens to the borrower
    // for the downpayment and fees
    await user1Wallet.sendTokens(
      user1Wallet.address as string,
      borrowerWallet.address as string,
      [{ denom: lppDenom, amount: downpayment }],
      DEFAULT_FEE,
    );
    await sendInitFeeTokens(
      userClient,
      userAccount.address,
      borrowerAccount.address,
    );
  });

  test('the borrower should be able to open lease', async () => {
    // get the liquidity
    lppLiquidity = await borrowerWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );
    // send some tokens to the borrower
    // for the downpayment and fees
    await user1Wallet.sendTokens(
      user1Wallet.address as string,
      borrowerWallet.address as string,
      [{ denom: lppDenom, amount: downpayment }],
      DEFAULT_FEE,
    );

    const quoteMsg = {
      quote: {
        downpayment: { denom: lppDenom, amount: downpayment },
      },
    };
    const quote = await borrowerWallet.queryContractSmart(
      leaserContractAddress,
      quoteMsg,
    );

    expect(quote.borrow).toBeDefined();

    if (+quote.borrow.amount > +lppLiquidity.amount) {
      // TO DO: we won`t need this in the future - maybe this will be some lender exec msg
      // Send tokens to lpp address to provide needed liquidity to open a lease
      await user1Wallet.sendTokens(
        user1Wallet.address as string,
        lppContractAddress,
        [{ denom: lppDenom, amount: quote.borrow.amount }],
        DEFAULT_FEE,
      );
    }

    expect(lppLiquidity.amount).not.toBe('0');

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

    const openLeaseMsg = {
      open_lease: { currency: lppDenom },
    };

    const openLease = await borrowerWallet.execute(
      borrowerWallet.address as string,
      leaserContractAddress,
      openLeaseMsg,
      DEFAULT_FEE,
      undefined,
      [{ denom: lppDenom, amount: downpayment }],
    );

    const leases = {
      leases: {
        owner: borrowerWallet.address as string,
      },
    };

    const queryLeases = await borrowerWallet.queryContractSmart(
      leaserContractAddress,
      leases,
    );

    console.log('user 1 leases:', leases);
    console.log(queryLeases);

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
      BigInt(lppLiquidityBefore.amount) - BigInt(quote.borrow.amount),
    );
  });

  test('the borrower should be able to open more than one leases', async () => {
    const borrower2wallet = await createWallet();

    // get the liquidity
    lppLiquidity = await borrowerWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    // send some tokens to the borrower
    // for the downpayment and fees
    await user1Wallet.sendTokens(
      user1Wallet.address as string,
      borrower2wallet.address as string,
      [{ denom: lppDenom, amount: downpayment }],
      DEFAULT_FEE,
    );
    await user1Wallet.sendTokens(
      user1Wallet.address as string,
      borrower2wallet.address as string,
      [
        {
          denom: NATIVE_TOKEN_DENOM,
          amount: (+DEFAULT_FEE.amount[0].amount * 2).toString(),
        },
      ],
      DEFAULT_FEE,
    );

    const quoteMsg = {
      quote: {
        downpayment: { denom: lppDenom, amount: (+downpayment / 2).toString() },
      },
    };

    const quote = await borrower2wallet.queryContractSmart(
      leaserContractAddress,
      quoteMsg,
    );

    const quote2 = await borrower2wallet.queryContractSmart(
      leaserContractAddress,
      quoteMsg,
    );
    console.log('Two quote queries without openLease between them - passed!');

    expect(quote.borrow).toBeDefined();

    if (+quote.borrow.amount * 2 > +lppLiquidity.amount) {
      // TO DO: we won`t need this in the future - maybe this will be some lender exec msg
      // Send tokens to lpp address to provide needed liquidity to open a lease
      await user1Wallet.sendTokens(
        user1Wallet.address as string,
        lppContractAddress,
        [{ denom: lppDenom, amount: quote.borrow.amount }],
        DEFAULT_FEE,
      );
    }

    expect(lppLiquidity.amount).not.toBe('0');

    // get borrower balance
    const borrowerBalanceBefore = await borrower2wallet.getBalance(
      borrower2wallet.address as string,
      lppDenom,
    );

    // get the liquidity before
    const lppLiquidityBefore = await borrower2wallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    const openLeaseMsg = {
      open_lease: { currency: lppDenom },
    };

    const openLease = await borrower2wallet.execute(
      borrower2wallet.address as string,
      leaserContractAddress,
      openLeaseMsg,
      DEFAULT_FEE,
      undefined,
      [{ denom: lppDenom, amount: (+downpayment / 2).toString() }],
    );
    console.log(openLease);

    await sleep(6000);

    const quote3 = await borrower2wallet.queryContractSmart(
      leaserContractAddress,
      quoteMsg,
    );

    expect(quote3.borrow).toBeDefined();

    const openLease2 = await borrower2wallet.execute(
      borrower2wallet.address as string,
      leaserContractAddress,
      openLeaseMsg,
      DEFAULT_FEE,
      undefined,
      [{ denom: lppDenom, amount: (+downpayment / 2).toString() }],
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
        BigInt(quote.borrow.amount) * BigInt(2),
    );
  });

  test('the borrower tries to open lease with unsuported lpp currency - should produce an error', async () => {
    // get borrower balance
    const borrowerBalanceBefore = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );
    await sendInitFeeTokens(
      userClient,
      userAccount.address,
      borrowerAccount.address,
    );

    const openLeaseMsg = {
      open_lease: { currency: 'not-existend' },
    };

    const openLease = () =>
      borrowerWallet.execute(
        borrowerWallet.address as string,
        leaserContractAddress,
        openLeaseMsg,
        DEFAULT_FEE,
        undefined,
        [{ denom: lppDenom, amount: '1' }],
      );

    await expect(openLease).rejects.toThrow(
      /^.*instantiate wasm contract failed.*/,
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
    const openLeaseMsg = {
      open_lease: { currency: lppDenom },
    };

    const openLease = () =>
      borrowerWallet.execute(
        borrowerWallet.address as string,
        leaserContractAddress,
        openLeaseMsg,
        DEFAULT_FEE,
        undefined,
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

    const openLeaseMsg = {
      open_lease: { currency: lppDenom },
    };

    const openLease = () =>
      borrowerWallet.execute(
        borrowerWallet.address as string,
        leaserContractAddress,
        openLeaseMsg,
        DEFAULT_FEE,
        undefined,
        [{ denom: lppDenom, amount: borrowerBalanceBefore.amount }],
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
