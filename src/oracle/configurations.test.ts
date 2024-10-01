import { assertIsDeliverTxSuccess } from '@cosmjs/stargate';
import { fromHex } from '@cosmjs/encoding';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import {
  OracleConfig,
  SwapTree,
  Tree,
} from '@nolus/nolusjs/build/contracts/types';
import { customFees } from '../util/utils';
import NODE_ENDPOINT, {
  createWallet,
  getUser1Wallet,
  getWallet,
} from '../util/clients';
import { runOrSkip, runTestIfDev, runTestIfLocal } from '../util/testingRules';
import { getLeaseGroupCurrencies } from '../util/smart-contracts/getters';
import { sendSudoContractProposal } from '../util/proposals';
import { sendInitExecuteFeeTokens } from '../util/transfer';

runOrSkip(process.env.TEST_ORACLE as string)(
  'Oracle tests - Configurations',
  () => {
    let userWithBalance: NolusWallet;
    let wallet: NolusWallet;
    let oracleInstance: NolusContracts.Oracle;
    let adminInstance: NolusContracts.Admin;
    let initConfig: OracleConfig;
    let baseAsset: string;
    let leaseCurrencies: string[] | string;
    const oracleContractAddress = process.env.ORACLE_ADDRESS as string;
    const adminContractAddress = process.env.ADMIN_CONTRACT_ADDRESS as string;

    async function trySendPropToUpdateConfig(
      wallet: NolusWallet,
      orState: OracleConfig,
      message: string,
      minFeedersPermilles?: number,
      samplePeriod?: number,
      samplesNumber?: number,
      discountFactor?: number,
    ): Promise<void> {
      const priceConfig_orState = orState.price_config;

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

    async function tryInstantiation(
      swapTree: Tree,
      message: string,
    ): Promise<void> {
      const dexAdmin = fromHex(process.env.DEX_ADMIN_PRIV_KEY as string);
      const dexAdminWallet = await getWallet(dexAdmin);

      await userWithBalance.transferAmount(
        dexAdminWallet.address as string,
        customFees.configs.amount,
        customFees.transfer,
      );

      const adminContractAddress = process.env.ADMIN_CONTRACT_ADDRESS as string;

      const protocol = 'TEST-PROTOCOL';
      const oracleCodeId = process.env.ORACLE_CODE_ID as string;

      const expectedAddressMsg = {
        instantiate_address: {
          code_id: oracleCodeId,
          protocol: protocol,
        },
      };

      const expectedAddress = await wallet.queryContractSmart(
        adminContractAddress,
        expectedAddressMsg,
      );

      const oracleInitMsg = {
        config: {
          price_config: {
            min_feeders: 500,
            sample_period_secs: 50,
            samples_number: 12,
            discount_factor: 600,
          },
        },
        swap_tree: swapTree,
      };

      const initMsg = {
        instantiate: {
          code_id: oracleCodeId,
          label: 'test-oracle-init',
          message: JSON.stringify(oracleInitMsg),
          protocol: protocol,
          expected_address: expectedAddress,
        },
      };

      const broadcastTx = () =>
        dexAdminWallet.executeContract(
          adminContractAddress,
          initMsg,
          customFees.init,
        );

      await expect(broadcastTx).rejects.toThrow(message);
    }

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      userWithBalance = await getUser1Wallet();
      wallet = await createWallet();

      const cosm = await NolusClient.getInstance().getCosmWasmClient();
      oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);
      adminInstance = new NolusContracts.Admin(cosm, adminContractAddress);

      initConfig = await oracleInstance.getConfig();
      baseAsset = await oracleInstance.getBaseCurrency();

      leaseCurrencies = await getLeaseGroupCurrencies(oracleInstance);
    });

    runTestIfLocal(
      'try to update swap paths with unsupported currencies - should produce an error',
      async () => {
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

        // Swap_tree update
        await trySendPropToUpdateSwapTree(
          wallet,
          newSwapTree,
          `Found a symbol '${invalidCurrency}' pretending to be ticker of a currency pertaining to the payment group`,
        );

        // Instantiation
        await tryInstantiation(
          newSwapTree.tree,
          `Found a symbol '${invalidCurrency}' pretending to be ticker of a currency pertaining to the payment group`,
        );
      },
    );

    runTestIfLocal(
      'try to update swap paths with unsupported pair - should produce an error',
      async () => {
        const secondPairMember = process.env.NO_PRICE_CURRENCY_TICKER as string;

        const newSwapTree: SwapTree = {
          tree: {
            value: [0, baseAsset],
            children: [
              {
                value: [1, secondPairMember],
              },
            ],
          },
        };

        // Swap_tree update
        await trySendPropToUpdateSwapTree(
          wallet,
          newSwapTree,
          `No records for a pool with '${secondPairMember}' and '${baseAsset}'`,
        );

        // Instantiation
        await tryInstantiation(
          newSwapTree.tree,
          `No records for a pool with '${secondPairMember}' and '${baseAsset}'`,
        );
      },
    );

    test('try to update swap paths with base currency other than the init base currency - should produce an error', async () => {
      const leaseGroupCurrencies =
        await getLeaseGroupCurrencies(oracleInstance);
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

    test('try to configure the sample_period to 0 - should produce an error', async () => {
      await trySendPropToUpdateConfig(
        wallet,
        initConfig,
        'The sample period should be longer than zero',
        1,
        0,
      );
    });

    test('try to configure the sample_number to 0 - should produce an error', async () => {
      await trySendPropToUpdateConfig(
        wallet,
        initConfig,
        'The price feeds validity should be longer than zero',
        1,
        1,
        0,
      ); // any pricePeriod
    });

    test('try to configure the min_feeders to 0% - should produce an error', async () => {
      await trySendPropToUpdateConfig(
        wallet,
        initConfig,
        'The minumum feeders should be greater than 0 and less or equal to 100%',
        0,
      );
    });

    test('try to configure the min_feeders to be greater than 100% - should produce an error', async () => {
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

    runTestIfDev(
      'migrate to code_id that is incompatible with the protocol - should produce an error',
      async () => {
        const protocols = await adminInstance.getProtocols();
        expect(protocols.length).toBeGreaterThan(1);

        const oracleCodeId = process.env
          .ORACLE_CODE_ID_DIFFERENT_PROTOCOL as string;

        expect(oracleCodeId).not.toBe('');

        const currentProtocolName = process.env.PROTOCOL as string;

        const protocolsObject = protocols.reduce(
          (acc, protocol) => {
            acc[protocol] =
              protocol === currentProtocolName
                ? {
                    some: {
                      oracle: {
                        code_id: oracleCodeId,
                        migrate_msg: '{}',
                      },
                    },
                  }
                : null;
            return acc;
          },
          {} as Record<string, any>,
        );

        const migrateMsg = {
          migrate_contracts: {
            release: 'tag',
            migration_spec: {
              platform: null,
              protocol: protocolsObject,
            },
          },
        };

        const broadcastTx = await sendSudoContractProposal(
          wallet,
          process.env.ADMIN_CONTRACT_ADDRESS as string,
          JSON.stringify(migrateMsg),
        );
        expect(broadcastTx.rawLog).toContain(
          'pretending to be ticker of a currency pertaining to the payment group',
        );
      },
    );
  },
);
