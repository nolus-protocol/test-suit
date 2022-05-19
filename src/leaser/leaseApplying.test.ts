import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import {
  getClient,
  createWallet,
  getUser1Client,
  getUser1Wallet,
} from '../util/clients';
import { AccountData, Coin } from '@cosmjs/amino';
import { DEFAULT_FEE, NATIVE_TOKEN_DENOM } from '../util/utils';

describe('Leaser contract tests - Lease application', () => {
  let borrowerAccount: AccountData;
  let borrowerClient: SigningCosmWasmClient;
  let userClient: SigningCosmWasmClient;
  let userAccount: AccountData;
  let lppLiquidity: Coin;
  let lppDenom: string;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;

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

    if (lppLiquidity.amount === '0') {
      // TO DO: we won`t need this in the future
      // Send tokens to lpp address to provide liquidity
      await userClient.sendTokens(
        userAccount.address,
        lppContractAddress,
        [{ denom: 'unolus', amount: '100000' }],
        DEFAULT_FEE,
      );
    }
    console.log(lppLiquidity.amount);

    expect(lppLiquidity.amount).not.toBe('0');
  });

  test('the borrower should be able to get information depending on the down payment', async () => {
    const borrowerBalanceBefore = await borrowerClient.getBalance(
      borrowerAccount.address,
      NATIVE_TOKEN_DENOM,
    );

    const quoteMsg = {
      quote: {
        downpayment: { denom: lppDenom, amount: '100' },
      },
    };
    const quote = await borrowerClient.queryContractSmart(
      leaserContractAddress,
      quoteMsg,
    );

    const borrowerBalanceAfter = await borrowerClient.getBalance(
      borrowerAccount.address,
      NATIVE_TOKEN_DENOM,
    );

    expect(quote.total).toBeDefined();
    expect(borrowerBalanceAfter.amount).toBe(borrowerBalanceBefore.amount);
  });

  test('the borrower tries to apply for a lease with 0 tokens as a down payment - should produce an error', async () => {
    const quoteMsg = {
      quote: {
        downpayment: { denom: lppDenom, amount: '0' },
      },
    };
    const quoteQueryResult = () =>
      borrowerClient.queryContractSmart(leaserContractAddress, quoteMsg);
    await expect(quoteQueryResult).rejects.toThrow(
      /^.*cannot open lease with zero downpayment.*/,
    );
  });

  test('the borrower tries to apply for a lease with tokens more than the liquidity in lpp - should be rejected with an information message', async () => {
    const quoteMsg = {
      quote: {
        downpayment: {
          denom: lppDenom,
          amount: (+lppLiquidity.amount + 1).toString(),
        }, // more than the liquidity by 1
      },
    };
    const quoteQueryResult = () =>
      borrowerClient.queryContractSmart(leaserContractAddress, quoteMsg);
    await expect(quoteQueryResult).rejects.toThrow(/^.*NoLiquidity.*/);
  });

  test('the borrower tries to apply for a lease with unsupported lpp denom as a down payment denom - should produce an error', async () => {
    const quoteMsg = {
      quote: {
        downpayment: { denom: 'A', amount: '100' },
      },
    };
    const quoteQueryResult = () =>
      borrowerClient.queryContractSmart(leaserContractAddress, quoteMsg);
    await expect(quoteQueryResult).rejects.toThrow(/^.*invalid request.*/);
  });
});
