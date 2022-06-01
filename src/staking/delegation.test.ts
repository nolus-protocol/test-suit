import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import {
  AccountData,
  Coin,
  DirectSecp256k1Wallet,
} from '@cosmjs/proto-signing';
import { assertIsDeliverTxSuccess, isDeliverTxFailure } from '@cosmjs/stargate';
import {
  BondStatus,
  bondStatusFromJSON,
} from 'cosmjs-types/cosmos/staking/v1beta1/staking';
import {
  getValidatorAddress,
  getUser2Wallet,
  createWallet,
  getClient,
  getUser1Client,
  getUser1Wallet,
} from '../util/clients';
import {
  getValidatorInformation,
  getDelegatorInformation,
  getDelegatorValidatorPairAmount,
  getParamsInformation,
  stakingModule,
} from '../util/staking';
import { DEFAULT_FEE, undefinedHandler } from '../util/utils';
import { ChainConstants } from '@nolus/nolusjs/build/constants';

describe('Staking Nolus tokens - Delegation', () => {
  let user1Client: SigningCosmWasmClient;
  let user1Account: AccountData;
  let stakeholderClient: SigningCosmWasmClient;
  let stakeholderWallet: DirectSecp256k1Wallet;
  let stakeholderAccount: AccountData;
  let validatorAddress: string;
  let NATIVE_TOKEN_DENOM: string;

  const delegatedAmount = '13';

  const delegateMsg = {
    typeUrl: `${stakingModule}.MsgDelegate`,
    value: {
      delegatorAddress: '',
      validatorAddress: '',
      amount: { denom: NATIVE_TOKEN_DENOM, amount: '' },
    },
  };

  beforeAll(async () => {
    NATIVE_TOKEN_DENOM = ChainConstants.COIN_MINIMAL_DENOM;
    user1Client = await getUser1Client();
    [user1Account] = await (await getUser1Wallet()).getAccounts();

    stakeholderWallet = await createWallet();
    stakeholderClient = await getClient(stakeholderWallet);
    [stakeholderAccount] = await stakeholderWallet.getAccounts();
    console.log(stakeholderAccount.address);

    validatorAddress = getValidatorAddress();

    delegateMsg.value.delegatorAddress = stakeholderAccount.address;
    delegateMsg.value.validatorAddress = validatorAddress;

    // send some tokens
    const initTransfer: Coin = {
      denom: NATIVE_TOKEN_DENOM,
      amount: delegatedAmount + DEFAULT_FEE.amount[0].amount,
    };

    const broadcastTx = await user1Client.sendTokens(
      user1Account.address,
      stakeholderAccount.address,
      [initTransfer],
      DEFAULT_FEE,
    );
    expect(assertIsDeliverTxSuccess(broadcastTx)).toBeUndefined();
  });

  afterEach(() => {
    delegateMsg.value.delegatorAddress = stakeholderAccount.address;
    delegateMsg.value.validatorAddress = validatorAddress;
    delegateMsg.value.amount.denom = NATIVE_TOKEN_DENOM;
  });

  test('the validator should exist and should be bonded', async () => {
    const expectedStatus: BondStatus = bondStatusFromJSON('BOND_STATUS_BONDED');
    const validatorStatus = (await getValidatorInformation(validatorAddress))
      .validator?.status;

    expect(validatorStatus).toBe(expectedStatus);
  });

  test('the mandatory validator information should be provided', async () => {
    const validatorInformation = (
      await getValidatorInformation(validatorAddress)
    ).validator;

    if (!validatorInformation) {
      undefinedHandler();
      return;
    }

    // At least, all mandatory validator information, which is used to help stakeholders choose a validator,
    // should be provided
    expect(validatorInformation.minSelfDelegation).not.toBe('');
    expect(validatorInformation.commission?.commissionRates?.rate).not.toBe('');
    expect(validatorInformation.commission?.commissionRates?.maxRate).not.toBe(
      '',
    );
    expect(
      validatorInformation.commission?.commissionRates?.maxChangeRate,
    ).not.toBe('');
    expect(validatorInformation.description?.moniker).not.toBe('');
    expect(validatorInformation.tokens).not.toBe('');
  });

  test('the successful scenario for tokens delegation to the validator - should work as expected', async () => {
    // get the amount of tokens delegated to the validator - before delegation
    const validatorDelegatedTokensBefore = (
      await getValidatorInformation(validatorAddress)
    ).validator?.tokens;

    if (!validatorDelegatedTokensBefore) {
      undefinedHandler();
      return;
    }

    // delegate tokens
    delegateMsg.value.amount.amount = delegatedAmount;

    const result = await stakeholderClient.signAndBroadcast(
      stakeholderAccount.address,
      [delegateMsg],
      DEFAULT_FEE,
    );
    expect(assertIsDeliverTxSuccess(result)).toBeUndefined();

    // see the stakeholder staked tokens to the current validator - after delegation
    const stakeholderDelegationsToValAfter =
      await getDelegatorValidatorPairAmount(
        stakeholderAccount.address,
        validatorAddress,
      );

    if (!stakeholderDelegationsToValAfter) {
      undefinedHandler();
      return;
    }

    expect(stakeholderDelegationsToValAfter).toBe(delegatedAmount);

    // see the stakeholder staked tokens
    const stakeholderDelegatedTokens = (
      await getDelegatorInformation(stakeholderAccount.address)
    ).delegationResponses[0]?.balance?.amount;

    if (!stakeholderDelegatedTokens) {
      undefinedHandler();
      return;
    }

    expect(+stakeholderDelegatedTokens).not.toBe(0);

    // get the amount of tokens delegated to the validator - after delegation
    const validatorDelegatedTokensAfter = (
      await getValidatorInformation(validatorAddress)
    ).validator?.tokens;

    if (!validatorDelegatedTokensAfter) {
      undefinedHandler();
      return;
    }
    expect(+validatorDelegatedTokensAfter).toBe(
      +validatorDelegatedTokensBefore + +delegatedAmount,
    );
  });

  test('the stakeholder tries to delegate 0 tokens - should produce an error', async () => {
    // see the stakeholder staked tokens to the current validator - before delegation
    const stakeholderDelegationsToValBefore =
      await getDelegatorValidatorPairAmount(
        stakeholderAccount.address,
        validatorAddress,
      );

    if (!stakeholderDelegationsToValBefore) {
      undefinedHandler();
      return;
    }

    // try to delegate 0 tokens
    delegateMsg.value.amount.amount = '0';

    const broadcastTx = () =>
      stakeholderClient.signAndBroadcast(
        stakeholderAccount.address,
        [delegateMsg],
        DEFAULT_FEE,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*invalid delegation amount.*/);

    // see the stakeholder staked tokens to the current validator - after delegation
    const stakeholderDelegationsToValAfter =
      await getDelegatorValidatorPairAmount(
        stakeholderAccount.address,
        validatorAddress,
      );

    if (!stakeholderDelegationsToValAfter) {
      undefinedHandler();
      return;
    }

    expect(+stakeholderDelegationsToValAfter).toBe(
      +stakeholderDelegationsToValBefore,
    );
  });

  test('the stakeholder tries to delegate tokens to non-existent validator - should produce an error', async () => {
    const invalidValidatoWallet = await getUser2Wallet();
    const [invalidValidatoAccount] = await invalidValidatoWallet.getAccounts();

    // see the stakeholder staked tokens to the current validator
    await expect(
      getDelegatorValidatorPairAmount(
        stakeholderAccount.address,
        invalidValidatoAccount.address,
      ),
    ).rejects.toThrow(/^.*expected nolusvaloper, got nolus.*/);

    // try to delegate tokens
    delegateMsg.value.amount.amount = delegatedAmount;
    delegateMsg.value.validatorAddress = invalidValidatoAccount.address;

    const broadcastTx = await stakeholderClient.signAndBroadcast(
      stakeholderAccount.address,
      [delegateMsg],
      DEFAULT_FEE,
    );

    expect(isDeliverTxFailure(broadcastTx)).toBeTruthy();
    expect(broadcastTx.rawLog).toEqual('internal');
  });

  test('the stakeholder tries to delegate tokens different than one defined by params.BondDenom - should produce an error', async () => {
    // get BondDenom from params
    const bondDenom = (await getParamsInformation()).params?.bondDenom;

    if (!bondDenom) {
      undefinedHandler();
      return;
    }

    const invalidDenom = 'upebble';

    expect(bondDenom).not.toBe(invalidDenom);

    // try to delegate tokens
    delegateMsg.value.amount.denom = invalidDenom;
    delegateMsg.value.amount.amount = delegatedAmount;

    const broadcastTx = await stakeholderClient.signAndBroadcast(
      stakeholderAccount.address,
      [delegateMsg],
      DEFAULT_FEE,
    );

    expect(isDeliverTxFailure(broadcastTx)).toBeTruthy();
    expect(broadcastTx.rawLog).toEqual(
      `failed to execute message; message index: 0: invalid coin denomination: got ${invalidDenom}, expected ${bondDenom}: invalid request`,
    );
  });
});
