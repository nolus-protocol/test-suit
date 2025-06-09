import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import { LeaserConfig } from '@nolus/nolusjs/build/contracts';
import { runOrSkip, runTestIfLocal } from '../util/testingRules';
import NODE_ENDPOINT, {
  createWallet,
  getUser1Wallet,
  getWallet,
} from '../util/clients';
import { customFees } from '../util/utils';
import { sendSudoContractProposal } from '../util/proposals';
import { getLeaseGroupCurrencies } from '../util/smart-contracts/getters';
import { fromHex } from '@cosmjs/encoding';

runOrSkip(process.env.TEST_BORROWER as string)(
  'Leaser contract tests - Config',
  () => {
    let userWithBalanceWallet: NolusWallet;
    let wallet: NolusWallet;
    let leaserInstance: NolusContracts.Leaser;
    let oracleInstance: NolusContracts.Oracle;
    let configBefore: NolusContracts.LeaserConfig;
    let leaserConfigMsg: LeaserConfig;

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
        JSON.stringify(leaserConfigMsg),
      );

      expect(broadcastTx.rawLog).toContain(message);
    }

    async function tryChangeConfig(
      leaseAdminWallet: NolusWallet,
      message: string,
    ) {
      const updateConfigMsg = {
        config_leases: leaserConfigMsg.config,
      };

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

      leaserInstance = new NolusContracts.Leaser(cosm, leaserContractAddress);
      oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);

      userWithBalanceWallet = await getUser1Wallet();
      wallet = await createWallet();

      configBefore = await leaserInstance.getLeaserConfig();
      leaserConfigMsg = JSON.parse(JSON.stringify(configBefore));
      leaserConfigMsg.config.lease_code = undefined;
      leaserConfigMsg.config.dex = undefined;
      leaserConfigMsg.config.lpp = undefined;
      leaserConfigMsg.config.market_price_oracle = undefined;
      leaserConfigMsg.config.profit = undefined;
      leaserConfigMsg.config.time_alarms = undefined;
      leaserConfigMsg.config.reserve = undefined;
      leaserConfigMsg.config.protocols_registry = undefined;
      leaserConfigMsg.config.lease_admin = undefined;
    });

    afterEach(async () => {
      leaserConfigMsg.config.lease_due_period =
        configBefore.config.lease_due_period;
      leaserConfigMsg.config.lease_position_spec = JSON.parse(
        JSON.stringify(configBefore.config.lease_position_spec),
      );
      leaserConfigMsg.config.lease_interest_rate_margin = JSON.parse(
        JSON.stringify(configBefore.config.lease_interest_rate_margin),
      );
      leaserConfigMsg.config.lease_max_slippages = JSON.parse(
        JSON.stringify(configBefore.config.lease_max_slippages),
      );

      const configAfter = await leaserInstance.getLeaserConfig();

      expect(configAfter).toStrictEqual(configBefore);
    });

    test('try to set initial liability % > healthy liability % - should produce an error', async () => {
      leaserConfigMsg.config.lease_position_spec.liability.initial =
        leaserConfigMsg.config.lease_position_spec.liability.healthy + 1;

      await trySendPropToSetConfig('Initial % should be <= healthy %');
    });

    test('try to set healthy liability % > max liability % - should produce an error', async () => {
      leaserConfigMsg.config.lease_position_spec.liability.healthy =
        leaserConfigMsg.config.lease_position_spec.liability.max + 1;

      await trySendPropToSetConfig('Healthy % should be < first liquidation %');
    });

    test('try to set first liq warn % <= healthy liability % - should produce an error', async () => {
      leaserConfigMsg.config.lease_position_spec.liability.first_liq_warn =
        leaserConfigMsg.config.lease_position_spec.liability.healthy - 1;

      await trySendPropToSetConfig('Healthy % should be < first liquidation %');

      leaserConfigMsg.config.lease_position_spec.liability.first_liq_warn =
        leaserConfigMsg.config.lease_position_spec.liability.healthy;

      await trySendPropToSetConfig('Healthy % should be < first liquidation %');
    });

    test('try to set second liq warn % <= first liq warn % - should produce an error', async () => {
      leaserConfigMsg.config.lease_position_spec.liability.second_liq_warn =
        leaserConfigMsg.config.lease_position_spec.liability.first_liq_warn - 1;

      await trySendPropToSetConfig(
        'First liquidation % should be < second liquidation %',
      );

      leaserConfigMsg.config.lease_position_spec.liability.second_liq_warn =
        leaserConfigMsg.config.lease_position_spec.liability.first_liq_warn;

      await trySendPropToSetConfig(
        'First liquidation % should be < second liquidation %',
      );
    });

    test('try to set third liq warn % <= second liq warn % - should produce an error', async () => {
      leaserConfigMsg.config.lease_position_spec.liability.third_liq_warn =
        leaserConfigMsg.config.lease_position_spec.liability.second_liq_warn -
        1;

      await trySendPropToSetConfig(
        'Second liquidation % should be < third liquidation %',
      );

      leaserConfigMsg.config.lease_position_spec.liability.third_liq_warn =
        leaserConfigMsg.config.lease_position_spec.liability.second_liq_warn;

      await trySendPropToSetConfig(
        'Second liquidation % should be < third liquidation %',
      );
    });

    test('try to set third liq warn % >= max % - should produce an error', async () => {
      leaserConfigMsg.config.lease_position_spec.liability.third_liq_warn =
        leaserConfigMsg.config.lease_position_spec.liability.max + 1;

      await trySendPropToSetConfig('Third liquidation % should be < max %');

      leaserConfigMsg.config.lease_position_spec.liability.third_liq_warn =
        leaserConfigMsg.config.lease_position_spec.liability.max;

      await trySendPropToSetConfig('Third liquidation % should be < max %');
    });

    test('try to set recalc period < 1hour - should produce an error', async () => {
      const oneHourToNanosec = 3600000000000;
      leaserConfigMsg.config.lease_position_spec.liability.recalc_time =
        oneHourToNanosec - 1;

      await trySendPropToSetConfig('Recalculation cadence should be >= 1h');
    });

    test('try to set "min_asset" amount = 0 - should produce an error', async () => {
      leaserConfigMsg.config.lease_position_spec.min_asset = {
        amount: '0',
        ticker: process.env.LPP_BASE_CURRENCY,
      };

      await trySendPropToSetConfig('Min asset amount should be positive');
    });

    test('try to set "min_asset" ticker != LPN - should produce an error', async () => {
      const invalidTicker = (await getLeaseGroupCurrencies(oracleInstance))[0];
      leaserConfigMsg.config.lease_position_spec.min_asset = {
        amount: '100', // any amount
        ticker: invalidTicker,
      };

      await trySendPropToSetConfig(
        `Found a symbol '${invalidTicker}' pretending to be ticker of a currency pertaining to the lpns group`,
      );
    });

    test('try to set "min_transaction" ticker != LPN - should produce an error', async () => {
      const invalidTicker = (await getLeaseGroupCurrencies(oracleInstance))[0];
      leaserConfigMsg.config.lease_position_spec.min_transaction = {
        amount: '100', // any amount
        ticker: invalidTicker,
      };

      await trySendPropToSetConfig(
        `Found a symbol '${invalidTicker}' pretending to be ticker of a currency pertaining to the lpns group`,
      );
    });

    test('try to set "slippage protection percent" outside the limit of min_transaction - should produce an error', async () => {
      const lowerBound =
        1000 -
        1000 /
          +leaserConfigMsg.config.lease_position_spec.min_transaction.amount;
      const invalidSlippagePercent = Math.ceil(lowerBound) + 1;

      leaserConfigMsg.config.lease_max_slippages.liquidation =
        invalidSlippagePercent;

      await trySendPropToSetConfig(
        'The min output from a dex transaction of the min transaction amount should be positive',
      );
    });

    runTestIfLocal(
      'try to set "slippage protection percent" outside the limit of min_transaction - exec - should produce an error',
      async () => {
        const leaseAdminWallet = await getWallet(
          fromHex(process.env.LEASE_ADMIN_PRIV_KEY as string),
        );

        const lowerBound =
          1000 -
          1000 /
            +leaserConfigMsg.config.lease_position_spec.min_transaction.amount;
        const invalidSlippagePercent = Math.ceil(lowerBound) + 1;
        leaserConfigMsg.config.lease_max_slippages.liquidation =
          invalidSlippagePercent;

        await tryChangeConfig(
          leaseAdminWallet,
          'The min output from a dex transaction of the min transaction amount should be positive',
        );
      },
    );

    runTestIfLocal(
      'try to set "min_asset" amount = 0 - exec - should produce an error',
      async () => {
        const leaseAdminWallet = await getWallet(
          fromHex(process.env.LEASE_ADMIN_PRIV_KEY as string),
        );

        leaserConfigMsg.config.lease_position_spec.min_asset = {
          amount: '0',
          ticker: process.env.LPP_BASE_CURRENCY,
        };

        await tryChangeConfig(
          leaseAdminWallet,
          'Min asset amount should be positive',
        );
      },
    );

    runTestIfLocal(
      'try to set invalid lease admin address - should produce an error',
      async () => {
        const leaseAdminWallet = await getWallet(
          fromHex(process.env.LEASE_ADMIN_PRIV_KEY as string),
        );

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
  },
);
