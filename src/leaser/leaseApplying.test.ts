import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import { Coin } from '@cosmjs/amino';
import { DEFAULT_FEE, sleep } from '../util/utils';
import { NolusClient, NolusWallet } from '@nolus/nolusjs';

describe('Leaser contract tests - Apply for a lease', () => {
  let user1Wallet: NolusWallet;
  let borrowerWallet: NolusWallet;
  let lppLiquidity: Coin;
  let lppDenom: string;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;

  const downpayment = '100';

  beforeAll(async () => {
    //await sleep(50000);
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    borrowerWallet = await createWallet();

    // TO DO: We will have a message about that soon
    lppDenom = 'unolus';

    // get the liquidity
    lppLiquidity = await user1Wallet.getBalance(lppContractAddress, lppDenom);

    const quoteMsg = {
      quote: {
        downpayment: { denom: lppDenom, amount: downpayment },
      },
    };
    const quote = await user1Wallet.queryContractSmart(
      leaserContractAddress,
      quoteMsg,
    );

    if (+quote.borrow.amount > +lppLiquidity.amount) {
      // TO DO: we won`t need this in the future
      // Send tokens to lpp address to provide liquidity
      await user1Wallet.sendTokens(
        user1Wallet.address as string,
        lppContractAddress,
        [{ denom: lppDenom, amount: quote.borrow.amount }],
        DEFAULT_FEE,
      );
    }
    console.log(lppLiquidity.amount);

    expect(lppLiquidity.amount).not.toBe('0');
  });

  test('the borrower should be able to get information depending on the down payment', async () => {
    const borrowerBalanceBefore = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
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

    const borrowerBalanceAfter = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    expect(quote.total).toBeDefined();
    expect(quote.borrow).toBeDefined();
    expect(quote.annual_interest_rate).toBeDefined();
    expect(borrowerBalanceAfter.amount).toBe(borrowerBalanceBefore.amount);
  });

  test('the borrower tries to apply for a lease with 0 tokens as a down payment - should produce an error', async () => {
    const quoteMsg = {
      quote: {
        downpayment: { denom: lppDenom, amount: '0' },
      },
    };
    const quoteQueryResult = () =>
      borrowerWallet.queryContractSmart(leaserContractAddress, quoteMsg);
    await expect(quoteQueryResult).rejects.toThrow(
      /^.*cannot open lease with zero downpayment.*/,
    );
  });

  test('the borrower tries to apply for a loan with tokens more than the liquidity in lpp - should be rejected with an information message', async () => {
    // get the liquidity
    lppLiquidity = await borrowerWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    const quoteMsg = {
      quote: {
        downpayment: {
          denom: lppDenom,
          amount: (+lppLiquidity.amount + 1).toString(),
        }, // more than the liquidity by 1
      },
    };
    const quoteQueryResult = () =>
      borrowerWallet.queryContractSmart(leaserContractAddress, quoteMsg);
    await expect(quoteQueryResult).rejects.toThrow(/^.*NoLiquidity.*/);
  });

  test('the borrower tries to apply for a lease with unsupported lpp denom as a down payment denom - should produce an error', async () => {
    const quoteMsg = {
      quote: {
        downpayment: { denom: 'A', amount: '100' },
      },
    };
    const quoteQueryResult = () =>
      borrowerWallet.queryContractSmart(leaserContractAddress, quoteMsg);
    await expect(quoteQueryResult).rejects.toThrow(/^.*invalid request.*/);
  });
});
