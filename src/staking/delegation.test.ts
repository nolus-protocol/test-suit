import { Coin } from '@cosmjs/proto-signing';
import { assertIsDeliverTxSuccess, isDeliverTxFailure } from '@cosmjs/stargate';
import {
  BondStatus,
  bondStatusFromJSON,
} from 'cosmjs-types/cosmos/staking/v1beta1/staking';
import NODE_ENDPOINT, {
  getValidator1Address,
  getUser2Wallet,
  createWallet,
  getUser1Wallet,
} from '../util/clients';
import {
  getValidatorInformation,
  getDelegatorInformation,
  getDelegatorValidatorPairAmount,
  getParamsInformation,
  stakingModule,
} from '../util/staking';
import { customFees, gasPrice, undefinedHandler } from '../util/utils';
import { ChainConstants, NolusClient, NolusWallet } from '@nolus/nolusjs';

describe('Staking Nolus tokens - Delegation', () => {
  const NATIVE_TOKEN_DENOM = ChainConstants.COIN_MINIMAL_DENOM;
  const treasuryAddress = process.env.TREASURY_ADDRESS as string;
  let user1Wallet: NolusWallet;
  let stakeholderWallet: NolusWallet;
  let validatorAddress: string;

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
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    stakeholderWallet = await createWallet();

    validatorAddress = getValidator1Address();

    delegateMsg.value.delegatorAddress = stakeholderWallet.address as string;
    delegateMsg.value.validatorAddress = validatorAddress;

    // send some tokens
    const initTransfer: Coin = {
      denom: NATIVE_TOKEN_DENOM,
      amount: delegatedAmount + customFees.transfer.amount[0].amount,
    };

    const broadcastTx = await user1Wallet.transferAmount(
      stakeholderWallet.address as string,
      [initTransfer],
      customFees.transfer,
      '',
    );
    expect(assertIsDeliverTxSuccess(broadcastTx)).toBeUndefined();
  });

  afterEach(() => {
    delegateMsg.value.delegatorAddress = stakeholderWallet.address as string;
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

    const treasuryBalanceBefore = await user1Wallet.getBalance(
      treasuryAddress,
      NATIVE_TOKEN_DENOM,
    );

    // delegate tokens
    delegateMsg.value.amount.amount = delegatedAmount;

    const result = await stakeholderWallet.signAndBroadcast(
      stakeholderWallet.address as string,
      [delegateMsg],
      customFees.configs,
    );
    expect(assertIsDeliverTxSuccess(result)).toBeUndefined();

    const treasuryBalanceAfter = await user1Wallet.getBalance(
      treasuryAddress,
      NATIVE_TOKEN_DENOM,
    );

    expect(+treasuryBalanceAfter.amount).toBe(
      +treasuryBalanceBefore.amount +
        +customFees.configs.amount[0].amount -
        Math.floor(+customFees.configs.gas * gasPrice),
    );

    // see the stakeholder staked tokens to the current validator - after delegation
    const stakeholderDelegationsToValAfter =
      await getDelegatorValidatorPairAmount(
        stakeholderWallet.address as string,
        validatorAddress,
      );

    if (!stakeholderDelegationsToValAfter) {
      undefinedHandler();
      return;
    }

    expect(stakeholderDelegationsToValAfter).toBe(delegatedAmount);

    // see the stakeholder staked tokens
    const stakeholderDelegatedTokens = (
      await getDelegatorInformation(stakeholderWallet.address as string)
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
        stakeholderWallet.address as string,
        validatorAddress,
      );

    if (!stakeholderDelegationsToValBefore) {
      undefinedHandler();
      return;
    }

    // try to delegate 0 tokens
    delegateMsg.value.amount.amount = '0';

    const broadcastTx = () =>
      stakeholderWallet.signAndBroadcast(
        stakeholderWallet.address as string,
        [delegateMsg],
        customFees.configs,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*invalid delegation amount.*/);

    // see the stakeholder staked tokens to the current validator - after delegation
    const stakeholderDelegationsToValAfter =
      await getDelegatorValidatorPairAmount(
        stakeholderWallet.address as string,
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

    // see the stakeholder staked tokens to the current validator
    await expect(
      getDelegatorValidatorPairAmount(
        stakeholderWallet.address as string,
        invalidValidatoWallet.address as string,
      ),
    ).rejects.toThrow(/^.*expected nolusvaloper, got nolus.*/);

    // try to delegate tokens
    delegateMsg.value.amount.amount = delegatedAmount;
    delegateMsg.value.validatorAddress =
      invalidValidatoWallet.address as string;

    const broadcastTx = await stakeholderWallet.signAndBroadcast(
      stakeholderWallet.address as string,
      [delegateMsg],
      customFees.configs,
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

    const broadcastTx = await stakeholderWallet.signAndBroadcast(
      stakeholderWallet.address as string,
      [delegateMsg],
      customFees.configs,
    );

    expect(isDeliverTxFailure(broadcastTx)).toBeTruthy();
    expect(broadcastTx.rawLog).toEqual(
      `failed to execute message; message index: 0: invalid coin denomination: got ${invalidDenom}, expected ${bondDenom}: invalid request`,
    );
  });
});
