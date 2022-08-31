import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import { Coin } from '@cosmjs/amino';
import { customFees } from '../util/utils';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';

describe('Leaser contract tests - Apply for a lease', () => {
  let user1Wallet: NolusWallet;
  let borrowerWallet: NolusWallet;
  let lppLiquidity: Coin;
  let lppDenom: string;
  let leaserInstance: NolusContracts.Leaser;
  let lppInstance: NolusContracts.Lpp;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;

  const downpayment = '100';

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    borrowerWallet = await createWallet();

    const cosm = await NolusClient.getInstance().getCosmWasmClient();
    leaserInstance = new NolusContracts.Leaser(cosm);
    lppInstance = new NolusContracts.Lpp(cosm);

    const lppConfig = await lppInstance.getLppConfig(lppContractAddress);
    lppDenom = lppConfig.lpn_symbol;

    // send init tokens to lpp address to provide liquidity, otherwise cant send query
    await lppInstance.lenderDeposit(
      lppContractAddress,
      user1Wallet,
      customFees.exec,
      [{ denom: lppDenom, amount: '10000' }],
    );

    // get the liquidity
    lppLiquidity = await user1Wallet.getBalance(lppContractAddress, lppDenom);

    const quote = await leaserInstance.makeLeaseApply(
      leaserContractAddress,
      downpayment,
      lppDenom,
    );

    if (+quote.borrow.amount > +lppLiquidity.amount) {
      await user1Wallet.transferAmount(
        lppContractAddress,
        [{ denom: lppDenom, amount: quote.borrow.amount }],
        customFees.transfer,
      );
    }

    expect(lppLiquidity.amount).not.toBe('0');
  });

  test('the borrower should be able to get information depending on the down payment', async () => {
    const borrowerBalanceBefore = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    const quote = await leaserInstance.makeLeaseApply(
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
    expect(quote.annual_interest_rate).toBeDefined();
    expect(borrowerBalanceAfter.amount).toBe(borrowerBalanceBefore.amount);
  });

  test('the borrower tries to apply for a lease with 0 tokens as a down payment - should produce an error', async () => {
    const quoteQueryResult = () =>
      leaserInstance.makeLeaseApply(leaserContractAddress, '0', lppDenom);
    await expect(quoteQueryResult).rejects.toThrow(
      /^.*Cannot open lease with zero downpayment.*/,
    );
  });

  test('the borrower tries to apply for a loan with tokens more than the liquidity in lpp - should be rejected with an information message', async () => {
    // get the liquidity
    lppLiquidity = await borrowerWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    const quoteQueryResult = () =>
      leaserInstance.makeLeaseApply(
        leaserContractAddress,
        (+lppLiquidity.amount + 1).toString(),
        lppDenom,
      );
    await expect(quoteQueryResult).rejects.toThrow(/^.*NoLiquidity.*/);
  });

  test('the borrower tries to apply for a lease with unsupported lpp denom as a down payment denom - should produce an error', async () => {
    const quoteQueryResult = () =>
      leaserInstance.makeLeaseApply(leaserContractAddress, '100', 'A');
    await expect(quoteQueryResult).rejects.toThrow(/^.*invalid request.*/);
  });
});
