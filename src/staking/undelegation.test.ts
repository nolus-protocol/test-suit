import {
  assertIsDeliverTxSuccess,
  Coin,
  isDeliverTxFailure,
} from '@cosmjs/stargate';
import NODE_ENDPOINT, {
  getValidator1Address,
  createWallet,
  getUser1Wallet,
} from '../util/clients';
import {
  getDelegatorValidatorUnboundingInformation,
  getParamsInformation,
  getDelegatorValidatorPairAmount,
  stakingModule,
} from '../util/staking';
import {
  customFees,
  NATIVE_MINIMAL_DENOM,
  undefinedHandler,
} from '../util/utils';
import { NolusClient, NolusWallet } from '@nolus/nolusjs';

describe('Staking Nolus tokens - Undelegation', () => {
  let user1Wallet: NolusWallet;
  let delegatorWallet: NolusWallet;
  let validatorAddress: string;

  const delegatedAmount = '22';
  const undelegatedAmount = (+delegatedAmount / 2).toString();
  let undelegationsCounter = 0;

  const generalMsg = {
    typeUrl: '',
    value: {
      delegatorAddress: '',
      validatorAddress: '',
      amount: { denom: NATIVE_MINIMAL_DENOM, amount: '' },
    },
  };

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    delegatorWallet = await createWallet();

    validatorAddress = getValidator1Address();

    // send some tokens
    const initTransfer: Coin = {
      denom: NATIVE_MINIMAL_DENOM,
      amount: delegatedAmount + customFees.transfer.amount[0].amount,
    };

    const broadcastTx = await user1Wallet.transferAmount(
      delegatorWallet.address as string,
      [initTransfer],
      customFees.transfer,
      '',
    );
    expect(assertIsDeliverTxSuccess(broadcastTx)).toBeUndefined();

    generalMsg.value.delegatorAddress = delegatorWallet.address as string;
    generalMsg.value.validatorAddress = validatorAddress;
  });

  afterEach(() => {
    generalMsg.value.delegatorAddress = delegatorWallet.address as string;
    generalMsg.value.validatorAddress = validatorAddress;
    generalMsg.value.amount.denom = NATIVE_MINIMAL_DENOM;
  });

  test('the delegator tries to undelegate tokens from a non-existent delegate-validator pair - should produce an error', async () => {
    // try to undelegate
    generalMsg.value.amount.amount = delegatedAmount;
    generalMsg.typeUrl = `${stakingModule}.MsgUndelegate`;

    const broadcastTx = await delegatorWallet.signAndBroadcast(
      delegatorWallet.address as string,
      [generalMsg],
      customFees.configs,
    );

    // the delegator is a new user and in this first test he has not delegated tokens yet
    expect(isDeliverTxFailure(broadcastTx)).toBeTruthy();
    expect(broadcastTx.rawLog).toEqual(
      'failed to execute message; message index: 0: no delegation for (address, validator) tuple',
    );
  });

  test('the successful scenario for tokens undelegation - should work as expected', async () => {
    // delegate tokens
    generalMsg.value.amount.amount = delegatedAmount;
    generalMsg.typeUrl = `${stakingModule}.MsgDelegate`;

    const delegationResult = await delegatorWallet.signAndBroadcast(
      delegatorWallet.address as string,
      [generalMsg],
      customFees.configs,
    );
    expect(assertIsDeliverTxSuccess(delegationResult)).toBeUndefined();

    // see the delegator staked tokens to the current validator - before undelegation
    const delegatorDelegationsToValBefore =
      await getDelegatorValidatorPairAmount(
        delegatorWallet.address as string,
        validatorAddress,
      );

    if (!delegatorDelegationsToValBefore) {
      undefinedHandler();
      return;
    }

    // undelegate tokens
    generalMsg.typeUrl = `${stakingModule}.MsgUndelegate`;
    generalMsg.value.amount.amount = undelegatedAmount;

    const undelegationResult = await delegatorWallet.signAndBroadcast(
      delegatorWallet.address as string,
      [generalMsg],
      customFees.configs,
    );

    expect(assertIsDeliverTxSuccess(undelegationResult)).toBeUndefined();
    undelegationsCounter++;

    // get unbounded delegation list deligator-validator
    const lastEntrie = (
      await getDelegatorValidatorUnboundingInformation(
        delegatorWallet.address as string,
        validatorAddress,
      )
    ).unbond?.entries.length;

    if (!lastEntrie) {
      undefinedHandler();
      return;
    }
    const completionTime = (
      await getDelegatorValidatorUnboundingInformation(
        delegatorWallet.address as string,
        validatorAddress,
      )
    ).unbond?.entries[lastEntrie - 1].completionTime?.nanos;

    expect(completionTime).not.toBe('');

    // see the delegator staked tokens to the current validator - after undelegation
    const delegatorDelegationsToValAfter =
      await getDelegatorValidatorPairAmount(
        delegatorWallet.address as string,
        validatorAddress,
      );

    if (!delegatorDelegationsToValAfter) {
      undefinedHandler();
      return;
    }

    expect(+delegatorDelegationsToValAfter).toBe(
      +delegatorDelegationsToValBefore - +undelegatedAmount,
    );
  });

  test('the delegator tries to undelegate 0 tokens - should produce an error', async () => {
    // try to undelegate
    generalMsg.typeUrl = `${stakingModule}.MsgUndelegate`;
    generalMsg.value.amount.amount = '0';

    const broadcastTx = () =>
      delegatorWallet.signAndBroadcast(
        delegatorWallet.address as string,
        [generalMsg],
        customFees.configs,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*invalid shares amount.*/);
  });

  test('the delegator tries to undelegate tokens different than one defined by params.BondDenom - should produce an error', async () => {
    // get BondDenom from params
    const bondDenom = (await getParamsInformation()).params?.bondDenom;

    if (!bondDenom) {
      undefinedHandler();
      return;
    }

    const invalidDenom = 'upebble';

    expect(bondDenom).not.toBe(invalidDenom);

    // undelegate tokens
    generalMsg.typeUrl = `${stakingModule}.MsgUndelegate`;
    generalMsg.value.amount.amount = undelegatedAmount;
    generalMsg.value.amount.denom = invalidDenom;

    const broadcastTx = await delegatorWallet.signAndBroadcast(
      delegatorWallet.address as string,
      [generalMsg],
      customFees.configs,
    );

    expect(isDeliverTxFailure(broadcastTx)).toBeTruthy();
    expect(broadcastTx.rawLog).toEqual(
      `failed to execute message; message index: 0: invalid coin denomination: got ${invalidDenom}, expected ${bondDenom}: invalid request`,
    );
  });

  test('the delegator tries to undelegate more tokens than he has delegated to the validator - should produce an error', async () => {
    // see the delegator staked tokens to the current validator - before undelegation
    const delegatorDelegationsToValBefore =
      await getDelegatorValidatorPairAmount(
        delegatorWallet.address as string,
        validatorAddress,
      );

    if (!delegatorDelegationsToValBefore) {
      undefinedHandler();
      return;
    }

    // undelegate tokens
    generalMsg.typeUrl = `${stakingModule}.MsgUndelegate`;
    // after the previous tests he has 'delegatedAmount/2' tokens left
    generalMsg.value.amount.amount = delegatedAmount;

    const broadcastTx = await delegatorWallet.signAndBroadcast(
      delegatorWallet.address as string,
      [generalMsg],
      customFees.configs,
    );

    expect(broadcastTx.rawLog).toEqual(
      'failed to execute message; message index: 0: invalid shares amount: invalid request',
    );

    // see the delegator staked tokens to the current validator - after undelegation
    const delegatorDelegationsToValAfter =
      await getDelegatorValidatorPairAmount(
        delegatorWallet.address as string,
        validatorAddress,
      );

    if (!delegatorDelegationsToValAfter) {
      undefinedHandler();
      return;
    }

    expect(+delegatorDelegationsToValAfter).toBe(
      +delegatorDelegationsToValBefore,
    );
  });

  test('the delegator should be able to undelagate all his delegated tokens - should be removed from the current validator pairs', async () => {
    // see the delegator staked tokens to the current validator - before undelegation
    const delegatorDelegationsToValBefore =
      await getDelegatorValidatorPairAmount(
        delegatorWallet.address as string,
        validatorAddress,
      );

    if (!delegatorDelegationsToValBefore) {
      undefinedHandler();
      return;
    }

    // undelegate tokens
    generalMsg.typeUrl = `${stakingModule}.MsgUndelegate`;
    // after the previous tests he has 'undelegatedAmount = delegatedAmount/2' tokens left
    generalMsg.value.amount.amount = undelegatedAmount;

    const undelegationResult = await delegatorWallet.signAndBroadcast(
      delegatorWallet.address as string,
      [generalMsg],
      customFees.configs,
    );

    expect(assertIsDeliverTxSuccess(undelegationResult)).toBeUndefined();
    undelegationsCounter++;

    // the validator-delegator pair information should not exist - after undelegation
    await expect(
      getDelegatorValidatorPairAmount(
        delegatorWallet.address as string,
        validatorAddress,
      ),
    ).rejects.toThrow(
      /^.*delegation with delegator.* not found for validator.*/,
    );
  });

  test('the delegator tries to undelegate tokens more than params.MaxEntries times - should produce an error', async () => {
    // delegate some tokens
    generalMsg.value.amount.amount = delegatedAmount;
    generalMsg.typeUrl = `${stakingModule}.MsgDelegate`;

    const delegationResult = await delegatorWallet.signAndBroadcast(
      delegatorWallet.address as string,
      [generalMsg],
      customFees.configs,
    );
    expect(assertIsDeliverTxSuccess(delegationResult)).toBeUndefined();

    // get MaxEntries from params
    const maxEntries = (await getParamsInformation()).params?.maxEntries;

    if (!maxEntries) {
      undefinedHandler();
      return;
    }
    generalMsg.typeUrl = `${stakingModule}.MsgUndelegate`;
    const loopIteration = maxEntries - undelegationsCounter;
    const loopUndelegateAmount = Math.floor(
      +delegatedAmount / (loopIteration + 1),
    );
    generalMsg.value.amount.amount = loopUndelegateAmount.toString();

    for (let i = 0; i < loopIteration; i++) {
      // undelegate tokens
      const undelegationResult = await delegatorWallet.signAndBroadcast(
        delegatorWallet.address as string,
        [generalMsg],
        customFees.configs,
      );
      expect(assertIsDeliverTxSuccess(undelegationResult)).toBeUndefined();
    }
    const broadcastTx = await delegatorWallet.signAndBroadcast(
      delegatorWallet.address as string,
      [generalMsg],
      customFees.configs,
    );

    // maxEntries has already been reached
    expect(isDeliverTxFailure(broadcastTx)).toBeTruthy();
    expect(broadcastTx.rawLog).toEqual(
      'failed to execute message; message index: 0: too many unbonding delegation entries for (delegator, validator) tuple',
    );
  });
});
