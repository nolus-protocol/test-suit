import { customFees, NATIVE_MINIMAL_DENOM } from '../util/utils';
import NODE_ENDPOINT, {
  createWallet,
  getUser1Wallet,
  getWasmAdminWallet,
} from '../util/clients';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';

describe('Oracle tests - Permissions', () => {
  let wasmAdminWallet: NolusWallet;
  let userWithBalance: NolusWallet;
  let feederWallet: NolusWallet;
  let oracleInstance: NolusContracts.Oracle;
  const testPairMember = 'UAT';
  const oracleContractAddress = process.env.ORACLE_ADDRESS as string;

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    wasmAdminWallet = await getWasmAdminWallet();
    userWithBalance = await getUser1Wallet();
    feederWallet = await createWallet();

    const cosm = await NolusClient.getInstance().getCosmWasmClient();
    oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);

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

  test('only a registered feeder should be able to push a price', async () => {
    const feedPrices = {
      prices: [
        {
          amount: { amount: '10', symbol: 'A' },
          amount_quote: { amount: '10', symbol: 'B' },
        },
      ],
    }; // any

    const result = () =>
      oracleInstance.feedPrices(
        userWithBalance,
        feedPrices,
        customFees.feedPrice,
      );

    await expect(result).rejects.toThrow(
      'No feeder data for the specified address',
    );
  });

  test('only the wasm admin should be able to change the config', async () => {
    const result = () =>
      oracleInstance.setConfig(userWithBalance, 10, 10, customFees.exec); // any feederPercentage and pricePeriod

    await expect(result).rejects.toThrow('Unauthorized');
  });

  test('only the wasm admin should be able to change the currency paths', async () => {
    const currencyPath = ['A', 'B'];
    const result = () =>
      oracleInstance.updateCurrencyPaths(
        userWithBalance,
        [currencyPath],
        customFees.exec,
      );

    await expect(result).rejects.toThrow('Unauthorized');
  });

  test('only the wasm admin should be able to add a feeder', async () => {
    const result = () =>
      oracleInstance.addFeeder(
        userWithBalance,
        userWithBalance.address as string,
        customFees.exec,
      );

    await expect(result).rejects.toThrow('Unauthorized');
  });

  test('only the wasm admin should be able to remove a feeder', async () => {
    // first add feeder
    await oracleInstance.addFeeder(
      wasmAdminWallet,
      feederWallet.address as string,
      customFees.exec,
    );

    const result = () =>
      oracleInstance.removeFeeder(
        userWithBalance,
        feederWallet.address as string,
        customFees.exec,
      );

    await expect(result).rejects.toThrow('Unauthorized');
  });

  test('the alarm should not be added externally', async () => {
    const addPriceAlarmMsg = {
      add_price_alarm: {
        alarm: {
          below: {
            amount: { amount: '5', symbol: testPairMember }, // any
            amount_quote: { amount: '5', symbol: testPairMember }, // any
          },
          currency: 'B', // any
        },
      },
    };

    const broadcastTx = () =>
      wasmAdminWallet.executeContract(
        oracleContractAddress,
        addPriceAlarmMsg,
        customFees.exec,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*No such contract.*/);
  });
});
