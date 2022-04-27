import {
  createWallet,
  getClient,
  getUser1Client,
  getUser1Wallet,
} from '../util/clients';
import { AccountData, EncodeObject } from '@cosmjs/proto-signing';
import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import {
  MsgCreateVestingAccount,
  protobufPackage as vestingPackage,
} from '../util/codec/cosmos/vesting/v1beta1/tx';
import Long from 'long';
import { assertIsDeliverTxSuccess, isDeliverTxFailure } from '@cosmjs/stargate';
import { DEFAULT_FEE, sleep } from '../util/utils';
import { Coin } from '../util/codec/cosmos/base/v1beta1/coin';

describe('Continuous vesting tests', () => {
  const FULL_AMOUNT: Coin = { denom: 'unolus', amount: '10000' };
  const HALF_AMOUNT: Coin = { denom: 'unolus', amount: '5000' };
  const INIT: Coin = { denom: 'unolus', amount: '200' };
  const ENDTIME_SECONDS = 30;
  let user1Client: SigningCosmWasmClient;
  let user1Account: AccountData;
  let continuousClient: SigningCosmWasmClient;
  let continuousAccount: AccountData;

  beforeAll(async () => {
    user1Client = await getUser1Client();
    [user1Account] = await (await getUser1Wallet()).getAccounts();
    const contWallet = await createWallet();
    continuousClient = await getClient(contWallet);
    [continuousAccount] = await contWallet.getAccounts();
  });

  test('created continuous vesting account should works as expected', async () => {
    const createVestingAccountMsg: MsgCreateVestingAccount = {
      fromAddress: user1Account.address,
      toAddress: continuousAccount.address,
      amount: [FULL_AMOUNT],
      endTime: Long.fromNumber(new Date().getTime() / 1000 + ENDTIME_SECONDS),
      delayed: false,
    };
    const encodedMsg: EncodeObject = {
      typeUrl: `/${vestingPackage}.MsgCreateVestingAccount`,
      value: createVestingAccountMsg,
    };

    const result = await user1Client.signAndBroadcast(
      user1Account.address,
      [encodedMsg],
      DEFAULT_FEE,
    );
    assertIsDeliverTxSuccess(result);

    await user1Client.sendTokens(
      user1Account.address,
      continuousAccount.address,
      [INIT],
      DEFAULT_FEE,
    );

    const sendFailTx = await continuousClient.sendTokens(
      continuousAccount.address,
      user1Account.address,
      [HALF_AMOUNT],
      DEFAULT_FEE,
    );
    console.log(sendFailTx);
    expect(isDeliverTxFailure(sendFailTx)).toBeTruthy();
    expect(sendFailTx.rawLog).toMatch(
      /^.*smaller than 5000unolus: insufficient funds.*/,
    );
    await sleep((ENDTIME_SECONDS / 2) * 1000);
    assertIsDeliverTxSuccess(
      await continuousClient.sendTokens(
        continuousAccount.address,
        user1Account.address,
        [HALF_AMOUNT],
        DEFAULT_FEE,
      ),
    );
  });
});
