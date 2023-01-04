import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import {
  OracleConfig,
  Price,
  SwapTree,
  Tree,
} from '@nolus/nolusjs/build/contracts/types';
import { customFees, sleep, NATIVE_MINIMAL_DENOM } from '../util/utils';
import NODE_ENDPOINT, {
  createWallet,
  getUser1Wallet,
  getContractsOwnerWallet,
} from '../util/clients';
import {
  returnRestToMainAccount,
  sendInitExecuteFeeTokens,
} from '../util/transfer';
import {
  registerAllFeedersBack,
  removeAllFeeders,
} from '../util/smart-contracts/calculations';
import { runOrSkip } from '../util/testingRules';
import { getLeaseGroupCurrencies } from '../util/smart-contracts/getters';
import { updateOracleConfig } from '../util/smart-contracts/actions/oracle';

runOrSkip(process.env.TEST_ORACLE as string)('Oracle tests - Prices', () => {
  let contractsOwnerWallet: NolusWallet;
  let userWithBalance: NolusWallet;
  let feederWallet: NolusWallet;
  let oracleInstance: NolusContracts.Oracle;
  let initConfig: OracleConfig;
  let initSwapTree: SwapTree;
  let initBaseAsset: string;
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
    initBaseAsset = initConfig.config.base_asset;
    initSwapTree = await oracleInstance.getSwapTree();

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
    firstPairMember = currenciesPairs[0].from;
    secondPairMember = currenciesPairs[0].to.target;

    await removeAllFeeders(oracleInstance, contractsOwnerWallet);
  });

  afterAll(async () => {
    // reset the config
    await oracleInstance.updateConfig(
      contractsOwnerWallet,
      initConfig.config.price_config,
      customFees.exec,
    );

    const configAfter = await oracleInstance.getConfig();
    expect(configAfter).toStrictEqual(initConfig);

    await removeAllFeeders(oracleInstance, contractsOwnerWallet);
    await registerAllFeedersBack(oracleInstance, contractsOwnerWallet);

    // reset the swap tree
    await oracleInstance.updateSwapTree(
      contractsOwnerWallet,
      initSwapTree.tree,
      customFees.exec,
    );

    const swapTreeAfter = await oracleInstance.getSwapTree();
    expect(initSwapTree).toStrictEqual(swapTreeAfter);
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
          amount: { amount: amountAmount, ticker: amountSymbol },
          amount_quote: {
            amount: amoutnQuoteAmount,
            ticker: amountQuoteSymbol,
          },
        },
      ],
    };

    await oracleInstance.feedPrices(feederWallet, feedPrices, 1.3);
    await returnRestToMainAccount(feederWallet, NATIVE_MINIMAL_DENOM);
  }

  function resolvePrice(
    firstCurrencyToBase: number[],
    secondCurrencyToFirst: number[],
  ): number[] {
    return [
      firstCurrencyToBase[0] * secondCurrencyToFirst[0],
      firstCurrencyToBase[1] * secondCurrencyToFirst[1],
    ];
  }

  function verifyPrice(price: Price, calcPrice: number[]): void {
    // a/b === c/d if a*d == b*c
    expect(BigInt(price.amount_quote.amount) * BigInt(calcPrice[0])).toBe(
      BigInt(price.amount.amount) * BigInt(calcPrice[1]),
    );
  }

  test('the contract owner tries to add a feeder - should work as expected', async () => {
    await sendInitExecuteFeeTokens(
      userWithBalance,
      feederWallet.address as string,
    );

    let isFeeder = await oracleInstance.isFeeder(
      feederWallet.address as string,
    );
    expect(isFeeder).toBe(false);

    await oracleInstance.addFeeder(
      contractsOwnerWallet,
      feederWallet.address as string,
      customFees.exec,
    );

    isFeeder = await oracleInstance.isFeeder(feederWallet.address as string);
    expect(isFeeder).toBe(true);

    // adding an already registered feeder
    const result = () =>
      oracleInstance.addFeeder(
        contractsOwnerWallet,
        feederWallet.address as string,
        customFees.exec,
      );

    await expect(result).rejects.toThrow(
      /^.*Given address already registered as a price feeder.*/,
    );
  });

  test('a registered feeder tries to feed a price - should work as expected', async () => {
    const samplePeriodSec = 10;
    const sampleNumbers = 2;
    const priceFeedPeriodSec = samplePeriodSec * sampleNumbers;
    const expectedFeedersPermile = 500;
    await updateOracleConfig(
      oracleInstance,
      initConfig,
      expectedFeedersPermile,
      samplePeriodSec,
      sampleNumbers,
    );

    await removeAllFeeders(oracleInstance, contractsOwnerWallet);

    const firstFeederWallet = await createWallet();
    const secondFeederWallet = await createWallet();
    const thirdFeederWallet = await createWallet();
    const lastFeederWallet = await createWallet();

    await oracleInstance.addFeeder(
      contractsOwnerWallet,
      firstFeederWallet.address as string,
      customFees.exec,
    );

    await oracleInstance.addFeeder(
      contractsOwnerWallet,
      secondFeederWallet.address as string,
      customFees.exec,
    );

    await oracleInstance.addFeeder(
      contractsOwnerWallet,
      thirdFeederWallet.address as string,
      customFees.exec,
    );

    await oracleInstance.addFeeder(
      contractsOwnerWallet,
      lastFeederWallet.address as string,
      customFees.exec,
    );

    await feedPrice(
      firstFeederWallet,
      '6',
      '5',
      firstPairMember,
      secondPairMember,
    ); // any amounts

    const priceAfterFirstFeederVote = () =>
      oracleInstance.getPriceFor(firstPairMember);

    // not enough votes yet
    await expect(priceAfterFirstFeederVote).rejects.toThrow(/^.*No price.*/);

    const EXPECTED_AMOUNT_QUOTE = '33';
    const EXPECTED_AMOUNT = '10';

    await feedPrice(
      secondFeederWallet,
      EXPECTED_AMOUNT,
      EXPECTED_AMOUNT_QUOTE,
      firstPairMember,
      secondPairMember,
    );
    const priceAfterSecondFeederVote = await oracleInstance.getPriceFor(
      firstPairMember,
    );

    // already enough votes - the price should be the last added value
    expect(priceAfterSecondFeederVote.amount_quote.ticker).toBe(initBaseAsset);
    expect(priceAfterSecondFeederVote.amount.ticker).toBe(firstPairMember);

    // TO DO
    // expect(priceAfterSecondFeederVote.amount.amount).toBe(EXPECTED_AMOUNT);
    // expect(priceAfterSecondFeederVote).toBe(EXPECTED_AMOUNT_QUOTE);

    await sleep(priceFeedPeriodSec + 1); //+1sec
    // the price feed period has expired
    const resultAfterPeriod = () =>
      oracleInstance.getPricesFor([firstPairMember]);
    await expect(resultAfterPeriod).rejects.toThrow(/^.*No price.*/);
  });

  test('the contract owner changes the price period when a price is available - should work as expected', async () => {
    await removeAllFeeders(oracleInstance, contractsOwnerWallet);

    const samplePeriodSec = 10000;
    const sampleNumbers = 10;
    const priceFeedPeriodSec = samplePeriodSec * sampleNumbers;

    await updateOracleConfig(
      oracleInstance,
      initConfig,
      500,
      samplePeriodSec,
      sampleNumbers,
    ); // any expectedFeeders
    await oracleInstance.addFeeder(
      contractsOwnerWallet,
      feederWallet.address as string,
      customFees.exec,
    );

    await feedPrice(
      feederWallet,
      '22',
      '33',
      firstPairMember,
      secondPairMember,
    ); // any amounts

    const price = await oracleInstance.getPriceFor(firstPairMember);
    expect(price.amount).toBeDefined();

    await updateOracleConfig(oracleInstance, initConfig, 500, 1, 1); // 1sec feed validity period, any expectedFeeders

    // the price feed period has decreased - the price should be expired
    let result = () => oracleInstance.getPriceFor(firstPairMember);
    await expect(result).rejects.toThrow(/^.*No price.*/);

    await updateOracleConfig(
      oracleInstance,
      initConfig,
      500,
      samplePeriodSec,
      sampleNumbers,
    ); // any expectedFeeders

    // the price feed period has changed to the init state - returns data that is valid with respect to the configuration
    const afterSecondUpdateResult = await oracleInstance.getPriceFor(
      firstPairMember,
    );
    expect(afterSecondUpdateResult.amount).toBeDefined();
  });

  test('shortening and extending of the currency path when a price is available - should work as expected', async () => {
    const samplePeriodSec = 1000;
    const sampleNumbers = 10;
    const priceFeedPeriodSec = samplePeriodSec * sampleNumbers;

    await updateOracleConfig(
      oracleInstance,
      initConfig,
      500,
      samplePeriodSec,
      sampleNumbers,
    ); // any expectedFeeders

    await removeAllFeeders(oracleInstance, contractsOwnerWallet);
    await oracleInstance.addFeeder(
      contractsOwnerWallet,
      feederWallet.address as string,
      customFees.exec,
    );

    const leaseCurrencies = getLeaseGroupCurrencies();
    const firstCurrency = leaseCurrencies[0];
    const secondCurrency = leaseCurrencies[1];
    const thirdCurrency = leaseCurrencies[2];

    let newSwapTree: Tree = [
      [0, initBaseAsset],
      [[1, firstCurrency], [[2, secondCurrency]]],
    ];
    await oracleInstance.updateSwapTree(
      contractsOwnerWallet,
      newSwapTree,
      customFees.exec,
    );

    const firstCurrencyToBase = [2, 3];
    const secondCurrencyToFirst = [222, 444];

    await feedPrice(
      feederWallet,
      firstCurrencyToBase[0].toString(),
      firstCurrencyToBase[1].toString(),
      firstCurrency,
      initBaseAsset,
    );

    await feedPrice(
      feederWallet,
      secondCurrencyToFirst[0].toString(),
      secondCurrencyToFirst[1].toString(),
      secondCurrency,
      firstCurrency,
    );

    let price = await oracleInstance.getPriceFor(firstCurrency);
    expect(price.amount.amount).toBe(firstCurrencyToBase[0].toString());
    expect(price.amount_quote.amount).toBe(firstCurrencyToBase[1].toString());

    // the price should be resolved
    price = await oracleInstance.getPriceFor(secondCurrency);
    let calcPrice = resolvePrice(firstCurrencyToBase, secondCurrencyToFirst);
    verifyPrice(price, calcPrice);

    // SHORTENING
    newSwapTree = [[0, initBaseAsset], [[1, firstCurrency]]];
    await oracleInstance.updateSwapTree(
      contractsOwnerWallet,
      newSwapTree,
      customFees.exec,
    );

    // the currency path was changed so now the pair doesn`t exist
    const priceResult2 = () => oracleInstance.getPriceFor(secondCurrency);
    await expect(priceResult2).rejects.toThrow(/^.*Unsupported currency.*/);

    // EXTENDING
    newSwapTree = [
      [0, initBaseAsset],
      [[1, firstCurrency], [[2, thirdCurrency]]],
    ];
    await oracleInstance.updateSwapTree(
      contractsOwnerWallet,
      newSwapTree,
      customFees.exec,
    );

    // push price for the new currency
    const thirdCurrencyToSecond = [600, 40];
    await feedPrice(
      feederWallet,
      thirdCurrencyToSecond[0].toString(),
      thirdCurrencyToSecond[1].toString(),
      thirdCurrency,
      firstCurrency,
    );

    // the price should be resolved
    price = await oracleInstance.getPriceFor(thirdCurrency);
    calcPrice = resolvePrice(firstCurrencyToBase, thirdCurrencyToSecond);
    verifyPrice(price, calcPrice);
  });

  test('a registered feeder tries to feed a price for an invalid pair - should produce an error', async () => {
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

    await returnRestToMainAccount(feederWallet, NATIVE_MINIMAL_DENOM);

    await expect(broadcastTx).rejects.toThrow(/^.*Unsupported denom pairs.*/);
  });

  test('a registered feeder tries to feed price 0 - should produce an error', async () => {
    const feedPrices = {
      prices: [
        {
          amount: { amount: '0', ticker: firstPairMember },
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

    const broadcastTx = () =>
      oracleInstance.feedPrices(feederWallet, feedPrices, 1.3);

    await returnRestToMainAccount(feederWallet, NATIVE_MINIMAL_DENOM);

    await expect(broadcastTx).rejects.toThrow(
      /^.*The amount should not be zero.*/,
    );
  });
});
