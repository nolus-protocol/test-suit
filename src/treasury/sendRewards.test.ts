import NODE_ENDPOINT, {
  getUser1Wallet,
  createWallet,
  getWasmAdminWallet,
} from '../util/clients';
import {
  customFees,
  gasPrice,
  NATIVE_MINIMAL_DENOM,
  NATIVE_TICKER,
} from '../util/utils';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import { Asset } from '@nolus/nolusjs/build/contracts';
import { runOrSkip } from '../util/testingRules';

runOrSkip(process.env.TEST_TREASURY as string)(
  'Treasury tests - Request rewards',
  () => {
    let userWithBalanceWallet: NolusWallet;
    let wasmAdminWallet: NolusWallet;
    let newDispatcherWallet: NolusWallet;
    let treasuryInstance: NolusContracts.Treasury;
    const treasuryContractAddress = process.env.TREASURY_ADDRESS as string;
    let rewards: Asset;
    let cosm: any;

    const percision = 100000;
    const gasPriceInteger = gasPrice * percision;

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      cosm = await NolusClient.getInstance().getCosmWasmClient();

      userWithBalanceWallet = await getUser1Wallet();
      newDispatcherWallet = await createWallet();
      wasmAdminWallet = await getWasmAdminWallet();

      treasuryInstance = new NolusContracts.Treasury(
        cosm,
        treasuryContractAddress,
      );

      rewards = { ticker: NATIVE_TICKER, amount: '100000' };
    });

    test('the configured dispatcher account tries to request rewards from the treasury - should work as expected', async () => {
      const dispatcherBalanceBeforeFirstReward =
        await userWithBalanceWallet.getBalance(
          newDispatcherWallet.address as string,
          NATIVE_MINIMAL_DENOM,
        );

      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        wasmAdminWallet.address as string,
      );

      await treasuryInstance.configRewardsTransfer(
        wasmAdminWallet,
        newDispatcherWallet.address as string,
        customFees.exec,
      );

      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        newDispatcherWallet.address as string,
      );

      const treasuryBalanceBeforeFirstReward = await cosm.getBalance(
        treasuryContractAddress,
        NATIVE_MINIMAL_DENOM,
      );

      await treasuryInstance.sendRewards(
        newDispatcherWallet,
        rewards,
        customFees.exec,
      );

      const treasuryBalanceAfterFirstReward = await cosm.getBalance(
        treasuryContractAddress,
        NATIVE_MINIMAL_DENOM,
      );

      const dispatcherBalanceAfterFirstReward =
        await userWithBalanceWallet.getBalance(
          newDispatcherWallet.address as string,
          NATIVE_MINIMAL_DENOM,
        );

      expect(BigInt(dispatcherBalanceAfterFirstReward.amount)).toBe(
        BigInt(dispatcherBalanceBeforeFirstReward.amount) +
          BigInt(rewards.amount),
      );

      // balanceBefore - rewards + 40%gas
      expect(BigInt(treasuryBalanceAfterFirstReward.amount)).toBe(
        BigInt(treasuryBalanceBeforeFirstReward.amount) -
          BigInt(rewards.amount) +
          BigInt(customFees.exec.amount[0].amount) -
          (BigInt(customFees.exec.gas) * BigInt(gasPriceInteger)) /
            BigInt(percision),
      );

      // send rewards more than once
      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        newDispatcherWallet.address as string,
      );

      await treasuryInstance.sendRewards(
        newDispatcherWallet,
        rewards,
        customFees.exec,
      );

      const dispatcherBalanceAfterSecondReward =
        await userWithBalanceWallet.getBalance(
          newDispatcherWallet.address as string,
          NATIVE_MINIMAL_DENOM,
        );

      expect(BigInt(dispatcherBalanceAfterSecondReward.amount)).toBe(
        BigInt(dispatcherBalanceAfterFirstReward.amount) +
          BigInt(rewards.amount),
      );
    });

    test('an unauthorized user tries to request rewards from the treasury - should produce an error', async () => {
      const broadcastTx = () =>
        treasuryInstance.sendRewards(
          userWithBalanceWallet,
          rewards,
          customFees.exec,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*Unauthorized.*/);
    });

    test('an unauthorized user tries to change dispatcher address - should produce an error', async () => {
      const broadcastTx = () =>
        treasuryInstance.configRewardsTransfer(
          userWithBalanceWallet,
          userWithBalanceWallet.address as string as string,
          customFees.exec,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*Unauthorized.*/);
    });

    test('the configured dispatcher account tries to request 0 rewards from the treasury - should produce an error', async () => {
      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        newDispatcherWallet.address as string,
      );

      rewards.amount = '0';

      const broadcastTx = () =>
        treasuryInstance.sendRewards(
          newDispatcherWallet,
          rewards,
          customFees.exec,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*0unls: invalid coins.*/);
    });

    test('the configured dispatcher account tries to request more rewards than the treasury has - should produce an error', async () => {
      const dispatcherBalanceBefore = await userWithBalanceWallet.getBalance(
        newDispatcherWallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      const treasuryBalanceBefore = await cosm.getBalance(
        treasuryContractAddress,
        NATIVE_MINIMAL_DENOM,
      );

      const excess = 1;

      rewards.amount = (
        BigInt(treasuryBalanceBefore.amount) +
        BigInt(excess) +
        BigInt(customFees.exec.amount[0].amount) -
        (BigInt(customFees.exec.gas) * BigInt(gasPriceInteger)) /
          BigInt(percision)
      ).toString();

      const broadcastTx = () =>
        treasuryInstance.sendRewards(
          newDispatcherWallet,
          rewards,
          customFees.exec,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*insufficient funds.*/);

      const dispatcherBalanceAfter = await userWithBalanceWallet.getBalance(
        newDispatcherWallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      const treasuryBalanceAfter = await cosm.getBalance(
        treasuryContractAddress,
        NATIVE_MINIMAL_DENOM,
      );

      expect(BigInt(treasuryBalanceAfter.amount)).toBe(
        BigInt(treasuryBalanceBefore.amount) +
          BigInt(customFees.exec.amount[0].amount) -
          (BigInt(customFees.exec.gas) * BigInt(gasPriceInteger)) /
            BigInt(percision),
      );

      expect(BigInt(dispatcherBalanceAfter.amount)).toBe(
        BigInt(dispatcherBalanceBefore.amount) -
          BigInt(customFees.exec.amount[0].amount),
      );
    });
  },
);
