import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import { Coin } from '@cosmjs/amino';
import { DEFAULT_FEE, sleep } from '../util/utils';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
// import { Lease } from '@nolus/nolusjs/build/contracts';

describe('Leaser contract tests - Apply for a lease', () => {
  let user1Wallet: NolusWallet;
  let borrowerWallet: NolusWallet;
  let lppLiquidity: Coin;
  let lppDenom: string;
  let leaseInstance: NolusContracts.Lease;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;

  const downpayment = '100';

  beforeAll(async () => {
    // if the openLease tests start first, the current tests will fail due to a problem with the qoute request, so sleep()
    await sleep(60000);
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    borrowerWallet = await createWallet();
    leaseInstance = new NolusContracts.Lease();

    // TO DO: We will have a message about that soon
    lppDenom = process.env.STABLE_DENOM as string;

    // get the liquidity
    lppLiquidity = await user1Wallet.getBalance(lppContractAddress, lppDenom);

    const quote = await leaseInstance.makeLeaseApply(
      leaserContractAddress,
      downpayment,
      lppDenom,
    );

    if (+quote.borrow.amount > +lppLiquidity.amount) {
      // TO DO: we won`t need this in the future
      // Send tokens to lpp address to provide liquidity
      await user1Wallet.transferAmount(
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

    const quote = await leaseInstance.makeLeaseApply(
      leaserContractAddress,
      downpayment,
      lppDenom,
    );

    const borrowerBalanceAfter = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    expect(quote.total).toBeDefined();
    expect(quote.borrow).toBeDefined();
    expect(quote.annualInterestRate).toBeDefined();
    expect(borrowerBalanceAfter.amount).toBe(borrowerBalanceBefore.amount);
  });

  test('the borrower tries to apply for a lease with 0 tokens as a down payment - should produce an error', async () => {
    const quoteQueryResult = () =>
      leaseInstance.makeLeaseApply(leaserContractAddress, '0', lppDenom);
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

    const quoteQueryResult = () =>
      leaseInstance.makeLeaseApply(
        leaserContractAddress,
        (+lppLiquidity.amount + 1).toString(),
        lppDenom,
      );
    await expect(quoteQueryResult).rejects.toThrow(/^.*NoLiquidity.*/);
  });

  test('the borrower tries to apply for a lease with unsupported lpp denom as a down payment denom - should produce an error', async () => {
    const quoteQueryResult = () =>
      leaseInstance.makeLeaseApply(leaserContractAddress, '100', 'A');
    await expect(quoteQueryResult).rejects.toThrow(/^.*invalid request.*/);
  });
});
