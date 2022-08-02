import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import { customFees, NATIVE_MINIMAL_DENOM } from '../util/utils';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import { Coin } from '@cosmjs/proto-signing';

describe('Lender tests - Claim rewards', () => {
  let user1Wallet: NolusWallet;
  let lenderWallet: NolusWallet;
  let lppDenom: string;
  let leaseInstance: NolusContracts.Lease;
  let rewards: Coin;
  let distributeRewardsMsg: any;
  const lppContractAddress = process.env.LPP_ADDRESS as string;
  const deposit = '1000000000';

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    lenderWallet = await createWallet();
    const cosm = await NolusClient.getInstance().getCosmWasmClient();
    leaseInstance = new NolusContracts.Lease(cosm);

    const lppConfig = await leaseInstance.getLppConfig(lppContractAddress);
    lppDenom = lppConfig.lpn_symbol;

    rewards = { amount: '20000000000', denom: NATIVE_MINIMAL_DENOM };
    distributeRewardsMsg = { distribute_rewards: [] };
  });

  test('the successful claim rewards scenario - should work as expected', async () => {
    const lppBalanceBefore = await leaseInstance.getLppBalance(
      lppContractAddress,
    );
    const lenderDepositBefore = await leaseInstance.getLenderDeposit(
      lppContractAddress,
      lenderWallet.address as string,
    );

    await user1Wallet.transferAmount(
      lenderWallet.address as string,
      [{ denom: lppDenom, amount: deposit }],
      customFees.transfer,
    );

    await sendInitExecuteFeeTokens(user1Wallet, lenderWallet.address as string);

    await leaseInstance.lenderDeposit(
      lppContractAddress,
      lenderWallet,
      customFees.exec,
      [{ denom: lppDenom, amount: deposit }],
    );

    const lppBalanceAfter = await leaseInstance.getLppBalance(
      lppContractAddress,
    );

    const lenderDepositAfter = await leaseInstance.getLenderDeposit(
      lppContractAddress,
      lenderWallet.address as string,
    );

    expect(+lppBalanceAfter.balance.amount).toBe(
      +lppBalanceBefore.balance.amount + +deposit,
    );
    expect(+lenderDepositAfter.balance).toBeGreaterThan(
      +lenderDepositBefore.balance,
    );

    const lenderBalanceBefore = await lenderWallet.getBalance(
      lenderWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    const user1BalanceBefore = await user1Wallet.getBalance(
      user1Wallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    // Send Rewards
    await user1Wallet.execute(
      user1Wallet.address as string,
      lppContractAddress,
      distributeRewardsMsg,
      customFees.exec,
      undefined,
      [rewards],
    );

    const user1BalanceAfter = await user1Wallet.getBalance(
      user1Wallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    expect(BigInt(user1BalanceAfter.amount)).toBe(
      BigInt(user1BalanceBefore.amount) -
        BigInt(rewards.amount) -
        BigInt(customFees.exec.amount[0].amount),
    );

    const lenderRewards = await leaseInstance.getLenderRewards(
      lppContractAddress,
      lenderWallet.address as string,
    );

    console.log(lenderRewards);
    // TO DO: calc lender rewards

    await sendInitExecuteFeeTokens(user1Wallet, lenderWallet.address as string);

    // Claim Rewards
    await leaseInstance.claimRewards(
      lppContractAddress,
      lenderWallet,
      undefined,
      customFees.exec,
    );

    const lenderBalanceAfter = await lenderWallet.getBalance(
      lenderWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    expect(+lenderBalanceAfter.amount).toBe(
      +lenderBalanceBefore.amount + +lenderRewards.rewards.amount,
    );
  });

  test('the lender tries to receive rewards to another account - should work as expected', async () => {
    const recipientWallet = await createWallet();

    const lenderRewardsBefore = await leaseInstance.getLenderRewards(
      lppContractAddress,
      lenderWallet.address as string,
    );

    await user1Wallet.execute(
      user1Wallet.address as string,
      lppContractAddress,
      distributeRewardsMsg,
      customFees.exec,
      undefined,
      [rewards],
    );

    const lenderRewardsAfter = await leaseInstance.getLenderRewards(
      lppContractAddress,
      lenderWallet.address as string,
    );

    expect(+lenderRewardsAfter.rewards.amount).toBeGreaterThan(
      +lenderRewardsBefore.rewards.amount,
    );

    const lenderBalanceBefore = await lenderWallet.getBalance(
      lenderWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    const otherRecipientBalanceBefore = await recipientWallet.getBalance(
      recipientWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    await sendInitExecuteFeeTokens(user1Wallet, lenderWallet.address as string);
    await leaseInstance.claimRewards(
      lppContractAddress,
      lenderWallet,
      recipientWallet.address as string,
      customFees.exec,
    );

    const lenderBalanceAfter = await lenderWallet.getBalance(
      lenderWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    const otherRecipientBalanceAfter = await recipientWallet.getBalance(
      recipientWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    expect(+lenderBalanceAfter.amount).toBe(+lenderBalanceBefore.amount);

    expect(+otherRecipientBalanceAfter.amount).toBe(
      +otherRecipientBalanceBefore.amount + +lenderRewardsAfter.rewards.amount,
    );
  });

  test('the dispatcher tries to send 0 rewards - should produce an error', async () => {
    const user1BalanceBefore = await user1Wallet.getBalance(
      user1Wallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    const distributeRewardsMsg = { distribute_rewards: [] };
    const rewards = { amount: '0', denom: NATIVE_MINIMAL_DENOM };

    const broadcastTx = () =>
      user1Wallet.execute(
        user1Wallet.address as string,
        lppContractAddress,
        distributeRewardsMsg,
        customFees.exec,
        undefined,
        [rewards],
      );

    await expect(broadcastTx).rejects.toThrow(/^.*invalid coins.*/);

    const user1BalanceAfter = await user1Wallet.getBalance(
      user1Wallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    expect(+user1BalanceAfter).toBe(+user1BalanceBefore);
  });

  test('the dispatcher tries not to send funds when calling "distribute rewards" msg - should produce an error', async () => {
    const user1BalanceBefore = await user1Wallet.getBalance(
      user1Wallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    const broadcastTx = () =>
      user1Wallet.execute(
        user1Wallet.address as string,
        lppContractAddress,
        distributeRewardsMsg,
        customFees.exec,
        undefined,
      );

    await expect(broadcastTx).rejects.toThrow(
      /^.*Expecting funds of unls but found none.*/,
    );

    const user1BalanceAfter = await user1Wallet.getBalance(
      user1Wallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    expect(+user1BalanceAfter).toBe(+user1BalanceBefore);
  });

  test('the dispatcher tries to send rewards in unsupported lpp currency - should produce an error', async () => {
    const user1BalanceBefore = await user1Wallet.getBalance(
      user1Wallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    const distributeRewardsMsg = { distribute_rewards: [] };
    const rewards = { amount: '10', denom: lppDenom };

    const broadcastTx = () =>
      user1Wallet.execute(
        user1Wallet.address as string,
        lppContractAddress,
        distributeRewardsMsg,
        customFees.exec,
        undefined,
        [rewards],
      );

    await expect(broadcastTx).rejects.toThrow(
      /^.*Found currency uusdc expecting unls.*/,
    );

    const user1BalanceAfter = await user1Wallet.getBalance(
      user1Wallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    expect(+user1BalanceAfter).toBe(+user1BalanceBefore);
  });

  test('the lender tries to claim 0 amount rewards - should produce an error', async () => {
    const newLenderWallet = await createWallet();
    const lenderRewards = await leaseInstance.getLenderRewards(
      lppContractAddress,
      newLenderWallet.address as string,
    );
    expect(lenderRewards.rewards.amount).toBe('0');

    await sendInitExecuteFeeTokens(
      user1Wallet,
      newLenderWallet.address as string,
    );

    const lenderBalanceBefore = await newLenderWallet.getBalance(
      newLenderWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    const broadcastTx = () =>
      leaseInstance.claimRewards(
        lppContractAddress,
        newLenderWallet,
        undefined,
        customFees.exec,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*TO DO.*/);

    const lenderBalanceAfter = await newLenderWallet.getBalance(
      newLenderWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    expect(+lenderBalanceAfter).toBe(+lenderBalanceBefore);
  });
});
