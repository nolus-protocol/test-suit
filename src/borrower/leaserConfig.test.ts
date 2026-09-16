import { NolusClient, NolusWallet } from '@nolus/nolusjs';
import { runOrSkip, withLeaseAdminTest } from '../util/testingRules';
import NODE_ENDPOINT, {
  createWallet,
  getLeaseAdminWallet,
  getUser1Wallet,
} from '../util/clients';
import { customFees } from '../util/utils';
import { sendSudoContractProposal } from '../util/proposals';
import { getLeaseGroupCurrencies } from '../util/smart-contracts/getters';
import { restoreLeaserConfig } from '../util/smart-contracts/actions/borrower';
import {
  configLeasesMsg,
  LeaseConfig,
  Leaser,
  LeaserConfig,
  leaserSudoConfigMsg,
  Oracle,
} from '../util/contracts';

const maybe = runOrSkip(process.env.TEST_BORROWER as string);

maybe('Leaser contract tests - Config', () => {
  let userWithBalanceWallet: NolusWallet;
  let wallet: NolusWallet;
  let leaserInstance: Leaser;
  let oracleInstance: Oracle;
  let configBefore: LeaserConfig;
  let leaseConfigMsg: LeaseConfig;
  let leaseAdminWallet: NolusWallet;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const oracleContractAddress = process.env.ORACLE_ADDRESS as string;

  async function trySendPropToSetConfig(message: string): Promise<void> {
    await userWithBalanceWallet.transferAmount(
      wallet.address as string,
      customFees.configs.amount,
      customFees.transfer,
    );

    const broadcastTx = await sendSudoContractProposal(
      wallet,
      leaserContractAddress,
      JSON.stringify(leaserSudoConfigMsg(leaseConfigMsg)),
    );

    expect(broadcastTx.rawLog).toContain(message);
  }

  async function tryChangeConfig(
    leaseAdminWallet: NolusWallet,
    message: string,
  ) {
    const updateConfigMsg = configLeasesMsg(leaseConfigMsg);

    await userWithBalanceWallet.transferAmount(
      leaseAdminWallet.address as string,
      customFees.configs.amount,
      customFees.transfer,
    );

    const broadcastTx = () =>
      leaseAdminWallet.executeContract(
        leaserContractAddress,
        updateConfigMsg,
        customFees.configs,
      );

    await expect(broadcastTx).rejects.toThrow(message);
  }

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    const cosm = await NolusClient.getInstance().getCosmWasmClient();

    leaserInstance = new Leaser(cosm, leaserContractAddress);
    oracleInstance = new Oracle(cosm, oracleContractAddress);

    userWithBalanceWallet = await getUser1Wallet();
    wallet = await createWallet();
    leaseAdminWallet = await getLeaseAdminWallet();

    configBefore = await leaserInstance.getLeaserConfig();
    leaseConfigMsg = structuredClone(configBefore.config.lease_config);
  });

  afterEach(async () => {
    leaseConfigMsg = structuredClone(configBefore.config.lease_config);

    const restored = await restoreLeaserConfig(
      leaseAdminWallet,
      configBefore.config.lease_config,
    );

    expect(restored).toBe(false);
  });

  test('try to set initial liability % > healthy liability % - should produce an error', async () => {
    leaseConfigMsg.position_spec.liability.initial =
      leaseConfigMsg.position_spec.liability.healthy + 1;

    await trySendPropToSetConfig('Initial % should be <= healthy %');
  });

  test('try to set healthy liability % > max liability % - should produce an error', async () => {
    leaseConfigMsg.position_spec.liability.healthy =
      leaseConfigMsg.position_spec.liability.max + 1;

    await trySendPropToSetConfig('Healthy % should be < first liquidation %');
  });

  test('try to set first liq warn % <= healthy liability % - should produce an error', async () => {
    leaseConfigMsg.position_spec.liability.first_liq_warn =
      leaseConfigMsg.position_spec.liability.healthy - 1;

    await trySendPropToSetConfig('Healthy % should be < first liquidation %');

    leaseConfigMsg.position_spec.liability.first_liq_warn =
      leaseConfigMsg.position_spec.liability.healthy;

    await trySendPropToSetConfig('Healthy % should be < first liquidation %');
  });

  test('try to set second liq warn % <= first liq warn % - should produce an error', async () => {
    leaseConfigMsg.position_spec.liability.second_liq_warn =
      leaseConfigMsg.position_spec.liability.first_liq_warn - 1;

    await trySendPropToSetConfig(
      'First liquidation % should be < second liquidation %',
    );

    leaseConfigMsg.position_spec.liability.second_liq_warn =
      leaseConfigMsg.position_spec.liability.first_liq_warn;

    await trySendPropToSetConfig(
      'First liquidation % should be < second liquidation %',
    );
  });

  test('try to set third liq warn % <= second liq warn % - should produce an error', async () => {
    leaseConfigMsg.position_spec.liability.third_liq_warn =
      leaseConfigMsg.position_spec.liability.second_liq_warn - 1;

    await trySendPropToSetConfig(
      'Second liquidation % should be < third liquidation %',
    );

    leaseConfigMsg.position_spec.liability.third_liq_warn =
      leaseConfigMsg.position_spec.liability.second_liq_warn;

    await trySendPropToSetConfig(
      'Second liquidation % should be < third liquidation %',
    );
  });

  test('try to set third liq warn % >= max % - should produce an error', async () => {
    leaseConfigMsg.position_spec.liability.third_liq_warn =
      leaseConfigMsg.position_spec.liability.max + 1;

    await trySendPropToSetConfig('Third liquidation % should be < max %');

    leaseConfigMsg.position_spec.liability.third_liq_warn =
      leaseConfigMsg.position_spec.liability.max;

    await trySendPropToSetConfig('Third liquidation % should be < max %');
  });

  test('try to set recalc period < 1hour - should produce an error', async () => {
    const oneHourToNanosec = 3600000000000;
    leaseConfigMsg.position_spec.liability.recalc_time = oneHourToNanosec - 1;

    await trySendPropToSetConfig('Recalculation cadence should be >= 1h');
  });

  test('try to set "min_asset" amount = 0 - should produce an error', async () => {
    leaseConfigMsg.position_spec.min_asset = {
      amount: '0',
      ticker: process.env.LPP_BASE_CURRENCY as string,
    };

    await trySendPropToSetConfig('Min asset amount should be positive');
  });

  test('try to set "min_asset" ticker != LPN - should produce an error', async () => {
    const invalidTicker = (await getLeaseGroupCurrencies(oracleInstance))[0];
    leaseConfigMsg.position_spec.min_asset = {
      amount: '100', // any amount
      ticker: invalidTicker,
    };

    await trySendPropToSetConfig(
      `Found a symbol '${invalidTicker}' pretending to be ticker of a currency pertaining to the lpns group`,
    );
  });

  test('try to set "min_transaction" ticker != LPN - should produce an error', async () => {
    const invalidTicker = (await getLeaseGroupCurrencies(oracleInstance))[0];
    leaseConfigMsg.position_spec.min_transaction = {
      amount: '100', // any amount
      ticker: invalidTicker,
    };

    await trySendPropToSetConfig(
      `Found a symbol '${invalidTicker}' pretending to be ticker of a currency pertaining to the lpns group`,
    );
  });

  test('try to set "slippage protection percent" outside the limit of min_transaction - should produce an error', async () => {
    const lowerBound =
      1000 - 1000 / +leaseConfigMsg.position_spec.min_transaction.amount;
    const invalidSlippagePercent = Math.ceil(lowerBound) + 1;

    leaseConfigMsg.max_slippages.liquidation = invalidSlippagePercent;

    await trySendPropToSetConfig(
      'The min output from a dex transaction of the min transaction amount should be positive',
    );
  });

  withLeaseAdminTest(
    'try to set "slippage protection percent" outside the limit of min_transaction - exec - should produce an error',
    async () => {
      const lowerBound =
        1000 - 1000 / +leaseConfigMsg.position_spec.min_transaction.amount;
      const invalidSlippagePercent = Math.ceil(lowerBound) + 1;
      leaseConfigMsg.max_slippages.liquidation = invalidSlippagePercent;

      await tryChangeConfig(
        leaseAdminWallet,
        'The min output from a dex transaction of the min transaction amount should be positive',
      );
    },
  );

  withLeaseAdminTest(
    'try to set "min_asset" amount = 0 - exec - should produce an error',
    async () => {
      leaseConfigMsg.position_spec.min_asset = {
        amount: '0',
        ticker: process.env.LPP_BASE_CURRENCY as string,
      };

      await tryChangeConfig(
        leaseAdminWallet,
        'Min asset amount should be positive',
      );
    },
  );

  withLeaseAdminTest(
    'try to set invalid lease admin address - should produce an error',
    async () => {
      const changeLeaseAdminMsg = {
        change_lease_admin: {
          new: 'blabla',
        },
      };

      await userWithBalanceWallet.transferAmount(
        leaseAdminWallet.address as string,
        customFees.configs.amount,
        customFees.transfer,
      );
      const broadcastTx = () =>
        leaseAdminWallet.executeContract(
          leaserContractAddress,
          changeLeaseAdminMsg,
          customFees.configs,
        );

      await expect(broadcastTx).rejects.toThrow(
        /^.*Address validation failed.*/,
      );
    },
  );
});
