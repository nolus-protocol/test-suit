import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { runOrSkip } from '../util/testingRules';
import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import { customFees, NATIVE_MINIMAL_DENOM } from '../util/utils';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import {
  currencyTicker_To_IBC,
  NLPNS_To_LPNS,
} from '../util/smart-contracts/calculations';

runOrSkip(process.env.TEST_LENDER as string)(
  'Lender tests - Burn deposit',
  () => {
    let userWithBalance: NolusWallet;
    let lenderWallet: NolusWallet;
    let lppCurrency: string;
    let lppCurrencyToIBC: string;
    let lppInstance: NolusContracts.Lpp;
    let cosm: CosmWasmClient;

    const lppContractAddress = process.env.LPP_ADDRESS as string;
    const deposit = '100';

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      userWithBalance = await getUser1Wallet();
      lenderWallet = await createWallet();

      cosm = await NolusClient.getInstance().getCosmWasmClient();
      lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);

      const lppConfig = await lppInstance.getLppConfig();
      lppCurrency = lppConfig.lpn_ticker;
      lppCurrencyToIBC = currencyTicker_To_IBC(lppCurrency);
    });

    test('the successful burn rewards scenario - should work as expected', async () => {
      const rewards = { amount: '200000000', denom: NATIVE_MINIMAL_DENOM };

      await userWithBalance.transferAmount(
        lenderWallet.address as string,
        [{ denom: lppCurrencyToIBC, amount: deposit }],
        customFees.transfer,
      );

      await sendInitExecuteFeeTokens(
        userWithBalance,
        lenderWallet.address as string,
      );

      const lppBalance = await lppInstance.getLppBalance();

      // if the total depositors balance_nlpn==0 lpp returns err, because otherwise funds are frozen in the contract
      if (BigInt(lppBalance.balance_nlpn.amount) === BigInt(0)) {
        console.log('No deposits.');
        const broadcastTx = () =>
          lppInstance.distributeRewards(userWithBalance, customFees.exec, [
            rewards,
          ]);

        await expect(broadcastTx).rejects.toThrow(
          /^.*Distribute rewards with zero balance nlpn.*/,
        );
      }

      await lppInstance.deposit(lenderWallet, customFees.exec, [
        { denom: lppCurrencyToIBC, amount: deposit },
      ]);

      const lenderBalanceBeforeFirstBurn = await cosm.getBalance(
        lenderWallet.address as string,
        lppCurrencyToIBC,
      );

      const lenderNativeBalanceBeforeFirstBurn = await cosm.getBalance(
        lenderWallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      const lenderDepositBeforeFirstBurn = await lppInstance.getLenderDeposit(
        lenderWallet.address as string,
      );

      // burn part of the deposit amount
      await lppInstance.distributeRewards(userWithBalance, customFees.exec, [
        rewards,
      ]);

      const lenderRewardsBeforeFirstBurn = await lppInstance.getLenderRewards(
        lenderWallet.address as string,
      );
      expect(lenderRewardsBeforeFirstBurn.rewards.amount).not.toBe('0');

      const burnAmount = (
        BigInt(lenderDepositBeforeFirstBurn.balance) / BigInt(2)
      ).toString();

      const priceBeforeBurn = await lppInstance.getPrice();

      await sendInitExecuteFeeTokens(
        userWithBalance,
        lenderWallet.address as string,
      );

      await lppInstance.burnDeposit(lenderWallet, burnAmount, customFees.exec);

      const lenderDepositAfterFirstBurn = await lppInstance.getLenderDeposit(
        lenderWallet.address as string,
      );

      const lenderBalanceAfterFirstBurn = await cosm.getBalance(
        lenderWallet.address as string,
        lppCurrencyToIBC,
      );

      const lenderNativeBalanceAfterFirstBurn = await cosm.getBalance(
        lenderWallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      const lenderRewardsAfterFirstBurn = await lppInstance.getLenderRewards(
        lenderWallet.address as string,
      );

      expect(BigInt(lenderDepositAfterFirstBurn.balance)).toBe(
        BigInt(lenderDepositBeforeFirstBurn.balance) - BigInt(burnAmount),
      );

      expect(BigInt(lenderBalanceAfterFirstBurn.amount)).toBe(
        BigInt(lenderBalanceBeforeFirstBurn.amount) +
          NLPNS_To_LPNS(+burnAmount, priceBeforeBurn),
      );

      expect(lenderNativeBalanceAfterFirstBurn.amount).toBe(
        lenderNativeBalanceBeforeFirstBurn.amount,
      );

      expect(lenderRewardsBeforeFirstBurn.rewards.amount).toBe(
        lenderRewardsAfterFirstBurn.rewards.amount,
      );

      // burn all deposit
      await sendInitExecuteFeeTokens(
        userWithBalance,
        lenderWallet.address as string,
      );
      const priceBeforeSecondBurn = await lppInstance.getPrice();

      await lppInstance.burnDeposit(
        lenderWallet,
        lenderDepositAfterFirstBurn.balance,
        customFees.exec,
      );

      const lenderDepositAfterSecondBurn = await lppInstance.getLenderDeposit(
        lenderWallet.address as string,
      );

      const lenderBalanceAfterSecondBurn = await cosm.getBalance(
        lenderWallet.address as string,
        lppCurrencyToIBC,
      );

      const lenderNativeBalanceAfterSecondBurn = await cosm.getBalance(
        lenderWallet.address as string,
        NATIVE_MINIMAL_DENOM,
      );

      const lenderRewardsAfterSecondBurnTx = () =>
        lppInstance.getLenderRewards(lenderWallet.address as string);
      await expect(lenderRewardsAfterSecondBurnTx).rejects.toThrow(
        /^.*The deposit does not exist.*/,
      );

      expect(lenderDepositAfterSecondBurn.balance).toBe('0');

      expect(BigInt(lenderBalanceAfterSecondBurn.amount)).toBe(
        BigInt(lenderBalanceAfterFirstBurn.amount) +
          NLPNS_To_LPNS(
            +lenderDepositAfterFirstBurn.balance,
            priceBeforeSecondBurn,
          ),
      );

      // claim should be exec automatically bacause Deposited_nLPN == WithdrawAmount_nLPN
      expect(BigInt(lenderNativeBalanceAfterSecondBurn.amount)).toBe(
        BigInt(lenderNativeBalanceAfterFirstBurn.amount) +
          BigInt(lenderRewardsAfterFirstBurn.rewards.amount),
      );
    });

    test('non-lender user tries to burn deposit - should produce an error', async () => {
      await lppInstance.deposit(userWithBalance, customFees.exec, [
        { denom: lppCurrencyToIBC, amount: deposit },
      ]);

      const newLenderWallet = await createWallet();

      await sendInitExecuteFeeTokens(
        userWithBalance,
        newLenderWallet.address as string,
      );

      const broadcastTx = () =>
        lppInstance.burnDeposit(
          newLenderWallet,
          '10', // any amount
          customFees.exec,
        );

      await expect(broadcastTx).rejects.toThrow(
        /^.*The deposit does not exist.*/,
      );
    });

    test('lender tries to burn 0 deposit - should produce an error', async () => {
      const newLenderWallet = await createWallet();

      await userWithBalance.transferAmount(
        newLenderWallet.address as string,
        [{ denom: lppCurrencyToIBC, amount: deposit }],
        customFees.transfer,
      );

      await sendInitExecuteFeeTokens(
        userWithBalance,
        newLenderWallet.address as string,
      );

      await lppInstance.deposit(newLenderWallet, customFees.exec, [
        { denom: lppCurrencyToIBC, amount: deposit },
      ]);

      await sendInitExecuteFeeTokens(
        userWithBalance,
        newLenderWallet.address as string,
      );

      const broadcastTx = () =>
        lppInstance.burnDeposit(newLenderWallet, '0', customFees.exec);

      await expect(broadcastTx).rejects.toThrow(/^.*Zero withdraw amount.*/);
    });

    test('lender tries to burn more deposit than he owns - should produce an error', async () => {
      await sendInitExecuteFeeTokens(
        userWithBalance,
        lenderWallet.address as string,
      );

      await userWithBalance.transferAmount(
        lenderWallet.address as string,
        [{ denom: lppCurrencyToIBC, amount: deposit }],
        customFees.transfer,
      );

      await lppInstance.deposit(lenderWallet, customFees.exec, [
        { denom: lppCurrencyToIBC, amount: deposit },
      ]);

      await sendInitExecuteFeeTokens(
        userWithBalance,
        lenderWallet.address as string,
      );

      const lenderDeposit = await lppInstance.getLenderDeposit(
        lenderWallet.address as string,
      );

      await sendInitExecuteFeeTokens(
        userWithBalance,
        lenderWallet.address as string,
      );

      const broadcastTx = () =>
        lppInstance.burnDeposit(
          lenderWallet,
          (BigInt(lenderDeposit.balance) + BigInt(1)).toString(),
          customFees.exec,
        );

      await expect(broadcastTx).rejects.toThrow(/^.*Insufficient balance.*/);
    });
  },
);
