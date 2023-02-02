import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { Coin } from '@cosmjs/proto-signing';
import { runOrSkip } from '../util/testingRules';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import { customFees, NATIVE_MINIMAL_DENOM, NATIVE_TICKER } from '../util/utils';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import { currencyTicker_To_IBC } from '../util/smart-contracts/calculations';

runOrSkip(process.env.TEST_LENDER as string)(
  'Lender tests - Claim rewards',
  () => {
    let userWithBalance: NolusWallet;
    let lenderWallet: NolusWallet;
    let lppCurrency: string;
    let lppCurrencyToIBC: string;
    let lppInstance: NolusContracts.Lpp;
    let rewards: Coin;
    let cosm: CosmWasmClient;

    const lppContractAddress = process.env.LPP_ADDRESS as string;
    const deposit = '100';

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      cosm = await NolusClient.getInstance().getCosmWasmClient();

      userWithBalance = await getUser1Wallet();
      lenderWallet = await createWallet();

      lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);

      const lppConfig = await lppInstance.getLppConfig();
      lppCurrency = lppConfig.lpn_ticker;
      lppCurrencyToIBC = currencyTicker_To_IBC(lppCurrency);

      rewards = { amount: '200000000', denom: NATIVE_MINIMAL_DENOM };
    });

    test('the successful claim rewards scenario - should work as expected', async () => {
      const lppBalanceBefore = await lppInstance.getLppBalance();
      const lenderDepositBefore = await lppInstance.getLenderDeposit(
        lenderWallet.address as string,
      );

      await userWithBalance.transferAmount(
        lenderWallet.address as string,
        [{ denom: lppCurrencyToIBC, amount: deposit }],
        customFees.transfer,
      );

      await sendInitExecuteFeeTokens(
        userWithBalance,
        lenderWallet.address as string,
      );

      // provide rewards
      await lppInstance.deposit(lenderWallet, customFees.exec, [
        { denom: lppCurrencyToIBC, amount: deposit },
      ]);

      const lppBalanceAfter = await lppInstance.getLppBalance();

      const lenderDepositAfter = await lppInstance.getLenderDeposit(
        lenderWallet.address as string,
      );

      expect(BigInt(lppBalanceAfter.balance.amount)).toBe(
        BigInt(lppBalanceBefore.balance.amount) + BigInt(deposit),
      );
      expect(BigInt(lenderDepositAfter.balance)).toBeGreaterThan(
        BigInt(lenderDepositBefore.balance),
      );

      const lenderBalanceBefore = await cosm.getBalance(
        lenderWallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      const feederBalanceBefore = await cosm.getBalance(
        userWithBalance.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      await lppInstance.distributeRewards(userWithBalance, customFees.exec, [
        rewards,
      ]);

      const feederBalanceAfter = await cosm.getBalance(
        userWithBalance.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      expect(BigInt(feederBalanceAfter.amount)).toBe(
        BigInt(feederBalanceBefore.amount) -
          BigInt(rewards.amount) -
          BigInt(customFees.exec.amount[0].amount),
      );

      const lenderRewards = await lppInstance.getLenderRewards(
        lenderWallet.address as string,
      );

      const calcLenderRewards = Math.trunc(
        (+rewards.amount / +lppBalanceAfter.balance_nlpn.amount) *
          +lenderDepositAfter.balance,
      );

      expect(+lenderRewards.rewards.amount).toBe(calcLenderRewards);

      // claim rewards
      await sendInitExecuteFeeTokens(
        userWithBalance,
        lenderWallet.address as string,
      );

      await lppInstance.claimRewards(lenderWallet, undefined, customFees.exec);

      const lenderBalanceAfter = await cosm.getBalance(
        lenderWallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      expect(BigInt(lenderBalanceAfter.amount)).toBe(
        BigInt(lenderBalanceBefore.amount) +
          BigInt(lenderRewards.rewards.amount),
      );
    });

    test('lender tries to receive rewards in another account - should work as expected', async () => {
      const recipientWallet = await createWallet();

      const lenderRewardsBefore = await lppInstance.getLenderRewards(
        lenderWallet.address as string,
      );

      await lppInstance.distributeRewards(userWithBalance, customFees.exec, [
        rewards,
      ]);

      const lenderRewardsAfter = await lppInstance.getLenderRewards(
        lenderWallet.address as string,
      );

      expect(BigInt(lenderRewardsAfter.rewards.amount)).toBeGreaterThan(
        BigInt(lenderRewardsBefore.rewards.amount),
      );

      const lenderBalanceBefore = await cosm.getBalance(
        lenderWallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      const otherRecipientBalanceBefore = await cosm.getBalance(
        recipientWallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      await sendInitExecuteFeeTokens(
        userWithBalance,
        lenderWallet.address as string,
      );
      await lppInstance.claimRewards(
        lenderWallet,
        recipientWallet.address as string,
        customFees.exec,
      );

      const lenderBalanceAfter = await cosm.getBalance(
        lenderWallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      const otherRecipientBalanceAfter = await cosm.getBalance(
        recipientWallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      expect(BigInt(lenderBalanceAfter.amount)).toBe(
        BigInt(lenderBalanceBefore.amount),
      );

      expect(BigInt(otherRecipientBalanceAfter.amount)).toBe(
        BigInt(otherRecipientBalanceBefore.amount) +
          BigInt(lenderRewardsAfter.rewards.amount),
      );
    });

    test('the dispatcher tries to send 0 rewards - should produce an error', async () => {
      const dispatcherBalanceBefore = await cosm.getBalance(
        userWithBalance.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      const rewards = { amount: '0', denom: NATIVE_MINIMAL_DENOM };

      const broadcastTx = () =>
        lppInstance.distributeRewards(userWithBalance, customFees.exec, [
          rewards,
        ]);

      await expect(broadcastTx).rejects.toThrow(/^.*invalid coins.*/);

      const dispatcherBalanceAfter = await cosm.getBalance(
        userWithBalance.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      expect(dispatcherBalanceAfter.amount).toBe(
        dispatcherBalanceBefore.amount,
      );
    });

    test('the dispatcher tries not to send funds when calling "distribute rewards" msg - should produce an error', async () => {
      const dispatcherBalanceBefore = await cosm.getBalance(
        userWithBalance.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      const broadcastTx = () =>
        lppInstance.distributeRewards(userWithBalance, customFees.exec);

      await expect(broadcastTx).rejects.toThrow(
        `Expecting funds of ${NATIVE_TICKER} but found none`,
      );

      const dispatcherBalanceAfter = await cosm.getBalance(
        userWithBalance.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      expect(BigInt(dispatcherBalanceAfter.amount)).toBe(
        BigInt(dispatcherBalanceBefore.amount) -
          BigInt(customFees.exec.amount[0].amount),
      );
    });

    test('the dispatcher tries to send rewards in unsupported currency - should produce an error', async () => {
      const dispatcherBalanceBefore = await cosm.getBalance(
        userWithBalance.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      const rewards = { amount: '10', denom: lppCurrencyToIBC };

      const broadcastTx = () =>
        lppInstance.distributeRewards(userWithBalance, customFees.exec, [
          rewards,
        ]);

      await expect(broadcastTx).rejects.toThrow(
        `Found bank symbol '${lppCurrencyToIBC}' expecting '${NATIVE_MINIMAL_DENOM}'`,
      );

      const dispatcherBalanceAfter = await cosm.getBalance(
        userWithBalance.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      expect(BigInt(dispatcherBalanceAfter.amount)).toBe(
        BigInt(dispatcherBalanceBefore.amount) -
          BigInt(customFees.exec.amount[0].amount),
      );
    });

    test('lender tries to claim unavailable rewards - should produce an error', async () => {
      const newLenderWallet = await createWallet();
      const lenderRewardsTx = () =>
        lppInstance.getLenderRewards(newLenderWallet.address as string);
      await expect(lenderRewardsTx).rejects.toThrow(
        /^.*The deposit does not exist.*/,
      );

      const lenderBalanceBefore = await cosm.getBalance(
        newLenderWallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      await sendInitExecuteFeeTokens(
        userWithBalance,
        newLenderWallet.address as string,
      );

      const broadcastTx = () =>
        lppInstance.claimRewards(newLenderWallet, undefined, customFees.exec);

      await expect(broadcastTx).rejects.toThrow(
        /^.*The deposit does not exist.*/,
      );

      const lenderBalanceAfter = await cosm.getBalance(
        newLenderWallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      expect(lenderBalanceAfter.amount).toBe(lenderBalanceBefore.amount);
    });
  },
);
