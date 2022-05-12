import {
  createWallet,
  getClient,
  getUser1Client,
  getUser1Wallet,
} from '../util/clients';
import { AccountData, EncodeObject } from '@cosmjs/proto-signing';
import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import {
  MsgCreateVestingAccount,
  protobufPackage as vestingPackage,
} from '../util/codec/cosmos/vesting/v1beta1/tx';
import Long from 'long';
import { assertIsDeliverTxSuccess, isDeliverTxFailure } from '@cosmjs/stargate';
import { DEFAULT_FEE, NATIVE_TOKEN_DENOM, sleep } from '../util/utils';
import { Coin } from '../util/codec/cosmos/base/v1beta1/coin';
import { sendInitFeeTokens } from '../util/transfer';

describe('Continuous vesting tests', () => {
  const FULL_AMOUNT: Coin = { denom: 'unolus', amount: '10000' };
  const HALF_AMOUNT: Coin = { denom: 'unolus', amount: '5000' };
  const ENDTIME_SECONDS = 50;
  let user1Client: SigningCosmWasmClient;
  let user1Account: AccountData;
  let vestingClient: SigningCosmWasmClient;
  let vestingAccount: AccountData;

  const createVestingAccountMsg: MsgCreateVestingAccount = {
    fromAddress: '',
    toAddress: '',
    amount: [FULL_AMOUNT],
    endTime: Long.fromNumber(0),
    delayed: false,
  };
  const encodedMsg: EncodeObject = {
    typeUrl: `/${vestingPackage}.MsgCreateVestingAccount`,
    value: createVestingAccountMsg,
  };

  beforeAll(async () => {
    user1Client = await getUser1Client();
    [user1Account] = await (await getUser1Wallet()).getAccounts();
    const vestingWallet = await createWallet();
    vestingClient = await getClient(vestingWallet);
    [vestingAccount] = await vestingWallet.getAccounts();
    console.log(vestingAccount.address);

    createVestingAccountMsg.fromAddress = user1Account.address;
    createVestingAccountMsg.toAddress = vestingAccount.address;
  });

  afterEach(() => {
    createVestingAccountMsg.toAddress = vestingAccount.address;
    createVestingAccountMsg.amount = [FULL_AMOUNT];
  });

  test('creation a continuous vesting account with 0 amount - should produce an error', async () => {
    // try to create vesting account
    createVestingAccountMsg.amount = [{ denom: 'unolus', amount: '0' }];
    const broadcastTx = () =>
      user1Client.signAndBroadcast(
        user1Account.address,
        [encodedMsg],
        DEFAULT_FEE,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*0unolus: invalid coins.*/);

    // get balance
    const vestingAccountBalance = await vestingClient.getBalance(
      vestingAccount.address,
      NATIVE_TOKEN_DENOM,
    );
    console.log(vestingAccountBalance);

    expect(+vestingAccountBalance.amount).toBe(0);
  });

  test('creation a continuous vesting account with invalid "to" address - should produce an error', async () => {
    // try to create vesting account
    createVestingAccountMsg.toAddress =
      'wasm1gzkmn2lfm56m0q0l4rmjamq7rlwpfjrp7k78xw';

    const broadcastTx = () =>
      user1Client.signAndBroadcast(
        user1Account.address,
        [encodedMsg],
        DEFAULT_FEE,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*internal.*/);

    // get balance
    const vestingAccountBalance = await vestingClient.getBalance(
      vestingAccount.address,
      NATIVE_TOKEN_DENOM,
    );

    expect(+vestingAccountBalance.amount).toBe(0);
  });

  test('creation a continuous vesting account with 0 EndTime - should produce an error', async () => {
    const broadcastTx = () =>
      user1Client.signAndBroadcast(
        user1Account.address,
        [encodedMsg],
        DEFAULT_FEE,
      );

    await expect(broadcastTx).rejects.toThrow(
      /^.* invalid end time: invalid request.*/,
    );

    // get balance
    const vestingAccountBalance = await vestingClient.getBalance(
      vestingAccount.address,
      NATIVE_TOKEN_DENOM,
    );

    expect(+vestingAccountBalance.amount).toBe(0);
  });

  test('the successful scenario for creation a continuous vesting account - should work as expected', async () => {
    // create vesting account
    createVestingAccountMsg.endTime = Long.fromNumber(
      new Date().getTime() / 1000 + ENDTIME_SECONDS,
    );

    const result = await user1Client.signAndBroadcast(
      user1Account.address,
      [encodedMsg],
      DEFAULT_FEE,
    );
    expect(assertIsDeliverTxSuccess(result)).toBeUndefined();

    // get balance before
    const vestingAccountBalanceBefore = await vestingClient.getBalance(
      vestingAccount.address,
      NATIVE_TOKEN_DENOM,
    );
    console.log(vestingAccountBalanceBefore);

    expect(vestingAccountBalanceBefore.amount).toBe(FULL_AMOUNT.amount);

    // send some tokens - non-vesting coins - would be immediately transferable
    const sendInitTokensResult = await sendInitFeeTokens(
      user1Client,
      user1Account.address,
      vestingAccount.address,
    );

    expect(assertIsDeliverTxSuccess(sendInitTokensResult)).toBeUndefined();

    let sendFailTx = await vestingClient.sendTokens(
      vestingAccount.address,
      user1Account.address,
      [HALF_AMOUNT],
      DEFAULT_FEE,
    );
    expect(isDeliverTxFailure(sendFailTx)).toBeTruthy();
    expect(sendFailTx.rawLog).toMatch(
      /^.*smaller than 5000unolus: insufficient funds.*/,
    );
    await sleep((ENDTIME_SECONDS / 2) * 1000);

    // half the tokens are provided now but not all
    sendFailTx = await vestingClient.sendTokens(
      vestingAccount.address,
      user1Account.address,
      [FULL_AMOUNT],
      DEFAULT_FEE,
    );

    expect(isDeliverTxFailure(sendFailTx)).toBeTruthy();
    expect(sendFailTx.rawLog).toMatch(
      /^.*smaller than 10000unolus: insufficient funds.*/,
    );

    assertIsDeliverTxSuccess(
      await vestingClient.sendTokens(
        vestingAccount.address,
        user1Account.address,
        [HALF_AMOUNT],
        DEFAULT_FEE,
      ),
    );

    const vestingAccountBalanceAfter = await vestingClient.getBalance(
      vestingAccount.address,
      NATIVE_TOKEN_DENOM,
    );
    console.log(vestingAccountBalanceAfter);

    expect(+vestingAccountBalanceAfter.amount).toBe(
      +vestingAccountBalanceBefore.amount -
        +HALF_AMOUNT.amount -
        +DEFAULT_FEE.amount[0].amount * 2,
    );
  });

  test('try creation same continuous vesting account twice - should produce an error', async () => {
    // create vesting account
    createVestingAccountMsg.endTime = Long.fromNumber(
      new Date().getTime() / 1000 + ENDTIME_SECONDS,
    );

    const broadcastTx = await user1Client.signAndBroadcast(
      user1Account.address,
      [encodedMsg],
      DEFAULT_FEE,
    );
    expect(isDeliverTxFailure(broadcastTx)).toBeTruthy();
    expect(broadcastTx.rawLog).toEqual(
      `failed to execute message; message index: 0: account ${vestingAccount.address} already exists: invalid request`,
    );
  });
});
