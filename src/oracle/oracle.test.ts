import { DEFAULT_FEE, BLOCK_CREATION_TIME_DEV, sleep } from '../util/utils';
import NODE_ENDPOINT, { createWallet, getUser1Wallet } from '../util/clients';
import { NolusClient, NolusWallet } from '@nolus/nolusjs';
import { sendInitFeeTokens } from '../util/transfer';

describe('Oracle contract tests', () => {
  let user1Wallet: NolusWallet;
  let feederWallet: NolusWallet;
  let PRICE_FEED_PERIOD: number;
  let PERCENTAGE_NEEDED: number;
  let BASE_ASSET: string;
  let supportedPairsBefore: [[string, string]];
  const testPairMember = 'UAT';
  const contractAddress = process.env.ORACLE_ADDRESS as string;

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    feederWallet = await createWallet();

    // get needed params
    const configMsg = {
      config: {},
    };
    const config = await user1Wallet.queryContractSmart(
      contractAddress,
      configMsg,
    );

    BASE_ASSET = config.base_asset;
    PRICE_FEED_PERIOD = config.price_feed_period;
    PERCENTAGE_NEEDED = config.feeders_percentage_needed;

    // send some tokens to the feeder
    await sendInitFeeTokens(user1Wallet, feederWallet.address as string);

    // this period must expires
    await sleep(PRICE_FEED_PERIOD * 1000);

    // add feeder
    const addFeederMsg = {
      register_feeder: {
        feeder_address: feederWallet.address as string,
      },
    };
    await user1Wallet.еxecuteContract(
      contractAddress,
      addFeederMsg,
      DEFAULT_FEE,
    );

    const supportedPairsMsg = {
      supported_denom_pairs: {},
    };

    supportedPairsBefore = await user1Wallet.queryContractSmart(
      contractAddress,
      supportedPairsMsg,
    );

    const newSupportedPairs = supportedPairsBefore.slice();
    newSupportedPairs.push([testPairMember, BASE_ASSET]);

    const updateSupportedPairsMsg = {
      supported_denom_pairs: { pairs: newSupportedPairs },
    };

    await user1Wallet.еxecuteContract(
      contractAddress,
      updateSupportedPairsMsg,
      DEFAULT_FEE,
    );
  });

  test('the feeder should be added', async () => {
    // query - is feeder
    const isFeederMsg = {
      is_feeder: {
        address: feederWallet.address as string,
      },
    };
    const isFeeder = await user1Wallet.queryContractSmart(
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
    await user1Wallet.еxecuteContract(
      contractAddress,
      changeConfigMsg,
      DEFAULT_FEE,
    );

    // list all feeders
    const feedersMsg = {
      feeders: {},
    };
    const listFeeders = await user1Wallet.queryContractSmart(
      contractAddress,
      feedersMsg,
    );

    // calc needed votes
    const onePercentNeeded = Math.ceil(listFeeders.length / 100); // 1%

    // create the required number of feeders - 1
    for (let i = 1; i < onePercentNeeded; i++) {
      const newFeederWallet = await createWallet();

      // add a new feeder
      const addFeederMsg = {
        register_feeder: {
          feeder_address: newFeederWallet.address as string,
        },
      };
      await user1Wallet.еxecuteContract(
        contractAddress,
        addFeederMsg,
        DEFAULT_FEE,
      );

      // send tokens to the new feeder
      await sendInitFeeTokens(user1Wallet, feederWallet.address as string);

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

      await newFeederWallet.еxecuteContract(
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
      user1Wallet.queryContractSmart(contractAddress, getPriceMsg);

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

    // add the feeder
    const addFeederMsg = {
      register_feeder: {
        feeder_address: lastFeederWallet.address as string,
      },
    };
    await user1Wallet.еxecuteContract(
      contractAddress,
      addFeederMsg,
      DEFAULT_FEE,
    );

    // send tokens
    await user1Wallet.transferAmount(
      lastFeederWallet.address as string,
      DEFAULT_FEE.amount,
      DEFAULT_FEE,
    );

    // add the last required price information
    await lastFeederWallet.еxecuteContract(
      contractAddress,
      feedPrice2Msg,
      DEFAULT_FEE,
    );

    const afterResult = await user1Wallet.queryContractSmart(
      contractAddress,
      getPriceMsg,
    );

    // already enough votes - the price must be last added value
    expect(afterResult.prices[0].price.amount).toBe(EXPECTED_PRICE);
    expect(afterResult.prices[0].price.denom).toBe(BASE_ASSET);

    // the price feed period has expired + block creation time
    await sleep(BLOCK_CREATION_TIME_DEV + PRICE_FEED_PERIOD * 1000);
    const resultAfterPeriod = () =>
      user1Wallet.queryContractSmart(contractAddress, getPriceMsg);
    await expect(resultAfterPeriod).rejects.toThrow(/^.*No price for pair.*/);

    // recovery percentage needed init value
    const changeConfig2Msg = {
      config: {
        price_feed_period: PRICE_FEED_PERIOD,
        feeders_percentage_needed: PERCENTAGE_NEEDED,
      },
    };
    await user1Wallet.еxecuteContract(
      contractAddress,
      changeConfig2Msg,
      DEFAULT_FEE,
    );

    // recovery the supported pairs from the
    const updateSupportedPairsMsg = {
      supported_denom_pairs: { pairs: supportedPairsBefore },
    };

    await user1Wallet.еxecuteContract(
      contractAddress,
      updateSupportedPairsMsg,
      DEFAULT_FEE,
    );
  });
});
