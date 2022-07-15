import {
  assertIsDeliverTxSuccess,
  Coin,
  isDeliverTxFailure,
} from '@cosmjs/stargate';
import NODE_ENDPOINT, {
  getValidator1Address,
  createWallet,
  getUser1Wallet,
  getValidator2Address,
} from '../util/clients';
import {
  getParamsInformation,
  getDelegatorValidatorPairAmount,
  getDelegatorValidatorsRedelegationsInformation,
  stakingModule,
} from '../util/staking';
import { customFees, undefinedHandler } from '../util/utils';
import { ChainConstants } from '@nolus/nolusjs/build/constants';
import { NolusClient, NolusWallet } from '@nolus/nolusjs';

const maybe = process.env.NODE_ENV === 'local' ? describe : describe.skip;

maybe('Staking Nolus tokens - Redelegation', () => {
  const NATIVE_TOKEN_DENOM = ChainConstants.COIN_MINIMAL_DENOM;
  let user1Wallet: NolusWallet;
  let delegatorWallet: NolusWallet;
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
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    delegatorWallet = await createWallet();

    srcValidatorAddress = getValidator1Address();
    dstValidatorAddress = getValidator2Address();

    delegateMsg.value.delegatorAddress = redelegateMsg.value.delegatorAddress =
      delegatorWallet.address as string;
    delegateMsg.value.validatorAddress = srcValidatorAddress;
    redelegateMsg.value.validatorSrcAddress = srcValidatorAddress;
    redelegateMsg.value.validatorDstAddress = dstValidatorAddress;

    // send some tokens
    const initTransfer: Coin = {
      denom: NATIVE_TOKEN_DENOM,
      amount: delegatedAmount + customFees.transfer.amount[0].amount,
    };

    const broadcastTx = await user1Wallet.transferAmount(
      delegatorWallet.address as string,
      [initTransfer],
      customFees.transfer,
      '',
    );
    assertIsDeliverTxSuccess(broadcastTx);
  });

  afterEach(() => {
    redelegateMsg.value.delegatorAddress = delegatorWallet.address as string;
    redelegateMsg.value.validatorDstAddress = dstValidatorAddress;
    redelegateMsg.value.amount.amount = redelegatedAmount;
    redelegateMsg.value.amount.denom = NATIVE_TOKEN_DENOM;
  });

  test('the delegator tries to redelegate tokens from a non-existent delegate-validator pair - should produce an error', async () => {
    // try to redelegate
    const delegationResult = await delegatorWallet.signAndBroadcast(
      delegatorWallet.address as string,
      [redelegateMsg],
      customFees.configs,
    );

    // the delegator is a new user and in this first test he has not delegated tokens yet
    expect(isDeliverTxFailure(delegationResult)).toBeTruthy();
    expect(delegationResult.rawLog).toEqual(
      'failed to execute message; message index: 0: no delegation for (address, validator) tuple',
    );
  });

  test('the successful scenario for tokens redelegation - should work as expected', async () => {
    // delegate tokens
    const delegationResult = await delegatorWallet.signAndBroadcast(
      delegatorWallet.address as string,
      [delegateMsg],
      customFees.configs,
    );

    expect(assertIsDeliverTxSuccess(delegationResult)).toBeUndefined();

    // see the delegator staked tokens to the source validator - before redelegation
    const delegationsToSrcValBefore = await getDelegatorValidatorPairAmount(
      delegatorWallet.address as string,
      srcValidatorAddress,
    );

    if (!delegationsToSrcValBefore) {
      undefinedHandler();
      return;
    }

    // redelegate tokens
    const redelegationResult = await delegatorWallet.signAndBroadcast(
      delegatorWallet.address as string,
      [redelegateMsg],
      customFees.configs,
    );

    expect(assertIsDeliverTxSuccess(redelegationResult)).toBeUndefined();
    redelegationsCounter++;

    // get redelegation list deligator-srcValidator-dstValidator
    const redelegationEntries =
      await getDelegatorValidatorsRedelegationsInformation(
        delegatorWallet.address as string,
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
      delegatorWallet.address as string,
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
      delegatorWallet.address as string,
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
      delegatorWallet.signAndBroadcast(
        delegatorWallet.address as string,
        [redelegateMsg],
        customFees.configs,
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

    const broadcastTx = await delegatorWallet.signAndBroadcast(
      delegatorWallet.address as string,
      [redelegateMsg],
      customFees.configs,
    );

    expect(isDeliverTxFailure(broadcastTx)).toBeTruthy();
    expect(broadcastTx.rawLog).toEqual(
      `failed to execute message; message index: 0: invalid coin denomination: got ${invalidDenom}, expected ${bondDenom}: invalid request`,
    );
  });

  test('the delegator tries to redelegate more tokens than he has delegated to the validator - should produce an error', async () => {
    // see the delegator staked tokens to the source validator - before redelegation
    const delegationsToSrcValBefore = await getDelegatorValidatorPairAmount(
      delegatorWallet.address as string,
      srcValidatorAddress,
    );

    if (!delegationsToSrcValBefore) {
      undefinedHandler();
      return;
    }

    // try to redelegate
    redelegateMsg.value.amount.amount = delegatedAmount;

    const broadcastTx = await delegatorWallet.signAndBroadcast(
      delegatorWallet.address as string,
      [redelegateMsg],
      customFees.configs,
    );

    // after the previous tests he has 'redelegatedAmount = delegatedAmount/2' tokens left so that:
    expect(broadcastTx.rawLog).toEqual(
      'failed to execute message; message index: 0: invalid shares amount: invalid request',
    );

    // see the delegator staked tokens to the source validator - after redelegation
    const delegationsToSrcValAfter = await getDelegatorValidatorPairAmount(
      delegatorWallet.address as string,
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
    redelegateMsg.value.validatorDstAddress = delegatorWallet.address as string;

    const broadcastTx = await delegatorWallet.signAndBroadcast(
      delegatorWallet.address as string,
      [redelegateMsg],
      customFees.configs,
    );

    expect(isDeliverTxFailure(broadcastTx)).toBeTruthy();
    expect(broadcastTx.rawLog).toEqual('internal');
  });

  test('the delegator tries to redelegate tokens to the same validator - should produce an error', async () => {
    // try to redelegate
    redelegateMsg.value.validatorDstAddress = srcValidatorAddress;

    const broadcastTx = await delegatorWallet.signAndBroadcast(
      delegatorWallet.address as string,
      [redelegateMsg],
      customFees.configs,
    );

    expect(isDeliverTxFailure(broadcastTx)).toBeTruthy();
    expect(broadcastTx.rawLog).toEqual(
      'failed to execute message; message index: 0: cannot redelegate to the same validator',
    );
  });

  test('the delegator tries to redelegate tokens more than params.MaxEntries times - should produce an error', async () => {
    // delegate some tokens
    const delegationResult = await delegatorWallet.signAndBroadcast(
      delegatorWallet.address as string,
      [delegateMsg],
      customFees.configs,
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
      const redelegationResult = await delegatorWallet.signAndBroadcast(
        delegatorWallet.address as string,
        [redelegateMsg],
        customFees.configs,
      );
      expect(assertIsDeliverTxSuccess(redelegationResult)).toBeUndefined();
    }

    const broadcastTx = await delegatorWallet.signAndBroadcast(
      delegatorWallet.address as string,
      [redelegateMsg],
      customFees.configs,
    );

    // maxEntries has already been reached
    expect(isDeliverTxFailure(broadcastTx)).toBeTruthy();
    expect(broadcastTx.rawLog).toEqual(
      'failed to execute message; message index: 0: too many redelegation entries for (delegator, src-validator, dst-validator) tuple',
    );
  });
});