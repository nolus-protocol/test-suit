import NODE_ENDPOINT, { getUser1Wallet } from '../util/clients';
import { customFees, NATIVE_MINIMAL_DENOM } from '../util/utils';
import { NolusClient, NolusWallet } from '@nolus/nolusjs';
import { runOrSkip } from '../util/testingRules';
import { sendSudoContractProposal } from '../util/proposals';

runOrSkip(process.env.TEST_TREASURY as string)(
  'Treasury tests - Permissions',
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

    test('user tries to propose invalid contract address as a reward dispatcher - should produce an error', async () => {
      const configureRewardTransferMsg = {
        configure_reward_transfer: {
          rewards_dispatcher: userWithBalanceWallet.address as string,
        },
      };

      const broadcastTx = await sendSudoContractProposal(
        userWithBalanceWallet,
        treasuryContractAddress,
        JSON.stringify(configureRewardTransferMsg),
      );

      expect(broadcastTx.rawLog).toContain('No such contract');
    });
  },
);
