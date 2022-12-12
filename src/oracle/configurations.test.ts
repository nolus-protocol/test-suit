import { customFees, NATIVE_MINIMAL_DENOM } from '../util/utils';
import NODE_ENDPOINT, {
  createWallet,
  getUser1Wallet,
  getContractsOwnerWallet,
} from '../util/clients';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { runOrSkip } from '../util/testingRules';
import { SwapTree, Tree } from '@nolus/nolusjs/build/contracts/types/SwapTree';
import { getLeaseGroupCurrencies } from '../util/smart-contracts/getters';

runOrSkip(process.env.TEST_ORACLE as string)(
  'Oracle tests - Configurations',
  () => {
    let contractsOwnerWallet: NolusWallet;
    let userWithBalance: NolusWallet;
    let oracleInstance: NolusContracts.Oracle;
    let BASE_ASSET: string;
    let leaseCurrencies: string[];
    let initSwapTree: SwapTree;
    const oracleContractAddress = process.env.ORACLE_ADDRESS as string;

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      contractsOwnerWallet = await getContractsOwnerWallet();
      userWithBalance = await getUser1Wallet();

      const cosm = await NolusClient.getInstance().getCosmWasmClient();
      oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);

      const config = await oracleInstance.getConfig();
      BASE_ASSET = config.base_asset;

      leaseCurrencies = getLeaseGroupCurrencies();
      const adminBalance = {
        amount: '10000000',
        denom: NATIVE_MINIMAL_DENOM,
      };

      await userWithBalance.transferAmount(
        contractsOwnerWallet.address as string,
        [adminBalance],
        customFees.transfer,
      );

      initSwapTree = await oracleInstance.getSwapTree();
    });

    afterAll(async () => {
      // reset the swap tree to its init state
      await oracleInstance.updateSwapTree(
        contractsOwnerWallet,
        initSwapTree.tree,
        customFees.exec,
      );

      const swapTreeAfter = await oracleInstance.getSwapTree();
      expect(initSwapTree).toStrictEqual(swapTreeAfter);
    });

    test('the contract owner tries to setup empty swap paths', async () => {
      const newSwapTree: Tree = [[]];

      const broadcastTx = () =>
        oracleInstance.updateSwapTree(
          contractsOwnerWallet,
          newSwapTree,
          customFees.exec,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*invalid length 0.*/);
    });

    test('the contract owner tries to setup swap paths with unsupported Nolus currencies', async () => {
      const newSwapTree: Tree = [[0, BASE_ASSET], [[1, 'A']]];

      const broadcastTx = () =>
        oracleInstance.updateSwapTree(
          contractsOwnerWallet,
          newSwapTree,
          customFees.exec,
        );

      await expect(broadcastTx).rejects.toThrow(
        /^.*not defined in the payment currency group.*/,
      );
    });

    test('the contract owner tries to update swap paths with base currency other than the init base currency', async () => {
      const leaseGroupCurrencies = getLeaseGroupCurrencies();
      const newSwapTree: Tree = [[0, leaseGroupCurrencies[0]]];

      const broadcastTx = () =>
        oracleInstance.updateSwapTree(
          contractsOwnerWallet,
          newSwapTree,
          customFees.exec,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*Invalid base currency.*/);
    });

    test('the contract owner tries to configure a duplicate swap path', async () => {
      const newSwapTree: Tree = [
        [0, BASE_ASSET],
        [[1, leaseCurrencies[0]], [[2, leaseCurrencies[1]]]],
        [[3, leaseCurrencies[1]]],
      ];

      const broadcastTx = () =>
        oracleInstance.updateSwapTree(
          contractsOwnerWallet,
          newSwapTree,
          customFees.exec,
        );

      await expect(broadcastTx).rejects.toThrow(
        /^.*Duplicated nodes in the currency tree.*/,
      );
    });

    test('the supported pairs should match the configured swap tree', async () => {
      const swapTree: Tree = [
        [0, BASE_ASSET],
        [[1, leaseCurrencies[0]], [[2, leaseCurrencies[1]]]],
        [[3, leaseCurrencies[2]]],
      ];
      await oracleInstance.updateSwapTree(
        contractsOwnerWallet,
        swapTree,
        customFees.exec,
      );

      const supportedPairs = await oracleInstance.getCurrencyPairs();
      expect(supportedPairs.length).toBe(3);
      expect(supportedPairs[0].from).toBe(leaseCurrencies[0]);
      expect(supportedPairs[0].to.target).toBe(BASE_ASSET);

      expect(supportedPairs[1].from).toBe(leaseCurrencies[1]);
      expect(supportedPairs[1].to.target).toBe(leaseCurrencies[0]);

      expect(supportedPairs[2].from).toBe(leaseCurrencies[2]);
      expect(supportedPairs[2].to.target).toBe(BASE_ASSET);
    });

    test('the contract owner tries to setup an invalid config - should produce an error', async () => {
      // price feed period = 0
      let result = () =>
        oracleInstance.setConfig(contractsOwnerWallet, 0, 1, customFees.exec); // any precentage needed

      await expect(result).rejects.toThrow('Price feed period can not be 0');

      // expected feeders = 0%
      result = () =>
        oracleInstance.setConfig(contractsOwnerWallet, 1, 0, customFees.exec); // any pricePeriod

      await expect(result).rejects.toThrow(
        'Percent of expected available feeders should be > 0 and <= 1000',
      );

      // expected feeders > 100%, 1000permille
      result = () =>
        oracleInstance.setConfig(
          contractsOwnerWallet,
          1,
          1001,
          customFees.exec,
        ); // any pricePeriod

      await expect(result).rejects.toThrow(
        'Percent of expected available feeders should be > 0 and <= 1000',
      );
    });

    test('the contract owner tries to add an invalid feeder address - should produce an error', async () => {
      const invalidAddress = 'nolus1ta43kkqwmugfdrddvdy4ewcgyw2n9maaaaaaaa';
      const result = () =>
        oracleInstance.addFeeder(
          contractsOwnerWallet,
          invalidAddress,
          customFees.exec,
        );

      await expect(result).rejects.toThrow('invalid checksum');
    });

    test('the contract owner tries to remove a non-existent feeder - should produce an error', async () => {
      const newWallet = await createWallet();

      const result = () =>
        oracleInstance.removeFeeder(
          contractsOwnerWallet,
          newWallet.address as string,
          customFees.exec,
        );

      await expect(result).rejects.toThrow(
        'No feeder data for the specified address',
      );
    });
  },
);
