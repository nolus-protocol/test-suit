import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { AccountData, DirectSecp256k1Wallet } from '@cosmjs/proto-signing';
import { assertIsDeliverTxSuccess } from '@cosmjs/stargate';
import {
  BondStatus,
  bondStatusFromJSON,
} from 'cosmjs-types/cosmos/staking/v1beta1/staking';
import {
  getUser1Client,
  getUser1Wallet,
  getValidatorAddress,
} from '../util/clients';
import {
  getValidatorInformation,
  getDelegatorInformation,
  getDelegatorValidatorPairInformation,
} from '../util/staking';
import {
  DEFAULT_FEE,
  NATIVE_TOKEN_DENOM,
  undefinedHandler,
} from '../util/utils';

describe('Staking Nolus tokens - Delegation', () => {
  let stakeholderClient: SigningCosmWasmClient;
  let stakeholderWallet: DirectSecp256k1Wallet;
  let stakeholderAccount: AccountData;
  let validatorAddress: string;
  const delegatedAmount = '120';

  beforeAll(async () => {
    stakeholderClient = await getUser1Client();
    stakeholderWallet = await getUser1Wallet();
    [stakeholderAccount] = await stakeholderWallet.getAccounts();
    validatorAddress = getValidatorAddress();
    console.log(stakeholderAccount.address);
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

  test('the successful scenario for tokens delegation to the validator should work as expected', async () => {
    // get the amount of tokens delegated to the validator - before delegation
    const validatorAmountBefore = (
      await getValidatorInformation(validatorAddress)
    ).validator?.tokens;

    if (!validatorAmountBefore) {
      undefinedHandler();
      return;
    }

    // see the stakeholder staked tokens to the current validator - before delegation
    const stakeholderDelegationsToValBefore = (
      await getDelegatorValidatorPairInformation(
        stakeholderAccount.address,
        validatorAddress,
      )
    ).delegationResponse?.balance?.amount;

    if (!stakeholderDelegationsToValBefore) {
      undefinedHandler();
      return;
    }

    // delegate tokens
    const delegateMsg = {
      typeUrl: '/cosmos.staking.v1beta1.MsgDelegate',
      value: {
        delegatorAddress: stakeholderAccount.address,
        validatorAddress: validatorAddress,
        amount: { denom: NATIVE_TOKEN_DENOM, amount: delegatedAmount },
      },
    };

    const result = await stakeholderClient.signAndBroadcast(
      stakeholderAccount.address,
      [delegateMsg],
      DEFAULT_FEE,
    );
    assertIsDeliverTxSuccess(result);

    // see the stakeholder staked tokens to the current validator - after delegation
    const stakeholderDelegationsToValAfter = (
      await getDelegatorValidatorPairInformation(
        stakeholderAccount.address,
        validatorAddress,
      )
    ).delegationResponse?.balance?.amount;

    if (!stakeholderDelegationsToValAfter) {
      undefinedHandler();
      return;
    }

    expect(+stakeholderDelegationsToValAfter).toBe(
      +stakeholderDelegationsToValBefore + +delegatedAmount,
    );

    // see the stakeholder staked tokens
    const stakeholderDelegations = (
      await getDelegatorInformation(stakeholderAccount.address)
    ).delegationResponses[0]?.balance?.amount;

    if (!stakeholderDelegations) {
      undefinedHandler();
      return;
    }

    expect(+stakeholderDelegations).not.toBe(0);

    // get the amount of tokens delegated to the validator - after delegation
    const validatorAmountAfter = (
      await getValidatorInformation(validatorAddress)
    ).validator?.tokens;

    if (!validatorAmountAfter) {
      undefinedHandler();
      return;
    }
    expect(+validatorAmountAfter).toBe(
      +validatorAmountBefore + +delegatedAmount,
    );
  });

  // test('stakeholder tries to delegate less than the minimum allowed delegation - should produce an error', () => {
  // });

  // test('stakeholder tries to delegate 0 tokens - should produce an error', () => {
  // });

  // test('stakeholder tries to delegate tokens to non-existent validator - should produce an error', () => {
  // });

  // test('stakeholder tries to delegate tokens different than one defined by params.BondDenom - should produce an error', () => {
  // });

  // test('stakeholder tries to delegate the entire amount tokens he owns - should produce an error', () => {
  // });
});
