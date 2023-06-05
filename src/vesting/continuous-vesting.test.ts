import Long from 'long';
import {
  assertIsDeliverTxSuccess,
  DeliverTxResponse,
  isDeliverTxFailure,
} from '@cosmjs/stargate';
import { EncodeObject } from '@cosmjs/proto-signing';
import { NolusClient, NolusWallet } from '@nolus/nolusjs';
import { Coin } from '../util/codec/cosmos/base/v1beta1/coin';
import {
  MsgCreateVestingAccount,
  protobufPackage as vestingPackage,
} from '../util/codec/vestings/tx';
import { customFees, sleep, NATIVE_MINIMAL_DENOM } from '../util/utils';
import NODE_ENDPOINT, {
  createWallet,
  getUser1Wallet,
  registerNewType,
} from '../util/clients';
import { sendInitTransferFeeTokens } from '../util/transfer';
import { runOrSkip } from '../util/testingRules';
import { currencyTicker_To_IBC } from '../util/smart-contracts/calculations';

runOrSkip(process.env.TEST_VESTING as string)(
  'Continuous vesting tests',
  () => {
    const FULL_AMOUNT: Coin = { denom: NATIVE_MINIMAL_DENOM, amount: '10000' };
    const HALF_AMOUNT: Coin = { denom: NATIVE_MINIMAL_DENOM, amount: '5000' };
    const ENDTIME_SECONDS = 80;
    const STARTTIME_SECONDS = 20;
    let userWithBalanceWallet: NolusWallet;
    let vestingWallet: NolusWallet;

    const createVestingAccountMsg: MsgCreateVestingAccount = {
      fromAddress: '',
      toAddress: '',
      amount: [FULL_AMOUNT],
      startTime: Long.fromNumber(0),
      endTime: Long.fromNumber(0),
      delayed: false,
    };
    const encodedMsg: EncodeObject = {
      typeUrl: `/${vestingPackage}.MsgCreateVestingAccount`,
      value: createVestingAccountMsg,
    };

    async function verifyVestingAccountBalance(
      vestingWallet: NolusWallet,
      balanceAmount: string,
      denom?: string,
    ) {
      const vestingAccountBalance = await vestingWallet.getBalance(
        vestingWallet.address as string,
        denom ? denom : NATIVE_MINIMAL_DENOM,
      );

      expect(vestingAccountBalance.amount).toBe(balanceAmount);
    }

    async function transferUnallocatedTokens(
      vestingWallet: NolusWallet,
      amount: Coin,
      msg: string,
    ) {
      await sendInitTransferFeeTokens(
        userWithBalanceWallet,
        vestingWallet.address as string,
      );

      const result: DeliverTxResponse = await vestingWallet.transferAmount(
        userWithBalanceWallet.address as string,
        [amount],
        customFees.transfer,
      );

      expect(result.rawLog).toContain(msg);
    }

    async function createVestingAccountWithInvalidParams(msg: RegExp) {
      const broadcastTx = () =>
        userWithBalanceWallet.signAndBroadcast(
          userWithBalanceWallet.address as string,
          [encodedMsg],
          customFees.configs,
        );

      await expect(broadcastTx).rejects.toThrow(msg);

      await verifyVestingAccountBalance(vestingWallet, '0');
    }

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);

      userWithBalanceWallet = await getUser1Wallet();
      vestingWallet = await createWallet();

      createVestingAccountMsg.fromAddress =
        userWithBalanceWallet.address as string;
      createVestingAccountMsg.toAddress = vestingWallet.address as string;

      registerNewType(
        userWithBalanceWallet,
        '/vestings.MsgCreateVestingAccount',
        MsgCreateVestingAccount,
      );
    });

    afterEach(() => {
      createVestingAccountMsg.fromAddress =
        userWithBalanceWallet.address as string;
      createVestingAccountMsg.toAddress = vestingWallet.address as string;
      createVestingAccountMsg.amount = [FULL_AMOUNT];
    });

    test('create a continuous vesting account with 0 amount - should produce an error', async () => {
      createVestingAccountMsg.amount = [
        { denom: NATIVE_MINIMAL_DENOM, amount: '0' },
      ];

      await createVestingAccountWithInvalidParams(/^.*0unls: invalid coins*/);
    });

    test('create a continuous vesting account with invalid "from" address - should produce an error', async () => {
      createVestingAccountMsg.fromAddress =
        'wasm1gzkmn2lfm56m0q0l4rmjamq7rlwpfjrp7k78xw';

      await createVestingAccountWithInvalidParams(/^.*invalid checksum.*/);
    });

    test('create a continuous vesting account with invalid "to" address - should produce an error', async () => {
      createVestingAccountMsg.toAddress =
        'wasm1gzkmn2lfm56m0q0l4rmjamq7rlwpfjrp7k78xw';

      await createVestingAccountWithInvalidParams(/^.*invalid checksum.*/);
    });

    test('create a continuous vesting account with StartTime = 0 - should produce an error', async () => {
      createVestingAccountMsg.startTime = Long.fromNumber(0);

      await createVestingAccountWithInvalidParams(/^.*invalid start time.*/);
    });

    test('create a continuous vesting account with EndTime = 0 - should produce an error', async () => {
      createVestingAccountMsg.startTime = Long.fromNumber(
        new Date().getTime() / 1000 + STARTTIME_SECONDS,
      );

      await createVestingAccountWithInvalidParams(/^.*invalid end time.*/);
    });

    test('create a continuous vesting account with EndTime < StartTime - should produce an error', async () => {
      createVestingAccountMsg.startTime = Long.fromNumber(
        new Date().getTime() / 1000 + ENDTIME_SECONDS,
      );
      createVestingAccountMsg.endTime = Long.fromNumber(
        new Date().getTime() / 1000 + STARTTIME_SECONDS,
      );

      await createVestingAccountWithInvalidParams(/^.*invalid start time.*/);
    });

    test('create a continuous vesting account with EndTime = StartTime - should produce an error', async () => {
      createVestingAccountMsg.startTime = Long.fromNumber(
        new Date().getTime() / 1000 + ENDTIME_SECONDS,
      );
      createVestingAccountMsg.endTime = createVestingAccountMsg.startTime;

      await createVestingAccountWithInvalidParams(/^.*invalid start time.*/);
    });

    test('create a continuous vesting account with StartTime and EndTime in the future - should work as expected', async () => {
      createVestingAccountMsg.startTime = Long.fromNumber(
        new Date().getTime() / 1000 + STARTTIME_SECONDS,
      );
      createVestingAccountMsg.endTime = Long.fromNumber(
        +createVestingAccountMsg.startTime + ENDTIME_SECONDS,
      );

      const result = await userWithBalanceWallet.signAndBroadcast(
        userWithBalanceWallet.address as string,
        [encodedMsg],
        customFees.configs,
      );
      expect(assertIsDeliverTxSuccess(result)).toBeUndefined();

      await verifyVestingAccountBalance(vestingWallet, FULL_AMOUNT.amount);

      await transferUnallocatedTokens(
        vestingWallet,
        HALF_AMOUNT,
        `smaller than ${HALF_AMOUNT.amount}${HALF_AMOUNT.denom}: insufficient funds`,
      );

      await sleep(STARTTIME_SECONDS);

      await verifyVestingAccountBalance(vestingWallet, FULL_AMOUNT.amount);

      await transferUnallocatedTokens(
        vestingWallet,
        HALF_AMOUNT,
        `smaller than ${HALF_AMOUNT.amount}${HALF_AMOUNT.denom}: insufficient funds`,
      );

      await sleep(ENDTIME_SECONDS / 2);

      await transferUnallocatedTokens(
        vestingWallet,
        FULL_AMOUNT,
        `smaller than ${FULL_AMOUNT.amount}${FULL_AMOUNT.denom}: insufficient funds`,
      );

      await sendInitTransferFeeTokens(
        userWithBalanceWallet,
        vestingWallet.address as string,
      );

      await vestingWallet.transferAmount(
        userWithBalanceWallet.address as string,
        [HALF_AMOUNT],
        customFees.transfer,
      );

      const expectedAmount =
        BigInt(FULL_AMOUNT.amount) - BigInt(HALF_AMOUNT.amount);

      await verifyVestingAccountBalance(
        vestingWallet,
        expectedAmount.toString(),
      );
    });

    test('create a continuous vesting account with StartTime in the past (non-native vesting) - should work as expected', async () => {
      createVestingAccountMsg.startTime = Long.fromNumber(
        new Date().getTime() / 1000 - ENDTIME_SECONDS,
      );

      createVestingAccountMsg.endTime = Long.fromNumber(
        new Date().getTime() / 1000 + ENDTIME_SECONDS,
      );

      createVestingAccountMsg.amount = [
        {
          denom: currencyTicker_To_IBC(process.env.LPP_BASE_CURRENCY as string),
          amount: FULL_AMOUNT.amount,
        },
      ];

      const vestingWallet = await createWallet();
      createVestingAccountMsg.toAddress = vestingWallet.address as string;

      await userWithBalanceWallet.signAndBroadcast(
        userWithBalanceWallet.address as string,
        [encodedMsg],
        customFees.configs,
      );

      await verifyVestingAccountBalance(
        vestingWallet,
        FULL_AMOUNT.amount,
        createVestingAccountMsg.amount[0].denom,
      );

      await sendInitTransferFeeTokens(
        userWithBalanceWallet,
        vestingWallet.address as string,
      );

      const transferHalfBalance = {
        denom: currencyTicker_To_IBC(process.env.LPP_BASE_CURRENCY as string),
        amount: HALF_AMOUNT.amount,
      };

      await vestingWallet.transferAmount(
        userWithBalanceWallet.address as string,
        [transferHalfBalance],
        customFees.transfer,
      );

      await verifyVestingAccountBalance(
        vestingWallet,
        HALF_AMOUNT.amount,
        createVestingAccountMsg.amount[0].denom,
      );

      await sleep(ENDTIME_SECONDS);

      await sendInitTransferFeeTokens(
        userWithBalanceWallet,
        vestingWallet.address as string,
      );

      await vestingWallet.transferAmount(
        userWithBalanceWallet.address as string,
        [transferHalfBalance],
        customFees.transfer,
      );

      await verifyVestingAccountBalance(
        vestingWallet,
        '0',
        createVestingAccountMsg.amount[0].denom,
      );
    });

    test('create a continuous vesting account with StartTime and EndTime in the past - should work as expected', async () => {
      createVestingAccountMsg.startTime = Long.fromNumber(
        new Date().getTime() / 1000 - ENDTIME_SECONDS,
      );

      createVestingAccountMsg.endTime = Long.fromNumber(
        new Date().getTime() / 1000 - STARTTIME_SECONDS,
      );

      const vestingWallet = await createWallet();
      createVestingAccountMsg.toAddress = vestingWallet.address as string;

      await userWithBalanceWallet.signAndBroadcast(
        userWithBalanceWallet.address as string,
        [encodedMsg],
        customFees.configs,
      );

      await verifyVestingAccountBalance(vestingWallet, FULL_AMOUNT.amount);

      await sendInitTransferFeeTokens(
        userWithBalanceWallet,
        vestingWallet.address as string,
      );

      const sendFailTx = await vestingWallet.transferAmount(
        userWithBalanceWallet.address as string,
        [FULL_AMOUNT],
        customFees.transfer,
      );

      expect(isDeliverTxFailure(sendFailTx)).toBeFalsy();

      await verifyVestingAccountBalance(vestingWallet, '0');
    });

    test('try to create the same continuous vesting account twice - should produce an error', async () => {
      const result: DeliverTxResponse =
        await userWithBalanceWallet.signAndBroadcast(
          userWithBalanceWallet.address as string,
          [encodedMsg],
          customFees.configs,
        );

      expect(result.rawLog).toContain(
        `account ${vestingWallet.address} already exists`,
      );
    });
  },
);
