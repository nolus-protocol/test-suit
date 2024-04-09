import {
  assertIsDeliverTxSuccess,
  Coin,
  DeliverTxResponse,
} from '@cosmjs/stargate';
import { NolusClient, NolusWallet } from '@nolus/nolusjs';
import { calcFeeProfit, sendInitTransferFeeTokens } from '../util/transfer';
import NODE_ENDPOINT, {
  getUser1Wallet,
  getUser2Wallet,
  getUser3Wallet,
} from '../util/clients';
import { customFees, NATIVE_MINIMAL_DENOM } from '../util/utils';
import { ifLocal, runOrSkip } from '../util/testingRules';
import { currencyTicker_To_IBC } from '../util/smart-contracts/calculations';

runOrSkip(process.env.TEST_TRANSFER as string)(
  'Transfers - tokens other than native',
  () => {
    let user1Wallet: NolusWallet;
    let user2Wallet: NolusWallet;
    let user3Wallet: NolusWallet;
    let transfer: Coin;
    let existingCurrencyIbc: string;
    const transferAmount = '10';
    const treasuryAddress = process.env.TREASURY_ADDRESS as string;
    const existingCurrencyTicker = process.env.LPP_BASE_CURRENCY as string;

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);

      user1Wallet = await getUser1Wallet();
      user2Wallet = await getUser2Wallet();
      user3Wallet = await getUser3Wallet();

      existingCurrencyIbc = await currencyTicker_To_IBC(existingCurrencyTicker);

      transfer = {
        denom: existingCurrencyIbc,
        amount: transferAmount,
      };
      // send some native tokens
      await sendInitTransferFeeTokens(
        user1Wallet,
        user2Wallet.address as string,
      );
    });

    test('user should have some balance and the current token should be defined', async () => {
      const balance = await user1Wallet.getBalance(
        user1Wallet.address as string,
        existingCurrencyIbc,
      );

      expect(existingCurrencyIbc).toBeDefined();
      expect(existingCurrencyIbc.length > 0).toBeTruthy();
      expect(BigInt(balance.amount) > 0).toBeTruthy();
    });

    test('user should be able to transfer and receive current tokens including sending the entire amount tokens he owns', async () => {
      const previousUser1Balance = await user1Wallet.getBalance(
        user1Wallet.address as string,
        existingCurrencyIbc,
      );

      await sendInitTransferFeeTokens(
        user1Wallet,
        user2Wallet.address as string,
      );

      // send some tokens
      const sendTokensResponse: DeliverTxResponse =
        await user1Wallet.transferAmount(
          user2Wallet.address as string,
          [transfer],
          customFees.transfer,
        );
      assertIsDeliverTxSuccess(sendTokensResponse);

      // user2 -> user3
      const previousUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        existingCurrencyIbc,
      );
      const previousUser3Balance = await user3Wallet.getBalance(
        user3Wallet.address as string,
        existingCurrencyIbc,
      );

      const treasuryBalanceBefore = await user1Wallet.getBalance(
        treasuryAddress,
        NATIVE_MINIMAL_DENOM,
      );

      const sendTokensResponse1: DeliverTxResponse =
        await user2Wallet.transferAmount(
          user3Wallet.address as string,
          [transfer],
          customFees.transfer,
        );
      assertIsDeliverTxSuccess(sendTokensResponse1);

      const treasuryBalanceAfter = await user1Wallet.getBalance(
        treasuryAddress,
        NATIVE_MINIMAL_DENOM,
      );

      if (ifLocal()) {
        expect(BigInt(treasuryBalanceAfter.amount)).toBe(
          BigInt(treasuryBalanceBefore.amount) +
            BigInt(calcFeeProfit(customFees.transfer)),
        );
      }

      const nextUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        existingCurrencyIbc,
      );
      let nextUser3Balance = await user3Wallet.getBalance(
        user3Wallet.address as string,
        existingCurrencyIbc,
      );

      expect(BigInt(nextUser2Balance.amount)).toBe(
        BigInt(previousUser2Balance.amount) - BigInt(transfer.amount),
      );
      expect(BigInt(nextUser3Balance.amount)).toBe(
        BigInt(previousUser3Balance.amount) + BigInt(transfer.amount),
      );

      // send entire amount
      // user 3 -> user 1 - isolate the test and finish in the initial state

      // send unolus for fee
      await sendInitTransferFeeTokens(
        user1Wallet,
        user3Wallet.address as string,
      );

      const sendTokensResponse2: DeliverTxResponse =
        await user3Wallet.transferAmount(
          user1Wallet.address as string,
          [transfer],
          customFees.transfer,
        );
      assertIsDeliverTxSuccess(sendTokensResponse2);

      const nextUser1Balance = await user1Wallet.getBalance(
        user1Wallet.address as string,
        existingCurrencyIbc,
      );

      nextUser3Balance = await user3Wallet.getBalance(
        user3Wallet.address as string,
        existingCurrencyIbc,
      );

      expect(BigInt(nextUser3Balance.amount)).toBe(
        BigInt(previousUser3Balance.amount),
      );
      expect(BigInt(nextUser1Balance.amount)).toBe(
        BigInt(previousUser1Balance.amount),
      );
    });

    test('user tries to send 0 tokens - should produce an error', async () => {
      const transfer = {
        denom: existingCurrencyIbc,
        amount: '0',
      };

      const previousUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        existingCurrencyIbc,
      );
      const previousUser3Balance = await user3Wallet.getBalance(
        user3Wallet.address as string,
        existingCurrencyIbc,
      );

      const broadcastTx = () =>
        user2Wallet.transferAmount(
          user3Wallet.address as string,
          [transfer],
          customFees.transfer,
        );
      await expect(broadcastTx).rejects.toThrow(/^.*invalid coins.*/);

      const nextUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        existingCurrencyIbc,
      );
      const nextUser3Balance = await user1Wallet.getBalance(
        user3Wallet.address as string,
        existingCurrencyIbc,
      );

      expect(BigInt(nextUser2Balance.amount)).toBe(
        BigInt(previousUser2Balance.amount),
      );
      expect(BigInt(nextUser3Balance.amount)).toBe(
        BigInt(previousUser3Balance.amount),
      );
    });

    test('user should not be able to send current tokens to an incompatible nolus wallet address', async () => {
      const WRONG_WALLET_ADDRESS =
        'wasm1gzkmn2lfm56m0q0l4rmjamq7rlwpfjrp7k78xw'; // wasm1 -> nolus1

      const previousUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        existingCurrencyIbc,
      );

      const broadcastTx = () =>
        user2Wallet.transferAmount(
          WRONG_WALLET_ADDRESS,
          [transfer],
          customFees.transfer,
        );
      await expect(broadcastTx).rejects.toThrow(/^.*invalid address.*/);

      const nextUser2Balance = await user2Wallet.getBalance(
        user2Wallet.address as string,
        existingCurrencyIbc,
      );

      expect(BigInt(nextUser2Balance.amount)).toBe(
        BigInt(previousUser2Balance.amount),
      );
    });
  },
);
