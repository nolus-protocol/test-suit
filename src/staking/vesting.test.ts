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
import { DEFAULT_FEE, sleep, undefinedHandler } from '../util/utils';
import { Coin } from '../util/codec/cosmos/base/v1beta1/coin';
import {
  getDelegatorValidatorPairAmount,
  stakingModule,
} from '../util/staking';
import { ChainConstants } from '@nolus/nolusjs/build/constants';
import { NolusClient, NolusWallet } from '@nolus/nolusjs';
import { sendInitFeeTokens } from '../util/transfer';

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
  let NATIVE_TOKEN_DENOM: string;

  beforeAll(async () => {
    NATIVE_TOKEN_DENOM = ChainConstants.COIN_MINIMAL_DENOM;
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    user2Wallet = await createWallet();
    validatorAddress = getValidator1Address();
  });

  test('the stakeholder should not be able to delegate unvested tokens', async () => {
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
      DEFAULT_FEE,
    );
    expect(
      assertIsDeliverTxSuccess(createVestingAccountResult),
    ).toBeUndefined();

    // send some tokens
    const sendInitTokensResult = await sendInitFeeTokens(
      user1Wallet,
      user2Wallet.address as string,
    );

    expect(assertIsDeliverTxSuccess(sendInitTokensResult)).toBeUndefined();

    // get balance
    const user2Balance = await user2Wallet.getBalance(
      user2Wallet.address as string,
      NATIVE_TOKEN_DENOM,
    );
    console.log(user2Balance); //should be 112 --> 100 from vesting + 12 from user1

    // try to delegate
    const delegateMsg = {
      typeUrl: `${stakingModule}.MsgDelegate`,
      value: {
        delegatorAddress: user2Wallet.address as string,
        validatorAddress: validatorAddress,
        amount: HALF_AMOUNT,
      },
    };

    const broadcastFailTx = await user2Wallet.signAndBroadcast(
      user2Wallet.address as string,
      [delegateMsg],
      DEFAULT_FEE,
    );

    // TO DO: should produce an error due to insufficient amount
    expect(broadcastFailTx.rawLog).toEqual(
      'failed to execute message; message index: 0: invalid shares amount: invalid request',
    );

    // see the stakeholder staked tokens to the current validator - before delegation
    const stakeholderDelegationsToValBefore =
      await getDelegatorValidatorPairAmount(
        user2Wallet.address as string,
        validatorAddress,
      );

    if (!stakeholderDelegationsToValBefore) {
      undefinedHandler();
      return;
    }

    expect(stakeholderDelegationsToValBefore).toBe('0');

    // wait for tokens to be vested and try to delegate again
    await sleep((ENDTIME_SECONDS / 2) * 1000);

    const broadcastSuccTx = await user2Wallet.signAndBroadcast(
      user2Wallet.address as string,
      [delegateMsg],
      DEFAULT_FEE,
    );

    expect(assertIsDeliverTxSuccess(broadcastSuccTx)).toBeUndefined();

    // see the stakeholder staked tokens to the current validator - after delegation
    const stakeholderDelegationsToValAfter =
      await getDelegatorValidatorPairAmount(
        user2Wallet.address as string,
        validatorAddress,
      );

    if (!stakeholderDelegationsToValAfter) {
      undefinedHandler();
      return;
    }

    expect(+stakeholderDelegationsToValAfter).toBe(
      +stakeholderDelegationsToValBefore + +HALF_AMOUNT.amount,
    );
  });
});
