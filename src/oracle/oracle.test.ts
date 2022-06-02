import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { AccountData } from '@cosmjs/amino';
import { DEFAULT_FEE, BLOCK_CREATION_TIME_DEV, sleep } from '../util/utils';

describe('Oracle contract tests', () => {
  let userClient: SigningCosmWasmClient;
  let userAccount: AccountData;
  let feederAccount: AccountData;
  let PRICE_FEED_PERIOD: number;
  let PERCENTAGE_NEEDED: number;
  let BASE_ASSET: string;
  let supportedPairsBefore: [[string, string]];
  const testPairMember = 'UAT';
  const contractAddress = process.env.ORACLE_ADDRESS as string;

  beforeAll(async () => {
    userClient = await getUser1Client();
    [userAccount] = await (await getUser1Wallet()).getAccounts();
    const feeder1wallet = await createWallet();
    [feederAccount] = await feeder1wallet.getAccounts();

    // get needed params
    const configMsg = {
      config: {},
    };
    const config = await userClient.queryContractSmart(
      contractAddress,
      configMsg,
    );

    BASE_ASSET = config.base_asset;
    PRICE_FEED_PERIOD = config.price_feed_period;
    PERCENTAGE_NEEDED = config.feeders_percentage_needed;

    // send some tokens to the feeder
    await sendInitFeeTokens(
      userClient,
      userAccount.address,
      feederAccount.address,
    );

    // this period must expires
    await sleep(PRICE_FEED_PERIOD * 1000);

    // add feeder
    const addFeederMsg = {
      register_feeder: {
        feeder_address: feederAccount.address,
      },
    };
    await userClient.execute(
      userAccount.address,
      contractAddress,
      addFeederMsg,
      DEFAULT_FEE,
    );

    const supportedPairsMsg = {
      supported_denom_pairs: {},
    };

    supportedPairsBefore = await userClient.queryContractSmart(
      contractAddress,
      supportedPairsMsg,
    );

    const newSupportedPairs = supportedPairsBefore.slice();
    newSupportedPairs.push([testPairMember, BASE_ASSET]);

    const updateSupportedPairsMsg = {
      supported_denom_pairs: { pairs: newSupportedPairs },
    };

    await userClient.execute(
      userAccount.address,
      contractAddress,
      updateSupportedPairsMsg,
      DEFAULT_FEE,
    );
  });

  test('the feeder should be added', async () => {
    // query - is feeder
    const isFeederMsg = {
      is_feeder: {
        address: feederAccount.address,
      },
    };
    const isFeeder = await userClient.queryContractSmart(
      contractAddress,
      isFeederMsg,
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
    const changeConfigMsg = {
      config: {
        price_feed_period: PRICE_FEED_PERIOD,
        feeders_percentage_needed: 1,
      },
    };
    await userClient.execute(
      userAccount.address,
      contractAddress,
      changeConfigMsg,
      DEFAULT_FEE,
    );

    // list all feeders
    const feedersMsg = {
      feeders: {},
    };
    const listFeeders = await userClient.queryContractSmart(
      contractAddress,
      feedersMsg,
    );

    // calc needed votes
    const onePercentNeeded = Math.ceil(listFeeders.length / 100); // 1%

    // create the required number of feeders - 1
    for (let i = 1; i < onePercentNeeded; i++) {
      const newFeederWallet = await createWallet();
      const newFeederClient = await getClient(newFeederWallet);
      const [newFeederAccount] = await newFeederWallet.getAccounts();

      // add a new feeder
      const addFeederMsg = {
        register_feeder: {
          feeder_address: newFeederAccount.address,
        },
      };
      await userClient.execute(
        userAccount.address,
        contractAddress,
        addFeederMsg,
        DEFAULT_FEE,
      );

      // send tokens to the new feeder
      await sendInitFeeTokens(
        userClient,
        userAccount.address,
        feederAccount.address,
      );

      // add feed price
      const feedPriceMsg = {
        feed_prices: {
          prices: [
            {
              base: testPairMember,
              values: [[BASE_ASSET, '1.3']],
            },
          ],
        },
      };

      await newFeederClient.execute(
        newFeederAccount.address,
        contractAddress,
        feedPriceMsg,
        DEFAULT_FEE,
      );
    }

    // get price
    const getPriceMsg = {
      price_for: {
        denoms: [testPairMember],
      },
    };

    const price = () =>
      userClient.queryContractSmart(contractAddress, getPriceMsg);

    // there are still not enough votes
    await expect(price).rejects.toThrow(/^.*No price for pair.*/);

    const EXPECTED_PRICE = '3.3';
    const feedPrice2Msg = {
      feed_prices: {
        prices: [
          {
            base: testPairMember,
            values: [{ denom: BASE_ASSET, amount: EXPECTED_PRICE }],
          },
        ],
      },
    };
    // create the last required feeder
    const lastFeederWallet = await createWallet();
    const lastFeederClient = await getClient(lastFeederWallet);
    const [lastFeederAccount] = await lastFeederWallet.getAccounts();

    // add the feeder
    const addFeederMsg = {
      register_feeder: {
        feeder_address: lastFeederAccount.address,
      },
    };
    await userClient.execute(
      userAccount.address,
      contractAddress,
      addFeederMsg,
      DEFAULT_FEE,
    );

    // send tokens
    await userClient.sendTokens(
      userAccount.address,
      lastFeederAccount.address,
      DEFAULT_FEE.amount,
      DEFAULT_FEE,
    );

    // add the last required price information
    await lastFeederClient.execute(
      lastFeederAccount.address,
      contractAddress,
      feedPrice2Msg,
      DEFAULT_FEE,
    );

    const afterResult = await userClient.queryContractSmart(
      contractAddress,
      getPriceMsg,
    );

    // already enough votes - the price must be last added value
    expect(afterResult.prices[0].price.amount).toBe(EXPECTED_PRICE);
    expect(afterResult.prices[0].price.denom).toBe(BASE_ASSET);

    // the price feed period has expired + block creation time
    await sleep(BLOCK_CREATION_TIME_DEV + PRICE_FEED_PERIOD * 1000);
    const resultAfterPeriod = () =>
      userClient.queryContractSmart(contractAddress, getPriceMsg);
    await expect(resultAfterPeriod).rejects.toThrow(/^.*No price for pair.*/);

    // recovery percentage needed init value
    const changeConfig2Msg = {
      config: {
        price_feed_period: PRICE_FEED_PERIOD,
        feeders_percentage_needed: PERCENTAGE_NEEDED,
      },
    };
    await userClient.execute(
      userAccount.address,
      contractAddress,
      changeConfig2Msg,
      DEFAULT_FEE,
    );

    // recovery the supported pairs from the
    const updateSupportedPairsMsg = {
      supported_denom_pairs: { pairs: supportedPairsBefore },
    };

    await userClient.execute(
      userAccount.address,
      contractAddress,
      updateSupportedPairsMsg,
      DEFAULT_FEE,
    );
  });
});
