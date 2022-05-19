import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import {
  getUser1Client,
  getUser1Wallet,
  getClient,
  createWallet,
} from '../util/clients';
import { AccountData, Coin } from '@cosmjs/amino';
import { DEFAULT_FEE, NATIVE_TOKEN_DENOM } from '../util/utils';

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
  const borrowerAmount = '500';

  beforeAll(async () => {
    userClient = await getUser1Client();
    [userAccount] = await (await getUser1Wallet()).getAccounts();
    const borrower1wallet = await createWallet();
    borrowerClient = await getClient(borrower1wallet);
    [borrowerAccount] = await borrower1wallet.getAccounts();

    // TO DO: We will have a message about that soon
    lppDenom = 'unolus';

    // get the liquidity
    lppLiquidity = await borrowerClient.getBalance(
      lppContractAddress,
      NATIVE_TOKEN_DENOM,
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

    if (+quote.borrow.amount > +lppLiquidity.amount) {
      // TO DO: we won`t need this in the future
      // Send tokens to lpp address to provide liquidity
      await userClient.sendTokens(
        userAccount.address,
        lppContractAddress,
        [{ denom: lppDenom, amount: quote.borrow.amount }],
        DEFAULT_FEE,
      );
    }
    console.log(lppLiquidity.amount);

    expect(lppLiquidity.amount).not.toBe('0');

    // send some tokens to the borrower
    // for the downpayment and fees
    await userClient.sendTokens(
      userAccount.address,
      borrowerAccount.address,
      [{ denom: lppDenom, amount: borrowerAmount }], // if the liquidiтy is != 0, will certainly be at least 1
      DEFAULT_FEE,
    );
  });

  test('the borrower should be able to open lease', async () => {
    const quoteMsg = {
      quote: {
        downpayment: { denom: lppDenom, amount: downpayment },
      },
    };
    const quote = await borrowerClient.queryContractSmart(
      leaserContractAddress,
      quoteMsg,
    );

    expect(quote.total).toBeDefined();
    expect(quote.borrow).toBeDefined();
    expect(quote.annual_interest_rate).toBeDefined();

    // get borrower balance
    const borrowerBalanceBefore = await borrowerClient.getBalance(
      borrowerAccount.address,
      NATIVE_TOKEN_DENOM,
    );

    // get the liquidity before
    const lppLiquidityBefore = await borrowerClient.getBalance(
      lppContractAddress,
      NATIVE_TOKEN_DENOM,
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
      NATIVE_TOKEN_DENOM,
    );

    // get the liquidity after
    const lppLiquidityAfter = await borrowerClient.getBalance(
      lppContractAddress,
      NATIVE_TOKEN_DENOM,
    );

    expect(BigInt(borrowerBalanceAfter.amount)).toBe(
      BigInt(borrowerBalanceBefore.amount) -
        BigInt(downpayment) -
        BigInt(DEFAULT_FEE.amount[0].amount),
    );

    expect(BigInt(lppLiquidityAfter.amount)).toBe(
      BigInt(lppLiquidityBefore.amount) - BigInt(quote.borrow.amount),
    );
  });
});
