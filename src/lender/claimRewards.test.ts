import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { Coin } from '@cosmjs/proto-signing';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import {
  customFees,
  NATIVE_MINIMAL_DENOM,
  NATIVE_TICKER,
  undefinedHandler,
} from '../util/utils';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import { currencyTicker_To_IBC } from '../util/smart-contracts/calculations';

const maybe =
  (process.env.TEST_LENDER as string).toLowerCase() !== 'false' &&
  +(process.env.LENDER_DEPOSIT_CAPACITY as string) !== 0
    ? describe
    : describe.skip;

maybe('Lender tests - Claim rewards', () => {
  let cosm: CosmWasmClient;
  let userWithBalance: NolusWallet;
  let lppInstance: NolusContracts.Lpp;
  let lenderWallet: NolusWallet;
  let lppCurrency: string;
  let lppCurrencyToIBC: string;
  let rewards: Coin;
  let deposit: string;

  const lppContractAddress = process.env.LPP_ADDRESS as string;

  async function testDistributeRewardsInvalidCases(
    errorMsg: string,
    rewards?: Coin,
  ) {
    const dispatcherBalanceBefore = await userWithBalance.getBalance(
      userWithBalance.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    const broadcastTx = () =>
      lppInstance.distributeRewards(
        userWithBalance,
        customFees.exec,
        rewards ? [rewards] : undefined,
      );

    await expect(broadcastTx).rejects.toThrow(errorMsg);

    const dispatcherBalanceAfter = await userWithBalance.getBalance(
      userWithBalance.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    if (!rewards) {
      undefinedHandler();
      return;
    }

    if (+rewards.amount === 0) {
      expect(dispatcherBalanceAfter.amount).toBe(
        dispatcherBalanceBefore.amount,
      );
    } else {
      expect(BigInt(dispatcherBalanceAfter.amount)).toBe(
        BigInt(dispatcherBalanceBefore.amount) -
          BigInt(customFees.exec.amount[0].amount),
      );
    }
  }

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    cosm = await NolusClient.getInstance().getCosmWasmClient();
    lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);

    userWithBalance = await getUser1Wallet();
    lenderWallet = await createWallet();

    lppCurrency = process.env.LPP_BASE_CURRENCY as string;
    lppCurrencyToIBC = currencyTicker_To_IBC(lppCurrency);

    rewards = { amount: '200000000', denom: NATIVE_MINIMAL_DENOM };

    const depositCapacity = await lppInstance.getDepositCapacity();
    depositCapacity
      ? (deposit = Math.ceil(depositCapacity.amount / 10000).toString())
      : (deposit = '100');

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

    await lppInstance.deposit(lenderWallet, customFees.exec, [
      { denom: lppCurrencyToIBC, amount: deposit },
    ]);

    const lenderDepositAfter = await lppInstance.getLenderDeposit(
      lenderWallet.address as string,
    );

    expect(BigInt(lenderDepositAfter.balance)).toBeGreaterThan(
      BigInt(lenderDepositBefore.balance),
    );
  });

  test('the successful scenario of rewards claiming - should work as expected', async () => {
    const lppBalance = await lppInstance.getLppBalance();

    const lenderDeposit = await lppInstance.getLenderDeposit(
      lenderWallet.address as string,
    );

    const lenderBalanceBefore = await lenderWallet.getBalance(
      lenderWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    const userWithBalanceBalanceBefore = await userWithBalance.getBalance(
      userWithBalance.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    await lppInstance.distributeRewards(userWithBalance, customFees.exec, [
      rewards,
    ]);

    const userWithBalanceBalanceAfter = await userWithBalance.getBalance(
      userWithBalance.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    expect(BigInt(userWithBalanceBalanceAfter.amount)).toBe(
      BigInt(userWithBalanceBalanceBefore.amount) -
        BigInt(rewards.amount) -
        BigInt(customFees.exec.amount[0].amount),
    );

    const lenderRewards = await lppInstance.getLenderRewards(
      lenderWallet.address as string,
    );

    const calcLenderRewards = Math.trunc(
      (+rewards.amount / +lppBalance.balance_nlpn.amount) *
        +lenderDeposit.balance,
    );

    expect(+lenderRewards.rewards.amount).toBe(calcLenderRewards);

    await sendInitExecuteFeeTokens(
      userWithBalance,
      lenderWallet.address as string,
    );

    await lppInstance.claimRewards(lenderWallet, undefined, customFees.exec);

    const lenderBalanceAfter = await lenderWallet.getBalance(
      lenderWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    expect(BigInt(lenderBalanceAfter.amount)).toBe(
      BigInt(lenderBalanceBefore.amount) + BigInt(lenderRewards.rewards.amount),
    );
  });

  test('a lender tries to receive rewards in another account - should work as expected', async () => {
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

    const lenderBalanceBefore = await lenderWallet.getBalance(
      lenderWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    const otherRecipientBalanceBefore = await recipientWallet.getBalance(
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

    const lenderBalanceAfter = await lenderWallet.getBalance(
      lenderWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    const otherRecipientBalanceAfter = await recipientWallet.getBalance(
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
    const rewards = { amount: '0', denom: NATIVE_MINIMAL_DENOM };

    await testDistributeRewardsInvalidCases('invalid coins', rewards);
  });

  test('the dispatcher tries not to send funds when calling "distribute_rewards" msg - should produce an error', async () => {
    await testDistributeRewardsInvalidCases(
      `Expecting funds of ${NATIVE_TICKER} but found non`,
    );
  });

  test('the dispatcher tries to send rewards in an unsupported currency - should produce an error', async () => {
    const rewards = { amount: '10', denom: lppCurrencyToIBC };

    await testDistributeRewardsInvalidCases(
      `Found a symbol '${lppCurrencyToIBC}' pretending to be the bank symbol of the currency with ticker '${NATIVE_TICKER}'`,
      rewards,
    );
  });

  test('a lender tries to claim unavailable rewards - should produce an error', async () => {
    const newLenderWallet = await createWallet();

    const lenderRewardsTx = () =>
      lppInstance.getLenderRewards(newLenderWallet.address as string);

    await expect(lenderRewardsTx).rejects.toThrow(
      /^.*The deposit does not exist.*/,
    );

    const lenderBalanceBefore = await newLenderWallet.getBalance(
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

    const lenderBalanceAfter = await newLenderWallet.getBalance(
      newLenderWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    expect(lenderBalanceAfter.amount).toBe(lenderBalanceBefore.amount);
  });
});
