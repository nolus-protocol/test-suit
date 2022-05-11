import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { AccountData, DirectSecp256k1Wallet } from '@cosmjs/proto-signing';
import { assertIsDeliverTxSuccess } from '@cosmjs/stargate';
import {
  getValidatorAddress,
  createWallet,
  getClient,
  getUser1Wallet,
  getUser1Client,
} from '../util/clients';
import { QueryDelegationRewardsResponse } from 'cosmjs-types/cosmos/distribution/v1beta1/query';
import {
  distributionModule,
  getDelegatorRewardsFromValidator,
  getDelegatorWithdrawAddress,
} from '../util/distribution';
import { DEFAULT_FEE, NATIVE_TOKEN_DENOM, sleep } from '../util/utils';
import { stakingModule } from '../util/staking';

describe('Staking Nolus tokens - Withdraw reward', () => {
  let user1Client: SigningCosmWasmClient;
  let user1Account: AccountData;
  let delegatorClient: SigningCosmWasmClient;
  let delegatorWallet: DirectSecp256k1Wallet;
  let delegatorAccount: AccountData;
  let validatorAddress: string;

  const delegatedAmount = '3500';
  const initTokens = '3501';
  const percision = 18;

  beforeAll(async () => {
    user1Client = await getUser1Client();
    [user1Account] = await (await getUser1Wallet()).getAccounts();

    delegatorWallet = await createWallet();
    delegatorClient = await getClient(delegatorWallet);
    [delegatorAccount] = await delegatorWallet.getAccounts();
    console.log(delegatorAccount.address);

    validatorAddress = getValidatorAddress();

    // send some tokens
    const initTransfer = {
      denom: NATIVE_TOKEN_DENOM,
      amount: (+initTokens + +DEFAULT_FEE.amount[0].amount * 2).toString(),
    };

    console.log(initTransfer.amount);

    const broadcastTx = await user1Client.sendTokens(
      user1Account.address,
      delegatorAccount.address,
      [initTransfer],
      DEFAULT_FEE,
    );
    assertIsDeliverTxSuccess(broadcastTx);

    // delegate some tokens
    const delegateMsg = {
      typeUrl: `${stakingModule}.MsgDelegate`,
      value: {
        delegatorAddress: delegatorAccount.address,
        validatorAddress: validatorAddress,
        amount: { denom: NATIVE_TOKEN_DENOM, amount: delegatedAmount },
      },
    };

    const result = await delegatorClient.signAndBroadcast(
      delegatorAccount.address,
      [delegateMsg],
      DEFAULT_FEE,
    );
    assertIsDeliverTxSuccess(result);
  });

  test('the delegator withdraw address should be his own address', async () => {
    const withdrawAddress = await getDelegatorWithdrawAddress(
      delegatorAccount.address,
    );

    expect(withdrawAddress.withdrawAddress).toBe(delegatorAccount.address);
  });

  test('the successful scenario for withdraw staking rewards should work as expected', async () => {
    // get delegator balance before
    const delegatorBalanceBefore = await delegatorClient.getBalance(
      delegatorAccount.address,
      NATIVE_TOKEN_DENOM,
    );

    let rewardResult: QueryDelegationRewardsResponse;

    do {
      sleep(50000);

      console.log('Waiting for the reward to become 1unolus.');
      rewardResult = await getDelegatorRewardsFromValidator(
        delegatorAccount.address,
        validatorAddress,
      );
      console.log(rewardResult.rewards[0]);
      console.log(rewardResult.rewards[0]?.amount.length);
    } while (
      typeof rewardResult.rewards[0] === 'undefined' ||
      rewardResult.rewards[0].amount.length < percision + 1
    );

    const reward = rewardResult.rewards[0].amount;
    const rewardInt = BigInt(+reward) / BigInt(Math.pow(10, percision));

    // withdraw reward
    const withdrawMsg = {
      typeUrl: `${distributionModule}.MsgWithdrawDelegatorReward`,
      value: {
        delegatorAddress: delegatorAccount.address,
        validatorAddress: validatorAddress,
      },
    };
    const withdrawResult = await delegatorClient.signAndBroadcast(
      delegatorAccount.address,
      [withdrawMsg],
      DEFAULT_FEE,
    );
    expect(assertIsDeliverTxSuccess(withdrawResult)).toBeUndefined();

    // get delegator balance after
    const delegatorBalanceAfter = await delegatorClient.getBalance(
      delegatorAccount.address,
      NATIVE_TOKEN_DENOM,
    );

    expect(BigInt(+delegatorBalanceAfter.amount)).toBeGreaterThan(
      BigInt(+delegatorBalanceBefore.amount) -
        BigInt(+DEFAULT_FEE.amount[0].amount),
    );
  });
});
