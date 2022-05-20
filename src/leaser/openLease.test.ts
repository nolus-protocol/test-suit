import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import {
  getUser1Client,
  getUser1Wallet,
  getClient,
  createWallet,
} from '../util/clients';
import { AccountData, Coin } from '@cosmjs/amino';
import { DEFAULT_FEE, sleep } from '../util/utils';

describe('Leaser contract tests - Open a lease', () => {
  let userClient: SigningCosmWasmClient;
  let userAccount: AccountData;
  let borrowerAccount: AccountData;
  let borrowerClient: SigningCosmWasmClient;
  let lppLiquidity: Coin;
  let lppDenom: string;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;

  const downpayment = '100';
  const borrowerAmount = '200';

  beforeAll(async () => {
    userClient = await getUser1Client();
    [userAccount] = await (await getUser1Wallet()).getAccounts();
    const borrowerWallet = await createWallet();
    borrowerClient = await getClient(borrowerWallet);
    [borrowerAccount] = await borrowerWallet.getAccounts();

    // TO DO: We will have a message about that soon
    lppDenom = 'unolus';

    // if the leaseOpening tests start first, the current tests will fail due to a problem with the qoute request, so sleep()
    await sleep(4000);

    // send init tokens to lpp address to provide liquidity, otherwise cant send query
    await userClient.sendTokens(
      userAccount.address,
      lppContractAddress,
      [{ denom: lppDenom, amount: '1000' }],
      DEFAULT_FEE,
    );

    lppLiquidity = await borrowerClient.getBalance(
      lppContractAddress,
      lppDenom,
    );

    expect(lppLiquidity.amount).not.toBe('0');

    //  send some tokens to the borrower
    // for the downpayment and fees
    await userClient.sendTokens(
      userAccount.address,
      borrowerAccount.address,
      [{ denom: lppDenom, amount: borrowerAmount }],
      DEFAULT_FEE,
    );
  });

  test('the borrower should be able to open lease', async () => {
    // get the liquidity
    lppLiquidity = await borrowerClient.getBalance(
      lppContractAddress,
      lppDenom,
    );
    // send some tokens to the borrower
    // for the downpayment and fees
    await userClient.sendTokens(
      userAccount.address,
      borrowerAccount.address,
      [{ denom: lppDenom, amount: borrowerAmount }],
      DEFAULT_FEE,
    );

    const quoteMsg = {
      quote: {
        downpayment: { denom: lppDenom, amount: downpayment },
      },
    };
    const quote = await borrowerClient.queryContractSmart(
      leaserContractAddress,
      quoteMsg,
    );

    expect(quote.borrow).toBeDefined();

    if (+quote.borrow.amount > +lppLiquidity.amount) {
      // TO DO: we won`t need this in the future - maybe this will be some lender exec msg
      // Send tokens to lpp address to provide needed liquidity to open a lease
      await userClient.sendTokens(
        userAccount.address,
        lppContractAddress,
        [{ denom: lppDenom, amount: quote.borrow.amount }],
        DEFAULT_FEE,
      );
    }
    console.log(lppLiquidity.amount);

    expect(lppLiquidity.amount).not.toBe('0');

    // get borrower balance
    const borrowerBalanceBefore = await borrowerClient.getBalance(
      borrowerAccount.address,
      lppDenom,
    );

    // get the liquidity before
    const lppLiquidityBefore = await borrowerClient.getBalance(
      lppContractAddress,
      lppDenom,
    );

    const openLeaseMsg = {
      open_lease: { currency: lppDenom },
    };

    const openLease = await borrowerClient.execute(
      borrowerAccount.address,
      leaserContractAddress,
      openLeaseMsg,
      DEFAULT_FEE,
      undefined,
      [{ denom: lppDenom, amount: downpayment }],
    );
    console.log(openLease);

    const borrowerBalanceAfter = await borrowerClient.getBalance(
      borrowerAccount.address,
      lppDenom,
    );

    // get the liquidity after
    const lppLiquidityAfter = await borrowerClient.getBalance(
      lppContractAddress,
      lppDenom,
    );

    console.log(lppLiquidityAfter);

    expect(BigInt(borrowerBalanceAfter.amount)).toBe(
      BigInt(borrowerBalanceBefore.amount) -
        BigInt(downpayment) -
        BigInt(DEFAULT_FEE.amount[0].amount),
    );

    expect(BigInt(lppLiquidityAfter.amount)).toBe(
      BigInt(lppLiquidityBefore.amount) - BigInt(quote.borrow.amount),
    );
    await sleep(4000);
  });

  test('the borrower should be able to open more than one leases', async () => {
    const borrower2wallet = await createWallet();
    const borrower2Client = await getClient(borrower2wallet);
    const [borrower2Account] = await borrower2wallet.getAccounts();

    // get the liquidity
    lppLiquidity = await borrowerClient.getBalance(
      lppContractAddress,
      lppDenom,
    );

    // send some tokens to the borrower
    // for the downpayment and fees
    await userClient.sendTokens(
      userAccount.address,
      borrower2Account.address,
      [{ denom: lppDenom, amount: borrowerAmount }],
      DEFAULT_FEE,
    );

    const quoteMsg = {
      quote: {
        downpayment: { denom: lppDenom, amount: (+downpayment / 2).toString() },
      },
    };

    const quote = await borrower2Client.queryContractSmart(
      leaserContractAddress,
      quoteMsg,
    );

    expect(quote.borrow).toBeDefined();
    console.log('quote lease 1:');
    console.log(quote.borrow);

    if (+quote.borrow.amount * 2 > +lppLiquidity.amount) {
      // TO DO: we won`t need this in the future - maybe this will be some lender exec msg
      // Send tokens to lpp address to provide needed liquidity to open a lease
      await userClient.sendTokens(
        userAccount.address,
        lppContractAddress,
        [{ denom: lppDenom, amount: quote.borrow.amount }],
        DEFAULT_FEE,
      );
    }
    console.log(lppLiquidity.amount);

    expect(lppLiquidity.amount).not.toBe('0');

    // get borrower balance
    const borrowerBalanceBefore = await borrower2Client.getBalance(
      borrower2Account.address,
      lppDenom,
    );

    // get the liquidity before
    const lppLiquidityBefore = await borrower2Client.getBalance(
      lppContractAddress,
      lppDenom,
    );
    console.log(lppLiquidityBefore);
    const openLeaseMsg = {
      open_lease: { currency: lppDenom },
    };

    const openLease = await borrower2Client.execute(
      borrower2Account.address,
      leaserContractAddress,
      openLeaseMsg,
      DEFAULT_FEE,
      undefined,
      [{ denom: lppDenom, amount: (+downpayment / 2).toString() }],
    );
    console.log(openLease);

    await sleep(4000);

    const quote3 = await borrower2Client.queryContractSmart(
      leaserContractAddress,
      quoteMsg,
    );

    expect(quote3.borrow).toBeDefined();
    console.log('quote lease 2:');
    console.log(quote3.borrow);

    const openLease2 = await borrower2Client.execute(
      borrower2Account.address,
      leaserContractAddress,
      openLeaseMsg,
      DEFAULT_FEE,
      undefined,
      [{ denom: lppDenom, amount: (+downpayment / 2).toString() }],
    );
    console.log(openLease2);

    const borrowerBalanceAfter = await borrower2Client.getBalance(
      borrower2Account.address,
      lppDenom,
    );

    // get the liquidity after
    const lppLiquidityAfter = await borrower2Client.getBalance(
      lppContractAddress,
      lppDenom,
    );

    console.log(lppLiquidityAfter);

    expect(BigInt(borrowerBalanceAfter.amount)).toBe(
      BigInt(borrowerBalanceBefore.amount) -
        BigInt(downpayment) -
        BigInt(DEFAULT_FEE.amount[0].amount) * BigInt(2),
    );

    expect(BigInt(lppLiquidityAfter.amount)).toBe(
      BigInt(lppLiquidityBefore.amount) -
        BigInt(quote.borrow.amount) * BigInt(2),
    );
  });

  //TO DO: open 2 leases from different borowers

  test('the borrower tries to open lease with unsuported lpp currency - should produce an error', async () => {
    // get borrower balance
    const borrowerBalanceBefore = await borrowerClient.getBalance(
      borrowerAccount.address,
      lppDenom,
    );

    console.log('aaaaaaa');
    console.log(borrowerBalanceBefore);

    const openLeaseMsg = {
      open_lease: { currency: 'not-existend' },
    };

    const openLease = () =>
      borrowerClient.execute(
        borrowerAccount.address,
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
    const borrowerBalanceAfter = await borrowerClient.getBalance(
      borrowerAccount.address,
      lppDenom,
    );

    console.log('bbbbbb');
    console.log(borrowerBalanceAfter);
  });

  test('the borrower tries to open a lease with 0 down payment - should produce an error', async () => {
    const openLeaseMsg = {
      open_lease: { currency: lppDenom },
    };

    const openLease = () =>
      borrowerClient.execute(
        borrowerAccount.address,
        leaserContractAddress,
        openLeaseMsg,
        DEFAULT_FEE,
        undefined,
        [{ denom: lppDenom, amount: '0' }],
      );

    await expect(openLease).rejects.toThrow(/^.*invalid coins.*/);
  });

  test('the borrower tries to open a lease with more down payment amount than he owns - should produce an error', async () => {
    const borrowerBalance = await borrowerClient.getBalance(
      borrowerAccount.address,
      lppDenom,
    );

    const openLeaseMsg = {
      open_lease: { currency: lppDenom },
    };

    const openLease = () =>
      borrowerClient.execute(
        borrowerAccount.address,
        leaserContractAddress,
        openLeaseMsg,
        DEFAULT_FEE,
        undefined,
        [{ denom: lppDenom, amount: borrowerBalance.amount }],
      );

    await expect(openLease).rejects.toThrow(/^.*insufficient fund.*/);
  });
});
