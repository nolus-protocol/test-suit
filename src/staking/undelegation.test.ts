import { assertIsDeliverTxSuccess, Coin } from '@cosmjs/stargate';
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
import { runOrSkip } from '../util/testingRules';

runOrSkip(process.env.TEST_STAKING as string)(
  'Staking Nolus tokens - Undelegation',
  () => {
    let userWithBalanceWallet: NolusWallet;
    let delegatorWallet: NolusWallet;
    let validatorAddress: string;

    const delegatedAmount = '22';
    const undelegatedAmount = (+delegatedAmount / 2).toString();
    let undelegationsCounter = 0;

    const undelegationMsg = {
      typeUrl: '',
      value: {
        delegatorAddress: '',
        validatorAddress: '',
        amount: { denom: NATIVE_MINIMAL_DENOM, amount: '' },
      },
    };

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      userWithBalanceWallet = await getUser1Wallet();
      delegatorWallet = await createWallet();

      validatorAddress = getValidator1Address();

      const initTransfer: Coin = {
        denom: NATIVE_MINIMAL_DENOM,
        amount: delegatedAmount + customFees.transfer.amount[0].amount,
      };

      const broadcastTx = await userWithBalanceWallet.transferAmount(
        delegatorWallet.address as string,
        [initTransfer],
        customFees.transfer,
      );
      expect(assertIsDeliverTxSuccess(broadcastTx)).toBeUndefined();

      undelegationMsg.value.delegatorAddress =
        delegatorWallet.address as string;
      undelegationMsg.value.validatorAddress = validatorAddress;
    });

    afterEach(() => {
      undelegationMsg.value.delegatorAddress =
        delegatorWallet.address as string;
      undelegationMsg.value.validatorAddress = validatorAddress;
      undelegationMsg.value.amount.denom = NATIVE_MINIMAL_DENOM;
    });

    async function tryUndelegationWithInvalidParams(message: string) {
      await userWithBalanceWallet.transferAmount(
        delegatorWallet.address as string,
        customFees.configs.amount,
        customFees.transfer,
      );

      const broadcastTx = await delegatorWallet.signAndBroadcast(
        delegatorWallet.address as string,
        [undelegationMsg],
        customFees.configs,
      );

      expect(broadcastTx.rawLog).toContain(message);
    }

    test('the delegator tries to undelegate tokens from a non-existent delegate-validator pair - should produce an error', async () => {
      undelegationMsg.value.amount.amount = delegatedAmount;
      undelegationMsg.typeUrl = `${stakingModule}.MsgUndelegate`;

      await tryUndelegationWithInvalidParams(
        'failed to execute message; message index: 0: no delegation for (address, validator) tuple',
      );
    });

    test('the successful scenario for tokens undelegation - should work as expected', async () => {
      undelegationMsg.value.amount.amount = delegatedAmount;
      undelegationMsg.typeUrl = `${stakingModule}.MsgDelegate`;

      const delegationResult = await delegatorWallet.signAndBroadcast(
        delegatorWallet.address as string,
        [undelegationMsg],
        customFees.configs,
      );
      expect(assertIsDeliverTxSuccess(delegationResult)).toBeUndefined();

      const delegatorDelegationsToValBefore =
        await getDelegatorValidatorPairAmount(
          delegatorWallet.address as string,
          validatorAddress,
        );

      if (!delegatorDelegationsToValBefore) {
        undefinedHandler();
        return;
      }

      undelegationMsg.typeUrl = `${stakingModule}.MsgUndelegate`;
      undelegationMsg.value.amount.amount = undelegatedAmount;

      const undelegationResult = await delegatorWallet.signAndBroadcast(
        delegatorWallet.address as string,
        [undelegationMsg],
        customFees.configs,
      );

      expect(assertIsDeliverTxSuccess(undelegationResult)).toBeUndefined();
      undelegationsCounter++;

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

      const delegatorDelegationsToValAfter =
        await getDelegatorValidatorPairAmount(
          delegatorWallet.address as string,
          validatorAddress,
        );

      if (!delegatorDelegationsToValAfter) {
        undefinedHandler();
        return;
      }

      expect(BigInt(delegatorDelegationsToValAfter)).toBe(
        BigInt(delegatorDelegationsToValBefore) - BigInt(undelegatedAmount),
      );
    });

    test('the delegator tries to undelegate 0 tokens - should produce an error', async () => {
      undelegationMsg.typeUrl = `${stakingModule}.MsgUndelegate`;
      undelegationMsg.value.amount.amount = '0';

      const undelegateTx = await delegatorWallet.signAndBroadcast(
        delegatorWallet.address as string,
        [undelegationMsg],
        customFees.configs,
      );

      expect(undelegateTx.rawLog).toContain('invalid shares amount');
    });

    test('the delegator tries to undelegate tokens different than one defined by params.BondDenom - should produce an error', async () => {
      const bondDenom = (await getParamsInformation()).params?.bondDenom;

      if (!bondDenom) {
        undefinedHandler();
        return;
      }

      const invalidDenom = 'upebble';

      expect(bondDenom).not.toBe(invalidDenom);

      undelegationMsg.typeUrl = `${stakingModule}.MsgUndelegate`;
      undelegationMsg.value.amount.amount = undelegatedAmount;
      undelegationMsg.value.amount.denom = invalidDenom;

      await tryUndelegationWithInvalidParams(
        `got ${invalidDenom}, expected ${bondDenom}`,
      );
    });

    test('the delegator tries to undelegate more tokens than he has delegated to the validator - should produce an error', async () => {
      const delegatorDelegationsToValBefore =
        await getDelegatorValidatorPairAmount(
          delegatorWallet.address as string,
          validatorAddress,
        );

      if (!delegatorDelegationsToValBefore) {
        undefinedHandler();
        return;
      }

      undelegationMsg.typeUrl = `${stakingModule}.MsgUndelegate`;
      undelegationMsg.value.amount.amount = delegatedAmount;

      await tryUndelegationWithInvalidParams(
        'failed to execute message; message index: 0: invalid shares amount: invalid request',
      );

      const delegatorDelegationsToValAfter =
        await getDelegatorValidatorPairAmount(
          delegatorWallet.address as string,
          validatorAddress,
        );

      if (!delegatorDelegationsToValAfter) {
        undefinedHandler();
        return;
      }

      expect(BigInt(delegatorDelegationsToValAfter)).toBe(
        BigInt(delegatorDelegationsToValBefore),
      );
    });

    test('the delegator should be able to undelagate all his delegated tokens - should be removed from the current validator pairs', async () => {
      const delegatorDelegationsToValBefore =
        await getDelegatorValidatorPairAmount(
          delegatorWallet.address as string,
          validatorAddress,
        );

      if (!delegatorDelegationsToValBefore) {
        undefinedHandler();
        return;
      }

      undelegationMsg.typeUrl = `${stakingModule}.MsgUndelegate`;
      undelegationMsg.value.amount.amount = undelegatedAmount;

      const undelegationResult = await delegatorWallet.signAndBroadcast(
        delegatorWallet.address as string,
        [undelegationMsg],
        customFees.configs,
      );

      expect(assertIsDeliverTxSuccess(undelegationResult)).toBeUndefined();
      undelegationsCounter++;

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
      undelegationMsg.value.amount.amount = delegatedAmount;
      undelegationMsg.typeUrl = `${stakingModule}.MsgDelegate`;

      const delegationResult = await delegatorWallet.signAndBroadcast(
        delegatorWallet.address as string,
        [undelegationMsg],
        customFees.configs,
      );
      expect(assertIsDeliverTxSuccess(delegationResult)).toBeUndefined();

      const maxEntries = (await getParamsInformation()).params?.maxEntries;

      if (!maxEntries) {
        undefinedHandler();
        return;
      }
      undelegationMsg.typeUrl = `${stakingModule}.MsgUndelegate`;
      const loopIteration = maxEntries - undelegationsCounter;
      const loopUndelegateAmount =
        BigInt(delegatedAmount) / (BigInt(loopIteration) + BigInt(1));

      undelegationMsg.value.amount.amount = loopUndelegateAmount.toString();

      for (let i = 0; i < loopIteration; i++) {
        const undelegationResult = await delegatorWallet.signAndBroadcast(
          delegatorWallet.address as string,
          [undelegationMsg],
          customFees.configs,
        );
        expect(assertIsDeliverTxSuccess(undelegationResult)).toBeUndefined();
      }

      await tryUndelegationWithInvalidParams(
        'failed to execute message; message index: 0: too many unbonding delegation entries for (delegator, validator) tuple',
      );
    });
  },
);
