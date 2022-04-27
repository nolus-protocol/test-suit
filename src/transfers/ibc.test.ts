import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { AccountData } from '@cosmjs/proto-signing';
import {
  assertIsDeliverTxSuccess,
  Coin,
  DeliverTxResponse,
} from '@cosmjs/stargate';
import {
  getUser1Client,
  getUser1Wallet,
  getUser2Wallet,
  getUser2Client,
} from '../util/clients';
import { DEFAULT_FEE } from '../util/utils';

describe('IBC transfer', () => {
  const ibcToken = process.env.IBC_TOKEN as string;
  let user1Client: SigningCosmWasmClient;
  let user1Account: AccountData;
  let user2Client: SigningCosmWasmClient;
  let user2Account: AccountData;

  beforeAll(async () => {
    user1Client = await getUser1Client();
    [user1Account] = await (await getUser1Wallet()).getAccounts();
    user2Client = await getUser2Client();
    [user2Account] = await (await getUser2Wallet()).getAccounts();
  });

  test('user should have some balance and ibc token should be defined', async () => {
    const balance: Coin = await user1Client.getBalance(
      user1Account.address,
      ibcToken,
    );

    expect(ibcToken).toBeDefined();
    expect(ibcToken.length > 0).toBeTruthy();
    expect(BigInt(balance.amount) > 0).toBeTruthy();
  });

  test('user should be able to transfer and receive ibc tokens including sending the entire amount tokens he owns', async () => {
    const amount_to_transfer = '100';

    let previousUser1Balance = await user1Client.getBalance(
      user1Account.address,
      ibcToken,
    );
    let previousUser2Balance = await user2Client.getBalance(
      user2Account.address,
      ibcToken,
    );

    const transfer = {
      denom: ibcToken,
      amount: amount_to_transfer,
    };

    const sendTokensResponse: DeliverTxResponse = await user1Client.sendTokens(
      user1Account.address,
      user2Account.address,
      [transfer],
      DEFAULT_FEE,
    );
    assertIsDeliverTxSuccess(sendTokensResponse);

    let nextUser1Balance = await user1Client.getBalance(
      user1Account.address,
      ibcToken,
    );

    let nextUser2Balance = await user2Client.getBalance(
      user2Account.address,
      ibcToken,
    );

    expect(BigInt(nextUser1Balance.amount)).toBe(
      BigInt(previousUser1Balance.amount) - BigInt(transfer.amount),
    );
    expect(BigInt(nextUser2Balance.amount)).toBe(
      BigInt(previousUser2Balance.amount) + BigInt(transfer.amount),
    );

    // send entire amount
    previousUser1Balance = await user1Client.getBalance(
      user1Account.address,
      ibcToken,
    );
    previousUser2Balance = await user2Client.getBalance(
      user2Account.address,
      ibcToken,
    );

    // send unolus for fee
    user1Client.sendTokens(
      user1Account.address,
      user2Account.address,
      DEFAULT_FEE.amount,
      DEFAULT_FEE,
    );

    const sendTokensResponse2: DeliverTxResponse = await user2Client.sendTokens(
      user2Account.address,
      user1Account.address,
      [transfer],
      DEFAULT_FEE,
    );
    assertIsDeliverTxSuccess(sendTokensResponse2);

    nextUser1Balance = await user1Client.getBalance(
      user1Account.address,
      ibcToken,
    );

    nextUser2Balance = await user2Client.getBalance(
      user2Account.address,
      ibcToken,
    );

    expect(BigInt(nextUser2Balance.amount)).toBe(
      BigInt(previousUser2Balance.amount) - BigInt(transfer.amount),
    );
    expect(BigInt(nextUser1Balance.amount)).toBe(
      BigInt(previousUser1Balance.amount) + BigInt(transfer.amount),
    );
  });

  test('user tries to send 0 ibc tokens - should produce an error', async () => {
    const transfer = {
      denom: ibcToken,
      amount: '0',
    };

    const previousUser1Balance: Coin = await user1Client.getBalance(
      user1Account.address,
      ibcToken,
    );
    const previousUser2Balance: Coin = await user1Client.getBalance(
      user2Account.address,
      ibcToken,
    );

    const broadcastTx = () =>
      user1Client.sendTokens(
        user1Account.address,
        user2Account.address,
        [transfer],
        DEFAULT_FEE,
      );
    await expect(broadcastTx).rejects.toThrow(/^.*invalid coins.*/);

    const nextUser1Balance: Coin = await user1Client.getBalance(
      user1Account.address,
      ibcToken,
    );
    const nextUser2Balance: Coin = await user1Client.getBalance(
      user2Account.address,
      ibcToken,
    );

    expect(BigInt(nextUser1Balance.amount)).toBe(
      BigInt(previousUser1Balance.amount),
    );
    expect(BigInt(nextUser2Balance.amount)).toBe(
      BigInt(previousUser2Balance.amount),
    );
  });

  test('user should not be able to send ibc tokens to an incompatible nolus wallet address', async () => {
    const WRONG_WALLET_ADDRESS = 'wasm1gzkmn2lfm56m0q0l4rmjamq7rlwpfjrp7k78xw'; // wasm1 -> nolus1

    const previousUser1Balance: Coin = await user1Client.getBalance(
      user1Account.address,
      ibcToken,
    );
    const transfer = {
      denom: ibcToken,
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
      ibcToken,
    );

    expect(BigInt(nextUser1Balance.amount)).toBe(
      BigInt(previousUser1Balance.amount),
    );
  });
});
