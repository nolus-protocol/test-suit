import { NolusClient, NolusWallet } from '../util/nolus';
import { customFees } from '../util/utils';
import NODE_ENDPOINT, {
  createWallet,
  getLeaseAdminWallet,
  getUser1Wallet,
} from '../util/clients';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import { restoreLeaserConfig } from '../util/smart-contracts/actions/borrower';
import { runOrSkip } from '../util/testingRules';
import { configLeasesMsg, LeaseConfig, Leaser } from '../util/contracts';

const maybe = runOrSkip(process.env.TEST_BORROWER as string);

maybe('Borrower tests - Permissions', () => {
  let userWithBalanceWallet: NolusWallet;
  let unauthorizedWallet: NolusWallet;
  let leaserInstance: Leaser;
  let leaseConfigBefore: LeaseConfig;
  const leaserContractAddress = process.env.LEASER_ADDRESS as string;

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    const cosm = await NolusClient.getInstance().getCosmWasmClient();

    leaserInstance = new Leaser(cosm, leaserContractAddress);

    userWithBalanceWallet = await getUser1Wallet();
    unauthorizedWallet = await createWallet();

    leaseConfigBefore = (await leaserInstance.getLeaserConfig()).config
      .lease_config;
  });

  afterAll(async () => {
    const restored = await restoreLeaserConfig(
      await getLeaseAdminWallet(),
      leaseConfigBefore,
    );

    expect(restored).toBe(false);
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

  test('update config msg should only be exec by the lease admin', async () => {
    const leaseConfig = (await leaserInstance.getLeaserConfig()).config
      .lease_config;

    leaseConfig.max_slippages.liquidation = 500;

    await sendInitExecuteFeeTokens(
      userWithBalanceWallet,
      unauthorizedWallet.address as string,
    );

    const updateConfigMsg = configLeasesMsg(leaseConfig);
    const broadcastTx = () =>
      unauthorizedWallet.executeContract(
        leaserContractAddress,
        updateConfigMsg,
        customFees.configs,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*Unauthorized access.*/);
  });

  test('change lease admin msg should only be exec by the current admin', async () => {
    const changeLeaseAdminMsg = {
      change_lease_admin: {
        new: unauthorizedWallet.address as string,
      },
    };

    await sendInitExecuteFeeTokens(
      userWithBalanceWallet,
      unauthorizedWallet.address as string,
    );

    const broadcastTx = () =>
      unauthorizedWallet.executeContract(
        leaserContractAddress,
        changeLeaseAdminMsg,
        customFees.configs,
      );
    await expect(broadcastTx).rejects.toThrow(/^.*Unauthorized access.*/);
  });
});
