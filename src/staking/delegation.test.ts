import { Coin } from '@cosmjs/proto-signing';
import { assertIsDeliverTxSuccess, isDeliverTxFailure } from '@cosmjs/stargate';
import { NolusClient, NolusWallet } from '@nolus/nolusjs';
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
import {
  customFees,
  NATIVE_MINIMAL_DENOM,
  undefinedHandler,
} from '../util/utils';
import { ifLocal, runOrSkip } from '../util/testingRules';
import { calcFeeProfit } from '../util/transfer';

runOrSkip(process.env.TEST_STAKING as string)(
  'Staking Nolus tokens - Delegation',
  () => {
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
        amount: { denom: NATIVE_MINIMAL_DENOM, amount: '' },
      },
    };

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      user1Wallet = await getUser1Wallet();
      stakeholderWallet = await createWallet();
      validatorAddress = getValidator1Address();

      delegateMsg.value.delegatorAddress = stakeholderWallet.address as string;
      delegateMsg.value.validatorAddress = validatorAddress;

      const initTransfer: Coin = {
        denom: NATIVE_MINIMAL_DENOM,
        amount: delegatedAmount + customFees.transfer.amount[0].amount,
      };

      const broadcastTx = await user1Wallet.transferAmount(
        stakeholderWallet.address as string,
        [initTransfer],
        customFees.transfer,
      );
      expect(assertIsDeliverTxSuccess(broadcastTx)).toBeUndefined();
    });

    afterEach(() => {
      delegateMsg.value.delegatorAddress = stakeholderWallet.address as string;
      delegateMsg.value.validatorAddress = validatorAddress;
      delegateMsg.value.amount.denom = NATIVE_MINIMAL_DENOM;
    });

    async function tryDelegationWithInvalidParams(message: string) {
      const delegateTx = await stakeholderWallet.signAndBroadcast(
        stakeholderWallet.address as string,
        [delegateMsg],
        customFees.configs,
      );

      expect(delegateTx.rawLog).toContain(message);
    }

    test('the validator should exist and should be bonded', async () => {
      const expectedStatus: BondStatus =
        bondStatusFromJSON('BOND_STATUS_BONDED');

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
      expect(validatorInformation.commission?.commissionRates?.rate).not.toBe(
        '',
      );
      expect(
        validatorInformation.commission?.commissionRates?.maxRate,
      ).not.toBe('');
      expect(
        validatorInformation.commission?.commissionRates?.maxChangeRate,
      ).not.toBe('');
      expect(validatorInformation.description?.moniker).not.toBe('');
      expect(validatorInformation.tokens).not.toBe('');
    });

    test('the successful scenario for tokens delegation to the validator - should work as expected', async () => {
      const validatorDelegatedTokensBefore = (
        await getValidatorInformation(validatorAddress)
      ).validator?.tokens;

      if (!validatorDelegatedTokensBefore) {
        undefinedHandler();
        return;
      }

      const treasuryBalanceBefore = await user1Wallet.getBalance(
        treasuryAddress,
        NATIVE_MINIMAL_DENOM,
      );

      delegateMsg.value.amount.amount = delegatedAmount;

      const result = await stakeholderWallet.signAndBroadcast(
        stakeholderWallet.address as string,
        [delegateMsg],
        customFees.configs,
      );
      expect(assertIsDeliverTxSuccess(result)).toBeUndefined();

      const treasuryBalanceAfter = await user1Wallet.getBalance(
        treasuryAddress,
        NATIVE_MINIMAL_DENOM,
      );

      if (ifLocal()) {
        expect(BigInt(treasuryBalanceAfter.amount)).toBe(
          BigInt(treasuryBalanceBefore.amount) +
            BigInt(calcFeeProfit(customFees.configs)),
        );
      }

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

      const stakeholderDelegatedTokens = (
        await getDelegatorInformation(stakeholderWallet.address as string)
      ).delegationResponses[0]?.balance?.amount;

      if (!stakeholderDelegatedTokens) {
        undefinedHandler();
        return;
      }

      expect(BigInt(stakeholderDelegatedTokens)).not.toBe(BigInt(0));

      const validatorDelegatedTokensAfter = (
        await getValidatorInformation(validatorAddress)
      ).validator?.tokens;

      if (!validatorDelegatedTokensAfter) {
        undefinedHandler();
        return;
      }
      expect(BigInt(validatorDelegatedTokensAfter)).toBe(
        BigInt(validatorDelegatedTokensBefore) + BigInt(delegatedAmount),
      );
    });

    test('the stakeholder tries to delegate 0 tokens - should produce an error', async () => {
      const stakeholderDelegationsToValBefore =
        await getDelegatorValidatorPairAmount(
          stakeholderWallet.address as string,
          validatorAddress,
        );

      if (!stakeholderDelegationsToValBefore) {
        undefinedHandler();
        return;
      }

      delegateMsg.value.amount.amount = '0';

      await tryDelegationWithInvalidParams('invalid delegation amount');

      const stakeholderDelegationsToValAfter =
        await getDelegatorValidatorPairAmount(
          stakeholderWallet.address as string,
          validatorAddress,
        );

      if (!stakeholderDelegationsToValAfter) {
        undefinedHandler();
        return;
      }

      expect(BigInt(stakeholderDelegationsToValAfter)).toBe(
        BigInt(stakeholderDelegationsToValBefore),
      );
    });

    test('the stakeholder tries to delegate tokens to non-existent validator - should produce an error', async () => {
      const invalidValidatoWallet = await getUser2Wallet();

      delegateMsg.value.amount.amount = delegatedAmount;
      delegateMsg.value.validatorAddress =
        invalidValidatoWallet.address as string;

      await tryDelegationWithInvalidParams(
        `expected 'nolusvaloper' got 'nolus'`,
      );
    });

    test('the stakeholder tries to delegate tokens different than one defined by params.BondDenom - should produce an error', async () => {
      const bondDenom = (await getParamsInformation()).params?.bondDenom;

      if (!bondDenom) {
        undefinedHandler();
        return;
      }

      const invalidDenom = 'upebble';

      expect(bondDenom).not.toBe(invalidDenom);

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
  },
);
