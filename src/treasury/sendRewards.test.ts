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
  let leaseInstance: NolusContracts.Lease;
  const treasuryContractAddress = process.env.TREASURY_ADDRESS as string;
  let rewards: Asset;

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    newDispatcherWallet = await createWallet();
    wasmAdminWallet = await getWasmAdminWallet();

    const cosm = await NolusClient.getInstance().getCosmWasmClient();
    leaseInstance = new NolusContracts.Lease(cosm);

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

    await leaseInstance.configRewardsTransfer(
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

    await leaseInstance.sendRewardsMsg(
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

    expect(+dispatcherBalanceAfterFirstReward.amount).toBe(
      +dispatcherBalanceBeforeFirstReward.amount + +rewards.amount,
    );

    // balanceBefore - rewards + 40%gas
    expect(+treasuryBalanceAfterFirstReward.amount).toBe(
      +treasuryBalanceBeforeFirstReward.amount -
        +rewards.amount +
        (+customFees.exec.amount[0].amount -
          Math.floor(+customFees.exec.gas * gasPrice)),
    );

    //send more than once
    await sendInitExecuteFeeTokens(
      user1Wallet,
      newDispatcherWallet.address as string,
    );

    await leaseInstance.sendRewardsMsg(
      treasuryContractAddress,
      newDispatcherWallet,
      rewards,
      customFees.exec,
    );

    const dispatcherBalanceAfterSecondReward = await user1Wallet.getBalance(
      newDispatcherWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    expect(+dispatcherBalanceAfterSecondReward.amount).toBe(
      +dispatcherBalanceAfterFirstReward.amount + +rewards.amount,
    );
  });

  test('an unauthorized user tries to request rewards from the treasury - should produce an error', async () => {
    const broadcastTx = () =>
      leaseInstance.sendRewardsMsg(
        treasuryContractAddress,
        user1Wallet,
        rewards,
        customFees.exec,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*Unauthorized.*/);
  });

  test('an unauthorized user tries to change dispatcher address - should produce an error', async () => {
    const broadcastTx = () =>
      leaseInstance.configRewardsTransfer(
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
      leaseInstance.sendRewardsMsg(
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

    rewards.amount = (
      +treasuryBalanceBefore.amount +
      1 +
      (+customFees.exec.amount[0].amount -
        Math.floor(+customFees.exec.gas * gasPrice))
    ).toString();

    const broadcastTx = () =>
      leaseInstance.sendRewardsMsg(
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

    expect(treasuryBalanceAfter.amount).toBe(
      (
        +treasuryBalanceBefore.amount +
        (+customFees.exec.amount[0].amount -
          Math.floor(+customFees.exec.gas * gasPrice))
      ).toString(),
    );
    expect(+dispatcherBalanceAfter.amount).toBe(
      +dispatcherBalanceBefore.amount - +customFees.exec.amount[0].amount,
    );
  });
});
