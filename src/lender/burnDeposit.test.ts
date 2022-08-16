import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import { customFees, NATIVE_MINIMAL_DENOM } from '../util/utils';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { sendInitExecuteFeeTokens } from '../util/transfer';

describe('Lender tests - Burn deposit', () => {
  let user1Wallet: NolusWallet;
  let lenderWallet: NolusWallet;
  let lppDenom: string;
  let leaseInstance: NolusContracts.Lease;
  const lppContractAddress = process.env.LPP_ADDRESS as string;

  const deposit = '1000000';

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    lenderWallet = await createWallet();

    const cosm = await NolusClient.getInstance().getCosmWasmClient();
    leaseInstance = new NolusContracts.Lease(cosm);

    const lppConfig = await leaseInstance.getLppConfig(lppContractAddress);
    lppDenom = lppConfig.lpn_symbol;
  });

  test('the successful burn rewards scenario - should work as expected', async () => {
    await user1Wallet.transferAmount(
      lenderWallet.address as string,
      [{ denom: lppDenom, amount: deposit }],
      customFees.transfer,
    );

    await sendInitExecuteFeeTokens(user1Wallet, lenderWallet.address as string);

    await leaseInstance.lenderDeposit(
      lppContractAddress,
      lenderWallet,
      customFees.exec,
      [{ denom: lppDenom, amount: deposit }],
    );

    const lenderBalanceBeforeBurn = await lenderWallet.getBalance(
      lenderWallet.address as string,
      lppDenom,
    );

    const lenderNativeBalanceBefore = await lenderWallet.getBalance(
      lenderWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    const lenderDepositBeforeBurn = await leaseInstance.getLenderDeposit(
      lppContractAddress,
      lenderWallet.address as string,
    );

    // burn part of the deposit amount
    const rewards = { amount: '20000000000', denom: NATIVE_MINIMAL_DENOM };

    await leaseInstance.distributeRewards(
      lppContractAddress,
      user1Wallet,
      customFees.exec,
      [rewards],
    );

    const lenderRewardsBeforeFirstBurn = await leaseInstance.getLenderRewards(
      lppContractAddress,
      lenderWallet.address as string,
    );

    expect(lenderRewardsBeforeFirstBurn.rewards.amount).not.toBe('0');

    const burnAmount = Math.trunc(
      +lenderDepositBeforeBurn.balance / 2,
    ).toString();

    const priceBeforeBurn = await leaseInstance.getPrice(lppContractAddress);

    await sendInitExecuteFeeTokens(user1Wallet, lenderWallet.address as string);

    await leaseInstance.burnDeposit(
      lppContractAddress,
      lenderWallet,
      burnAmount,
      customFees.exec,
    );

    const lenderDepositAfterBurn = await leaseInstance.getLenderDeposit(
      lppContractAddress,
      lenderWallet.address as string,
    );

    const lenderBalanceAfterBurn = await lenderWallet.getBalance(
      lenderWallet.address as string,
      lppDenom,
    );

    const lenderNativeBalanceAfterBurn = await lenderWallet.getBalance(
      lenderWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    const lenderRewardsAfterFirstBurn = await leaseInstance.getLenderRewards(
      lppContractAddress,
      lenderWallet.address as string,
    );

    expect(+lenderDepositAfterBurn.balance).toBe(
      +lenderDepositBeforeBurn.balance - +burnAmount,
    );

    expect(+lenderBalanceAfterBurn.amount).toBe(
      +lenderBalanceBeforeBurn.amount +
        Math.trunc(
          +burnAmount /
            (+priceBeforeBurn.amount.amount /
              +priceBeforeBurn.amount_quote.amount),
        ),
    );

    expect(lenderNativeBalanceAfterBurn.amount).toBe(
      lenderNativeBalanceBefore.amount,
    );

    expect(lenderRewardsBeforeFirstBurn.rewards.amount).toBe(
      lenderRewardsAfterFirstBurn.rewards.amount,
    );

    // burn all deposit
    await sendInitExecuteFeeTokens(user1Wallet, lenderWallet.address as string);
    const priceBeforeSecondBurn = await leaseInstance.getPrice(
      lppContractAddress,
    );

    await leaseInstance.burnDeposit(
      lppContractAddress,
      lenderWallet,
      lenderDepositAfterBurn.balance,
      customFees.exec,
    );

    const lenderDepositAfterSecondBurn = await leaseInstance.getLenderDeposit(
      lppContractAddress,
      lenderWallet.address as string,
    );

    const lenderBalanceAfterSecondBurn = await lenderWallet.getBalance(
      lenderWallet.address as string,
      lppDenom,
    );

    const lenderNativeBalanceAfterSecondBurn = await lenderWallet.getBalance(
      lenderWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    const lenderRewardsAfterSecondBurnTx = () =>
      leaseInstance.getLenderRewards(
        lppContractAddress,
        lenderWallet.address as string,
      );
    await expect(lenderRewardsAfterSecondBurnTx).rejects.toThrow(
      /^.*The deposit does not exist.*/,
    );

    expect(lenderDepositAfterSecondBurn.balance).toBe('0');

    expect(+lenderBalanceAfterSecondBurn.amount).toBe(
      +lenderBalanceAfterBurn.amount +
        Math.trunc(
          +lenderDepositAfterBurn.balance /
            (+priceBeforeSecondBurn.amount.amount /
              +priceBeforeSecondBurn.amount_quote.amount),
        ),
    );

    // claim should be exec bacause Deposited_nLPN == WithdrawAmount_nLPN
    expect(+lenderNativeBalanceAfterSecondBurn.amount).toBe(
      +lenderNativeBalanceAfterBurn.amount +
        +lenderRewardsAfterFirstBurn.rewards.amount,
    );
  });

  test('the non-lender user tries to burn deposit - should produce an error', async () => {
    const newLenderWallet = await createWallet();

    await sendInitExecuteFeeTokens(
      user1Wallet,
      newLenderWallet.address as string,
    );

    const broadcastTx = () =>
      leaseInstance.burnDeposit(
        lppContractAddress,
        newLenderWallet,
        '10',
        customFees.exec,
      );

    await expect(broadcastTx).rejects.toThrow(
      /^.*The deposit does not exist.*/,
    );
  });

  test('the lender user tries to burn 0 deposit - should produce an error', async () => {
    const newLenderWallet = await createWallet();

    await user1Wallet.transferAmount(
      newLenderWallet.address as string,
      [{ denom: lppDenom, amount: deposit }],
      customFees.transfer,
    );

    await sendInitExecuteFeeTokens(
      user1Wallet,
      newLenderWallet.address as string,
    );

    await leaseInstance.lenderDeposit(
      lppContractAddress,
      newLenderWallet,
      customFees.exec,
      [{ denom: lppDenom, amount: deposit }],
    );

    await sendInitExecuteFeeTokens(
      user1Wallet,
      newLenderWallet.address as string,
    );

    const broadcastTx = () =>
      leaseInstance.burnDeposit(
        lppContractAddress,
        newLenderWallet,
        '0',
        customFees.exec,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*0uusdc: invalid coins.*/);
  });

  test('the lender tries to burn more deposit than he owns - should produce an error', async () => {
    await sendInitExecuteFeeTokens(user1Wallet, lenderWallet.address as string);

    await user1Wallet.transferAmount(
      lenderWallet.address as string,
      [{ denom: lppDenom, amount: deposit }],
      customFees.transfer,
    );

    await leaseInstance.lenderDeposit(
      lppContractAddress,
      lenderWallet,
      customFees.exec,
      [{ denom: lppDenom, amount: deposit }],
    );
    await sendInitExecuteFeeTokens(user1Wallet, lenderWallet.address as string);

    const lenderDeposit = await leaseInstance.getLenderDeposit(
      lppContractAddress,
      lenderWallet.address as string,
    );

    await sendInitExecuteFeeTokens(user1Wallet, lenderWallet.address as string);

    const broadcastTx = () =>
      leaseInstance.burnDeposit(
        lppContractAddress,
        lenderWallet,
        (+lenderDeposit.balance + 1).toString(),
        customFees.exec,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*Insufficient balance.*/);
  });
});
