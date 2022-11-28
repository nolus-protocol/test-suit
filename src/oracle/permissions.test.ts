import { customFees, NATIVE_MINIMAL_DENOM } from '../util/utils';
import NODE_ENDPOINT, {
  createWallet,
  getUser1Wallet,
  getWasmAdminWallet,
} from '../util/clients';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { runOrSkip } from '../util/testingRules';
import { Tree } from '@nolus/nolusjs/build/contracts/types/SwapTree';

runOrSkip(process.env.TEST_ORACLE as string)(
  'Oracle tests - Permissions',
  () => {
    let wasmAdminWallet: NolusWallet;
    let userWithBalance: NolusWallet;
    let feederWallet: NolusWallet;
    let oracleInstance: NolusContracts.Oracle;
    let firstPairMember: string;
    let secondPairMember: string;
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

      const currenciesPairs = await oracleInstance.getCurrencyPairs();
      firstPairMember = currenciesPairs[0].from;
      secondPairMember = currenciesPairs[0].to.target;
    });

    test('only a registered feeder should be able to push a price', async () => {
      // TO DO: make valid price
      const feedPrices = {
        prices: [
          {
            amount: { amount: '10', ticker: firstPairMember },
            amount_quote: { amount: '10', ticker: secondPairMember },
          },
        ],
      }; // any amounts

      const result = () =>
        oracleInstance.feedPrices(userWithBalance, feedPrices, 1.3);

      await expect(result).rejects.toThrow(
        'No feeder data for the specified address',
      );
    });

    test('only the contract owner should be able to change the config', async () => {
      const result = () =>
        oracleInstance.setConfig(userWithBalance, 10, 10, customFees.exec); // any feederPercentage and pricePeriod

      await expect(result).rejects.toThrow('Unauthorized');
    });

    test('only the contract owner should be able to change the currency paths', async () => {
      const swapTree: Tree = [[0, 'A']]; //any
      const result = () =>
        oracleInstance.updateSwapTree(
          userWithBalance,
          swapTree,
          customFees.exec,
        );

      await expect(result).rejects.toThrow('Unauthorized');
    });

    test('only the contract owner should be able to add a feeder', async () => {
      const result = () =>
        oracleInstance.addFeeder(
          userWithBalance,
          userWithBalance.address as string,
          customFees.exec,
        );

      await expect(result).rejects.toThrow('Unauthorized');
    });

    test('only the contract owner should be able to remove a feeder', async () => {
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
              amount: { amount: '5', ticker: firstPairMember },
              amount_quote: { amount: '5', ticker: secondPairMember },
            },
          },
        },
      }; // any amounts

      const broadcastTx = () =>
        wasmAdminWallet.executeContract(
          oracleContractAddress,
          addPriceAlarmMsg,
          customFees.exec,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*No such contract.*/);
    });
  },
);
