import { NolusClient, NolusWallet } from '@nolus/nolusjs';
import { customFees } from '../util/utils';
import NODE_ENDPOINT, { getUser1Wallet } from '../util/clients';
import { runOrSkip } from '../util/testingRules';

runOrSkip(process.env.TEST_LENDER as string)(
  'Lender tests - Permissions',
  () => {
    let userWithBalanceWallet: NolusWallet;
    const lppContractAddress = process.env.LPP_ADDRESS as string;

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      userWithBalanceWallet = await getUser1Wallet();
    });

    test('lease code id should only be updated by the Leaser contract', async () => {
      const newLeaseCodeMsg = { new_lease_code: { lease_code: 2 } };

      const broadcastTx = () =>
        userWithBalanceWallet.execute(
          userWithBalanceWallet.address as string,
          lppContractAddress,
          newLeaseCodeMsg,
          customFees.exec,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*Unauthorized access.*/);
    });
  },
);
