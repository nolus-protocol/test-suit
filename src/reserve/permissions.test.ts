import { NolusClient, NolusWallet } from '@nolus/nolusjs';
import NODE_ENDPOINT, { getUser1Wallet } from '../util/clients';
import { customFees } from '../util/utils';
import { runOrSkip } from '../util/testingRules';

runOrSkip(process.env.TEST_RESERVE as string)(
  'Reserve tests - Permissions',
  () => {
    let userWithBalanceWallet: NolusWallet;
    const reserveContractAddress = process.env.RESERVE_ADDRESS as string;
    const lpn = process.env.LPP_BASE_CURRENCY as string;

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      userWithBalanceWallet = await getUser1Wallet();
    });

    test('instantiate msg should only be exec via proposal', async () => {
      const instantiateContractMsg = {
        protocol_admin: process.env.LEASER_ADDRESS,
        lease_code_id: process.env.LEASE_CODE_ID,
      };

      const reserveCodeId = 1;

      await userWithBalanceWallet.transferAmount(
        userWithBalanceWallet.address as string,
        customFees.configs.amount,
        customFees.transfer,
      );

      const broadcastTx = () =>
        userWithBalanceWallet.instantiate(
          userWithBalanceWallet.address as string,
          reserveCodeId,
          instantiateContractMsg,
          'reserve-test',
          customFees.configs,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*unauthorized.*/);
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
          reserveContractAddress,
          1,
          migrateContractMsg,
          customFees.configs,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*unauthorized.*/);
    });

    test('cover liquidation losses msg should only be exec by a lease', async () => {
      const coverLiquidationLossesMsg = {
        cover_liquidation_losses: { amount: '100', ticker: lpn },
      };

      await userWithBalanceWallet.transferAmount(
        userWithBalanceWallet.address as string,
        customFees.configs.amount,
        customFees.transfer,
      );

      const broadcastTx = () =>
        userWithBalanceWallet.executeContract(
          reserveContractAddress,
          coverLiquidationLossesMsg,
          customFees.configs,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*No such contract.*/);
    });

    test('lease code id should only be updated by the Leaser contract', async () => {
      const newLeaseCodeMsg = { new_lease_code: 2 };

      const broadcastTx = () =>
        userWithBalanceWallet.execute(
          userWithBalanceWallet.address as string,
          reserveContractAddress,
          newLeaseCodeMsg,
          customFees.exec,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*Unauthorized access.*/);
    });
  },
);
