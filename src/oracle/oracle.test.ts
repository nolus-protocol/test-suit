import * as fs from 'fs';
import {
  InstantiateResult,
  SigningCosmWasmClient,
} from '@cosmjs/cosmwasm-stargate';
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

  const PRICE_FEED_PERIOD = 10;

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

    const codeId: any = process.env.ORACLE_CODE_ID;

    // instantiate the contract
    const instatiateMsg = {
      base_asset: 'ust',
      price_feed_period: PRICE_FEED_PERIOD,
      feeders_percentage_needed: 50,
    };
    const contract: InstantiateResult = await userClient.instantiate(
      userAccount.address,
      codeId,
      instatiateMsg,
      'test',
      customFees.init,
    );
    contractAddress = contract.contractAddress;

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
    // feed price
    const feedPriceMsg = {
      feed_price: {
        base: 'OSM',
        prices: [
          ['mAAPL', '1.2'],
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

    expect(result.price).toBe('1.3');
    expect(result2.price).toBe('1.2');
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

    const feedPrice2Msg = {
      feed_price: {
        base: 'OSM',
        prices: [
          ['mAAPL', '3.4'],
          ['mGOGOL', '3.3'],
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
    expect(afterResult.price).toBe('3.3');

    // the price feed period has expired
    await sleep(PRICE_FEED_PERIOD * 1000);
    const resultAfterPeriod = () =>
      userClient.queryContractSmart(contractAddress, getPriceMsg);
    await expect(resultAfterPeriod).rejects.toThrow(/^.*No price for pair.*/);
  });
});
