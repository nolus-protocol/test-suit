import { NolusClient, NolusWallet } from '@nolus/nolusjs';
import { customFees } from '../util/utils';
import NODE_ENDPOINT, { getUser1Wallet } from '../util/clients';
import { runOrSkip } from '../util/testingRules';

runOrSkip(process.env.TEST_BORROWER as string)(
  'Borrower tests - Permissions',
  () => {
    let userWithBalanceWallet: NolusWallet;
    const leaserContractAddress = process.env.LEASER_ADDRESS as string;

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      userWithBalanceWallet = await getUser1Wallet();
    });

    test('migrate msg should only be exec via proposal', async () => {
      const migrateContractMsg = {};

      await userWithBalanceWallet.transferAmount(
        userWithBalanceWallet.address as string,
        customFees.configs.amount,
        customFees.transfer,
      );

      const broadcastTx = () =>
        userWithBalanceWallet.migrate(
          userWithBalanceWallet.address as string,
          leaserContractAddress,
          1,
          migrateContractMsg,
          customFees.configs,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*unauthorized.*/);
    });

    test('migrate leases msg should only be exec via proposal', async () => {
      const migrateLeasesMsg = {
        migrate_leases: { new_code_id: '2', max_leases: 1000 },
      };

      await userWithBalanceWallet.transferAmount(
        userWithBalanceWallet.address as string,
        customFees.configs.amount,
        customFees.transfer,
      );

      const broadcastTx = () =>
        userWithBalanceWallet.executeContract(
          leaserContractAddress,
          migrateLeasesMsg,
          customFees.configs,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*Unauthorized access.*/);
    });

    test('migrate lease continue msg should only be exec via proposal', async () => {
      const migrateLeasesContMsg = {
        migrate_leases_cont: { key: leaserContractAddress, max_leases: 1000 },
      };

      await userWithBalanceWallet.transferAmount(
        userWithBalanceWallet.address as string,
        customFees.configs.amount,
        customFees.transfer,
      );

      const broadcastTx = () =>
        userWithBalanceWallet.executeContract(
          leaserContractAddress,
          migrateLeasesContMsg,
          customFees.configs,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*Unauthorized access.*/);
    });

    test('finalize lease msg should only be exec by a lease', async () => {
      const finalizeLeaseMsg = {
        finalize_lease: { customer: userWithBalanceWallet.address as string },
      };

      await userWithBalanceWallet.transferAmount(
        userWithBalanceWallet.address as string,
        customFees.configs.amount,
        customFees.transfer,
      );

      const broadcastTx = () =>
        userWithBalanceWallet.executeContract(
          leaserContractAddress,
          finalizeLeaseMsg,
          customFees.configs,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*No such contract.*/);
    });
  },
);
