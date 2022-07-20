import NODE_ENDPOINT, {
  createWallet,
  getUser1Wallet,
  getValidator1Address,
} from '../util/clients';
import { EncodeObject } from '@cosmjs/proto-signing';
import {
  MsgCreateVestingAccount,
  protobufPackage as vestingPackage,
} from '../util/codec/cosmos/vesting/v1beta1/tx';
import Long from 'long';
import { assertIsDeliverTxSuccess } from '@cosmjs/stargate';
import { customFees, undefinedHandler } from '../util/utils';
import { Coin } from '../util/codec/cosmos/base/v1beta1/coin';
import {
  getDelegatorValidatorPairAmount,
  stakingModule,
} from '../util/staking';
import { NolusClient, NolusWallet } from '@nolus/nolusjs';

describe('Staking Nolus tokens - Staking of unvested tokens', () => {
  const FULL_AMOUNT: Coin = { denom: 'unolus', amount: '100' };
  const HALF_AMOUNT: Coin = {
    denom: 'unolus',
    amount: (+FULL_AMOUNT.amount / 2).toString(),
  };
  const ENDTIME_SECONDS = 30;
  let user1Wallet: NolusWallet;
  let user2Wallet: NolusWallet;
  let validatorAddress: string;

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    user2Wallet = await createWallet();
    validatorAddress = getValidator1Address();
  });

  test('the stakeholder should be able to delegate unvested tokens', async () => {
    const createVestingAccountMsg: MsgCreateVestingAccount = {
      fromAddress: user1Wallet.address as string,
      toAddress: user2Wallet.address as string,
      amount: [FULL_AMOUNT],
      endTime: Long.fromNumber(new Date().getTime() / 1000 + ENDTIME_SECONDS),
      delayed: false,
    };
    const encodedMsg: EncodeObject = {
      typeUrl: `/${vestingPackage}.MsgCreateVestingAccount`,
      value: createVestingAccountMsg,
    };

    // create a brand new vesting account
    const createVestingAccountResult = await user1Wallet.signAndBroadcast(
      user1Wallet.address as string,
      [encodedMsg],
      customFees.configs,
    );
    expect(
      assertIsDeliverTxSuccess(createVestingAccountResult),
    ).toBeUndefined();

    // send some tokens
    const sendInitTokensResult = await user1Wallet.transferAmount(
      user2Wallet.address as string,
      customFees.configs.amount,
      customFees.transfer,
      '',
    );

    expect(assertIsDeliverTxSuccess(sendInitTokensResult)).toBeUndefined();

    // try to delegate
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

    // see the stakeholder staked tokens to the current validator
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
});
