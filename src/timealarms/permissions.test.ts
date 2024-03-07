import { NolusClient, NolusWallet } from '@nolus/nolusjs';
import { TONANOSEC, customFees } from '../util/utils';
import NODE_ENDPOINT, { getUser1Wallet } from '../util/clients';
import { runOrSkip } from '../util/testingRules';

runOrSkip(process.env.TEST_TIMEALARMS as string)(
  'Timealarms tests - Permissions',
  () => {
    let userWithBalanceWallet: NolusWallet;
    const timeAlarmsContractAddress = process.env.TIMEALARMS_ADDRESS as string;

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      userWithBalanceWallet = await getUser1Wallet();
    });

    test('user tries to exec addAlarm', async () => {
      const addAlarmMsg = {
        add_alarm: {
          time: ((new Date().getTime() / 1000 + 5 * 60) * TONANOSEC).toString(), // now+5min
        },
      };

      const dispatchTimeAlarm = () =>
        userWithBalanceWallet.execute(
          userWithBalanceWallet.address as string,
          timeAlarmsContractAddress,
          addAlarmMsg,
          customFees.exec,
        );

      await expect(dispatchTimeAlarm).rejects.toThrow(/^.*No such contract.*/);
    });
  },
);
