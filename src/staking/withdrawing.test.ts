import { assertIsDeliverTxSuccess } from '@cosmjs/stargate';
import NODE_ENDPOINT, {
  getValidator1Address,
  createWallet,
  getUser1Wallet,
} from '../util/clients';
import { QueryDelegationRewardsResponse } from 'cosmjs-types/cosmos/distribution/v1beta1/query';
import {
  distributionModule,
  getDelegatorRewardsFromValidator,
  getDelegatorWithdrawAddress,
} from '../util/distribution';
import { customFees, NATIVE_MINIMAL_DENOM, sleep } from '../util/utils';
import { stakingModule } from '../util/staking';
import { NolusClient, NolusWallet } from '@nolus/nolusjs';

describe('Staking Nolus tokens - Withdraw reward', () => {
  let user1Wallet: NolusWallet;
  let delegatorWallet: NolusWallet;
  let validatorAddress: string;

  const delegatedAmount = '3500';
  const initTokens = '3501';
  const percision = 18;

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    delegatorWallet = await createWallet();
    validatorAddress = getValidator1Address();

    // send some tokens
    const initTransfer = {
      denom: NATIVE_MINIMAL_DENOM,
      amount: (
        +initTokens +
        +customFees.configs.amount[0].amount * 2
      ).toString(),
    };

    const broadcastTx = await user1Wallet.transferAmount(
      delegatorWallet.address as string,
      [initTransfer],
      customFees.transfer,
      '',
    );
    assertIsDeliverTxSuccess(broadcastTx);

    // delegate some tokens
    const delegateMsg = {
      typeUrl: `${stakingModule}.MsgDelegate`,
      value: {
        delegatorAddress: delegatorWallet.address as string,
        validatorAddress: validatorAddress,
        amount: { denom: NATIVE_MINIMAL_DENOM, amount: delegatedAmount },
      },
    };

    const result = await delegatorWallet.signAndBroadcast(
      delegatorWallet.address as string,
      [delegateMsg],
      customFees.configs,
    );
    assertIsDeliverTxSuccess(result);
  });

  test('the delegator withdraw address should be his own address', async () => {
    const withdrawAddress = await getDelegatorWithdrawAddress(
      delegatorWallet.address as string,
    );

    expect(withdrawAddress.withdrawAddress).toBe(
      delegatorWallet.address as string,
    );
  });

  test('the successful scenario for withdraw staking rewards - should work as expected', async () => {
    // get delegator balance before
    const delegatorBalanceBefore = await delegatorWallet.getBalance(
      delegatorWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    let rewardResult: QueryDelegationRewardsResponse;

    do {
      await sleep(50000);

      console.log('Waiting for the reward to become 1unls.');
      rewardResult = await getDelegatorRewardsFromValidator(
        delegatorWallet.address as string,
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
        delegatorAddress: delegatorWallet.address as string,
        validatorAddress: validatorAddress,
      },
    };
    const withdrawResult = await delegatorWallet.signAndBroadcast(
      delegatorWallet.address as string,
      [withdrawMsg],
      customFees.configs,
    );
    expect(assertIsDeliverTxSuccess(withdrawResult)).toBeUndefined();

    // get delegator balance after
    const delegatorBalanceAfter = await delegatorWallet.getBalance(
      delegatorWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    expect(BigInt(+delegatorBalanceAfter.amount)).toBeGreaterThan(
      BigInt(+delegatorBalanceBefore.amount) -
        BigInt(+customFees.configs.amount[0].amount),
    );
  });
});
