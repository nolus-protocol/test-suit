import { assertIsDeliverTxSuccess } from '@cosmjs/stargate';
import NODE_ENDPOINT, {
  getValidator1Address,
  createWallet,
  getUser1Wallet,
} from '../util/clients';
import {
  distributionModule,
  getDelegatorRewardsFromValidator,
  getDelegatorWithdrawAddress,
} from '../util/distribution';
import { customFees, NATIVE_MINIMAL_DENOM, sleep } from '../util/utils';
import { stakingModule } from '../util/staking';
import { NolusClient, NolusWallet } from '../util/nolus';
import { runOrSkip } from '../util/testingRules';

runOrSkip(process.env.TEST_STAKING as string)(
  'Staking Nolus tokens - Withdraw reward',
  () => {
    let user1Wallet: NolusWallet;
    let delegatorWallet: NolusWallet;
    let validatorAddress: string;

    const percision = 18;
    const ONE_UNLS_REWARD = BigInt(10) ** BigInt(percision);

    const PROBE_DELEGATION = BigInt(100000);
    const PROBE_SAMPLE_SEC = 30;
    const REWARD_TARGET_SEC = 120;
    // The probe spans few enough blocks that its rate is noisy; overshoot rather than sit in
    // the poll loop.
    const SIZING_SAFETY_FACTOR = BigInt(4);
    // A rate measured far too low would otherwise size an arbitrarily large delegation, and
    // nothing here can undelegate it. Refuse instead.
    const MAX_DELEGATION = BigInt(10) ** BigInt(12);
    const REWARD_POLL_INTERVAL_SEC = 15;
    const REWARD_DEADLINE_SEC = 600;

    let delegatedAmount: bigint;

    async function accruedReward(): Promise<bigint> {
      const result = await getDelegatorRewardsFromValidator(
        delegatorWallet.address as string,
        validatorAddress,
      );

      return BigInt(result.rewards[0]?.amount ?? '0');
    }

    async function fundAndDelegate(amount: bigint): Promise<void> {
      const initTransfer = {
        denom: NATIVE_MINIMAL_DENOM,
        amount: (
          amount +
          BigInt(customFees.configs.amount[0].amount) * BigInt(2)
        ).toString(),
      };

      const broadcastTx = await user1Wallet.transferAmount(
        delegatorWallet.address as string,
        [initTransfer],
        customFees.transfer,
      );
      assertIsDeliverTxSuccess(broadcastTx);

      const delegateMsg = {
        typeUrl: `${stakingModule}.MsgDelegate`,
        value: {
          delegatorAddress: delegatorWallet.address as string,
          validatorAddress: validatorAddress,
          amount: { denom: NATIVE_MINIMAL_DENOM, amount: amount.toString() },
        },
      };

      const result = await delegatorWallet.signAndBroadcast(
        delegatorWallet.address as string,
        [delegateMsg],
        customFees.configs,
      );
      assertIsDeliverTxSuccess(result);
    }

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      user1Wallet = await getUser1Wallet();
      delegatorWallet = await createWallet();
      validatorAddress = getValidator1Address();

      await fundAndDelegate(PROBE_DELEGATION);
      delegatedAmount = PROBE_DELEGATION;

      const rewardBefore = await accruedReward();
      await sleep(PROBE_SAMPLE_SEC);
      const rewardAfter = await accruedReward();

      const sampled = rewardAfter - rewardBefore;

      if (sampled <= BigInt(0)) {
        throw new Error(
          `${PROBE_DELEGATION}${NATIVE_MINIMAL_DENOM} delegated to ${validatorAddress} earned ` +
            `nothing over ${PROBE_SAMPLE_SEC}s (reward went ${rewardBefore} -> ${rewardAfter}, ` +
            `${percision} decimals), so the stake needed to earn 1${NATIVE_MINIMAL_DENOM} cannot ` +
            `be derived. Either the chain stopped minting or the validator is not earning.`,
        );
      }

      const required =
        (ONE_UNLS_REWARD *
          SIZING_SAFETY_FACTOR *
          PROBE_DELEGATION *
          BigInt(PROBE_SAMPLE_SEC)) /
        (sampled * BigInt(REWARD_TARGET_SEC));

      if (required > MAX_DELEGATION) {
        throw new Error(
          `Earning 1${NATIVE_MINIMAL_DENOM} within ${REWARD_TARGET_SEC}s would take ` +
            `${required}${NATIVE_MINIMAL_DENOM} staked, over the ${MAX_DELEGATION} cap. ` +
            `The delegation is unrecoverable within a run, so this refuses rather than ` +
            `stranding that much. Raise the cap deliberately if the chain really is this ` +
            `heavily bonded.`,
        );
      }

      if (required > PROBE_DELEGATION) {
        await fundAndDelegate(required - PROBE_DELEGATION);
        delegatedAmount = required;
      }
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

      let reward = await accruedReward();
      let waited = 0;

      while (reward < ONE_UNLS_REWARD) {
        if (waited >= REWARD_DEADLINE_SEC) {
          throw new Error(
            `The reward on ${delegatedAmount}${NATIVE_MINIMAL_DENOM} delegated to ` +
              `${validatorAddress} did not reach 1${NATIVE_MINIMAL_DENOM} over ` +
              `${REWARD_DEADLINE_SEC}s of polling; it stood at '${reward}' ` +
              `(${percision} decimals). The stake was sized off a live measurement, so this ` +
              `means the reward rate collapsed after that measurement was taken.`,
          );
        }

        await sleep(REWARD_POLL_INTERVAL_SEC);
        waited += REWARD_POLL_INTERVAL_SEC;

        reward = await accruedReward();
      }

      const rewardInt = reward / ONE_UNLS_REWARD;

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

      expect(BigInt(delegatorBalanceAfter.amount)).toBeGreaterThanOrEqual(
        BigInt(delegatorBalanceBefore.amount) +
          BigInt(rewardInt) -
          BigInt(customFees.configs.amount[0].amount),
      );
    });
  },
);
