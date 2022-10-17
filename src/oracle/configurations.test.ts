import { customFees, NATIVE_MINIMAL_DENOM } from '../util/utils';
import NODE_ENDPOINT, {
  createWallet,
  getUser1Wallet,
  getWasmAdminWallet,
} from '../util/clients';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { runOrSkip } from '../util/testingRules';

runOrSkip(process.env.TEST_ORACLE as string)(
  'Oracle tests - Configurations',
  () => {
    let wasmAdminWallet: NolusWallet;
    let userWithBalance: NolusWallet;
    let oracleInstance: NolusContracts.Oracle;
    let BASE_ASSET: string;
    const testPairMember = 'UAT';
    const oracleContractAddress = process.env.ORACLE_ADDRESS as string;

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      wasmAdminWallet = await getWasmAdminWallet();
      userWithBalance = await getUser1Wallet();

      const cosm = await NolusClient.getInstance().getCosmWasmClient();
      oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);

      const config = await oracleInstance.getConfig();
      BASE_ASSET = config.base_asset;

      const adminBalance = {
        amount: '10000000',
        denom: NATIVE_MINIMAL_DENOM,
      };

      await userWithBalance.transferAmount(
        wasmAdminWallet.address as string,
        [adminBalance],
        customFees.transfer,
      );
    });

    test('the wasm admin tries to setup empty currency paths array', async () => {
      const newCurrencyPaths: any = [];

      const broadcastTx = () =>
        oracleInstance.updateCurrencyPaths(
          wasmAdminWallet,
          [newCurrencyPaths],
          customFees.exec,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*Invalid denom pair.*/);
    });

    test('the wasm admin tries to setup currency paths with one element', async () => {
      const newCurrencyPaths = ['A'];

      const broadcastTx = () =>
        oracleInstance.updateCurrencyPaths(
          wasmAdminWallet,
          [newCurrencyPaths],
          customFees.exec,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*Invalid denom pair.*/);
    });

    test('the wasm admin tries to update supported pairs with a base asset other than the init msg "base_asset" param', async () => {
      const newSupportedPairs = [BASE_ASSET, testPairMember];

      const broadcastTx = () =>
        oracleInstance.updateCurrencyPaths(
          wasmAdminWallet,
          [newSupportedPairs],
          customFees.exec,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*Invalid denom pair.*/);
    });

    test('the wasm admin tries to configure a duplicate path', async () => {
      const firstPath = [testPairMember, BASE_ASSET];
      const dublicatePath = [testPairMember, 'B', BASE_ASSET];

      const broadcastTx = () =>
        oracleInstance.updateCurrencyPaths(
          wasmAdminWallet,
          [firstPath, dublicatePath],
          customFees.exec,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*Invalid denom pair.*/);
    });

    test('the supported pairs should match the configured currency paths', async () => {
      const currencyPath = ['A', 'B', 'C', BASE_ASSET];

      await oracleInstance.updateCurrencyPaths(
        wasmAdminWallet,
        [currencyPath],
        customFees.exec,
      );

      const supportedPairs = await oracleInstance.getSupportedPairs();
      expect(supportedPairs.length).toBe(3);
      expect(supportedPairs[2]).toStrictEqual([
        currencyPath[0],
        currencyPath[1],
      ]);
      expect(supportedPairs[1]).toStrictEqual([
        currencyPath[1],
        currencyPath[2],
      ]);
      expect(supportedPairs[0]).toStrictEqual([
        currencyPath[2],
        currencyPath[3],
      ]);
    });

    test('the wasm admin tries to setup an invalid config - should produce an error', async () => {
      // price feed period = 0
      const result1 = () =>
        oracleInstance.setConfig(wasmAdminWallet, 0, 1, customFees.exec); // any precentage needed

      await expect(result1).rejects.toThrow('Price feed period can not be 0');

      // feeder precentage needed = 0
      const result2 = () =>
        oracleInstance.setConfig(wasmAdminWallet, 1, 0, customFees.exec); // any pricePeriod

      await expect(result2).rejects.toThrow(
        'Percent of expected available feeders should be > 0 and <= 1000',
      );

      // feeder precentage needed > 100%, 1000permille
      const result3 = () =>
        oracleInstance.setConfig(wasmAdminWallet, 1, 1001, customFees.exec); // any pricePeriod

      await expect(result3).rejects.toThrow(
        'Percent of expected available feeders should be > 0 and <= 1000',
      );
    });

    test('the wasm admin tries to add an invalid feeder address - should produce an error', async () => {
      const invalidAddress = 'nolus1ta43kkqwmugfdrddvdy4ewcgyw2n9maaaaaaaa';
      const result = () =>
        oracleInstance.addFeeder(
          wasmAdminWallet,
          invalidAddress,
          customFees.exec,
        );

      await expect(result).rejects.toThrow('invalid checksum');
    });

    test('the wasm admin tries to remove a non-existent feeder - should produce an error', async () => {
      const newWallet = await createWallet();

      const result = () =>
        oracleInstance.removeFeeder(
          wasmAdminWallet,
          newWallet.address as string,
          customFees.exec,
        );

      await expect(result).rejects.toThrow(
        'No feeder data for the specified address',
      );
    });
  },
);
