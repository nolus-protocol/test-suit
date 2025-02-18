import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { customFees } from '../util/utils';
import NODE_ENDPOINT, { getUser1Wallet } from '../util/clients';
import { runOrSkip } from '../util/testingRules';
import { sendSudoContractProposal } from '../util/proposals';
import {
  openLease,
  waitLeaseOpeningProcess,
} from '../util/smart-contracts/actions/borrower';
import { getLeaseGroupCurrencies } from '../util/smart-contracts/getters';

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
        migrate_leases: {
          new_code_id: '2',
          max_leases: 1000,
          to_release: { software: 'v1.2.3', protocol: '222222222' },
        },
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
        migrate_leases_cont: {
          key: leaserContractAddress,
          max_leases: 1000,
          to_release: { software: 'v1.2.3', protocol: '222222222' },
        },
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

    test('close protocol msg should be exec only if there are no leases or the force flag says so', async () => {
      const leases = await userWithBalanceWallet.getContracts(
        +(process.env.LEASE_CODE_ID as string),
      );

      if (leases.length === 0) {
        const cosm = await NolusClient.getInstance().getCosmWasmClient();
        const leaserContractAddress = process.env.LEASER_ADDRESS as string;
        const lppContractAddress = process.env.LPP_ADDRESS as string;
        const oracleContractAddress = process.env.ORACLE_ADDRESS as string;

        const leaserInstance = new NolusContracts.Leaser(
          cosm,
          leaserContractAddress,
        );
        const lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);
        const oracleInstance = new NolusContracts.Oracle(
          cosm,
          oracleContractAddress,
        );

        const downpayment = '10000';
        const lppCurrency = process.env.LPP_BASE_CURRENCY as string;
        const leaseCurrency = (
          await getLeaseGroupCurrencies(oracleInstance)
        )[0];

        const leaseAddress = await openLease(
          leaserInstance,
          lppInstance,
          downpayment,
          lppCurrency,
          leaseCurrency,
          userWithBalanceWallet,
        );

        const leaseInstance = new NolusContracts.Lease(cosm, leaseAddress);
        expect(await waitLeaseOpeningProcess(leaseInstance)).toBe(undefined);
      }

      const forceInvalidValue = 'value';
      const closeProtocolMsg = {
        close_protocol: {
          new_lease_code_id: '1',
          migration_spec: {
            leaser: { code_id: '1', migrate_message: '{}' },
            lpp: { code_id: '1', migrate_message: '{}' },
            oracle: { code_id: '1', migrate_message: '{}' },
            profit: { code_id: '1', migrate_message: '{}' },
            reserve: { code_id: '1', migrate_message: '{}' },
          },
          force: forceInvalidValue,
        },
      };

      let broadcastTx = await sendSudoContractProposal(
        userWithBalanceWallet,
        leaserContractAddress,
        JSON.stringify(closeProtocolMsg),
      );

      expect(broadcastTx.rawLog).toContain('unknown variant');

      closeProtocolMsg.close_protocol.force = 'no';

      broadcastTx = await sendSudoContractProposal(
        userWithBalanceWallet,
        leaserContractAddress,
        JSON.stringify(closeProtocolMsg),
      );

      expect(broadcastTx.rawLog).toContain(
        'The protocol is still in use. There are open leases',
      );
    });
  },
);
