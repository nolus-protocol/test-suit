import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import {
  AccountData,
  Coin,
  DirectSecp256k1Wallet,
} from '@cosmjs/proto-signing';
import { assertIsDeliverTxSuccess, isDeliverTxFailure } from '@cosmjs/stargate';
import {
  getValidatorAddress,
  createWallet,
  getClient,
  getUser1Wallet,
  getUser1Client,
} from '../util/clients';
import {
  getParamsInformation,
  getDelegatorValidatorPairAmount,
  getDelegatorValidatorsRedelegationsInformation,
  stakingModule,
} from '../util/staking';
import {
  DEFAULT_FEE,
  NATIVE_TOKEN_DENOM,
  undefinedHandler,
} from '../util/utils';

describe('Staking Nolus tokens - Redelegation', () => {
  let user1Client: SigningCosmWasmClient;
  let user1Account: AccountData;
  let delegatorClient: SigningCosmWasmClient;
  let delegatorWallet: DirectSecp256k1Wallet;
  let delegatorAccount: AccountData;
  let srcValidatorAddress: string;
  let dstValidatorAddress: string;

  const delegatedAmount = '22';
  const redelegatedAmount = (+delegatedAmount / 2).toString();
  let redelegationsCounter = 0;

  const delegateMsg = {
    typeUrl: `${stakingModule}.MsgDelegate`,
    value: {
      delegatorAddress: '',
      validatorAddress: '',
      amount: { denom: NATIVE_TOKEN_DENOM, amount: delegatedAmount },
    },
  };

  const redelegateMsg = {
    typeUrl: `${stakingModule}.MsgBeginRedelegate`,
    value: {
      delegatorAddress: '',
      validatorSrcAddress: '',
      validatorDstAddress: '',
      amount: { denom: NATIVE_TOKEN_DENOM, amount: delegatedAmount },
    },
  };

  beforeAll(async () => {
    user1Client = await getUser1Client();
    [user1Account] = await (await getUser1Wallet()).getAccounts();

    delegatorWallet = await createWallet();
    delegatorClient = await getClient(delegatorWallet);
    [delegatorAccount] = await delegatorWallet.getAccounts();
    console.log(delegatorAccount.address);

    srcValidatorAddress = getValidatorAddress();
    dstValidatorAddress = process.env.VALIDATOR_2_ADDRESS as string;

    delegateMsg.value.delegatorAddress = redelegateMsg.value.delegatorAddress =
      delegatorAccount.address;
    delegateMsg.value.validatorAddress = srcValidatorAddress;
    redelegateMsg.value.validatorSrcAddress = srcValidatorAddress;
    redelegateMsg.value.validatorDstAddress = dstValidatorAddress;

    // send some tokens
    const initTransfer: Coin = {
      denom: NATIVE_TOKEN_DENOM,
      amount: delegatedAmount + DEFAULT_FEE.amount[0].amount,
    };

    const broadcastTx = await user1Client.sendTokens(
      user1Account.address,
      delegatorAccount.address,
      [initTransfer],
      DEFAULT_FEE,
    );
    assertIsDeliverTxSuccess(broadcastTx);
  });

  afterEach(() => {
    redelegateMsg.value.delegatorAddress = delegatorAccount.address;
    redelegateMsg.value.validatorDstAddress = dstValidatorAddress;
    redelegateMsg.value.amount.amount = redelegatedAmount;
    redelegateMsg.value.amount.denom = NATIVE_TOKEN_DENOM;
  });

  test('the delegator tries to redelegate tokens from a non-existent delegate-validator pair - should produce an error', async () => {
    // try to redelegate
    const delegationResult = await delegatorClient.signAndBroadcast(
      delegatorAccount.address,
      [redelegateMsg],
      DEFAULT_FEE,
    );

    // the delegator is a new user and in this first test he has not delegated tokens yet
    expect(isDeliverTxFailure(delegationResult)).toBeTruthy();
    expect(delegationResult.rawLog).toEqual(
      'failed to execute message; message index: 0: no delegation for (address, validator) tuple',
    );
  });

  test('the successful scenario for tokens redelegation - should work as expected', async () => {
    // delegate tokens
    const delegationResult = await delegatorClient.signAndBroadcast(
      delegatorAccount.address,
      [delegateMsg],
      DEFAULT_FEE,
    );

    expect(assertIsDeliverTxSuccess(delegationResult)).toBeUndefined();

    // see the delegator staked tokens to the source validator - before redelegation
    const delegationsToSrcValBefore = await getDelegatorValidatorPairAmount(
      delegatorAccount.address,
      srcValidatorAddress,
    );

    if (!delegationsToSrcValBefore) {
      undefinedHandler();
      return;
    }

    // redelegate tokens
    const redelegationResult = await delegatorClient.signAndBroadcast(
      delegatorAccount.address,
      [redelegateMsg],
      DEFAULT_FEE,
    );

    expect(assertIsDeliverTxSuccess(redelegationResult)).toBeUndefined();
    redelegationsCounter++;

    // get redelegation list deligator-srcValidator-dstValidator
    const redelegationEntries =
      await getDelegatorValidatorsRedelegationsInformation(
        delegatorAccount.address,
        srcValidatorAddress,
        dstValidatorAddress,
      );

    if (!redelegationEntries) {
      undefinedHandler();
      return;
    }

    const completionTime =
      redelegationEntries.redelegationResponses[0]?.redelegation?.entries[0]
        ?.completionTime?.nanos;

    expect(completionTime).not.toBe('');

    // see the delegator staked tokens to the source validator - after redelegation
    const delegationsToSrcValAfter = await getDelegatorValidatorPairAmount(
      delegatorAccount.address,
      srcValidatorAddress,
    );

    if (!delegationsToSrcValAfter) {
      undefinedHandler();
      return;
    }

    expect(+delegationsToSrcValAfter).toBe(
      +delegationsToSrcValBefore - +redelegatedAmount,
    );

    // see the delegator staked tokens to the destination validator - after redelegation
    const delegationsToDstValAfter = await getDelegatorValidatorPairAmount(
      delegatorAccount.address,
      srcValidatorAddress,
    );

    if (!delegationsToDstValAfter) {
      undefinedHandler();
      return;
    }

    expect(+delegationsToDstValAfter).toBe(+redelegatedAmount);
  });

  test('the delegator tries to redelegate 0 tokens - should produce an error', async () => {
    // try to redelegate
    redelegateMsg.value.amount.amount = '0';

    const broadcastTx = () =>
      delegatorClient.signAndBroadcast(
        delegatorAccount.address,
        [redelegateMsg],
        DEFAULT_FEE,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*invalid shares amount.*/);
  });

  test('the delegator tries to redelegate tokens different than one defined by params.BondDenom - should produce an error', async () => {
    // get BondDenom from params
    const bondDenom = (await getParamsInformation()).params?.bondDenom;

    if (!bondDenom) {
      undefinedHandler();
      return;
    }

    const invalidDenom = 'upebble';

    expect(bondDenom).not.toBe(invalidDenom);

    // try to redelegate
    redelegateMsg.value.amount.denom = invalidDenom;

    const broadcastTx = await delegatorClient.signAndBroadcast(
      delegatorAccount.address,
      [redelegateMsg],
      DEFAULT_FEE,
    );

    expect(isDeliverTxFailure(broadcastTx)).toBeTruthy();
    expect(broadcastTx.rawLog).toEqual(
      `failed to execute message; message index: 0: invalid coin denomination: got ${invalidDenom}, expected ${bondDenom}: invalid request`,
    );
  });

  test('the delegator tries to redelegate more tokens than he has delegated to the validator - should produce an error', async () => {
    // see the delegator staked tokens to the source validator - before redelegation
    const delegationsToSrcValBefore = await getDelegatorValidatorPairAmount(
      delegatorAccount.address,
      srcValidatorAddress,
    );

    if (!delegationsToSrcValBefore) {
      undefinedHandler();
      return;
    }

    // try to redelegate
    redelegateMsg.value.amount.amount = delegatedAmount;

    const broadcastTx = await delegatorClient.signAndBroadcast(
      delegatorAccount.address,
      [redelegateMsg],
      DEFAULT_FEE,
    );

    // after the previous tests he has 'redelegatedAmount = delegatedAmount/2' tokens left so that:
    expect(broadcastTx.rawLog).toEqual(
      'failed to execute message; message index: 0: invalid shares amount: invalid request',
    );

    // see the delegator staked tokens to the source validator - after redelegation
    const delegationsToSrcValAfter = await getDelegatorValidatorPairAmount(
      delegatorAccount.address,
      srcValidatorAddress,
    );

    if (!delegationsToSrcValAfter) {
      undefinedHandler();
      return;
    }

    expect(+delegationsToSrcValAfter).toBe(+delegationsToSrcValBefore);
  });

  test('the delegator tries to redelegate tokens to non-existent validator - should produce an error', async () => {
    // try to redelegate
    redelegateMsg.value.validatorDstAddress = delegatorAccount.address;

    const broadcastTx = await delegatorClient.signAndBroadcast(
      delegatorAccount.address,
      [redelegateMsg],
      DEFAULT_FEE,
    );

    expect(isDeliverTxFailure(broadcastTx)).toBeTruthy();
    expect(broadcastTx.rawLog).toEqual('internal');
  });

  test('the delegator tries to redelegate tokens to the same validator - should produce an error', async () => {
    // try to redelegate
    redelegateMsg.value.validatorDstAddress = srcValidatorAddress;

    const broadcastTx = await delegatorClient.signAndBroadcast(
      delegatorAccount.address,
      [redelegateMsg],
      DEFAULT_FEE,
    );

    expect(isDeliverTxFailure(broadcastTx)).toBeTruthy();
    expect(broadcastTx.rawLog).toEqual(
      'failed to execute message; message index: 0: cannot redelegate to the same validator',
    );
  });

  test('the delegator tries to redelegate tokens more than params.MaxEntries times - should produce an error', async () => {
    // delegate some tokens
    const delegationResult = await delegatorClient.signAndBroadcast(
      delegatorAccount.address,
      [delegateMsg],
      DEFAULT_FEE,
    );
    expect(assertIsDeliverTxSuccess(delegationResult)).toBeUndefined();

    // get MaxEntries from params
    const maxEntries = (await getParamsInformation()).params?.maxEntries;

    if (!maxEntries) {
      undefinedHandler();
      return;
    }

    const loopIteration = maxEntries - redelegationsCounter;
    const loopRedelegateAmount = Math.floor(
      +delegatedAmount / (loopIteration + 1),
    );
    redelegateMsg.value.amount.amount = loopRedelegateAmount.toString();

    for (let i = 0; i < loopIteration; i++) {
      // redelegate tokens
      const redelegationResult = await delegatorClient.signAndBroadcast(
        delegatorAccount.address,
        [redelegateMsg],
        DEFAULT_FEE,
      );
      expect(assertIsDeliverTxSuccess(redelegationResult)).toBeUndefined();
    }

    const broadcastTx = await delegatorClient.signAndBroadcast(
      delegatorAccount.address,
      [redelegateMsg],
      DEFAULT_FEE,
    );

    // maxEntries has already been reached
    expect(isDeliverTxFailure(broadcastTx)).toBeTruthy();
    expect(broadcastTx.rawLog).toEqual(
      'failed to execute message; message index: 0: too many redelegation entries for (delegator, src-validator, dst-validator) tuple',
    );
  });
});
