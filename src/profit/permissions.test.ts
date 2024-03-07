import { NolusClient, NolusWallet } from '@nolus/nolusjs';
import { customFees } from '../util/utils';
import NODE_ENDPOINT, { getUser1Wallet } from '../util/clients';
import { runOrSkip } from '../util/testingRules';

runOrSkip(process.env.TEST_PROFIT as string)(
  'Profit tests - Permissions',
  () => {
    let userWithBalanceWallet: NolusWallet;
    const profitContractAddress = process.env.PROFIT_ADDRESS as string;

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      userWithBalanceWallet = await getUser1Wallet();
    });

    test('an unauthorized user tries to update cadance_hours', async () => {
      const configMsg = { config: { cadence_hours: 10 } };

      const config = () =>
        userWithBalanceWallet.execute(
          userWithBalanceWallet.address as string,
          profitContractAddress,
          configMsg,
          customFees.exec,
        );

      await expect(config).rejects.toThrow(/^.*Unauthorized access.*/);
    });

    test('an unauthorized user tries to exec timeAlarm', async () => {
      const timeAlarmMsg = { time_alarm: {} };

      const dispatchTimeAlarm = () =>
        userWithBalanceWallet.execute(
          userWithBalanceWallet.address as string,
          profitContractAddress,
          timeAlarmMsg,
          customFees.exec,
        );

      await expect(dispatchTimeAlarm).rejects.toThrow(
        /^.*Unauthorized access.*/,
      );
    });
  },
);
