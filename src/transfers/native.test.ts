import {
  assertIsDeliverTxSuccess,
  Coin,
  DeliverTxResponse,
  isDeliverTxFailure,
} from '@cosmjs/stargate';
import NODE_ENDPOINT, {
  getUser1Wallet,
  getUser2Wallet,
  getUser3Wallet,
} from '../util/clients';
import { customFees, GASPRICE, NATIVE_MINIMAL_DENOM } from '../util/utils';
import { NolusWallet, NolusClient } from '@nolus/nolusjs';
import { sendInitTransferFeeTokens } from '../util/transfer';
import { ifLocal, runOrSkip } from '../util/testingRules';

runOrSkip(process.env.TEST_TRANSFER as string)(
  'Transfers - Native transfer',
  () => {
    let user1Wallet: NolusWallet;
    let user2Wallet: NolusWallet;
    let user3Wallet: NolusWallet;
    let transfer1: Coin;
    let transfer2: Coin;
    let transfer3: Coin;
    const transferAmount = 10;
    const treasuryAddress = process.env.TREASURY_ADDRESS as string;

    const percision = 100000;
    const gasPriceInteger = GASPRICE * percision;

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      user1Wallet = await getUser1Wallet();
      user2Wallet = await getUser2Wallet();
      user3Wallet = await getUser3Wallet();

      transfer1 = {
        denom: NATIVE_MINIMAL_DENOM,
        amount: (
          transferAmount +
          +customFees.transfer.amount[0].amount * 2
        ).toString(),
      };
      transfer2 = {
        denom: NATIVE_MINIMAL_DENOM,
        amount: (
          transferAmount + +customFees.transfer.amount[0].amount
        ).toString(),
      };
      transfer3 = {
        denom: NATIVE_MINIMAL_DENOM,
        amount: transferAmount.toString(),
      };
    });

    test('account should have some balance', async () => {
      const balance = await user1Wallet.getBalance(
        user1Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      expect(BigInt(balance.amount) > 0).toBeTruthy();
    });

    test('users should be able to transfer and receive native tokens', async () => {
      const treasuryBalanceBefore = await user1Wallet.getBalance(
        treasuryAddress,
        NATIVE_MINIMAL_DENOM,
      );
      // user1 -> user2
      const previousUser1Balance = await user1Wallet.getBalance(
        user1Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );
      let previousUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );
      const broadcastTxResponse1: DeliverTxResponse =
        await user1Wallet.transferAmount(
          user2Wallet.address as string,
          [transfer1],
          customFees.transfer,
          '',
        );

      const treasuryBalanceAfter = await user1Wallet.getBalance(
        treasuryAddress,
        NATIVE_MINIMAL_DENOM,
      );

      if (ifLocal()) {
        expect(BigInt(treasuryBalanceAfter.amount)).toBe(
          BigInt(treasuryBalanceBefore.amount) +
            BigInt(customFees.transfer.amount[0].amount) -
            (BigInt(customFees.transfer.gas) * BigInt(gasPriceInteger)) /
              BigInt(percision),
        );
      }

      assertIsDeliverTxSuccess(broadcastTxResponse1);

      const nextUser1Balance = await user1Wallet.getBalance(
        user1Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );
      let nextUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      expect(BigInt(nextUser1Balance.amount)).toBe(
        BigInt(previousUser1Balance.amount) -
          BigInt(transfer1.amount) -
          BigInt(customFees.transfer.amount[0].amount),
      );
      expect(BigInt(nextUser2Balance.amount)).toBe(
        BigInt(previousUser2Balance.amount) + BigInt(transfer1.amount),
      );

      // user2 -> user3
      previousUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );
      const previousUser3Balance = await user3Wallet.getBalance(
        user3Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      const broadcastTxResponse2: DeliverTxResponse =
        await user2Wallet.transferAmount(
          user3Wallet.address as string,
          [transfer2],
          customFees.transfer,
          '',
        );
      assertIsDeliverTxSuccess(broadcastTxResponse2);
      nextUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );
      const nextUser3Balance = await user3Wallet.getBalance(
        user3Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      expect(BigInt(nextUser2Balance.amount)).toBe(
        BigInt(previousUser2Balance.amount) -
          BigInt(transfer2.amount) -
          BigInt(customFees.transfer.amount[0].amount),
      );
      expect(BigInt(nextUser3Balance.amount)).toBe(
        BigInt(previousUser3Balance.amount) + BigInt(transfer2.amount),
      );

      // user 3 -> user 1 - isolate the test and finish in the initial state

      const broadcastTxResponse3: DeliverTxResponse =
        await user3Wallet.transferAmount(
          user1Wallet.address as string,
          [transfer3],
          customFees.transfer,
          '',
        );
      assertIsDeliverTxSuccess(broadcastTxResponse3);

      const user1Balance = await user1Wallet.getBalance(
        user1Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );
      const user3Balance = await user3Wallet.getBalance(
        user3Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      expect(BigInt(user1Balance.amount)).toBe(
        BigInt(previousUser1Balance.amount) -
          BigInt(+customFees.transfer.amount[0].amount * 3), // *3 -> transfer1 -> amount=2*fee.amount; fee=1*fee.amount
      );
      expect(BigInt(user3Balance.amount)).toBe(
        BigInt(previousUser3Balance.amount),
      );
    });

    test('user tries to send 0 tokens - should produce an error', async () => {
      const transfer = {
        denom: NATIVE_MINIMAL_DENOM,
        amount: '0',
      };
      const previousUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );
      const previousUser3Balance = await user1Wallet.getBalance(
        user3Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      const broadcastTx = () =>
        user2Wallet.transferAmount(
          user3Wallet.address as string,
          [transfer],
          customFees.transfer,
          '',
        );

      await expect(broadcastTx).rejects.toThrow(/^.*0unls: invalid coins.*/);

      const nextUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );
      const nextUser3Balance = await user3Wallet.getBalance(
        user3Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      expect(BigInt(nextUser2Balance.amount)).toBe(
        BigInt(previousUser2Balance.amount),
      );
      expect(BigInt(nextUser3Balance.amount)).toBe(
        BigInt(previousUser3Balance.amount),
      );
    });

    test('user tries to send the entire amount tokens he owns - should produce an error message', async () => {
      await sendInitTransferFeeTokens(
        user1Wallet,
        user2Wallet.address as string,
      );

      const previousUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );
      const transfer = {
        denom: NATIVE_MINIMAL_DENOM,
        amount: previousUser2Balance.amount,
      };
      const previousUser3Balance = await user3Wallet.getBalance(
        user3Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      const broadcastTxResponse: DeliverTxResponse =
        await user2Wallet.transferAmount(
          user3Wallet.address as string,
          [transfer],
          customFees.transfer,
          '',
        );

      expect(isDeliverTxFailure(broadcastTxResponse)).toBeTruthy();
      expect(broadcastTxResponse.rawLog).toMatch(/^.*insufficient funds.*/);

      const nextUser3Balance = await user3Wallet.getBalance(
        user3Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );
      const nextUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      expect(BigInt(nextUser2Balance.amount)).toBe(
        BigInt(previousUser2Balance.amount) -
          BigInt(customFees.transfer.amount[0].amount),
      );
      expect(BigInt(nextUser3Balance.amount)).toBe(
        BigInt(previousUser3Balance.amount),
      );
    });

    test('user should not be able to send tokens to an incompatible nolus wallet address', async () => {
      const WRONG_WALLET_ADDRESS =
        'wasm1gzkmn2lfm56m0q0l4rmjamq7rlwpfjrp7k78xw'; // wasm1 -> nolus1

      const previousUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      const broadcastTx = () =>
        user2Wallet.transferAmount(
          WRONG_WALLET_ADDRESS,
          [transfer2],
          customFees.transfer,
          '',
        );
      await expect(broadcastTx).rejects.toThrow(/^.*invalid address.*/);

      const nextUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      expect(BigInt(nextUser2Balance.amount)).toBe(
        BigInt(previousUser2Balance.amount),
      );
    });
  },
);
