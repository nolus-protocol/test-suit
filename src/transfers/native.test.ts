import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { AccountData } from '@cosmjs/proto-signing';
import {
  assertIsDeliverTxSuccess,
  Coin,
  DeliverTxResponse,
  isDeliverTxFailure,
} from '@cosmjs/stargate';
import {
  getUser1Wallet,
  getUser2Wallet,
  getUser3Wallet,
  getUser1Client,
  getUser2Client,
} from '../util/clients';
import { DEFAULT_FEE } from '../util/utils';
import { ChainConstants } from '@nolus/nolusjs/build/constants';

describe('Native transfer', () => {
  let user1Client: SigningCosmWasmClient;
  let user1Account: AccountData;
  let NATIVE_TOKEN_DENOM: string;

  beforeAll(async () => {
    NATIVE_TOKEN_DENOM = ChainConstants.COIN_MINIMAL_DENOM;
    user1Client = await getUser1Client();
    [user1Account] = await (await getUser1Wallet()).getAccounts();
  });

  test('account should have some balance', async () => {
    const balance: Coin = await user1Client.getBalance(
      user1Account.address,
      NATIVE_TOKEN_DENOM,
    );

    expect(BigInt(balance.amount) > 0).toBeTruthy();
  });

  test('users should be able to transfer and receive native tokens', async () => {
    const user2Client: SigningCosmWasmClient = await getUser2Client();
    const [user2Account] = await (await getUser2Wallet()).getAccounts();
    const [user3Account] = await (await getUser3Wallet()).getAccounts();
    const transfer1 = {
      denom: NATIVE_TOKEN_DENOM,
      amount: '1234',
    };
    const transfer2 = {
      denom: NATIVE_TOKEN_DENOM,
      amount: '1000',
    };

    // user1 -> user2
    const previousUser1Balance: Coin = await user1Client.getBalance(
      user1Account.address,
      NATIVE_TOKEN_DENOM,
    );
    let previousUser2Balance: Coin = await user1Client.getBalance(
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
    const nextUser1Balance: Coin = await user1Client.getBalance(
      user1Account.address,
      NATIVE_TOKEN_DENOM,
    );
    let nextUser2Balance: Coin = await user1Client.getBalance(
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
    previousUser2Balance = await user1Client.getBalance(
      user2Account.address,
      NATIVE_TOKEN_DENOM,
    );
    const previousUser3Balance: Coin = await user1Client.getBalance(
      user3Account.address,
      NATIVE_TOKEN_DENOM,
    );

    const broadcastTxResponse3: DeliverTxResponse =
      await user2Client.sendTokens(
        user2Account.address,
        user3Account.address,
        [transfer2],
        DEFAULT_FEE,
      );
    assertIsDeliverTxSuccess(broadcastTxResponse3);
    nextUser2Balance = await user1Client.getBalance(
      user2Account.address,
      NATIVE_TOKEN_DENOM,
    );
    const nextUser3Balance: Coin = await user1Client.getBalance(
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
  });

  test('user tries to send 0 tokens - should produce an error', async () => {
    const [user2Account] = await (await getUser2Wallet()).getAccounts();

    const transfer = {
      denom: NATIVE_TOKEN_DENOM,
      amount: '0',
    };
    const previousUser1Balance: Coin = await user1Client.getBalance(
      user1Account.address,
      NATIVE_TOKEN_DENOM,
    );
    const previousUser2Balance: Coin = await user1Client.getBalance(
      user2Account.address,
      NATIVE_TOKEN_DENOM,
    );

    const broadcastTx = () =>
      user1Client.sendTokens(
        user1Account.address,
        user2Account.address,
        [transfer],
        DEFAULT_FEE,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*0unolus: invalid coins.*/);

    const nextUser1Balance: Coin = await user1Client.getBalance(
      user1Account.address,
      NATIVE_TOKEN_DENOM,
    );
    const nextUser2Balance: Coin = await user1Client.getBalance(
      user2Account.address,
      NATIVE_TOKEN_DENOM,
    );

    expect(BigInt(nextUser1Balance.amount)).toBe(
      BigInt(previousUser1Balance.amount),
    );
    expect(BigInt(nextUser2Balance.amount)).toBe(
      BigInt(previousUser2Balance.amount),
    );
  });

  test('user tries to send the entire amount tokens he owns - should produce an error message', async () => {
    const [user2Account] = await (await getUser2Wallet()).getAccounts();

    const previousUser1Balance: Coin = await user1Client.getBalance(
      user1Account.address,
      NATIVE_TOKEN_DENOM,
    );
    const transfer = {
      denom: NATIVE_TOKEN_DENOM,
      amount: previousUser1Balance.amount,
    };
    const previousUser2Balance: Coin = await user1Client.getBalance(
      user2Account.address,
      NATIVE_TOKEN_DENOM,
    );

    const broadcastTxResponse: DeliverTxResponse = await user1Client.sendTokens(
      user1Account.address,
      user2Account.address,
      [transfer],
      DEFAULT_FEE,
    );

    expect(isDeliverTxFailure(broadcastTxResponse)).toBeTruthy();
    expect(broadcastTxResponse.rawLog).toMatch(/^.*insufficient funds.*/);

    const nextUser1Balance: Coin = await user1Client.getBalance(
      user1Account.address,
      NATIVE_TOKEN_DENOM,
    );
    const nextUser2Balance: Coin = await user1Client.getBalance(
      user2Account.address,
      NATIVE_TOKEN_DENOM,
    );

    expect(BigInt(nextUser1Balance.amount)).toBe(
      BigInt(previousUser1Balance.amount) -
        BigInt(DEFAULT_FEE.amount[0].amount),
    );
    expect(BigInt(nextUser2Balance.amount)).toBe(
      BigInt(previousUser2Balance.amount),
    );
  });

  test('user should not be able to send tokens to an incompatible nolus wallet address', async () => {
    const WRONG_WALLET_ADDRESS = 'wasm1gzkmn2lfm56m0q0l4rmjamq7rlwpfjrp7k78xw'; // wasm1 -> nolus1

    const previousUser1Balance: Coin = await user1Client.getBalance(
      user1Account.address,
      NATIVE_TOKEN_DENOM,
    );
    const transfer = {
      denom: NATIVE_TOKEN_DENOM,
      amount: '100',
    };

    const broadcastTx = () =>
      user1Client.sendTokens(
        user1Account.address,
        WRONG_WALLET_ADDRESS,
        [transfer],
        DEFAULT_FEE,
      );
    await expect(broadcastTx).rejects.toThrow(/^.*invalid address.*/);

    const nextUser1Balance: Coin = await user1Client.getBalance(
      user1Account.address,
      NATIVE_TOKEN_DENOM,
    );

    expect(BigInt(nextUser1Balance.amount)).toBe(
      BigInt(previousUser1Balance.amount),
    );
  });
});
