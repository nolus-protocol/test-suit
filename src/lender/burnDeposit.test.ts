import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import { customFees, NATIVE_MINIMAL_DENOM } from '../util/utils';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import {
  currencyTicker_To_IBC,
  NLPNS_To_LPNS,
} from '../util/smart-contracts/calculations';

const maybe =
  (process.env.TEST_LENDER as string).toLowerCase() !== 'false' &&
  +(process.env.LENDER_DEPOSIT_CAPACITY as string) !== 0
    ? describe
    : describe.skip;

maybe('Lender tests - Deposit burn', () => {
  let cosm: CosmWasmClient;
  let userWithBalance: NolusWallet;
  let lppInstance: NolusContracts.Lpp;
  let lenderWallet: NolusWallet;
  let lppCurrency: string;
  let lppCurrencyToIBC: string;
  let deposit: string;

  const lppContractAddress = process.env.LPP_ADDRESS as string;

  async function testDepositBurnInvalidCases(
    senderWallet: NolusWallet,
    burnAmount: string,
    errorMsg: string,
  ) {
    await sendInitExecuteFeeTokens(
      userWithBalance,
      senderWallet.address as string,
    );

    const broadcastTx = () =>
      lppInstance.burnDeposit(senderWallet, burnAmount, customFees.exec);

    await expect(broadcastTx).rejects.toThrow(errorMsg);
  }

  async function makeDeposit() {
    await userWithBalance.transferAmount(
      lenderWallet.address as string,
      [{ denom: lppCurrencyToIBC, amount: deposit }],
      customFees.transfer,
    );

    await sendInitExecuteFeeTokens(
      userWithBalance,
      lenderWallet.address as string,
    );

    await lppInstance.deposit(lenderWallet, customFees.exec, [
      { denom: lppCurrencyToIBC, amount: deposit },
    ]);
  }

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    cosm = await NolusClient.getInstance().getCosmWasmClient();
    lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);

    userWithBalance = await getUser1Wallet();
    lenderWallet = await createWallet();

    lppCurrency = process.env.LPP_BASE_CURRENCY as string;
    lppCurrencyToIBC = await currencyTicker_To_IBC(lppCurrency);
    expect(lppCurrencyToIBC).not.toBe('');

    const depositCapacity = await lppInstance.getDepositCapacity();
    depositCapacity
      ? (deposit = Math.ceil(depositCapacity.amount / 10000).toString())
      : (deposit = '100');

    +deposit < 100 ? (deposit = '100') : deposit;
  });

  test('the successful deposit burn scenario - should work as expected', async () => {
    const rewards = { amount: '200000000', denom: NATIVE_MINIMAL_DENOM };

    const lppBalance = await lppInstance.getLppBalance();

    // if the total depositors balance_nlpn==0 - lpp returns err, because otherwise funds are frozen in the contract
    if (BigInt(lppBalance.balance_nlpn.amount) === BigInt(0)) {
      console.log('No deposit.');
      const broadcastTx = () =>
        lppInstance.distributeRewards(userWithBalance, customFees.exec, [
          rewards,
        ]);

      await expect(broadcastTx).rejects.toThrow(
        /^.*Distribute rewards with zero balance nlpn.*/,
      );
    }

    await makeDeposit();

    const lenderBalanceBeforeFirstBurn = await lenderWallet.getBalance(
      lenderWallet.address as string,
      lppCurrencyToIBC,
    );

    const lenderNativeBalanceBeforeFirstBurn = await lenderWallet.getBalance(
      lenderWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    const lenderDepositBeforeFirstBurn = await lppInstance.getLenderDeposit(
      lenderWallet.address as string,
    );

    await lppInstance.distributeRewards(userWithBalance, customFees.exec, [
      rewards,
    ]);

    const lenderRewardsBeforeFirstBurn = await lppInstance.getLenderRewards(
      lenderWallet.address as string,
    );
    expect(lenderRewardsBeforeFirstBurn.rewards.amount).not.toBe('0');

    const burnAmount = Math.ceil(
      +lenderDepositBeforeFirstBurn.amount / 2,
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

    const lenderBalanceAfterFirstBurn = await lenderWallet.getBalance(
      lenderWallet.address as string,
      lppCurrencyToIBC,
    );

    const lenderNativeBalanceAfterFirstBurn = await lenderWallet.getBalance(
      lenderWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    const lenderRewardsAfterFirstBurn = await lppInstance.getLenderRewards(
      lenderWallet.address as string,
    );

    expect(BigInt(lenderDepositAfterFirstBurn.amount)).toBe(
      BigInt(lenderDepositBeforeFirstBurn.amount) - BigInt(burnAmount),
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

    await sendInitExecuteFeeTokens(
      userWithBalance,
      lenderWallet.address as string,
    );
    const priceBeforeSecondBurn = await lppInstance.getPrice();

    await lppInstance.burnDeposit(
      lenderWallet,
      lenderDepositAfterFirstBurn.amount,
      customFees.exec,
    );

    const lenderDepositAfterSecondBurn = await lppInstance.getLenderDeposit(
      lenderWallet.address as string,
    );

    const lenderBalanceAfterSecondBurn = await lenderWallet.getBalance(
      lenderWallet.address as string,
      lppCurrencyToIBC,
    );

    const lenderNativeBalanceAfterSecondBurn = await lenderWallet.getBalance(
      lenderWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    const lenderRewardsAfterSecondBurnTx = () =>
      lppInstance.getLenderRewards(lenderWallet.address as string);
    await expect(lenderRewardsAfterSecondBurnTx).rejects.toThrow(
      /^.*The deposit does not exist.*/,
    );

    expect(lenderDepositAfterSecondBurn.amount).toBe('0');

    expect(BigInt(lenderBalanceAfterSecondBurn.amount)).toBe(
      BigInt(lenderBalanceAfterFirstBurn.amount) +
        NLPNS_To_LPNS(
          +lenderDepositAfterFirstBurn.amount,
          priceBeforeSecondBurn,
        ),
    );

    // claim should be exec automatically bacause Deposited_nLPN == WithdrawAmount_nLPN
    expect(BigInt(lenderNativeBalanceAfterSecondBurn.amount)).toBe(
      BigInt(lenderNativeBalanceAfterFirstBurn.amount) +
        BigInt(lenderRewardsAfterFirstBurn.rewards.amount),
    );
  });

  test('a non-lender user tries to burn a deposit - should produce an error', async () => {
    const newWallet = await createWallet();

    await testDepositBurnInvalidCases(
      newWallet,
      '10',
      'The deposit does not exist',
    ); // any amount
  });

  test('a lender tries to burn deposit amount = 0 - should produce an error', async () => {
    await makeDeposit();

    await testDepositBurnInvalidCases(
      lenderWallet,
      '0',
      'Zero withdraw amount',
    );
  });

  test('a lender tries to burn more deposit than he owns - should produce an error', async () => {
    await makeDeposit();

    const lenderDeposit = await lppInstance.getLenderDeposit(
      lenderWallet.address as string,
    );

    await testDepositBurnInvalidCases(
      lenderWallet,
      (BigInt(lenderDeposit.amount) + BigInt(1)).toString(),
      'Insufficient balance',
    );
  });
});
