import NODE_ENDPOINT, { getUser1Wallet } from '../util/clients';
import { customFees, NATIVE_MINIMAL_DENOM } from '../util/utils';
import { NolusClient, NolusWallet } from '@nolus/nolusjs';
import { runOrSkip } from '../util/testingRules';

runOrSkip(process.env.TEST_TREASURY as string)(
  'Treasury tests - Permissions',
  () => {
    let userWithBalanceWallet: NolusWallet;
    const treasuryContractAddress = process.env.TREASURY_ADDRESS as string;

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      userWithBalanceWallet = await getUser1Wallet();
    });

    test('an unauthorized user tries to exec timeAlarm', async () => {
      const timeAlarmMsg = { time_alarm: {} };

      const dispatchTimeAlarm = () =>
        userWithBalanceWallet.execute(
          userWithBalanceWallet.address as string,
          treasuryContractAddress,
          timeAlarmMsg,
          customFees.exec,
        );

      await expect(dispatchTimeAlarm).rejects.toThrow(
        /^.*Unauthorized access.*/,
      );
    });
  },
);
