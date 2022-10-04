import {
  customFees,
  sleep,
  NATIVE_MINIMAL_DENOM,
  BLOCK_CREATION_TIME_DEV_SEC,
} from '../util/utils';
import NODE_ENDPOINT, {
  createWallet,
  getUser1Wallet,
  getWasmAdminWallet,
} from '../util/clients';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import { FeedPrices } from '@nolus/nolusjs/build/contracts';

describe('Oracle contract tests', () => {
  let wasmAdminWallet: NolusWallet;
  let userWithBalance: NolusWallet;
  let feederWallet: NolusWallet;
  let oracleInstance: NolusContracts.Oracle;
  let PRICE_FEED_PERIOD: number;
  let PERMILLE_NEEDED: number;
  let BASE_ASSET: string;
  let supportedPairsBefore: string[][];
  let feedPrices: FeedPrices;
  const testPairMember = 'UAT';
  const oracleContractAddress = process.env.ORACLE_ADDRESS as string;

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    wasmAdminWallet = await getWasmAdminWallet();
    userWithBalance = await getUser1Wallet();
    feederWallet = await createWallet();

    const cosm = await NolusClient.getInstance().getCosmWasmClient();
    oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);

    const config = await oracleInstance.getConfig();

    BASE_ASSET = config.base_asset;

    PRICE_FEED_PERIOD = config.price_feed_period / 1000000000; //nanosec to sec
    PERMILLE_NEEDED = config.expected_feeders;

    const adminBalance = {
      amount: '10000000',
      denom: NATIVE_MINIMAL_DENOM,
    };

    await userWithBalance.transferAmount(
      wasmAdminWallet.address as string,
      [adminBalance],
      customFees.transfer,
    );

    // send some tokens to the feeder
    await sendInitExecuteFeeTokens(
      wasmAdminWallet,
      feederWallet.address as string,
    );

    // this period must expires
    await sleep(PRICE_FEED_PERIOD);

    const isFeeder = await oracleInstance.isFeeder(
      feederWallet.address as string,
    );
    expect(isFeeder).toBe(false);

    await oracleInstance.addFeeder(
      wasmAdminWallet,
      feederWallet.address as string,
      customFees.exec,
    );

    supportedPairsBefore = await oracleInstance.getSupportedPairs();

    const newSupportedPairs = supportedPairsBefore.slice();
    newSupportedPairs.push([testPairMember, BASE_ASSET]);

    await oracleInstance.updateSupportPairs(
      wasmAdminWallet,
      newSupportedPairs,
      customFees.exec,
    );
  });

  test('the feeder should be added', async () => {
    const isFeeder = await oracleInstance.isFeeder(
      feederWallet.address as string,
    );
    expect(isFeeder).toBe(true);
  });

  test('feed price - should work as expected', async () => {
    // change percentage needed to 1%
    await oracleInstance.setConfig(
      wasmAdminWallet,
      PRICE_FEED_PERIOD,
      10, //1% permille
      customFees.exec,
    );

    const listFeeders = await oracleInstance.getFeeders();

    // calc needed votes
    const onePercentNeeded = Math.trunc(listFeeders.length / 100) + 1; // 1%

    // create the required number of feeders - 1
    for (let i = 1; i < onePercentNeeded; i++) {
      console.log('waiting for 1% feeders ...');
      const newFeederWallet = await createWallet();

      await oracleInstance.addFeeder(
        wasmAdminWallet,
        newFeederWallet.address as string,
        customFees.exec,
      );

      // send tokens to the new feeder
      await sendInitExecuteFeeTokens(
        wasmAdminWallet,
        newFeederWallet.address as string,
      );

      // feed price
      feedPrices = {
        prices: [
          {
            amount: { amount: '11', symbol: testPairMember }, // any amount
            amount_quote: { amount: '1', symbol: BASE_ASSET }, // any amount
          },
        ],
      };

      await oracleInstance.feedPrices(
        newFeederWallet,
        feedPrices,
        customFees.exec,
      );
    }

    const price = () => oracleInstance.getPriceFor(testPairMember);

    // not enough votes yet
    await expect(price).rejects.toThrow(/^.*No price.*/);

    // create the last required feeder
    const lastFeederWallet = await createWallet();

    await oracleInstance.addFeeder(
      wasmAdminWallet,
      lastFeederWallet.address as string,
      customFees.exec,
    );

    await wasmAdminWallet.transferAmount(
      lastFeederWallet.address as string,
      customFees.exec.amount,
      customFees.transfer,
    );

    const EXPECTED_AMOUNT_QUOTE = '3';
    const EXPECTED_AMOUNT = '10';
    feedPrices = {
      prices: [
        {
          amount: { amount: EXPECTED_AMOUNT, symbol: testPairMember }, // any amount
          amount_quote: { amount: EXPECTED_AMOUNT_QUOTE, symbol: BASE_ASSET },
        },
      ],
    };

    await oracleInstance.feedPrices(
      lastFeederWallet,
      feedPrices,
      customFees.exec,
    );

    const afterResult = await oracleInstance.getPriceFor(testPairMember);

    // already enough votes - the price should be the last added value
    expect(afterResult.amount_quote.amount).toBe(EXPECTED_AMOUNT_QUOTE);
    expect(afterResult.amount_quote.symbol).toBe(BASE_ASSET);
    expect(afterResult.amount.amount).toBe(EXPECTED_AMOUNT);
    expect(afterResult.amount.symbol).toBe(testPairMember);

    // the price feed period has expired + block creation time
    await sleep(BLOCK_CREATION_TIME_DEV_SEC + PRICE_FEED_PERIOD);
    const resultAfterPeriod = () =>
      oracleInstance.getPricesFor([testPairMember]);
    await expect(resultAfterPeriod).rejects.toThrow(/^.*No price.*/);

    // set config to the init state
    await oracleInstance.setConfig(
      wasmAdminWallet,
      PRICE_FEED_PERIOD,
      PERMILLE_NEEDED,
      customFees.exec,
    );

    // set supported pairs to the init state
    await oracleInstance.updateSupportPairs(
      wasmAdminWallet,
      supportedPairsBefore,
      customFees.exec,
    );
  });

  // TO DO: Alarm ?

  test('only the wasm admin should be able to change the config', async () => {
    const result = () =>
      oracleInstance.setConfig(userWithBalance, 1, 1, customFees.exec); // any feederPercentage and pricePeriod

    await expect(result).rejects.toThrow('Unauthorized');
  });

  test('only the wasm admin should be able to change supported pairs', async () => {
    const result = () =>
      oracleInstance.updateSupportPairs(
        userWithBalance,
        supportedPairsBefore,
        customFees.exec,
      );

    await expect(result).rejects.toThrow('Unauthorized');
  });

  test('only the wasm admin should be able to add feeder', async () => {
    const result = () =>
      oracleInstance.addFeeder(
        userWithBalance,
        userWithBalance.address as string,
        customFees.exec,
      );

    await expect(result).rejects.toThrow('Unauthorized');
  });

  test('only the wasm admin should be able to remove feeder', async () => {
    const result = () =>
      oracleInstance.removeFeeder(
        userWithBalance,
        feederWallet.address as string,
        customFees.exec,
      );

    await expect(result).rejects.toThrow('Unauthorized');
  });

  test('only a registered feeder should be able to push prices', async () => {
    const result = () =>
      oracleInstance.feedPrices(userWithBalance, feedPrices, customFees.exec);

    await expect(result).rejects.toThrow(
      'No feeder data for the specified address',
    );
  });

  test('the wasm admin tries to add an invalid feeder address', async () => {
    const invalidAddress = 'nolus1ta43kkqwmugfdrddvdy4ewcgyw2n9maaaaaaaa';
    const result = () =>
      oracleInstance.addFeeder(
        wasmAdminWallet,
        invalidAddress,
        customFees.exec,
      );

    await expect(result).rejects.toThrow('invalid checksum');
  });

  test('the wasm admin tries to remove a non-existent feeder', async () => {
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

  test('the wasm admin tries to set an invalid config - should produce an error', async () => {
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
      'Percent of expected available feeders should be > 0 and <= 100',
    );
  });

  test('try to feed price for base different from the init msg base_asset parameter', async () => {
    feedPrices = {
      prices: [
        {
          amount: { amount: '2', symbol: BASE_ASSET }, // any amount
          amount_quote: { amount: '5', symbol: testPairMember }, //any amount
        },
      ],
    };

    await sendInitExecuteFeeTokens(
      wasmAdminWallet,
      feederWallet.address as string,
    );

    const broadcastTx = () =>
      oracleInstance.feedPrices(feederWallet, feedPrices, customFees.exec);

    await expect(broadcastTx).rejects.toThrow(/^.*Unsupported denom pairs.*/);
  });

  test('try to feed price 0', async () => {
    feedPrices = {
      prices: [
        {
          amount: { amount: '0', symbol: testPairMember }, // any amount
          amount_quote: { amount: '0', symbol: BASE_ASSET }, //any amount
        },
      ],
    };

    await sendInitExecuteFeeTokens(
      wasmAdminWallet,
      feederWallet.address as string,
    );

    const broadcastTx = () =>
      oracleInstance.feedPrices(feederWallet, feedPrices, customFees.exec);

    await expect(broadcastTx).rejects.toThrow(/^.*Unsupported denom pairs.*/);
  });

  test('try to update supported pairs with a base asset other than the init msg "base_asset" parameter', async () => {
    const newSupportedPairs = [BASE_ASSET, testPairMember];

    const broadcastTx = () =>
      oracleInstance.updateSupportPairs(
        wasmAdminWallet,
        [newSupportedPairs],
        customFees.exec,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*Invalid denom pair.*/);
  });

  test('try to set empty supported pairs array', async () => {
    const newSupportedPairs: any = [];

    const broadcastTx = () =>
      oracleInstance.updateSupportPairs(
        wasmAdminWallet,
        [newSupportedPairs],
        customFees.exec,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*Invalid denom pair.*/);
  });
});
