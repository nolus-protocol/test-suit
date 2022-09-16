import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import { Coin } from '@cosmjs/amino';
import { customFees } from '../util/utils';
import {
  NolusClient,
  NolusWallet,
  NolusContracts,
  ChainConstants,
} from '@nolus/nolusjs';

describe('Leaser contract tests - Apply for a lease', () => {
  let feederWallet: NolusWallet;
  let borrowerWallet: NolusWallet;
  let lppLiquidity: Coin;
  let lppDenom: string;
  let leaserInstance: NolusContracts.Leaser;
  let lppInstance: NolusContracts.Lpp;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;
  let cosm: any;

  const downpayment = '10';
  const minimalAmountInLpp = '100000';

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    cosm = await NolusClient.getInstance().getCosmWasmClient();

    feederWallet = await getUser1Wallet();
    borrowerWallet = await createWallet();

    leaserInstance = new NolusContracts.Leaser(cosm, leaserContractAddress);
    lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);

    const lppConfig = await lppInstance.getLppConfig();
    lppDenom = lppConfig.lpn_symbol;

    // provide liquidity
    await lppInstance.deposit(feederWallet, customFees.exec, [
      { denom: lppDenom, amount: minimalAmountInLpp },
    ]);

    // get the liquidity
    lppLiquidity = await cosm.getBalance(lppContractAddress, lppDenom);

    const quote = await leaserInstance.leaseQuote(downpayment, lppDenom);

    if (BigInt(quote.borrow.amount) > BigInt(lppLiquidity.amount)) {
      await feederWallet.transferAmount(
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

    const quote = await leaserInstance.leaseQuote(downpayment, lppDenom);

    const borrowerBalanceAfter = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    expect(quote.total).toBeDefined();
    expect(quote.borrow).toBeDefined();
    expect(quote.annual_interest_rate).toBeDefined();

    //TO DO calc
    // const toPercent = 10;

    // baseInterestRate = lppConfig.base_interest_rate / toPercent; //%
    // utilizationOptimal = lppConfig.utilization_optimal / toPercent; //%
    // addonOptimalInterestRate =
    //   lppConfig.addon_optimal_interest_rate / toPercent; //%

    // const lppInformation = await lppInstance.getLppBalance(lppContractAddress);

    // const totalPrincipalDueByNow = lppInformation.total_principal_due;
    // const totalInterestDueByNow = lppInformation.total_interest_due;
    // const lppLiquidity = lppInformation.balance;

    // expect(lppLiquidity.amount).not.toBe('0');
    // expect(lppBalance.amount).toBe(lppLiquidity.amount);

    // const utilization = calcUtilization(
    //   +totalPrincipalDueByNow.amount,
    //   +quote.borrow.amount,
    //   +totalInterestDueByNow.amount,
    //   +lppLiquidity.amount,
    // );

    // let leaserConfig = await leaserInstance.getLeaserConfig(
    //   leaserContractAddress,
    // );

    // expect(
    //   calcQuoteAnnualInterestRate(
    //     utilization,
    //     utilizationOptimal,
    //     baseInterestRate,
    //     addonOptimalInterestRate,
    //   ),
    // ).toBe(quote.annual_interest_rate);

    expect(borrowerBalanceAfter.amount).toBe(borrowerBalanceBefore.amount);
  });

  test('the borrower tries to apply for a lease with 0 tokens as a down payment - should produce an error', async () => {
    const quoteQueryResult = () => leaserInstance.leaseQuote('0', lppDenom);
    await expect(quoteQueryResult).rejects.toThrow(
      /^.*Cannot open lease with zero downpayment.*/,
    );
  });

  test('the borrower tries to apply for a loan with tokens more than the liquidity in lpp - should be rejected with an information message', async () => {
    // get the liquidity
    lppLiquidity = await cosm.getBalance(lppContractAddress, lppDenom);

    const quoteQueryResult = () =>
      leaserInstance.leaseQuote(
        (BigInt(lppLiquidity.amount) + BigInt(1)).toString(),
        lppDenom,
      );
    await expect(quoteQueryResult).rejects.toThrow(/^.*NoLiquidity.*/);
  });

  test('the borrower tries to apply for a lease with unsupported lpp denom as a down payment denom - should produce an error', async () => {
    const invalidLppDenom = ChainConstants.COIN_MINIMAL_DENOM;

    const quoteQueryResult = () =>
      leaserInstance.leaseQuote('100', invalidLppDenom);
    await expect(quoteQueryResult).rejects.toThrow(/^.*invalid request.*/);
  });
});
