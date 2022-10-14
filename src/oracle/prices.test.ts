import { customFees, sleep, NATIVE_MINIMAL_DENOM } from '../util/utils';
import NODE_ENDPOINT, {
  createWallet,
  getUser1Wallet,
  getWasmAdminWallet,
} from '../util/clients';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import {
  returnRestToMainAccount,
  sendInitExecuteFeeTokens,
} from '../util/transfer';
import { removeAllFeeders } from '../util/smart-contracts';
import { NANOSEC } from '../util/utils';

describe('Oracle tests - Prices', () => {
  let wasmAdminWallet: NolusWallet;
  let userWithBalance: NolusWallet;
  let feederWallet: NolusWallet;
  let oracleInstance: NolusContracts.Oracle;
  let INIT_PRICE_FEED_PERIOD: number;
  let INIT_PERMILLES_NEEDED: number;
  let BASE_ASSET: string;
  const testPairMember = 'UAT';
  const oracleContractAddress = process.env.ORACLE_ADDRESS as string;

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    wasmAdminWallet = await getWasmAdminWallet();
    userWithBalance = await getUser1Wallet();
    feederWallet = await createWallet();

    const cosm = await NolusClient.getInstance().getCosmWasmClient();
    oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);

    const configBefore = await oracleInstance.getConfig();
    BASE_ASSET = configBefore.base_asset;
    INIT_PRICE_FEED_PERIOD = configBefore.price_feed_period / NANOSEC; //nanosec to sec
    INIT_PERMILLES_NEEDED = configBefore.expected_feeders;

    const adminBalance = {
      amount: '10000000',
      denom: NATIVE_MINIMAL_DENOM,
    };

    await userWithBalance.transferAmount(
      wasmAdminWallet.address as string,
      [adminBalance],
      customFees.transfer,
    );

    const newCurrencyPaths = [[testPairMember, BASE_ASSET]];
    await oracleInstance.updateCurrencyPaths(
      wasmAdminWallet,
      newCurrencyPaths,
      customFees.exec,
    );
  });

  afterAll(async () => {
    await oracleInstance.setConfig(
      wasmAdminWallet,
      INIT_PRICE_FEED_PERIOD,
      INIT_PERMILLES_NEEDED,
      customFees.exec,
    );

    const configAfter = await oracleInstance.getConfig();
    expect(configAfter.price_feed_period).toBe(
      INIT_PRICE_FEED_PERIOD * NANOSEC,
    );
    expect(configAfter.expected_feeders).toBe(INIT_PERMILLES_NEEDED);
  });

  async function feedPrice(
    feederWallet: NolusWallet,
    amountAmount: string,
    amoutnQuoteAmount: string,
    amountSymbol: string,
    amountQuoteSymbol: string,
  ) {
    await userWithBalance.transferAmount(
      feederWallet.address as string,
      customFees.feedPrice.amount,
      customFees.transfer,
      '',
    );

    const feedPrices = {
      prices: [
        {
          amount: { amount: amountAmount, symbol: amountSymbol },
          amount_quote: {
            amount: amoutnQuoteAmount,
            symbol: amountQuoteSymbol,
          },
        },
      ],
    };

    await oracleInstance.feedPrices(feederWallet, feedPrices, 1.3);
    await returnRestToMainAccount(feederWallet, NATIVE_MINIMAL_DENOM);
  }

  async function setConfig(
    priceFeedPeriodSec: number,
    feedersNeededPermilles: number,
  ) {
    await oracleInstance.setConfig(
      wasmAdminWallet,
      priceFeedPeriodSec,
      feedersNeededPermilles,
      customFees.exec,
    );
  }

  test('the wasm admin tries to add a feeder - should work as expected', async () => {
    await sendInitExecuteFeeTokens(
      userWithBalance,
      feederWallet.address as string,
    );

    let isFeeder = await oracleInstance.isFeeder(
      feederWallet.address as string,
    );
    expect(isFeeder).toBe(false);

    await oracleInstance.addFeeder(
      wasmAdminWallet,
      feederWallet.address as string,
      customFees.exec,
    );

    isFeeder = await oracleInstance.isFeeder(feederWallet.address as string);
    expect(isFeeder).toBe(true);

    // try to add an already registered feeder
    const result = () =>
      oracleInstance.addFeeder(
        wasmAdminWallet,
        feederWallet.address as string,
        customFees.exec,
      );

    await expect(result).rejects.toThrow(
      /^.*Given address already registered as a price feeder.*/,
    );
  });

  test('a registered feeder tries to feed a price - should work as expected', async () => {
    const priceFeedPeriodSec = 30;
    await setConfig(priceFeedPeriodSec, 500);

    await removeAllFeeders(oracleInstance, wasmAdminWallet);

    // add feeders
    const firstFeederWallet = await createWallet();
    const secondFeederWallet = await createWallet();
    const thirdFeederWallet = await createWallet();

    await oracleInstance.addFeeder(
      wasmAdminWallet,
      firstFeederWallet.address as string,
      customFees.exec,
    );

    await oracleInstance.addFeeder(
      wasmAdminWallet,
      secondFeederWallet.address as string,
      customFees.exec,
    );

    await oracleInstance.addFeeder(
      wasmAdminWallet,
      thirdFeederWallet.address as string,
      customFees.exec,
    );

    await feedPrice(firstFeederWallet, '11', '1', testPairMember, BASE_ASSET);
    const priceAfterFirstFeederVote = () =>
      oracleInstance.getPriceFor(testPairMember);

    // not enough votes yet
    await expect(priceAfterFirstFeederVote).rejects.toThrow(/^.*No price.*/);

    const EXPECTED_AMOUNT_QUOTE = '3';
    const EXPECTED_AMOUNT = '10';

    await feedPrice(
      secondFeederWallet,
      EXPECTED_AMOUNT,
      EXPECTED_AMOUNT_QUOTE,
      testPairMember,
      BASE_ASSET,
    );
    const priceAfterSecondFeederVote = await oracleInstance.getPriceFor(
      testPairMember,
    );

    // already enough votes - the price should be the last added value
    expect(priceAfterSecondFeederVote.amount_quote.amount).toBe(
      EXPECTED_AMOUNT_QUOTE,
    );
    expect(priceAfterSecondFeederVote.amount_quote.symbol).toBe(BASE_ASSET);
    expect(priceAfterSecondFeederVote.amount.amount).toBe(EXPECTED_AMOUNT);
    expect(priceAfterSecondFeederVote.amount.symbol).toBe(testPairMember);

    // the price feed period has expired
    await sleep(priceFeedPeriodSec + 1);
    const resultAfterPeriod = () =>
      oracleInstance.getPricesFor([testPairMember]);
    await expect(resultAfterPeriod).rejects.toThrow(/^.*No price.*/);
  });

  test('the wasm admin changes the price period when a price is available - should work as expected', async () => {
    await removeAllFeeders(oracleInstance, wasmAdminWallet);

    const priceFeedPeriodSec = 100000;
    await setConfig(priceFeedPeriodSec, 500);
    await oracleInstance.addFeeder(
      wasmAdminWallet,
      feederWallet.address as string,
      customFees.exec,
    );

    await feedPrice(feederWallet, '227', '337', testPairMember, BASE_ASSET); // any amounts

    const afterResult = await oracleInstance.getPriceFor(testPairMember);
    expect(afterResult.amount).toBeDefined();

    // change the price feed period = 1sec
    await setConfig(1, 500);

    // the price feed period was changed so now the price should be expired
    const resultAfterPeriod = () => oracleInstance.getPriceFor(testPairMember);
    await expect(resultAfterPeriod).rejects.toThrow(/^.*No price.*/);

    await setConfig(priceFeedPeriodSec, 500);

    // the price feed period was changed but the price has already expired anyway -> 'No price'
    const resultAfterPeriodUpdate = () =>
      oracleInstance.getPriceFor(testPairMember);
    await expect(resultAfterPeriodUpdate).rejects.toThrow(/^.*No price.*/);
  });

  test('the wasm admin changes the expected feeders % when a price is available - should work as expected', async () => {
    const priceFeedPeriodSec = 100000;
    const feedersNeededPermille = 500; // 50%
    await setConfig(priceFeedPeriodSec, feedersNeededPermille);

    await removeAllFeeders(oracleInstance, wasmAdminWallet);

    // add feeders
    const firstFeederWallet = await createWallet();
    const secondFeederWallet = await createWallet();
    const thirdFeederWallet = await createWallet();

    await oracleInstance.addFeeder(
      wasmAdminWallet,
      firstFeederWallet.address as string,
      customFees.exec,
    );

    await oracleInstance.addFeeder(
      wasmAdminWallet,
      secondFeederWallet.address as string,
      customFees.exec,
    );

    await oracleInstance.addFeeder(
      wasmAdminWallet,
      thirdFeederWallet.address as string,
      customFees.exec,
    );

    await feedPrice(firstFeederWallet, '11', '1', testPairMember, BASE_ASSET);
    await feedPrice(secondFeederWallet, '11', '1', testPairMember, BASE_ASSET);

    const afterResult = await oracleInstance.getPriceFor(testPairMember);
    expect(afterResult.amount).toBeDefined();

    // change the expected feeders % to > %
    await setConfig(priceFeedPeriodSec, 1000); // 100%

    // the expected feeders % was changed so now the price should be expired
    const resultAfterPeriod = () => oracleInstance.getPriceFor(testPairMember);
    await expect(resultAfterPeriod).rejects.toThrow(/^.*No price.*/);
  });

  test('the wasm admin removes the current currency path when a price is available - should work as expected', async () => {
    const priceFeedPeriodSec = 100000;
    await setConfig(priceFeedPeriodSec, 500);

    await removeAllFeeders(oracleInstance, wasmAdminWallet);

    await oracleInstance.addFeeder(
      wasmAdminWallet,
      feederWallet.address as string,
      customFees.exec,
    );

    await feedPrice(feederWallet, '22', '33', testPairMember, BASE_ASSET); // any amounts

    const afterResult = await oracleInstance.getPriceFor(testPairMember);
    expect(afterResult.amount).toBeDefined();

    // change the currency path
    const newSupportedPairs = ['A', BASE_ASSET];

    await oracleInstance.updateCurrencyPaths(
      wasmAdminWallet,
      [newSupportedPairs],
      customFees.exec,
    );
    // the currency path was changed so now the pair doesn`t exist
    const resultAfterPeriod = () => oracleInstance.getPriceFor(testPairMember);
    await expect(resultAfterPeriod).rejects.toThrow(
      /^.*Unsupported currency 'UAT'.*/,
    );
  });

  // TO DO:
  test('shortening and extending of the currency path when a price is available', async () => {
    // SHORTENING
    // change the currency path
    const newCurrencyPath = ['OSMO', 'WETH', BASE_ASSET];

    await oracleInstance.updateCurrencyPaths(
      wasmAdminWallet,
      [newCurrencyPath],
      customFees.exec,
    );

    await removeAllFeeders(oracleInstance, wasmAdminWallet);

    await oracleInstance.addFeeder(
      wasmAdminWallet,
      feederWallet.address as string,
      customFees.exec,
    );

    await feedPrice(
      feederWallet,
      '2',
      '3',
      newCurrencyPath[0],
      newCurrencyPath[1],
    ); // any amounts

    await feedPrice(
      feederWallet,
      '22',
      '33',
      newCurrencyPath[1],
      newCurrencyPath[2],
    ); // any amounts

    const price1BeforeChange = await oracleInstance.getPriceFor(
      newCurrencyPath[0],
    );
    expect(price1BeforeChange.amount).toBeDefined();

    const price2BeforeChange = await oracleInstance.getPriceFor(
      newCurrencyPath[1],
    );
    expect(price2BeforeChange.amount).toBeDefined();

    // TO DO
    console.log(price1BeforeChange);
    console.log(price2BeforeChange);

    const shorteningCurrencyPath = [newCurrencyPath[1], BASE_ASSET];
    await oracleInstance.updateCurrencyPaths(
      wasmAdminWallet,
      [shorteningCurrencyPath],
      customFees.exec,
    );

    const price1AfterChange = await oracleInstance.getPriceFor(
      newCurrencyPath[1],
    );
    expect(price1AfterChange.amount).toBeUndefined();

    const price2AfterChange = await oracleInstance.getPriceFor(
      newCurrencyPath[2],
    );
    expect(price2AfterChange.amount).toBeDefined();

    // EXTENDING
    // TO DO
  });

  test('a registered feeder tries to feed a price for a base asset other than the init msg "base_asset" parameter - should produce an error', async () => {
    const feedPrices = {
      prices: [
        {
          amount: { amount: '2', symbol: BASE_ASSET }, // any amount
          amount_quote: { amount: '5', symbol: testPairMember }, // any amount
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

    await returnRestToMainAccount(feederWallet, NATIVE_MINIMAL_DENOM);

    await expect(broadcastTx).rejects.toThrow(/^.*Unsupported denom pairs.*/);
  });

  test('a registered feeder tries to feed price 0 - should produce an error', async () => {
    const feedPrices = {
      prices: [
        {
          amount: { amount: '0', symbol: testPairMember }, // any amount
          amount_quote: { amount: '0', symbol: BASE_ASSET }, // any amount
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

    await returnRestToMainAccount(feederWallet, NATIVE_MINIMAL_DENOM);

    await expect(broadcastTx).rejects.toThrow(/^.*Unsupported denom pairs.*/);
  });
});
