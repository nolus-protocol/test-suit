import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { customFees, NATIVE_MINIMAL_DENOM } from '../util/utils';
import NODE_ENDPOINT, {
  getFeederWallet,
  getUser1Wallet,
} from '../util/clients';
import { returnRestToMainAccount } from '../util/transfer';
import { runOrSkip, runTestIfLocal } from '../util/testingRules';

// !!! Since the feeder we use in the locally started bot (oracle-price-feeder) is also used here
// - running the tests in this file requires the bot to be stopped
runOrSkip(process.env.TEST_ORACLE as string)('Oracle tests - Prices', () => {
  let userWithBalance: NolusWallet;
  let feederWallet: NolusWallet;
  let oracleInstance: NolusContracts.Oracle;
  let firstPairMember: string;
  let secondPairMember: string;
  const oracleContractAddress = process.env.ORACLE_ADDRESS as string;
  const initBaseAsset = process.env.LPP_BASE_CURRENCY as string;

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    userWithBalance = await getUser1Wallet();
    feederWallet = await getFeederWallet();

    const cosm = await NolusClient.getInstance().getCosmWasmClient();
    oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);

    const currenciesPairs = await oracleInstance.getCurrencyPairs();
    firstPairMember = currenciesPairs[0][0];
    secondPairMember = currenciesPairs[0][1][1];
  });

  runTestIfLocal(
    'a registered feeder tries to feed a price for an invalid pair - should produce an error',
    async () => {
      const feedPrices = {
        prices: [
          {
            amount: { amount: '2', ticker: initBaseAsset }, // any amount
            amount_quote: { amount: '5', ticker: firstPairMember }, // any amount
          },
        ],
      };

      await userWithBalance.transferAmount(
        feederWallet.address as string,
        customFees.feedPrice.amount,
        customFees.transfer,
        '',
      );

      const broadcastTx = () =>
        oracleInstance.feedPrices(feederWallet, feedPrices, 1.3);

      await expect(broadcastTx).rejects.toThrow(/^.*Unsupported denom pairs.*/);

      await returnRestToMainAccount(feederWallet, NATIVE_MINIMAL_DENOM);
    },
  );

  runTestIfLocal(
    'a registered feeder tries to feed price = 0 - should produce an error',
    async () => {
      const feedPrices = {
        prices: [
          {
            amount: { amount: '2', ticker: firstPairMember },
            amount_quote: { amount: '0', ticker: secondPairMember },
          },
        ],
      };

      await userWithBalance.transferAmount(
        feederWallet.address as string,
        customFees.feedPrice.amount,
        customFees.transfer,
        '',
      );

      let broadcastTx = () =>
        oracleInstance.feedPrices(feederWallet, feedPrices, 1.3);

      await expect(broadcastTx).rejects.toThrow(
        /^.*The quote amount should not be zero.*/,
      );

      feedPrices.prices[0].amount.amount = '0';
      feedPrices.prices[0].amount_quote.amount = '2';

      broadcastTx = () =>
        oracleInstance.feedPrices(feederWallet, feedPrices, 1.3);

      await expect(broadcastTx).rejects.toThrow(
        /^.*The amount should not be zero.*/,
      );

      await returnRestToMainAccount(feederWallet, NATIVE_MINIMAL_DENOM);
    },
  );
});
