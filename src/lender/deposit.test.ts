import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import { customFees, NATIVE_MINIMAL_DENOM } from '../util/utils';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { sendInitExecuteFeeTokens } from '../util/transfer';

describe('Lender tests - Provide liquidity', () => {
  let user1Wallet: NolusWallet;
  let lenderWallet: NolusWallet;
  let lppDenom: string;
  let leaseInstance: NolusContracts.Lease;
  const lppContractAddress = process.env.LPP_ADDRESS as string;

  const deposit = '10000';

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    lenderWallet = await createWallet();

    const cosm = await NolusClient.getInstance().getCosmWasmClient();
    leaseInstance = new NolusContracts.Lease(cosm);

    const lppConfig = await leaseInstance.getLppConfig(lppContractAddress);
    lppDenom = lppConfig.lpn_symbol;
  });

  test('the successful provide liquidity scenario - should work as expected', async () => {
    const lppLiquidityBefore = await lenderWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    const priceMsg = { price: [] };
    const price = await lenderWallet.queryContractSmart(
      lppContractAddress,
      priceMsg,
    );
    console.log(price);

    console.log(await leaseInstance.getLppBalance(lppContractAddress));

    const lenderDepositBefore = await leaseInstance.getLenderDeposit(
      lppContractAddress,
      lenderWallet.address as string,
    );

    //  send some tokens to the lender
    // for the deposit and fees
    await user1Wallet.transferAmount(
      lenderWallet.address as string,
      [{ denom: lppDenom, amount: deposit }],
      customFees.transfer,
    );

    const lenderBalanceBefore = await lenderWallet.getBalance(
      lenderWallet.address as string,
      lppDenom,
    );

    await sendInitExecuteFeeTokens(user1Wallet, lenderWallet.address as string);

    console.log(deposit);
    await leaseInstance.lenderDeposit(
      lppContractAddress,
      lenderWallet,
      customFees.exec,
      [{ denom: lppDenom, amount: deposit }],
    );

    const lppLiquidityAfter = await lenderWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    const lppBalanceResponse = await leaseInstance.getLppBalance(
      lppContractAddress,
    );
    const lenderBalanceAfter = await lenderWallet.getBalance(
      lenderWallet.address as string,
      lppDenom,
    );

    const lenderDepositAfter = await leaseInstance.getLenderDeposit(
      lppContractAddress,
      lenderWallet.address as string,
    );
    console.log(lenderDepositAfter);
    console.log(lenderDepositBefore);

    expect(+lppLiquidityAfter.amount).toBe(
      +lppLiquidityBefore.amount + +deposit,
    );

    expect(+lppLiquidityAfter.amount).toBe(+lppBalanceResponse.balance.amount);

    expect(+lenderBalanceAfter.amount).toBe(
      +lenderBalanceBefore.amount - +deposit,
    );

    expect(+lenderDepositAfter.balance).toBe(
      +lenderDepositBefore.balance +
        Math.floor(
          (+deposit * +price.amount.amount) / +price.amount_quote.amount,
        ),
    );
  });

  test('the lender should be able to deposit more than once', async () => {
    const lppLiquidityBefore = await lenderWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    //  send some tokens to the lender
    // for the deposit and fees
    await user1Wallet.transferAmount(
      lenderWallet.address as string,
      [{ denom: lppDenom, amount: deposit }],
      customFees.transfer,
    );

    const lenderBalanceBefore = await lenderWallet.getBalance(
      lenderWallet.address as string,
      lppDenom,
    );

    await sendInitExecuteFeeTokens(user1Wallet, lenderWallet.address as string);

    await leaseInstance.lenderDeposit(
      lppContractAddress,
      lenderWallet,
      customFees.exec,
      [{ denom: lppDenom, amount: Math.floor(+deposit / 2).toString() }],
    );

    await sendInitExecuteFeeTokens(user1Wallet, lenderWallet.address as string);

    await leaseInstance.lenderDeposit(
      lppContractAddress,
      lenderWallet,
      customFees.exec,
      [{ denom: lppDenom, amount: Math.floor(+deposit / 2).toString() }],
    );

    const lppLiquidityAfter = await lenderWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    const lenderBalanceAfter = await lenderWallet.getBalance(
      lenderWallet.address as string,
      lppDenom,
    );

    expect(+lppLiquidityAfter.amount).toBe(
      +lppLiquidityBefore.amount + Math.floor(+deposit / 2) * 2,
    );

    expect(+lenderBalanceAfter.amount).toBe(
      +lenderBalanceBefore.amount - Math.floor(+deposit / 2) * 2,
    );
  });

  test('the lender tries to deposit unsuported lpp currency - should produce an error', async () => {
    const lppLiquidityBefore = await lenderWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    await user1Wallet.transferAmount(
      lenderWallet.address as string,
      [{ denom: NATIVE_MINIMAL_DENOM, amount: deposit }],
      customFees.transfer,
    );

    await sendInitExecuteFeeTokens(user1Wallet, lenderWallet.address as string);

    const depositResult = () =>
      leaseInstance.lenderDeposit(
        lppContractAddress,
        lenderWallet,
        customFees.exec,
        [{ denom: NATIVE_MINIMAL_DENOM, amount: deposit }],
      );

    await expect(depositResult).rejects.toThrow(
      /^.*Found currency unls expecting uusdc.*/,
    );
    const lppLiquidityAfter = await lenderWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    expect(lppLiquidityAfter.amount).toBe(lppLiquidityBefore.amount);
  });

  test('the lender tries to deposit more amount than he owns - should produce an error', async () => {
    const lppLiquidityBefore = await lenderWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    await user1Wallet.transferAmount(
      lenderWallet.address as string,
      [{ denom: lppDenom, amount: deposit }],
      customFees.transfer,
    );

    await sendInitExecuteFeeTokens(user1Wallet, lenderWallet.address as string);

    const lenderBalanceBefore = await lenderWallet.getBalance(
      lenderWallet.address as string,
      lppDenom,
    );

    const depositResult = () =>
      leaseInstance.lenderDeposit(
        lppContractAddress,
        lenderWallet,
        customFees.exec,
        [
          {
            denom: lppDenom,
            amount: (+lenderBalanceBefore.amount + 1).toString(),
          },
        ],
      );
    await expect(depositResult).rejects.toThrow(/^.*insufficient funds.*/);

    const lppLiquidityAfter = await lenderWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    const lenderBalanceAfter = await lenderWallet.getBalance(
      lenderWallet.address as string,
      lppDenom,
    );

    expect(lppLiquidityAfter.amount).toBe(lppLiquidityBefore.amount);

    expect(lenderBalanceBefore.amount).toBe(lenderBalanceAfter.amount);
  });

  test('the lender tries to deposit 0 amount - should produce an error', async () => {
    const lppLiquidityBefore = await lenderWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    await sendInitExecuteFeeTokens(user1Wallet, lenderWallet.address as string);

    const depositResult = () =>
      leaseInstance.lenderDeposit(
        lppContractAddress,
        lenderWallet,
        customFees.exec,
        [{ denom: lppDenom, amount: '0' }],
      );
    await expect(depositResult).rejects.toThrow(/^.*invalid coins.*/);

    const lppLiquidityAfter = await lenderWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    expect(+lppLiquidityAfter.amount).toBe(+lppLiquidityBefore.amount);
  });
});
