import {
  assertIsDeliverTxSuccess,
  Coin,
  DeliverTxResponse,
} from '@cosmjs/stargate';
import { NolusClient, NolusWallet } from '@nolus/nolusjs';
import { sendInitFeeTokens } from '../util/transfer';
import NODE_ENDPOINT, {
  getUser1Wallet,
  getUser2Wallet,
  getUser3Wallet,
} from '../util/clients';
import { DEFAULT_FEE } from '../util/utils';

describe('Transfers - IBC tokens', () => {
  const ibcToken = process.env.IBC_TOKEN as string;
  let user1Wallet: NolusWallet;
  let user2Wallet: NolusWallet;
  let user3Wallet: NolusWallet;
  let transfer: Coin;
  const transferAmount = '10';

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    user2Wallet = await getUser2Wallet();
    user3Wallet = await getUser3Wallet();

    transfer = {
      denom: ibcToken,
      amount: transferAmount,
    };
    // send some native tokens
    await sendInitFeeTokens(user1Wallet, user2Wallet.address as string);
  });

  test('user should have some balance and ibc token should be defined', async () => {
    const balance = await user1Wallet.getBalance(
      user1Wallet.address as string,
      ibcToken,
    );

    expect(ibcToken).toBeDefined();
    expect(ibcToken.length > 0).toBeTruthy();
    expect(BigInt(balance.amount) > 0).toBeTruthy();
  });

  test('user should be able to transfer and receive ibc tokens including sending the entire amount tokens he owns', async () => {
    const previousUser1Balance = await user1Wallet.getBalance(
      user1Wallet.address as string,
      ibcToken,
    );

    // send some ibc tokens
    const sendTokensResponse: DeliverTxResponse =
      await user1Wallet.transferAmount(
        user2Wallet.address as string,
        [transfer],
        DEFAULT_FEE,
        '',
      );
    assertIsDeliverTxSuccess(sendTokensResponse);

    // user2 -> user3

    const previousUser2Balance = await user2Wallet.getBalance(
      user2Wallet.address as string,
      ibcToken,
    );
    const previousUser3Balance = await user3Wallet.getBalance(
      user3Wallet.address as string,
      ibcToken,
    );
    const sendTokensResponse1: DeliverTxResponse =
      await user2Wallet.transferAmount(
        user3Wallet.address as string,
        [transfer],
        DEFAULT_FEE,
        '',
      );
    assertIsDeliverTxSuccess(sendTokensResponse1);

    const nextUser2Balance = await user2Wallet.getBalance(
      user2Wallet.address as string,
      ibcToken,
    );
    let nextUser3Balance = await user3Wallet.getBalance(
      user3Wallet.address as string,
      ibcToken,
    );

    expect(BigInt(nextUser2Balance.amount)).toBe(
      BigInt(previousUser2Balance.amount) - BigInt(transfer.amount),
    );
    expect(BigInt(nextUser3Balance.amount)).toBe(
      BigInt(previousUser3Balance.amount) + BigInt(transfer.amount),
    );

    // send entire amount
    // user 3 -> user 1 - isolate the test and finish in the initial state

    // send unolus for fee
    await sendInitFeeTokens(user1Wallet, user3Wallet.address as string);

    const sendTokensResponse2: DeliverTxResponse =
      await user3Wallet.transferAmount(
        user1Wallet.address as string,
        [transfer],
        DEFAULT_FEE,
        '',
      );
    assertIsDeliverTxSuccess(sendTokensResponse2);

    const nextUser1Balance = await user1Wallet.getBalance(
      user1Wallet.address as string,
      ibcToken,
    );

    nextUser3Balance = await user3Wallet.getBalance(
      user3Wallet.address as string,
      ibcToken,
    );

    expect(BigInt(nextUser3Balance.amount)).toBe(
      BigInt(previousUser3Balance.amount),
    );
    expect(BigInt(nextUser1Balance.amount)).toBe(
      BigInt(previousUser1Balance.amount),
    );
  });

  test('user tries to send 0 ibc tokens - should produce an error', async () => {
    const transfer = {
      denom: ibcToken,
      amount: '0',
    };

    const previousUser2Balance = await user2Wallet.getBalance(
      user2Wallet.address as string,
      ibcToken,
    );
    const previousUser3Balance = await user3Wallet.getBalance(
      user3Wallet.address as string,
      ibcToken,
    );

    const broadcastTx = () =>
      user2Wallet.transferAmount(
        user3Wallet.address as string,
        [transfer],
        DEFAULT_FEE,
        '',
      );
    await expect(broadcastTx).rejects.toThrow(/^.*invalid coins.*/);

    const nextUser2Balance = await user2Wallet.getBalance(
      user2Wallet.address as string,
      ibcToken,
    );
    const nextUser3Balance = await user1Wallet.getBalance(
      user3Wallet.address as string,
      ibcToken,
    );

    expect(BigInt(nextUser2Balance.amount)).toBe(
      BigInt(previousUser2Balance.amount),
    );
    expect(BigInt(nextUser3Balance.amount)).toBe(
      BigInt(previousUser3Balance.amount),
    );
  });

  test('user should not be able to send ibc tokens to an incompatible nolus wallet address', async () => {
    const WRONG_WALLET_ADDRESS = 'wasm1gzkmn2lfm56m0q0l4rmjamq7rlwpfjrp7k78xw'; // wasm1 -> nolus1

    const previousUser2Balance = await user2Wallet.getBalance(
      user2Wallet.address as string,
      ibcToken,
    );

    const broadcastTx = () =>
      user2Wallet.transferAmount(
        WRONG_WALLET_ADDRESS,
        [transfer],
        DEFAULT_FEE,
        '',
      );
    await expect(broadcastTx).rejects.toThrow(/^.*invalid address.*/);

    const nextUser2Balance = await user2Wallet.getBalance(
      user2Wallet.address as string,
      ibcToken,
    );

    expect(BigInt(nextUser2Balance.amount)).toBe(
      BigInt(previousUser2Balance.amount),
    );
  });
});
