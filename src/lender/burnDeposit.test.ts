import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import { customFees } from '../util/utils';
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

    const lenderDepositBeforeBurn = await leaseInstance.getLenderDeposit(
      lppContractAddress,
      lenderWallet.address as string,
    );

    // burn part of the deposit amount
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

    expect(lenderDepositAfterSecondBurn.balance).toBe('0');

    expect(+lenderBalanceAfterSecondBurn.amount).toBe(
      +lenderBalanceAfterBurn.amount +
        Math.trunc(
          +lenderDepositAfterBurn.balance /
            (+priceBeforeSecondBurn.amount.amount /
              +priceBeforeSecondBurn.amount_quote.amount),
        ),
    );
  });

  test('the lender tries to burn 0 amount deposit - should produce an error', async () => {
    const newLenderWallet = await createWallet();

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

    await expect(broadcastTx).rejects.toThrow(/^.*invalid coins.*/);
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
