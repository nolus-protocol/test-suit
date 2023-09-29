import { assertIsDeliverTxSuccess } from '@cosmjs/stargate';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { OracleConfig, SwapTree } from '@nolus/nolusjs/build/contracts/types';
import { customFees } from '../util/utils';
import NODE_ENDPOINT, { createWallet, getUser1Wallet } from '../util/clients';
import { runOrSkip } from '../util/testingRules';
import { getLeaseGroupCurrencies } from '../util/smart-contracts/getters';
import { sendSudoContractProposal } from '../util/gov';
import { sendInitExecuteFeeTokens } from '../util/transfer';

runOrSkip(process.env.TEST_ORACLE as string)(
  'Oracle tests - Configurations',
  () => {
    let userWithBalance: NolusWallet;
    let wallet: NolusWallet;
    let oracleInstance: NolusContracts.Oracle;
    let initConfig: OracleConfig;
    let baseAsset: string;
    let leaseCurrencies: string[] | string;
    const oracleContractAddress = process.env.ORACLE_ADDRESS as string;

    async function trySendPropToUpdateConfig(
      wallet: NolusWallet,
      orState: OracleConfig,
      message: string,
      minFeedersPermilles?: number,
      samplePeriod?: number,
      samplesNumber?: number,
      discountFactor?: number,
    ): Promise<void> {
      const priceConfig_orState = orState.config.price_config;

      const priceConfig = {
        update_config: {
          min_feeders:
            minFeedersPermilles !== undefined
              ? minFeedersPermilles
              : priceConfig_orState.min_feeders,
          discount_factor:
            discountFactor !== undefined
              ? discountFactor
              : priceConfig_orState.discount_factor,
          sample_period_secs:
            samplePeriod !== undefined
              ? samplePeriod
              : priceConfig_orState.sample_period_secs,
          samples_number:
            samplesNumber !== undefined
              ? samplesNumber
              : priceConfig_orState.samples_number,
        },
      };

      await userWithBalance.transferAmount(
        wallet.address as string,
        customFees.configs.amount,
        customFees.transfer,
      );

      const broadcastTx = await sendSudoContractProposal(
        wallet,
        oracleContractAddress,
        JSON.stringify(priceConfig),
      );

      expect(broadcastTx.rawLog).toContain(message);
    }

    async function trySendPropToUpdateSwapTree(
      wallet: NolusWallet,
      swapTree: SwapTree,
      message: string,
    ): Promise<void> {
      await userWithBalance.transferAmount(
        wallet.address as string,
        customFees.configs.amount,
        customFees.transfer,
      );

      const propMsg = { swap_tree: swapTree };
      const broadcastTx = await sendSudoContractProposal(
        wallet,
        oracleContractAddress,
        JSON.stringify(propMsg),
      );

      expect(broadcastTx.rawLog).toContain(message);
    }

    async function trySendPropToRegisterFeeder(
      wallet: NolusWallet,
      feederAddress: string,
      message: string,
    ): Promise<void> {
      const addFeederMsg = {
        register_feeder: {
          feeder_address: feederAddress,
        },
      };

      await userWithBalance.transferAmount(
        wallet.address as string,
        customFees.configs.amount,
        customFees.transfer,
      );

      const broadcastTx = await sendSudoContractProposal(
        wallet,
        oracleContractAddress,
        JSON.stringify(addFeederMsg),
      );

      expect(broadcastTx.rawLog).toContain(message);
    }

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      userWithBalance = await getUser1Wallet();
      wallet = await createWallet();

      const cosm = await NolusClient.getInstance().getCosmWasmClient();
      oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);

      initConfig = await oracleInstance.getConfig();
      baseAsset = initConfig.config.base_asset;

      leaseCurrencies = getLeaseGroupCurrencies();
    });

    test('try to update swap paths with unsupported currencies - should produce an error', async () => {
      const invalidCurrency = 'A';
      const newSwapTree: SwapTree = {
        tree: {
          value: [0, baseAsset],
          children: [
            {
              value: [1, invalidCurrency],
            },
          ],
        },
      };

      await trySendPropToUpdateSwapTree(
        wallet,
        newSwapTree,
        `Found a symbol '${invalidCurrency}' pretending to be ticker of a currency pertaining to the payment group`,
      );
    });

    test('try to update swap paths with base currency other than the init base currency - should produce an error', async () => {
      const leaseGroupCurrencies = getLeaseGroupCurrencies();
      const newSwapTree: SwapTree = {
        tree: { value: [0, leaseGroupCurrencies[0]] },
      };

      await trySendPropToUpdateSwapTree(
        wallet,
        newSwapTree,
        'Invalid base currency',
      );
    });

    test('try to configure a duplicate swap path - should produce an error', async () => {
      const newSwapTree: SwapTree = {
        tree: {
          value: [0, baseAsset],
          children: [
            {
              value: [1, leaseCurrencies[0]],
              children: [{ value: [2, leaseCurrencies[1]] }],
            },
            {
              value: [3, leaseCurrencies[1]],
            },
          ],
        },
      };

      await trySendPropToUpdateSwapTree(
        wallet,
        newSwapTree,
        'Duplicated nodes in the currency tree',
      );
    });

    test('configuration update -> invalid cases - should produce an error', async () => {
      // sample period = 0
      await trySendPropToUpdateConfig(
        wallet,
        initConfig,
        'The sample period should be longer than zero',
        1,
        0,
      );

      // sample numbers = 0
      await trySendPropToUpdateConfig(
        wallet,
        initConfig,
        'The price feeds validity should be longer than zero',
        1,
        1,
        0,
      ); // any pricePeriod

      // min feeders = 0%
      await trySendPropToUpdateConfig(
        wallet,
        initConfig,
        'The minumum feeders should be greater than 0 and less or equal to 100%',
        0,
      );

      // min feeders > 100%, 1000permille
      await trySendPropToUpdateConfig(
        wallet,
        initConfig,
        'The minumum feeders should be greater than 0 and less or equal to 100%',
        1001,
      );
    });

    test('try adding a valid feeder - should work as expected', async () => {
      const newWallet = await createWallet();

      await sendInitExecuteFeeTokens(userWithBalance, wallet.address as string);

      const isFeeder = await oracleInstance.isFeeder(
        newWallet.address as string,
      );
      expect(isFeeder).toBe(false);

      const addFeederMsg = {
        register_feeder: {
          feeder_address: newWallet.address as string,
        },
      };

      await userWithBalance.transferAmount(
        wallet.address as string,
        customFees.configs.amount,
        customFees.transfer,
      );

      const broadcastTx = await sendSudoContractProposal(
        wallet,
        oracleContractAddress,
        JSON.stringify(addFeederMsg),
      );

      expect(assertIsDeliverTxSuccess(broadcastTx)).toBeUndefined();
    });

    test('try adding an invalid feeder address - should produce an error', async () => {
      await trySendPropToRegisterFeeder(
        wallet,
        'nolus1ta43kkqwmugfdrddvdy4ewcgyw2n9maaaaaaaa',
        'invalid checksum',
      );
    });

    test('try adding an already registered feeder - should produce an error', async () => {
      const allFeeders = await oracleInstance.getFeeders();
      await trySendPropToRegisterFeeder(
        wallet,
        allFeeders[0],
        'Given address already registered as a price feeder',
      );
    });

    test('try to remove a non-existent feeder - should produce an error', async () => {
      const newWallet = await createWallet();

      const removeFeederMsg = {
        remove_feeder: {
          feeder_address: newWallet.address as string,
        },
      };

      await userWithBalance.transferAmount(
        wallet.address as string,
        customFees.configs.amount,
        customFees.transfer,
      );

      const broadcastTx = await sendSudoContractProposal(
        wallet,
        oracleContractAddress,
        JSON.stringify(removeFeederMsg),
      );

      expect(broadcastTx.rawLog).toContain(
        'No feeder data for the specified address',
      );
    });
  },
);
