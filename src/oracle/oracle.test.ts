import * as fs from 'fs';
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
    upload: {
      amount: [{ denom: 'unolus', amount: '2000000' }],
      gas: '2000000',
    },
    init: {
      amount: [{ amount: '500000', denom: 'unolus' }],
      gas: '500000',
    },
    exec: {
      amount: [{ amount: '200000', denom: 'unolus' }],
      gas: '200000',
    },
  };
  let userClient: SigningCosmWasmClient;
  let userAccount: AccountData;
  let feederClient: SigningCosmWasmClient;
  let feederAccount: AccountData;
  let contractAddress: string;

  //TO DO: how to find out what the price feed period is? Maybe there should be a contract message that gives me this type of info as result?
  const PRICE_FEED_PERIOD = 5; //example - i need it for the tests

  beforeEach(async () => {
    userClient = await getUser1Client();
    [userAccount] = await (await getUser1Wallet()).getAccounts();
    const feeder1wallet = await createWallet();
    feederClient = await getClient(feeder1wallet);
    [feederAccount] = await feeder1wallet.getAccounts();

    // send some tokens
    await userClient.sendTokens(
      userAccount.address,
      feederAccount.address,
      customFees.upload.amount,
      DEFAULT_FEE,
    );

    // TO DO: contractAddress = process.env.ORACLE_ADDRESS;

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
  });

  test('feed price should works as expected - one feeder', async () => {
    const mAAPL_PRICE = '1.2';
    const mGOGOL_PRICE = '1.3';

    // feed price
    const feedPriceMsg = {
      feed_price: {
        base: 'OSM',
        prices: [
          [mAAPL_PRICE, '1.2'],
          [mGOGOL_PRICE, '1.3'],
        ],
      },
    };
    await feederClient.execute(
      feederAccount.address,
      contractAddress,
      feedPriceMsg,
      customFees.exec,
    );

    // get price
    const mGOGOL_PriceMsg = {
      price: {
        base: 'OSM',
        quote: 'mGOGOL',
      },
    };
    const mAAPL_PriceMsg = {
      price: {
        base: 'OSM',
        quote: 'mAAPL',
      },
    };
    const failed_PriceMsg = {
      price: {
        base: 'ust',
        quote: 'mAAPL',
      },
    };

    const result = await userClient.queryContractSmart(
      contractAddress,
      mGOGOL_PriceMsg,
    );
    const result2 = await userClient.queryContractSmart(
      contractAddress,
      mAAPL_PriceMsg,
    );
    const result3 = () =>
      userClient.queryContractSmart(contractAddress, failed_PriceMsg);

    expect(result.price).toBe(mGOGOL_PRICE);
    expect(result2.price).toBe(mAAPL_PRICE);
    await expect(result3).rejects.toThrow(/^.*No price for pair.*/);

    // the price feed period has expired
    await sleep((PRICE_FEED_PERIOD + 5) * 1000);
    const resultAfter = () =>
      userClient.queryContractSmart(contractAddress, mGOGOL_PriceMsg);
    const result2After = () =>
      userClient.queryContractSmart(contractAddress, mAAPL_PriceMsg);

    await expect(resultAfter).rejects.toThrow(/^.*No price for pair.*/);
    await expect(result2After).rejects.toThrow(/^.*No price for pair.*/);
  });

  test('feed price should works as expected - even number feeders', async () => {
    // add feeder 2
    const feeder2wallet = await createWallet();
    const feeder2Client = await getClient(feeder2wallet);
    const [feeder2Account] = await feeder2wallet.getAccounts();
    // add feeder 3
    const feeder3wallet = await createWallet();
    const [feeder3Account] = await feeder3wallet.getAccounts();
    // add feeder 4
    const feeder4wallet = await createWallet();
    const [feeder4Account] = await feeder4wallet.getAccounts();

    // send some tokens
    await userClient.sendTokens(
      userAccount.address,
      feeder2Account.address,
      customFees.upload.amount,
      DEFAULT_FEE,
    );
    const feeders = [feeder2Account, feeder3Account, feeder4Account];
    // register feeders
    for (let i = 0; i < feeders.length; i++) {
      const addFeederMsg = {
        register_feeder: {
          feeder_address: feeders[i].address,
        },
      };
      await userClient.execute(
        userAccount.address,
        contractAddress,
        addFeederMsg,
        customFees.exec,
      );
    }

    // list all feeders
    const feedersMsg = {
      feeders: {},
    };
    const list = await userClient.queryContractSmart(
      contractAddress,
      feedersMsg,
    );
    console.log(list);
    expect(list.length).toEqual(4);

    // feed price
    const feedPriceMsg = {
      feed_price: {
        base: 'OSM',
        prices: [
          ['mAAPL', '1.6'],
          ['mGOGOL', '1.3'],
        ],
      },
    };
    await feederClient.execute(
      feederAccount.address,
      contractAddress,
      feedPriceMsg,
      customFees.exec,
    );

    // get price
    const getPriceMsg = {
      price: {
        base: 'OSM',
        quote: 'mGOGOL',
      },
    };

    const price = () =>
      userClient.queryContractSmart(contractAddress, getPriceMsg);

    // no 50% vote yet
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

    await feeder2Client.execute(
      feeder2Account.address,
      contractAddress,
      feedPrice2Msg,
      customFees.exec,
    );
    const afterResult = await userClient.queryContractSmart(
      contractAddress,
      getPriceMsg,
    );

    // already has 50% vote - the price must be last added value
    expect(afterResult.price).toBe(EXPECTED_PRICE);

    // the price feed period has expired
    await sleep(PRICE_FEED_PERIOD * 1000);
    const resultAfterPeriod = () =>
      userClient.queryContractSmart(contractAddress, getPriceMsg);
    await expect(resultAfterPeriod).rejects.toThrow(/^.*No price for pair.*/);
  });
});
