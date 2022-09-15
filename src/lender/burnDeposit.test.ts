import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import { customFees, NATIVE_MINIMAL_DENOM } from '../util/utils';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import { NLPNS_To_LPNS } from '../util/smart-contracts';

describe('Lender tests - Burn deposit', () => {
  let feederWallet: NolusWallet;
  let lenderWallet: NolusWallet;
  let lppDenom: string;
  let lppInstance: NolusContracts.Lpp;
  const lppContractAddress = process.env.LPP_ADDRESS as string;

  const deposit = '1000000';

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    feederWallet = await getUser1Wallet();
    lenderWallet = await createWallet();

    const cosm = await NolusClient.getInstance().getCosmWasmClient();
    lppInstance = new NolusContracts.Lpp(cosm);

    const lppConfig = await lppInstance.getLppConfig(lppContractAddress);
    lppDenom = lppConfig.lpn_symbol;
  });

  test('the successful burn rewards scenario - should work as expected', async () => {
    const rewards = { amount: '20000000000', denom: NATIVE_MINIMAL_DENOM };

    await feederWallet.transferAmount(
      lenderWallet.address as string,
      [{ denom: lppDenom, amount: deposit }],
      customFees.transfer,
    );

    await sendInitExecuteFeeTokens(
      feederWallet,
      lenderWallet.address as string,
    );

    const lppBalance = await lppInstance.getLppBalance(lppContractAddress);

    // if the total depositors balance_nlpn==0 lpp returns err, because otherwise funds are frozen in the contract
    if (BigInt(lppBalance.balance_nlpn.amount) === BigInt(0)) {
      console.log('No deposits.');
      const broadcastTx = () =>
        lppInstance.distributeRewards(
          lppContractAddress,
          feederWallet,
          customFees.exec,
          [rewards],
        );

      await expect(broadcastTx).rejects.toThrow(
        /^.*Distribute rewards with zero balance nlpn.*/,
      );
    }

    await lppInstance.lenderDeposit(
      lppContractAddress,
      lenderWallet,
      customFees.exec,
      [{ denom: lppDenom, amount: deposit }],
    );

    const lenderBalanceBeforeFirstBurn = await lenderWallet.getBalance(
      lenderWallet.address as string,
      lppDenom,
    );

    const lenderNativeBalanceBeforeFirstBurn = await lenderWallet.getBalance(
      lenderWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    const lenderDepositBeforeFirstBurn = await lppInstance.getLenderDeposit(
      lppContractAddress,
      lenderWallet.address as string,
    );

    // burn part of the deposit amount

    // provide rewards
    await lppInstance.distributeRewards(
      lppContractAddress,
      feederWallet,
      customFees.exec,
      [rewards],
    );

    const lenderRewardsBeforeFirstBurn = await lppInstance.getLenderRewards(
      lppContractAddress,
      lenderWallet.address as string,
    );
    expect(lenderRewardsBeforeFirstBurn.rewards.amount).not.toBe('0');

    const burnAmount = (
      BigInt(lenderDepositBeforeFirstBurn.balance) / BigInt(2)
    ).toString();

    const priceBeforeBurn = await lppInstance.getPrice(lppContractAddress);

    await sendInitExecuteFeeTokens(
      feederWallet,
      lenderWallet.address as string,
    );

    await lppInstance.burnDeposit(
      lppContractAddress,
      lenderWallet,
      burnAmount,
      customFees.exec,
    );

    const lenderDepositAfterFirstBurn = await lppInstance.getLenderDeposit(
      lppContractAddress,
      lenderWallet.address as string,
    );

    const lenderBalanceAfterFirstBurn = await lenderWallet.getBalance(
      lenderWallet.address as string,
      lppDenom,
    );

    const lenderNativeBalanceAfterFirstBurn = await lenderWallet.getBalance(
      lenderWallet.address as string,
      NATIVE_MINIMAL_DENOM,
    );

    const lenderRewardsAfterFirstBurn = await lppInstance.getLenderRewards(
      lppContractAddress,
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

    // the rewards should be the same
    expect(lenderRewardsBeforeFirstBurn.rewards.amount).toBe(
      lenderRewardsAfterFirstBurn.rewards.amount,
    );

    // burn all deposit

    await sendInitExecuteFeeTokens(
      feederWallet,
      lenderWallet.address as string,
    );
    const priceBeforeSecondBurn = await lppInstance.getPrice(
      lppContractAddress,
    );

    await lppInstance.burnDeposit(
      lppContractAddress,
      lenderWallet,
      lenderDepositAfterFirstBurn.balance,
      customFees.exec,
    );

    const lenderDepositAfterSecondBurn = await lppInstance.getLenderDeposit(
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
      lppInstance.getLenderRewards(
        lppContractAddress,
        lenderWallet.address as string,
      );
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

  test('the non-lender user tries to burn deposit - should produce an error', async () => {
    await lppInstance.lenderDeposit(
      lppContractAddress,
      feederWallet,
      customFees.exec,
      [{ denom: lppDenom, amount: deposit }],
    );

    const newLenderWallet = await createWallet();

    await sendInitExecuteFeeTokens(
      feederWallet,
      newLenderWallet.address as string,
    );

    const broadcastTx = () =>
      lppInstance.burnDeposit(
        lppContractAddress,
        newLenderWallet,
        '10', // any amount
        customFees.exec,
      );

    await expect(broadcastTx).rejects.toThrow(
      /^.*The deposit does not exist.*/,
    );
  });

  test('the lender user tries to burn 0 deposit - should produce an error', async () => {
    const newLenderWallet = await createWallet();

    await feederWallet.transferAmount(
      newLenderWallet.address as string,
      [{ denom: lppDenom, amount: deposit }],
      customFees.transfer,
    );

    await sendInitExecuteFeeTokens(
      feederWallet,
      newLenderWallet.address as string,
    );

    await lppInstance.lenderDeposit(
      lppContractAddress,
      newLenderWallet,
      customFees.exec,
      [{ denom: lppDenom, amount: deposit }],
    );

    await sendInitExecuteFeeTokens(
      feederWallet,
      newLenderWallet.address as string,
    );

    const broadcastTx = () =>
      lppInstance.burnDeposit(
        lppContractAddress,
        newLenderWallet,
        '0',
        customFees.exec,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*Zero withdraw amount.*/);
  });

  test('the lender tries to burn more deposit than he owns - should produce an error', async () => {
    await sendInitExecuteFeeTokens(
      feederWallet,
      lenderWallet.address as string,
    );

    await feederWallet.transferAmount(
      lenderWallet.address as string,
      [{ denom: lppDenom, amount: deposit }],
      customFees.transfer,
    );

    await lppInstance.lenderDeposit(
      lppContractAddress,
      lenderWallet,
      customFees.exec,
      [{ denom: lppDenom, amount: deposit }],
    );
    await sendInitExecuteFeeTokens(
      feederWallet,
      lenderWallet.address as string,
    );

    const lenderDeposit = await lppInstance.getLenderDeposit(
      lppContractAddress,
      lenderWallet.address as string,
    );

    await sendInitExecuteFeeTokens(
      feederWallet,
      lenderWallet.address as string,
    );

    const broadcastTx = () =>
      lppInstance.burnDeposit(
        lppContractAddress,
        lenderWallet,
        (BigInt(lenderDeposit.balance) + BigInt(1)).toString(),
        customFees.exec,
      );

    await expect(broadcastTx).rejects.toThrow(/^.*Insufficient balance.*/);
  });
});
