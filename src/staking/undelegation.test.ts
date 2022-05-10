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
  getDelegatorValidatorUnboundingInformation,
  getParamsInformation,
  getDelegatorValidatorPairAmount,
  stakingModule,
} from '../util/staking';
import {
  DEFAULT_FEE,
  NATIVE_TOKEN_DENOM,
  undefinedHandler,
} from '../util/utils';

describe('Staking Nolus tokens - Undelegation', () => {
  let user1Client: SigningCosmWasmClient;
  let user1Account: AccountData;
  let delegatorClient: SigningCosmWasmClient;
  let delegatorWallet: DirectSecp256k1Wallet;
  let delegatorAccount: AccountData;
  let validatorAddress: string;

  const delegatedAmount = '22';
  const undelegatedAmount = (+delegatedAmount / 2).toString();
  let undelegationsCounter = 0;

  const generalMsg = {
    typeUrl: '',
    value: {
      delegatorAddress: '',
      validatorAddress: '',
      amount: { denom: NATIVE_TOKEN_DENOM, amount: '' },
    },
  };

  beforeAll(async () => {
    user1Client = await getUser1Client();
    [user1Account] = await (await getUser1Wallet()).getAccounts();

    delegatorWallet = await createWallet();
    delegatorClient = await getClient(delegatorWallet);
    [delegatorAccount] = await delegatorWallet.getAccounts();

    validatorAddress = getValidatorAddress();

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
    expect(assertIsDeliverTxSuccess(broadcastTx)).toBeUndefined();

    generalMsg.value.delegatorAddress = delegatorAccount.address;
    generalMsg.value.validatorAddress = validatorAddress;
  });

  afterEach(() => {
    generalMsg.value.delegatorAddress = delegatorAccount.address;
    generalMsg.value.validatorAddress = validatorAddress;
    generalMsg.value.amount.denom = NATIVE_TOKEN_DENOM;
  });

  test('the delegator tries to undelegate tokens from a non-existent delegate-validator pair - should produce an error', async () => {
    // try to undelegate
    generalMsg.value.amount.amount = delegatedAmount;
    generalMsg.typeUrl = `${stakingModule}.MsgUndelegate`;

    const broadcastTx = await delegatorClient.signAndBroadcast(
      delegatorAccount.address,
      [generalMsg],
      DEFAULT_FEE,
    );

    // the delegator is a new user and in this first test he has not delegated tokens yet
    expect(isDeliverTxFailure(broadcastTx)).toBeTruthy();
    expect(broadcastTx.rawLog).toEqual(
      'failed to execute message; message index: 0: no delegation for (address, validator) tuple',
    );
  });

  test('the successful scenario for tokens undelegation should work as expected', async () => {
    // delegate tokens
    generalMsg.value.amount.amount = delegatedAmount;
    generalMsg.typeUrl = `${stakingModule}.MsgDelegate`;

    const delegationResult = await delegatorClient.signAndBroadcast(
      delegatorAccount.address,
      [generalMsg],
      DEFAULT_FEE,
    );
    expect(assertIsDeliverTxSuccess(delegationResult)).toBeUndefined();

    // see the delegator staked tokens to the current validator - before undelegation
    const delegatorDelegationsToValBefore =
      await getDelegatorValidatorPairAmount(
        delegatorAccount.address,
        validatorAddress,
      );

    if (!delegatorDelegationsToValBefore) {
      undefinedHandler();
      return;
    }

    // undelegate tokens
    generalMsg.typeUrl = `${stakingModule}.MsgUndelegate`;
    generalMsg.value.amount.amount = undelegatedAmount;

    const undelegationResult = await delegatorClient.signAndBroadcast(
      delegatorAccount.address,
      [generalMsg],
      DEFAULT_FEE,
    );

    expect(assertIsDeliverTxSuccess(undelegationResult)).toBeUndefined();
    undelegationsCounter++;

    // get unbounded delegation list deligator-validator
    const lastEntrie = (
      await getDelegatorValidatorUnboundingInformation(
        delegatorAccount.address,
        validatorAddress,
      )
    ).unbond?.entries.length;

    if (!lastEntrie) {
      undefinedHandler();
      return;
    }
    const completionTime = (
      await getDelegatorValidatorUnboundingInformation(
        delegatorAccount.address,
        validatorAddress,
      )
    ).unbond?.entries[lastEntrie - 1].completionTime?.nanos;

    expect(completionTime).not.toBe('');

    // see the delegator staked tokens to the current validator - after undelegation
    const delegatorDelegationsToValAfter =
      await getDelegatorValidatorPairAmount(
        delegatorAccount.address,
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
      delegatorClient.signAndBroadcast(
        delegatorAccount.address,
        [generalMsg],
        DEFAULT_FEE,
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

    const broadcastTx = await delegatorClient.signAndBroadcast(
      delegatorAccount.address,
      [generalMsg],
      DEFAULT_FEE,
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
        delegatorAccount.address,
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

    const broadcastTx = await delegatorClient.signAndBroadcast(
      delegatorAccount.address,
      [generalMsg],
      DEFAULT_FEE,
    );

    expect(broadcastTx.rawLog).toEqual(
      'failed to execute message; message index: 0: invalid shares amount: invalid request',
    );

    // see the delegator staked tokens to the current validator - after undelegation
    const delegatorDelegationsToValAfter =
      await getDelegatorValidatorPairAmount(
        delegatorAccount.address,
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
        delegatorAccount.address,
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

    const undelegationResult = await delegatorClient.signAndBroadcast(
      delegatorAccount.address,
      [generalMsg],
      DEFAULT_FEE,
    );

    expect(assertIsDeliverTxSuccess(undelegationResult)).toBeUndefined();
    undelegationsCounter++;

    // the validator-delegator pair information should not exist - after undelegation
    await expect(
      getDelegatorValidatorPairAmount(
        delegatorAccount.address,
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

    const delegationResult = await delegatorClient.signAndBroadcast(
      delegatorAccount.address,
      [generalMsg],
      DEFAULT_FEE,
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
      const undelegationResult = await delegatorClient.signAndBroadcast(
        delegatorAccount.address,
        [generalMsg],
        DEFAULT_FEE,
      );
      expect(assertIsDeliverTxSuccess(undelegationResult)).toBeUndefined();
    }
    const broadcastTx = await delegatorClient.signAndBroadcast(
      delegatorAccount.address,
      [generalMsg],
      DEFAULT_FEE,
    );

    // maxEntries has already been reached
    expect(isDeliverTxFailure(broadcastTx)).toBeTruthy();
    expect(broadcastTx.rawLog).toEqual(
      'failed to execute message; message index: 0: too many unbonding delegation entries for (delegator, validator) tuple',
    );
  });
});
