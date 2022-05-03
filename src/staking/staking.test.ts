import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { AccountData, DirectSecp256k1Wallet } from '@cosmjs/proto-signing';
import { assertIsDeliverTxSuccess } from '@cosmjs/stargate';
import {
  getUser1Client,
  getUser1Wallet,
  getValidatorAddress,
  getValidatorInformation,
} from '../util/clients';
import {
  DEFAULT_FEE,
  NATIVE_TOKEN_DENOM,
  undefinedHandler,
} from '../util/utils';

describe('Staking Nolus tokens', () => {
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
  });

  // test('validator information should be provided', () => {
  // });

  // TO DO: "As a stakeholder, I want to see my staked token amounts"
  test('the successful scenario for tokens delegation to the validator should work as expected', async () => {
    //get validator delegated amount before tx
    const validatorAmountBefore = (
      await getValidatorInformation(validatorAddress)
    ).validator?.tokens;

    if (!validatorAmountBefore) {
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

    //get validator delegated amount after tx
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

  //test('the successful scenario for staked tokens undelegation should work as expected', () => {
  // });

  //test('TO DO: undelegation - cases', () => {
  // });

  //test('the successful scenario for withdraw staking rewards should work as expected', () => {
  // });

  //test('TO DO: withdraw staking rewards - cases', () => {
  // });
});
