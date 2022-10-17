import {
  MsgCreateVestingAccount,
  protobufPackage as vestingPackage,
} from '../util/codec/cosmos/vesting/v1beta1/tx';
import Long from 'long';
import { assertIsDeliverTxSuccess, isDeliverTxFailure } from '@cosmjs/stargate';
import { customFees, sleep, NATIVE_MINIMAL_DENOM } from '../util/utils';
import { Coin } from '../util/codec/cosmos/base/v1beta1/coin';
import { ChainConstants } from '@nolus/nolusjs/build/constants';
import { NolusClient, NolusWallet } from '@nolus/nolusjs';
import NODE_ENDPOINT, { createWallet, getUser1Wallet } from '../util/clients';
import { sendInitTransferFeeTokens } from '../util/transfer';
import { EncodeObject } from '@cosmjs/proto-signing';
import { runOrSkip } from '../util/testingRules';

runOrSkip(process.env.TEST_VESTING as string)(
  'Continuous vesting tests',
  () => {
    const FULL_AMOUNT: Coin = { denom: NATIVE_MINIMAL_DENOM, amount: '10000' };
    const HALF_AMOUNT: Coin = { denom: NATIVE_MINIMAL_DENOM, amount: '5000' };
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

    async function verifyVestingAccountBalance() {
      const vestingAccountBalance = await vestingWallet.getBalance(
        vestingWallet.address as string,
        NATIVE_TOKEN_DENOM,
      );

      expect(BigInt(vestingAccountBalance.amount)).toBe(BigInt(0));
    }

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      NATIVE_TOKEN_DENOM = ChainConstants.COIN_MINIMAL_DENOM;

      user1Wallet = await getUser1Wallet();
      vestingWallet = await createWallet();

      createVestingAccountMsg.fromAddress = user1Wallet.address as string;
      createVestingAccountMsg.toAddress = vestingWallet.address as string;
    });

    afterEach(() => {
      createVestingAccountMsg.toAddress = vestingWallet.address as string;
      createVestingAccountMsg.amount = [FULL_AMOUNT];
    });

    test('creation a continuous vesting account with 0 amount - should produce an error', async () => {
      createVestingAccountMsg.amount = [
        { denom: NATIVE_MINIMAL_DENOM, amount: '0' },
      ];
      const broadcastTx = () =>
        user1Wallet.signAndBroadcast(
          user1Wallet.address as string,
          [encodedMsg],
          customFees.configs,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*0unls: invalid coins.*/);

      await verifyVestingAccountBalance();
    });

    test('creation a continuous vesting account with invalid "to" address - should produce an error', async () => {
      createVestingAccountMsg.toAddress =
        'wasm1gzkmn2lfm56m0q0l4rmjamq7rlwpfjrp7k78xw';

      const broadcastTx = () =>
        user1Wallet.signAndBroadcast(
          user1Wallet.address as string,
          [encodedMsg],
          customFees.configs,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*internal.*/);

      await verifyVestingAccountBalance();
    });

    test('creation a continuous vesting account with 0 EndTime - should produce an error', async () => {
      const broadcastTx = () =>
        user1Wallet.signAndBroadcast(
          user1Wallet.address as string,
          [encodedMsg],
          customFees.configs,
        );

      await expect(broadcastTx).rejects.toThrow(
        /^.* invalid end time: invalid request.*/,
      );

      await verifyVestingAccountBalance();
    });

    test('the successful scenario for creation a continuous vesting account - should work as expected', async () => {
      // create vesting account
      createVestingAccountMsg.endTime = Long.fromNumber(
        new Date().getTime() / 1000 + ENDTIME_SECONDS,
      );

      const result = await user1Wallet.signAndBroadcast(
        user1Wallet.address as string,
        [encodedMsg],
        customFees.configs,
      );
      expect(assertIsDeliverTxSuccess(result)).toBeUndefined();

      // get balance before
      const vestingAccountBalanceBefore = await vestingWallet.getBalance(
        vestingWallet.address as string,
        NATIVE_TOKEN_DENOM,
      );

      expect(vestingAccountBalanceBefore.amount).toBe(FULL_AMOUNT.amount);

      // send some tokens - non-vesting coins - would be immediately transferable
      const sendInitTokensResult = await sendInitTransferFeeTokens(
        user1Wallet,
        vestingWallet.address as string,
      );

      expect(assertIsDeliverTxSuccess(sendInitTokensResult)).toBeUndefined();

      let sendFailTx = await vestingWallet.transferAmount(
        user1Wallet.address as string,
        [HALF_AMOUNT],
        customFees.transfer,
        '',
      );
      expect(isDeliverTxFailure(sendFailTx)).toBeTruthy();
      expect(sendFailTx.rawLog).toMatch(
        /^.*smaller than 5000unls: insufficient funds.*/,
      );
      await sleep(ENDTIME_SECONDS / 2 + 1); // > half

      // half the tokens are provided now but not all
      sendFailTx = await vestingWallet.transferAmount(
        user1Wallet.address as string,
        [FULL_AMOUNT],
        customFees.transfer,
        '',
      );

      expect(isDeliverTxFailure(sendFailTx)).toBeTruthy();
      expect(sendFailTx.rawLog).toMatch(
        /^.*smaller than 10000unls: insufficient funds.*/,
      );

      assertIsDeliverTxSuccess(
        await vestingWallet.transferAmount(
          user1Wallet.address as string,
          [HALF_AMOUNT],
          customFees.transfer,
          '',
        ),
      );

      const vestingAccountBalanceAfter = await vestingWallet.getBalance(
        vestingWallet.address as string,
        NATIVE_TOKEN_DENOM,
      );

      expect(BigInt(vestingAccountBalanceAfter.amount)).toBe(
        BigInt(vestingAccountBalanceBefore.amount) -
          BigInt(HALF_AMOUNT.amount) -
          BigInt(customFees.transfer.amount[0].amount) * BigInt(2),
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
        customFees.configs,
      );
      expect(isDeliverTxFailure(broadcastTx)).toBeTruthy();
      expect(broadcastTx.rawLog).toEqual(
        `failed to execute message; message index: 0: account ${vestingWallet.address} already exists: invalid request`,
      );
    });
  },
);
