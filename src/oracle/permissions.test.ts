import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { customFees } from '../util/utils';
import NODE_ENDPOINT, { getUser1Wallet } from '../util/clients';
import { runOrSkip } from '../util/testingRules';

runOrSkip(process.env.TEST_ORACLE as string)(
  'Oracle tests - Permissions',
  () => {
    let userWithBalance: NolusWallet;
    let oracleInstance: NolusContracts.Oracle;
    let firstPairMember: string;
    let secondPairMember: string;
    const oracleContractAddress = process.env.ORACLE_ADDRESS as string;

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      userWithBalance = await getUser1Wallet();

      const cosm = await NolusClient.getInstance().getCosmWasmClient();
      oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);

      const currenciesPairs = await oracleInstance.getCurrencyPairs();
      firstPairMember = currenciesPairs[0][0];
      secondPairMember = currenciesPairs[0][1][1];
    });

    test('an unregistered feeder tries to push a price - should produce an error', async () => {
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
        userWithBalance.executeContract(
          oracleContractAddress,
          addPriceAlarmMsg,
          customFees.exec,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*No such contract.*/);
    });
  },
);
