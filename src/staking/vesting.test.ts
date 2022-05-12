import {
  createWallet,
  getClient,
  getUser1Client,
  getUser1Wallet,
  getValidatorAddress,
} from '../util/clients';
import { AccountData, EncodeObject } from '@cosmjs/proto-signing';
import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import {
  MsgCreateVestingAccount,
  protobufPackage as vestingPackage,
} from '../util/codec/cosmos/vesting/v1beta1/tx';
import Long from 'long';
import { assertIsDeliverTxSuccess } from '@cosmjs/stargate';
import {
  DEFAULT_FEE,
  NATIVE_TOKEN_DENOM,
  sleep,
  undefinedHandler,
} from '../util/utils';
import { Coin } from '../util/codec/cosmos/base/v1beta1/coin';
import {
  getDelegatorValidatorPairAmount,
  stakingModule,
} from '../util/staking';
import { sendInitFeeTokens } from '../util/transfer';

describe('Staking Nolus tokens - Staking of unvested tokens', () => {
  const FULL_AMOUNT: Coin = { denom: 'unolus', amount: '100' };
  const HALF_AMOUNT: Coin = {
    denom: 'unolus',
    amount: (+FULL_AMOUNT.amount / 2).toString(),
  };
  const INIT: Coin = { denom: 'unolus', amount: '12' };
  const ENDTIME_SECONDS = 30;
  let user1Client: SigningCosmWasmClient;
  let user1Account: AccountData;
  let user2Client: SigningCosmWasmClient;
  let user2Account: AccountData;
  let validatorAddress: string;

  beforeAll(async () => {
    user1Client = await getUser1Client();
    [user1Account] = await (await getUser1Wallet()).getAccounts();
    const user2Wallet = await createWallet();
    user2Client = await getClient(user2Wallet);
    [user2Account] = await user2Wallet.getAccounts();
    validatorAddress = getValidatorAddress();
  });

  test('the stakeholder should not be able to delegate unvested tokens', async () => {
    const createVestingAccountMsg: MsgCreateVestingAccount = {
      fromAddress: user1Account.address,
      toAddress: user2Account.address,
      amount: [FULL_AMOUNT],
      endTime: Long.fromNumber(new Date().getTime() / 1000 + ENDTIME_SECONDS),
      delayed: false,
    };
    const encodedMsg: EncodeObject = {
      typeUrl: `/${vestingPackage}.MsgCreateVestingAccount`,
      value: createVestingAccountMsg,
    };

    // create a brand new vesting account
    const createVestingAccountResult = await user1Client.signAndBroadcast(
      user1Account.address,
      [encodedMsg],
      DEFAULT_FEE,
    );
    expect(
      assertIsDeliverTxSuccess(createVestingAccountResult),
    ).toBeUndefined();

    // send some tokens
    const sendInitTokensResult = await sendInitFeeTokens(
      user1Client,
      user1Account.address,
      user2Account.address,
    );

    expect(assertIsDeliverTxSuccess(sendInitTokensResult)).toBeUndefined();

    // get balance
    const user2Balance = await user2Client.getBalance(
      user2Account.address,
      NATIVE_TOKEN_DENOM,
    );
    console.log(user2Balance); //should be 112 --> 100 from vesting + 12 from user1

    // try to delegate
    const delegateMsg = {
      typeUrl: `${stakingModule}.MsgDelegate`,
      value: {
        delegatorAddress: user2Account.address,
        validatorAddress: validatorAddress,
        amount: HALF_AMOUNT,
      },
    };

    const broadcastFailTx = await user2Client.signAndBroadcast(
      user2Account.address,
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
        user1Account.address,
        validatorAddress,
      );

    if (!stakeholderDelegationsToValBefore) {
      undefinedHandler();
      return;
    }

    expect(stakeholderDelegationsToValBefore).toBe('0');

    // wait for tokens to be vested and try to delegate again
    await sleep((ENDTIME_SECONDS / 2) * 1000);

    const broadcastSuccTx = await user2Client.signAndBroadcast(
      user2Account.address,
      [delegateMsg],
      DEFAULT_FEE,
    );

    expect(assertIsDeliverTxSuccess(broadcastSuccTx)).toBeUndefined();

    // see the stakeholder staked tokens to the current validator - after delegation
    const stakeholderDelegationsToValAfter =
      await getDelegatorValidatorPairAmount(
        user1Account.address,
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
