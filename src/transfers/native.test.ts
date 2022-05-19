import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { AccountData } from '@cosmjs/proto-signing';
import {
  assertIsDeliverTxSuccess,
  Coin,
  DeliverTxResponse,
  isDeliverTxFailure,
} from '@cosmjs/stargate';
import { sendInitFeeTokens } from '../util/transfer';
import {
  getUser1Wallet,
  getUser2Wallet,
  getUser3Wallet,
  getUser1Client,
  getUser2Client,
  getUser3Client,
} from '../util/clients';
import { DEFAULT_FEE, NATIVE_TOKEN_DENOM } from '../util/utils';

describe('Transfers - Native transfer', () => {
  let user1Client: SigningCosmWasmClient;
  let user1Account: AccountData;
  let user2Client: SigningCosmWasmClient;
  let user2Account: AccountData;
  let user3Client: SigningCosmWasmClient;
  let user3Account: AccountData;
  let transfer1: Coin;
  let transfer2: Coin;
  let transfer3: Coin;
  const transferAmount = 10;

  beforeAll(async () => {
    user1Client = await getUser1Client();
    [user1Account] = await (await getUser1Wallet()).getAccounts();
    user2Client = await getUser2Client();
    [user2Account] = await (await getUser2Wallet()).getAccounts();
    user3Client = await getUser3Client();
    [user3Account] = await (await getUser3Wallet()).getAccounts();

    transfer1 = {
      denom: NATIVE_TOKEN_DENOM,
      amount: (transferAmount + +DEFAULT_FEE.amount[0].amount * 2).toString(),
    };
    transfer2 = {
      denom: NATIVE_TOKEN_DENOM,
      amount: (transferAmount + +DEFAULT_FEE.amount[0].amount).toString(),
    };
    transfer3 = {
      denom: NATIVE_TOKEN_DENOM,
      amount: transferAmount.toString(),
    };
  });

  test('account should have some balance', async () => {
    const balance = await user1Client.getBalance(
      user1Account.address,
      NATIVE_TOKEN_DENOM,
    );

    expect(BigInt(balance.amount) > 0).toBeTruthy();
  });

  test('users should be able to transfer and receive native tokens', async () => {
    // user1 -> user2
    const previousUser1Balance = await user1Client.getBalance(
      user1Account.address,
      NATIVE_TOKEN_DENOM,
    );
    let previousUser2Balance = await user2Client.getBalance(
      user2Account.address,
      NATIVE_TOKEN_DENOM,
    );

    const broadcastTxResponse1: DeliverTxResponse =
      await user1Client.sendTokens(
        user1Account.address,
        user2Account.address,
        [transfer1],
        DEFAULT_FEE,
      );
    assertIsDeliverTxSuccess(broadcastTxResponse1);

    const nextUser1Balance = await user1Client.getBalance(
      user1Account.address,
      NATIVE_TOKEN_DENOM,
    );
    let nextUser2Balance = await user2Client.getBalance(
      user2Account.address,
      NATIVE_TOKEN_DENOM,
    );

    expect(BigInt(nextUser1Balance.amount)).toBe(
      BigInt(previousUser1Balance.amount) -
        BigInt(transfer1.amount) -
        BigInt(DEFAULT_FEE.amount[0].amount),
    );
    expect(BigInt(nextUser2Balance.amount)).toBe(
      BigInt(previousUser2Balance.amount) + BigInt(transfer1.amount),
    );

    // user2 -> user3
    previousUser2Balance = await user2Client.getBalance(
      user2Account.address,
      NATIVE_TOKEN_DENOM,
    );
    const previousUser3Balance = await user3Client.getBalance(
      user3Account.address,
      NATIVE_TOKEN_DENOM,
    );

    const broadcastTxResponse2: DeliverTxResponse =
      await user2Client.sendTokens(
        user2Account.address,
        user3Account.address,
        [transfer2],
        DEFAULT_FEE,
      );
    assertIsDeliverTxSuccess(broadcastTxResponse2);
    nextUser2Balance = await user2Client.getBalance(
      user2Account.address,
      NATIVE_TOKEN_DENOM,
    );
    const nextUser3Balance = await user3Client.getBalance(
      user3Account.address,
      NATIVE_TOKEN_DENOM,
    );

    expect(BigInt(nextUser2Balance.amount)).toBe(
      BigInt(previousUser2Balance.amount) -
        BigInt(transfer2.amount) -
        BigInt(DEFAULT_FEE.amount[0].amount),
    );
    expect(BigInt(nextUser3Balance.amount)).toBe(
      BigInt(previousUser3Balance.amount) + BigInt(transfer2.amount),
    );

    // user 3 -> user 1 - isolate the test and finish in the initial state

    const broadcastTxResponse3: DeliverTxResponse =
      await user3Client.sendTokens(
        user3Account.address,
        user1Account.address,
        [transfer3],
        DEFAULT_FEE,
      );
    assertIsDeliverTxSuccess(broadcastTxResponse3);

    const user1Balance = await user1Client.getBalance(
      user1Account.address,
      NATIVE_TOKEN_DENOM,
    );
    const user3Balance = await user3Client.getBalance(
      user3Account.address,
      NATIVE_TOKEN_DENOM,
    );

    expect(BigInt(user1Balance.amount)).toBe(
      BigInt(previousUser1Balance.amount) -
        BigInt(+DEFAULT_FEE.amount[0].amount * 3), //3 -> transfer1 -> amount=2*fee.amount; fee=1*fee.amount
    );
    expect(BigInt(user3Balance.amount)).toBe(
      BigInt(previousUser3Balance.amount),
    );
  });

  test('user tries to send 0 tokens - should produce an error', async () => {
    const transfer = {
      denom: NATIVE_TOKEN_DENOM,
      amount: '0',
    };
    const previousUser2Balance = await user2Client.getBalance(
      user2Account.address,
      NATIVE_TOKEN_DENOM,
    );
    const previousUser3Balance = await user1Client.getBalance(
      user3Account.address,
      NATIVE_TOKEN_DENOM,
    );

    const broadcastTx = () =>
      user2Client.sendTokens(
        user2Account.address,
        user3Account.address,
        [transfer],
        DEFAULT_FEE,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*0unolus: invalid coins.*/);

    const nextUser2Balance = await user2Client.getBalance(
      user2Account.address,
      NATIVE_TOKEN_DENOM,
    );
    const nextUser3Balance = await user3Client.getBalance(
      user3Account.address,
      NATIVE_TOKEN_DENOM,
    );

    expect(BigInt(nextUser2Balance.amount)).toBe(
      BigInt(previousUser2Balance.amount),
    );
    expect(BigInt(nextUser3Balance.amount)).toBe(
      BigInt(previousUser3Balance.amount),
    );
  });

  test('user tries to send the entire amount tokens he owns - should produce an error message', async () => {
    // send some tokens
    await sendInitFeeTokens(
      user1Client,
      user1Account.address,
      user2Account.address,
    );

    const previousUser2Balance = await user2Client.getBalance(
      user2Account.address,
      NATIVE_TOKEN_DENOM,
    );
    const transfer = {
      denom: NATIVE_TOKEN_DENOM,
      amount: previousUser2Balance.amount,
    };
    const previousUser3Balance = await user3Client.getBalance(
      user3Account.address,
      NATIVE_TOKEN_DENOM,
    );

    const broadcastTxResponse: DeliverTxResponse = await user2Client.sendTokens(
      user2Account.address,
      user3Account.address,
      [transfer],
      DEFAULT_FEE,
    );

    expect(isDeliverTxFailure(broadcastTxResponse)).toBeTruthy();
    expect(broadcastTxResponse.rawLog).toMatch(/^.*insufficient funds.*/);

    const nextUser3Balance = await user3Client.getBalance(
      user3Account.address,
      NATIVE_TOKEN_DENOM,
    );
    const nextUser2Balance = await user2Client.getBalance(
      user2Account.address,
      NATIVE_TOKEN_DENOM,
    );

    expect(BigInt(nextUser2Balance.amount)).toBe(
      BigInt(previousUser2Balance.amount) -
        BigInt(DEFAULT_FEE.amount[0].amount),
    );
    expect(BigInt(nextUser3Balance.amount)).toBe(
      BigInt(previousUser3Balance.amount),
    );
  });

  test('user should not be able to send tokens to an incompatible nolus wallet address', async () => {
    const WRONG_WALLET_ADDRESS = 'wasm1gzkmn2lfm56m0q0l4rmjamq7rlwpfjrp7k78xw'; // wasm1 -> nolus1

    const previousUser2Balance = await user2Client.getBalance(
      user2Account.address,
      NATIVE_TOKEN_DENOM,
    );

    const broadcastTx = () =>
      user2Client.sendTokens(
        user2Account.address,
        WRONG_WALLET_ADDRESS,
        [transfer2],
        DEFAULT_FEE,
      );
    await expect(broadcastTx).rejects.toThrow(/^.*invalid address.*/);

    const nextUser2Balance = await user2Client.getBalance(
      user2Account.address,
      NATIVE_TOKEN_DENOM,
    );

    expect(BigInt(nextUser2Balance.amount)).toBe(
      BigInt(previousUser2Balance.amount),
    );
  });
});
