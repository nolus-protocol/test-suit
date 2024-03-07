import { NolusClient, NolusWallet } from '@nolus/nolusjs';
import { customFees } from '../util/utils';
import NODE_ENDPOINT, { getUser1Wallet } from '../util/clients';
import { runOrSkip } from '../util/testingRules';

runOrSkip(process.env.TEST_DISPATCHER as string)(
  'Rewards Dispatcher tests - Permissions',
  () => {
    let userWithBalanceWallet: NolusWallet;
    const dispatcherContractAddress = process.env.DISPATCHER_ADDRESS as string;

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      userWithBalanceWallet = await getUser1Wallet();
    });

    test('an unauthorized user tries to exec timeAlarm', async () => {
      const timeAlarmMsg = { time_alarm: {} };

      const dispatchTimeAlarm = () =>
        userWithBalanceWallet.execute(
          userWithBalanceWallet.address as string,
          dispatcherContractAddress,
          timeAlarmMsg,
          customFees.exec,
        );

      await expect(dispatchTimeAlarm).rejects.toThrow(
        /^.*Unauthorized access.*/,
      );
    });
  },
);
