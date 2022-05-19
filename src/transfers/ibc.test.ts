import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { AccountData } from '@cosmjs/proto-signing';
import {
  assertIsDeliverTxSuccess,
  Coin,
  DeliverTxResponse,
} from '@cosmjs/stargate';
import { sendInitFeeTokens } from '../util/transfer';
import {
  getUser1Client,
  getUser1Wallet,
  getUser2Wallet,
  getUser2Client,
  getUser3Client,
  getUser3Wallet,
} from '../util/clients';
import { DEFAULT_FEE } from '../util/utils';

describe('Transfers - IBC tokens', () => {
  const ibcToken = process.env.IBC_TOKEN as string;

  let user1Client: SigningCosmWasmClient;
  let user1Account: AccountData;
  let user2Client: SigningCosmWasmClient;
  let user2Account: AccountData;
  let user3Client: SigningCosmWasmClient;
  let transfer: Coin;
  let user3Account: AccountData;
  const transferAmount = '10';

  beforeAll(async () => {
    user1Client = await getUser1Client();
    [user1Account] = await (await getUser1Wallet()).getAccounts();
    user2Client = await getUser2Client();
    [user2Account] = await (await getUser2Wallet()).getAccounts();
    [user2Account] = await (await getUser2Wallet()).getAccounts();
    user3Client = await getUser3Client();
    [user3Account] = await (await getUser3Wallet()).getAccounts();

    transfer = {
      denom: ibcToken,
      amount: transferAmount,
    };
    // send some native tokens
    await sendInitFeeTokens(
      user1Client,
      user1Account.address,
      user2Account.address,
    );
  });

  test('user should have some balance and ibc token should be defined', async () => {
    const balance = await user1Client.getBalance(
      user1Account.address,
      ibcToken,
    );

    expect(ibcToken).toBeDefined();
    expect(ibcToken.length > 0).toBeTruthy();
    expect(BigInt(balance.amount) > 0).toBeTruthy();
  });

  test('user should be able to transfer and receive ibc tokens including sending the entire amount tokens he owns', async () => {
    const previousUser1Balance = await user1Client.getBalance(
      user1Account.address,
      ibcToken,
    );

    // send some ibc tokens
    const sendTokensResponse: DeliverTxResponse = await user1Client.sendTokens(
      user1Account.address,
      user2Account.address,
      [transfer],
      DEFAULT_FEE,
    );
    assertIsDeliverTxSuccess(sendTokensResponse);

    // user2 -> user3

    const previousUser2Balance = await user2Client.getBalance(
      user2Account.address,
      ibcToken,
    );
    const previousUser3Balance = await user3Client.getBalance(
      user3Account.address,
      ibcToken,
    );
    const sendTokensResponse1: DeliverTxResponse = await user2Client.sendTokens(
      user2Account.address,
      user3Account.address,
      [transfer],
      DEFAULT_FEE,
    );
    assertIsDeliverTxSuccess(sendTokensResponse1);

    const nextUser2Balance = await user2Client.getBalance(
      user2Account.address,
      ibcToken,
    );
    let nextUser3Balance = await user3Client.getBalance(
      user3Account.address,
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
    await sendInitFeeTokens(
      user1Client,
      user1Account.address,
      user3Account.address,
    );

    const sendTokensResponse2: DeliverTxResponse = await user3Client.sendTokens(
      user3Account.address,
      user1Account.address,
      [transfer],
      DEFAULT_FEE,
    );
    assertIsDeliverTxSuccess(sendTokensResponse2);

    const nextUser1Balance = await user1Client.getBalance(
      user1Account.address,
      ibcToken,
    );

    nextUser3Balance = await user3Client.getBalance(
      user3Account.address,
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

    const previousUser2Balance = await user2Client.getBalance(
      user2Account.address,
      ibcToken,
    );
    const previousUser3Balance = await user3Client.getBalance(
      user3Account.address,
      ibcToken,
    );

    const broadcastTx = () =>
      user2Client.sendTokens(
        user2Account.address,
        user3Account.address,
        [transfer],
        DEFAULT_FEE,
      );
    await expect(broadcastTx).rejects.toThrow(/^.*invalid coins.*/);

    const nextUser2Balance = await user2Client.getBalance(
      user2Account.address,
      ibcToken,
    );
    const nextUser3Balance = await user3Client.getBalance(
      user3Account.address,
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

    const previousUser2Balance = await user2Client.getBalance(
      user2Account.address,
      ibcToken,
    );

    const broadcastTx = () =>
      user2Client.sendTokens(
        user2Account.address,
        WRONG_WALLET_ADDRESS,
        [transfer],
        DEFAULT_FEE,
      );
    await expect(broadcastTx).rejects.toThrow(/^.*invalid address.*/);

    const nextUser2Balance = await user2Client.getBalance(
      user2Account.address,
      ibcToken,
    );

    expect(BigInt(nextUser2Balance.amount)).toBe(
      BigInt(previousUser2Balance.amount),
    );
  });
});
