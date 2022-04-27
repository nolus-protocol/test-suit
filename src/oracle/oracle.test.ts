import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import {
  getUser1Client,
  getUser1Wallet,
  getClient,
  createWallet,
} from '../util/clients';
import { AccountData } from '@cosmjs/amino';
import { DEFAULT_FEE, sleep } from '../util/utils';

describe('Oracle contract tests', () => {
  const customFees = {
    exec: {
      amount: [{ amount: '20000', denom: 'unolus' }],
      gas: '2000000',
    },
  };
  let userClient: SigningCosmWasmClient;
  let userAccount: AccountData;
  let feederAccount: AccountData;
  let listFeedersBeforeTests;
  const contractAddress = process.env.ORACLE_ADDRESS as string;

  //TO DO: Maybe there should be a contract message that gives me this type of info as result?
  const PRICE_FEED_PERIOD = 60; //example - i need this for the tests
  const PERCENTAGE_NEEDED = 50; //also

  beforeAll(async () => {
    userClient = await getUser1Client();
    [userAccount] = await (await getUser1Wallet()).getAccounts();
    const feeder1wallet = await createWallet();
    [feederAccount] = await feeder1wallet.getAccounts();

    // send some tokens
    await userClient.sendTokens(
      userAccount.address,
      feederAccount.address,
      customFees.exec.amount,
      DEFAULT_FEE,
    );

    // list all feeders
    const feedersMsg = {
      feeders: {},
    };

    listFeedersBeforeTests = await userClient.queryContractSmart(
      contractAddress,
      feedersMsg,
    );

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
      customFees.exec,
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

    // list all feeders
    const feedersMsg = {
      feeders: {},
    };
    const listFeeders = await userClient.queryContractSmart(
      contractAddress,
      feedersMsg,
    );

    expect(listFeeders.length).toEqual(listFeedersBeforeTests.length + 1);
  });

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
      customFees.exec,
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
    const onePercentNeeded = Math.floor(listFeeders.length / 100); // 1%

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
        customFees.exec,
      );

      // send tokens to the new feeder
      await userClient.sendTokens(
        userAccount.address,
        newFeederAccount.address,
        customFees.exec.amount,
        DEFAULT_FEE,
      );

      // add feed price
      const feedPriceMsg = {
        feed_price: {
          base: 'OSM',
          prices: [
            ['mAAPL', '1.6'],
            ['mGOGOL', '1.3'],
          ],
        },
      };
      await newFeederClient.execute(
        newFeederAccount.address,
        contractAddress,
        feedPriceMsg,
        customFees.exec,
      );
    }

    // get price
    const getPriceMsg = {
      price: {
        base: 'OSM',
        quote: 'mGOGOL',
      },
    };

    const price = () =>
      userClient.queryContractSmart(contractAddress, getPriceMsg);

    // there are still not enough votes
    await expect(price).rejects.toThrow(/^.*No price for pair.*/);

    const EXPECTED_PRICE = '3.3';
    const feedPrice2Msg = {
      feed_price: {
        base: 'OSM',
        prices: [
          ['mAAPL', '3.4'],
          ['mGOGOL', EXPECTED_PRICE],
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
      customFees.exec,
    );

    // send tokens
    await userClient.sendTokens(
      userAccount.address,
      lastFeederAccount.address,
      customFees.exec.amount,
      DEFAULT_FEE,
    );

    // add the last required price information
    await lastFeederClient.execute(
      lastFeederAccount.address,
      contractAddress,
      feedPrice2Msg,
      customFees.exec,
    );

    const afterResult = await userClient.queryContractSmart(
      contractAddress,
      getPriceMsg,
    );

    // already enough votes - the price must be last added value
    expect(afterResult.price).toBe(EXPECTED_PRICE);

    // the price feed period has expired + 5sec block creation time
    await sleep((PRICE_FEED_PERIOD + 5) * 1000);
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
      customFees.exec,
    );
  });
});
