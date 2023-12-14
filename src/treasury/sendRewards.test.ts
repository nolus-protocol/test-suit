import NODE_ENDPOINT, { getUser1Wallet } from '../util/clients';
import { customFees, NATIVE_MINIMAL_DENOM } from '../util/utils';
import { NolusClient, NolusWallet } from '@nolus/nolusjs';
import { runOrSkip } from '../util/testingRules';

runOrSkip(process.env.TEST_TREASURY as string)(
  'Treasury tests - Request rewards',
  () => {
    let userWithBalanceWallet: NolusWallet;
    const treasuryContractAddress = process.env.TREASURY_ADDRESS as string;

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      userWithBalanceWallet = await getUser1Wallet();
    });

    test('an unregistered dispatcher tries to request rewards from the treasury - should produce an error', async () => {
      const rewards = { denom: NATIVE_MINIMAL_DENOM, amount: '1000' };

      const sendRewardsMsg = {
        send_rewards: { amount: { amount: rewards.amount } },
      };

      const broadcastTx = () =>
        userWithBalanceWallet.executeContract(
          treasuryContractAddress,
          sendRewardsMsg,
          customFees.exec,
          undefined,
          [rewards],
        );

      await expect(broadcastTx).rejects.toThrow(/^.*Unauthorized access.*/);
    });
  },
);
