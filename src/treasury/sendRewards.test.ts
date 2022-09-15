import NODE_ENDPOINT, {
  getUser1Wallet,
  createWallet,
  getWasmAdminWallet,
} from '../util/clients';
import { customFees, gasPrice, NATIVE_MINIMAL_DENOM } from '../util/utils';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import { Asset } from '@nolus/nolusjs/build/contracts';

describe('Treasury tests - Request rewards', () => {
  let user1Wallet: NolusWallet;
  let wasmAdminWallet: NolusWallet;
  let newDispatcherWallet: NolusWallet;
  let treasuryInstance: NolusContracts.Treasury;
  const treasuryContractAddress = process.env.TREASURY_ADDRESS as string;
  let rewards: Asset;

  const percision = 100000;
  const gasPriceInteger = gasPrice * percision;

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    const cosm = await NolusClient.getInstance().getCosmWasmClient();

    user1Wallet = await getUser1Wallet();
    newDispatcherWallet = await createWallet();
    wasmAdminWallet = await getWasmAdminWallet();

    treasuryInstance = new NolusContracts.Treasury(cosm);

    rewards = { symbol: NATIVE_MINIMAL_DENOM, amount: '100000' };
  });

  test('the configured dispatcher account tries to request rewards from the treasury - should work as expected', async () => {
    const dispatcherBalanceBeforeFirstReward = await user1Wallet.getBalance(
      newDispatcherWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    await sendInitExecuteFeeTokens(
      user1Wallet,
      wasmAdminWallet.address as string,
    );

    await treasuryInstance.configRewardsTransfer(
      treasuryContractAddress,
      wasmAdminWallet,
      newDispatcherWallet.address as string,
      customFees.exec,
    );

    await sendInitExecuteFeeTokens(
      user1Wallet,
      newDispatcherWallet.address as string,
    );

    const treasuryBalanceBeforeFirstReward = await user1Wallet.getBalance(
      treasuryContractAddress,
      NATIVE_MINIMAL_DENOM,
    );

    await treasuryInstance.sendRewardsMsg(
      treasuryContractAddress,
      newDispatcherWallet,
      rewards,
      customFees.exec,
    );

    const treasuryBalanceAfterFirstReward = await user1Wallet.getBalance(
      treasuryContractAddress,
      NATIVE_MINIMAL_DENOM,
    );

    const dispatcherBalanceAfterFirstReward = await user1Wallet.getBalance(
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

    //send more than once
    await sendInitExecuteFeeTokens(
      user1Wallet,
      newDispatcherWallet.address as string,
    );

    await treasuryInstance.sendRewardsMsg(
      treasuryContractAddress,
      newDispatcherWallet,
      rewards,
      customFees.exec,
    );

    const dispatcherBalanceAfterSecondReward = await user1Wallet.getBalance(
      newDispatcherWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    expect(BigInt(dispatcherBalanceAfterSecondReward.amount)).toBe(
      BigInt(dispatcherBalanceAfterFirstReward.amount) + BigInt(rewards.amount),
    );
  });

  test('an unauthorized user tries to request rewards from the treasury - should produce an error', async () => {
    const broadcastTx = () =>
      treasuryInstance.sendRewardsMsg(
        treasuryContractAddress,
        user1Wallet,
        rewards,
        customFees.exec,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*Unauthorized.*/);
  });

  test('an unauthorized user tries to change dispatcher address - should produce an error', async () => {
    const broadcastTx = () =>
      treasuryInstance.configRewardsTransfer(
        treasuryContractAddress,
        user1Wallet,
        user1Wallet.address as string as string,
        customFees.exec,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*Unauthorized.*/);
  });

  test('the configured dispatcher account tries to request 0 rewards from the treasury - should produce an error', async () => {
    await sendInitExecuteFeeTokens(
      user1Wallet,
      newDispatcherWallet.address as string,
    );

    rewards.amount = '0';

    const broadcastTx = () =>
      treasuryInstance.sendRewardsMsg(
        treasuryContractAddress,
        newDispatcherWallet,
        rewards,
        customFees.exec,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*0unls: invalid coins.*/);
  });

  test('the configured dispatcher account tries to request more rewards than the treasury has - should produce an error', async () => {
    const dispatcherBalanceBefore = await user1Wallet.getBalance(
      newDispatcherWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    const treasuryBalanceBefore = await user1Wallet.getBalance(
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
      treasuryInstance.sendRewardsMsg(
        treasuryContractAddress,
        newDispatcherWallet,
        rewards,
        customFees.exec,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*insufficient funds.*/);

    const dispatcherBalanceAfter = await user1Wallet.getBalance(
      newDispatcherWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    const treasuryBalanceAfter = await user1Wallet.getBalance(
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
});
