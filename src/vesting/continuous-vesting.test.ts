import {
  MsgCreateVestingAccount,
  protobufPackage as vestingPackage,
} from '../util/codec/cosmos/vesting/v1beta1/tx';
import Long from 'long';
import { assertIsDeliverTxSuccess, isDeliverTxFailure } from '@cosmjs/stargate';
import { DEFAULT_FEE, sleep } from '../util/utils';
import { Coin } from '../util/codec/cosmos/base/v1beta1/coin';
import { ChainConstants } from '@nolus/nolusjs/build/constants';
import { NolusClient, NolusWallet } from '@nolus/nolusjs';
import NODE_ENDPOINT, { createWallet, getUser1Wallet } from '../util/clients';
import { sendInitFeeTokens } from '../util/transfer';
import { EncodeObject } from '@cosmjs/proto-signing';

describe('Continuous vesting tests', () => {
  const FULL_AMOUNT: Coin = { denom: 'unolus', amount: '10000' };
  const HALF_AMOUNT: Coin = { denom: 'unolus', amount: '5000' };
  const ENDTIME_SECONDS = 50;
  let NATIVE_TOKEN_DENOM: string;
  let user1Wallet: NolusWallet;
  let vestingWallet: NolusWallet;

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
    NATIVE_TOKEN_DENOM = ChainConstants.COIN_MINIMAL_DENOM;
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    vestingWallet = await createWallet();
    console.log(vestingWallet.address);

    createVestingAccountMsg.fromAddress = user1Wallet.address as string;
    createVestingAccountMsg.toAddress = vestingWallet.address as string;
  });

  afterEach(() => {
    createVestingAccountMsg.toAddress = vestingWallet.address as string;
    createVestingAccountMsg.amount = [FULL_AMOUNT];
  });

  test('creation a continuous vesting account with 0 amount - should produce an error', async () => {
    // try to create vesting account
    createVestingAccountMsg.amount = [{ denom: 'unolus', amount: '0' }];
    const broadcastTx = () =>
      user1Wallet.signAndBroadcast(
        user1Wallet.address as string,
        [encodedMsg],
        DEFAULT_FEE,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*0unolus: invalid coins.*/);

    // get balance
    const vestingAccountBalance = await vestingWallet.getBalance(
      vestingWallet.address as string,
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
      user1Wallet.signAndBroadcast(
        user1Wallet.address as string,
        [encodedMsg],
        DEFAULT_FEE,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*internal.*/);

    // get balance
    const vestingAccountBalance = await vestingWallet.getBalance(
      vestingWallet.address as string,
      NATIVE_TOKEN_DENOM,
    );

    expect(+vestingAccountBalance.amount).toBe(0);
  });

  test('creation a continuous vesting account with 0 EndTime - should produce an error', async () => {
    const broadcastTx = () =>
      user1Wallet.signAndBroadcast(
        user1Wallet.address as string,
        [encodedMsg],
        DEFAULT_FEE,
      );

    await expect(broadcastTx).rejects.toThrow(
      /^.* invalid end time: invalid request.*/,
    );

    // get balance
    const vestingAccountBalance = await vestingWallet.getBalance(
      vestingWallet.address as string,
      NATIVE_TOKEN_DENOM,
    );

    expect(+vestingAccountBalance.amount).toBe(0);
  });

  test('the successful scenario for creation a continuous vesting account - should work as expected', async () => {
    // create vesting account
    createVestingAccountMsg.endTime = Long.fromNumber(
      new Date().getTime() / 1000 + ENDTIME_SECONDS,
    );

    const result = await user1Wallet.signAndBroadcast(
      user1Wallet.address as string,
      [encodedMsg],
      DEFAULT_FEE,
    );
    expect(assertIsDeliverTxSuccess(result)).toBeUndefined();

    // get balance before
    const vestingAccountBalanceBefore = await vestingWallet.getBalance(
      vestingWallet.address as string,
      NATIVE_TOKEN_DENOM,
    );
    console.log(vestingAccountBalanceBefore);

    expect(vestingAccountBalanceBefore.amount).toBe(FULL_AMOUNT.amount);

    // send some tokens - non-vesting coins - would be immediately transferable
    const sendInitTokensResult = await sendInitFeeTokens(
      user1Wallet,
      vestingWallet.address as string,
    );

    expect(assertIsDeliverTxSuccess(sendInitTokensResult)).toBeUndefined();

    let sendFailTx = await vestingWallet.transferAmount(
      user1Wallet.address as string,
      [HALF_AMOUNT],
      DEFAULT_FEE,
      '',
    );
    expect(isDeliverTxFailure(sendFailTx)).toBeTruthy();
    expect(sendFailTx.rawLog).toMatch(
      /^.*smaller than 5000unolus: insufficient funds.*/,
    );
    await sleep((ENDTIME_SECONDS / 2) * 1000);

    // half the tokens are provided now but not all
    sendFailTx = await vestingWallet.transferAmount(
      user1Wallet.address as string,
      [FULL_AMOUNT],
      DEFAULT_FEE,
      '',
    );

    expect(isDeliverTxFailure(sendFailTx)).toBeTruthy();
    expect(sendFailTx.rawLog).toMatch(
      /^.*smaller than 10000unolus: insufficient funds.*/,
    );

    assertIsDeliverTxSuccess(
      await vestingWallet.transferAmount(
        user1Wallet.address as string,
        [HALF_AMOUNT],
        DEFAULT_FEE,
        '',
      ),
    );

    const vestingAccountBalanceAfter = await vestingWallet.getBalance(
      vestingWallet.address as string,
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

    const broadcastTx = await user1Wallet.signAndBroadcast(
      user1Wallet.address as string,
      [encodedMsg],
      DEFAULT_FEE,
    );
    expect(isDeliverTxFailure(broadcastTx)).toBeTruthy();
    expect(broadcastTx.rawLog).toEqual(
      `failed to execute message; message index: 0: account ${vestingWallet.address} already exists: invalid request`,
    );
  });
});
