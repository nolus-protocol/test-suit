import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import {
  OracleConfig,
  OraclePriceConfig,
  Tree,
} from '@nolus/nolusjs/build/contracts/types';
import { customFees, NATIVE_MINIMAL_DENOM } from '../util/utils';
import NODE_ENDPOINT, {
  createWallet,
  getUser1Wallet,
  getContractsOwnerWallet,
} from '../util/clients';
import { runOrSkip } from '../util/testingRules';

runOrSkip(process.env.TEST_ORACLE as string)(
  'Oracle tests - Permissions',
  () => {
    let contractsOwnerWallet: NolusWallet;
    let userWithBalance: NolusWallet;
    let feederWallet: NolusWallet;
    let oracleInstance: NolusContracts.Oracle;
    let initConfig: OracleConfig;
    let firstPairMember: string;
    let secondPairMember: string;
    const oracleContractAddress = process.env.ORACLE_ADDRESS as string;

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      contractsOwnerWallet = await getContractsOwnerWallet();
      userWithBalance = await getUser1Wallet();
      feederWallet = await createWallet();

      const cosm = await NolusClient.getInstance().getCosmWasmClient();
      oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);
      initConfig = await oracleInstance.getConfig();

      const adminBalance = {
        amount: '10000000',
        denom: NATIVE_MINIMAL_DENOM,
      };

      await userWithBalance.transferAmount(
        contractsOwnerWallet.address as string,
        [adminBalance],
        customFees.transfer,
      );

      const currenciesPairs = await oracleInstance.getCurrencyPairs();
      firstPairMember = currenciesPairs[0][0];
      secondPairMember = currenciesPairs[0][1][1];
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
      };

      const result = () =>
        oracleInstance.feedPrices(userWithBalance, feedPrices, 1.3);

      await expect(result).rejects.toThrow(
        'No feeder data for the specified address',
      );
    });

    test('only the contract owner should be able to change the config', async () => {
      const priceConfig: OraclePriceConfig = {
        min_feeders: 1,
        discount_factor: 1,
        sample_period_secs: 1,
        samples_number: 1,
      };

      const result = () =>
        oracleInstance.updateConfig(
          userWithBalance,
          priceConfig,
          customFees.exec,
        ); // any feederPercentage and pricePeriod

      await expect(result).rejects.toThrow(
        `Checked address doesn't match the one associated with access control variable`,
      );
    });

    test('only the contract owner should be able to change the currency paths', async () => {
      const swapTree: Tree = {
        value: [0, 'A'],
      };

      const result = () =>
        oracleInstance.updateSwapTree(
          userWithBalance,
          swapTree,
          customFees.exec,
        );

      await expect(result).rejects.toThrow(
        `Checked address doesn't match the one associated with access control variable`,
      );
    });

    test('only the contract owner should be able to add a feeder', async () => {
      const result = () =>
        oracleInstance.addFeeder(
          userWithBalance,
          userWithBalance.address as string,
          customFees.exec,
        );

      await expect(result).rejects.toThrow(
        `Checked address doesn't match the one associated with access control variable`,
      );
    });

    test('only the contract owner should be able to remove a feeder', async () => {
      await oracleInstance.addFeeder(
        contractsOwnerWallet,
        feederWallet.address as string,
        customFees.exec,
      );

      const result = () =>
        oracleInstance.removeFeeder(
          userWithBalance,
          feederWallet.address as string,
          customFees.exec,
        );

      await expect(result).rejects.toThrow(
        `Checked address doesn't match the one associated with access control variable`,
      );
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
        contractsOwnerWallet.executeContract(
          oracleContractAddress,
          addPriceAlarmMsg,
          customFees.exec,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*No such contract.*/);
    });
  },
);
