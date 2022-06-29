import { customFees, BLOCK_CREATION_TIME_DEV, sleep } from '../util/utils';
import NODE_ENDPOINT, { createWallet, getUser1Wallet } from '../util/clients';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { sendInitExecuteFeeTokens } from '../util/transfer';

describe('Oracle contract tests', () => {
  let user1Wallet: NolusWallet;
  let feederWallet: NolusWallet;
  let oracleInstance: NolusContracts.Oracle;
  let PRICE_FEED_PERIOD: number;
  let PERCENTAGE_NEEDED: number;
  let BASE_ASSET: string;
  let supportedPairsBefore: string[][];
  const testPairMember = 'UAT';
  const contractAddress = process.env.ORACLE_ADDRESS as string;

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    feederWallet = await createWallet();

    const cosm = await NolusClient.getInstance().getCosmWasmClient();
    oracleInstance = new NolusContracts.Oracle(cosm);

    const config = await oracleInstance.getConfig(contractAddress);

    BASE_ASSET = config.base_asset;
    PRICE_FEED_PERIOD = config.price_feed_period;
    PERCENTAGE_NEEDED = config.feeders_percentage_needed;

    // send some tokens to the feeder
    await sendInitExecuteFeeTokens(user1Wallet, feederWallet.address as string);

    // this period must expires
    await sleep(PRICE_FEED_PERIOD * 1000);

    await oracleInstance.addFeeder(
      contractAddress,
      user1Wallet,
      feederWallet.address as string,
      customFees.exec,
    );

    supportedPairsBefore = await oracleInstance.getSupportedPairs(
      contractAddress,
    );

    const newSupportedPairs = supportedPairsBefore.slice();
    newSupportedPairs.push([testPairMember, BASE_ASSET]);

    await oracleInstance.updateSupportPairs(
      contractAddress,
      user1Wallet,
      newSupportedPairs,
      customFees.exec,
    );
  });

  test('the feeder should be added', async () => {
    // query - is feeder

    const isFeeder = await oracleInstance.isFeeder(
      contractAddress,
      feederWallet.address as string,
    );
    expect(isFeeder).toBe(true);
  });

  // test('push new price feed for unsupported denom pairs - should produce an error', async () => {
  // TO DO
  // });

  // test('feed nested price should works as expected', async () => {  // [OSMO,UST] [B,UST] -> get OSMO,B
  // TO DO
  // });

  // TO DO: Alarm ?

  test('feed price should works as expected', async () => {
    // change percentage needed to 1%
    await oracleInstance.changeConfig(
      contractAddress,
      user1Wallet,
      PRICE_FEED_PERIOD,
      1,
      customFees.exec,
    );

    const listFeeders = await oracleInstance.getFeeders(contractAddress);

    // calc needed votes
    const onePercentNeeded = Math.ceil(listFeeders.length / 100); // 1%

    // create the required number of feeders - 1
    for (let i = 1; i < onePercentNeeded; i++) {
      const newFeederWallet = await createWallet();

      await oracleInstance.addFeeder(
        contractAddress,
        user1Wallet,
        newFeederWallet.address as string,
        customFees.exec,
      );

      // send tokens to the new feeder
      await sendInitExecuteFeeTokens(
        user1Wallet,
        feederWallet.address as string,
      );

      // add feed price
      const feedPrices = {
        prices: [
          {
            base: testPairMember,
            values: [{ denom: BASE_ASSET, amount: '1.3' }],
          },
        ],
      };

      await oracleInstance.addFeedPrice(
        contractAddress,
        newFeederWallet,
        feedPrices,
        customFees.exec,
      );
    }

    const price = () =>
      oracleInstance.getPrices(contractAddress, [testPairMember]);

    // there are still not enough votes
    await expect(price).rejects.toThrow(/^.*No price for pair.*/);

    // create the last required feeder
    const lastFeederWallet = await createWallet();

    await oracleInstance.addFeeder(
      contractAddress,
      user1Wallet,
      lastFeederWallet.address as string,
      customFees.exec,
    );

    // send tokens
    await user1Wallet.transferAmount(
      lastFeederWallet.address as string,
      customFees.exec.amount,
      customFees.transfer,
    );

    const EXPECTED_PRICE = '3.3';

    const feedPrices = {
      prices: [
        {
          base: testPairMember,
          values: [{ denom: BASE_ASSET, amount: EXPECTED_PRICE }],
        },
      ],
    };

    await oracleInstance.addFeedPrice(
      contractAddress,
      lastFeederWallet,
      feedPrices,
      customFees.exec,
    );

    const afterResult = await oracleInstance.getPrices(contractAddress, [
      testPairMember,
    ]);

    // already enough votes - the price must be last added value
    expect(afterResult.prices[0].price.amount).toBe(EXPECTED_PRICE);
    expect(afterResult.prices[0].price.denom).toBe(BASE_ASSET);

    // the price feed period has expired + block creation time
    await sleep(BLOCK_CREATION_TIME_DEV + PRICE_FEED_PERIOD * 1000);
    const resultAfterPeriod = () =>
      oracleInstance.getPrices(contractAddress, [testPairMember]);
    await expect(resultAfterPeriod).rejects.toThrow(/^.*No price for pair.*/);

    // set config to the init state
    await oracleInstance.changeConfig(
      contractAddress,
      user1Wallet,
      PRICE_FEED_PERIOD,
      PERCENTAGE_NEEDED,
      customFees.exec,
    );

    // set SupportPairs to the init state
    await oracleInstance.updateSupportPairs(
      contractAddress,
      user1Wallet,
      supportedPairsBefore,
      customFees.exec,
    );
  });
});
