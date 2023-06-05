import Long from 'long';
import { assertIsDeliverTxSuccess } from '@cosmjs/stargate';
import { EncodeObject } from '@cosmjs/proto-signing';
import { NolusClient, NolusWallet } from '@nolus/nolusjs';
import {
  MsgCreateVestingAccount,
  protobufPackage as vestingPackage,
} from '../util/codec/vestings/tx';
import { Coin } from '../util/codec/cosmos/base/v1beta1/coin';
import NODE_ENDPOINT, {
  createWallet,
  getUser1Wallet,
  getValidator1Address,
  registerNewType,
} from '../util/clients';
import {
  customFees,
  NATIVE_MINIMAL_DENOM,
  undefinedHandler,
} from '../util/utils';
import {
  getDelegatorValidatorPairAmount,
  stakingModule,
} from '../util/staking';
import { runOrSkip } from '../util/testingRules';

runOrSkip(process.env.TEST_STAKING as string)(
  'Staking Nolus tokens - Staking of unvested tokens',
  () => {
    const FULL_AMOUNT: Coin = { denom: NATIVE_MINIMAL_DENOM, amount: '100' };
    const HALF_AMOUNT: Coin = {
      denom: NATIVE_MINIMAL_DENOM,
      amount: Math.trunc(+FULL_AMOUNT.amount / 2).toString(),
    };
    const ENDTIME_SECONDS = 300;
    let userWithBalanceWallet: NolusWallet;
    let user2Wallet: NolusWallet;
    let validatorAddress: string;

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      userWithBalanceWallet = await getUser1Wallet();
      user2Wallet = await createWallet();
      validatorAddress = getValidator1Address();
    });

    test('the stakeholder should be able to delegate unallocated tokens', async () => {
      const createVestingAccountMsg: MsgCreateVestingAccount = {
        fromAddress: userWithBalanceWallet.address as string,
        toAddress: user2Wallet.address as string,
        amount: [FULL_AMOUNT],
        startTime: Long.fromNumber(new Date().getTime() / 1000),
        endTime: Long.fromNumber(new Date().getTime() / 1000 + ENDTIME_SECONDS),
        delayed: false,
      };
      const encodedMsg: EncodeObject = {
        typeUrl: `/${vestingPackage}.MsgCreateVestingAccount`,
        value: createVestingAccountMsg,
      };

      registerNewType(
        userWithBalanceWallet,
        '/vestings.MsgCreateVestingAccount',
        MsgCreateVestingAccount,
      );

      const createVestingAccountResult =
        await userWithBalanceWallet.signAndBroadcast(
          userWithBalanceWallet.address as string,
          [encodedMsg],
          customFees.configs,
        );
      expect(
        assertIsDeliverTxSuccess(createVestingAccountResult),
      ).toBeUndefined();

      const sendInitTokensResult = await userWithBalanceWallet.transferAmount(
        user2Wallet.address as string,
        customFees.configs.amount,
        customFees.transfer,
      );

      expect(assertIsDeliverTxSuccess(sendInitTokensResult)).toBeUndefined();

      const delegateMsg = {
        typeUrl: `${stakingModule}.MsgDelegate`,
        value: {
          delegatorAddress: user2Wallet.address as string,
          validatorAddress: validatorAddress,
          amount: HALF_AMOUNT,
        },
      };

      await user2Wallet.signAndBroadcast(
        user2Wallet.address as string,
        [delegateMsg],
        customFees.configs,
      );

      const stakeholderDelegationsToVal = await getDelegatorValidatorPairAmount(
        user2Wallet.address as string,
        validatorAddress,
      );

      if (!stakeholderDelegationsToVal) {
        undefinedHandler();
        return;
      }

      expect(stakeholderDelegationsToVal).toBe(HALF_AMOUNT.amount);
    });
  },
);
