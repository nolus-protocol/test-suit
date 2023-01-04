import NODE_ENDPOINT, { getUser1Wallet } from '../util/clients';
import { customFees, gasPrice, NATIVE_TICKER } from '../util/utils';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { runOrSkip } from '../util/testingRules';

runOrSkip(process.env.TEST_TREASURY as string)(
  'Treasury tests - Request rewards',
  () => {
    let userWithBalanceWallet: NolusWallet;
    let treasuryInstance: NolusContracts.Treasury;
    const treasuryContractAddress = process.env.TREASURY_ADDRESS as string;
    let cosm: any;

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      cosm = await NolusClient.getInstance().getCosmWasmClient();

      userWithBalanceWallet = await getUser1Wallet();

      treasuryInstance = new NolusContracts.Treasury(
        cosm,
        treasuryContractAddress,
      );
    });

    test('an unregistered dispatcher tries to request rewards from the treasury - should produce an error', async () => {
      const rewards = { ticker: NATIVE_TICKER, amount: '1000' };

      const broadcastTx = () =>
        treasuryInstance.sendRewards(
          userWithBalanceWallet,
          rewards,
          customFees.exec,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*Addr not found.*/);
    });

    test('an unauthorized user tries to change dispatcher address - should produce an error', async () => {
      const dispatcherContractAddress = process.env
        .DISPATCHER_ADDRESS as string;

      const broadcastTx = () =>
        treasuryInstance.configRewardsTransfer(
          userWithBalanceWallet,
          dispatcherContractAddress,
          customFees.exec,
        );

      await expect(broadcastTx).rejects.toThrow(
        /^.*Checked address doesn't match the one associated with access control variable.*/,
      );
    });
  },
);
