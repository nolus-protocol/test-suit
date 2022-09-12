import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import {
  customFees,
  NATIVE_MINIMAL_DENOM,
  sleep,
  undefinedHandler,
} from '../util/utils';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { sendInitExecuteFeeTokens } from '../util/transfer';

describe('Lender tests - Make deposit', () => {
  let user1Wallet: NolusWallet;
  let lenderWallet: NolusWallet;
  let lppDenom: string;
  let lppInstance: NolusContracts.Lpp;
  let leaserInstance: NolusContracts.Leaser;
  let leaseInstance: NolusContracts.Lease;
  const lppContractAddress = process.env.LPP_ADDRESS as string;
  const leaserContractAddress = process.env.LEASER_ADDRESS as string;

  const deposit = '100000';
  const downpayment = '10000000000';

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    lenderWallet = await createWallet();

    const cosm = await NolusClient.getInstance().getCosmWasmClient();
    lppInstance = new NolusContracts.Lpp(cosm);
    leaserInstance = new NolusContracts.Leaser(cosm);
    leaseInstance = new NolusContracts.Lease(cosm);

    const lppConfig = await lppInstance.getLppConfig(lppContractAddress);
    lppDenom = lppConfig.lpn_symbol;
  });

  test('the successful provide liquidity scenario - should work as expected', async () => {
    const lppLiquidityBefore = await lenderWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    const lppBalanceBeginning = await lppInstance.getLppBalance(
      lppContractAddress,
    );

    const price = await lppInstance.getPrice(lppContractAddress);

    if (+lppLiquidityBefore.amount === 0) {
      expect(price.amount.amount).toBe('1');
      expect(price.amount_quote.amount).toBe('1');
    } else {
      // a/b === c/d if a*d == b*c
      expect(
        +price.amount_quote.amount * +lppBalanceBeginning.balance_nlpn.amount,
      ).toBe(
        (+lppBalanceBeginning.balance.amount +
          +lppBalanceBeginning.total_principal_due.amount +
          +lppBalanceBeginning.total_interest_due.amount) *
          +price.amount.amount,
      );
    }

    const lenderDepositBefore = await lppInstance.getLenderDeposit(
      lppContractAddress,
      lenderWallet.address as string,
    );

    await user1Wallet.transferAmount(
      lenderWallet.address as string,
      [{ denom: lppDenom, amount: (+downpayment * 2).toString() }],
      customFees.transfer,
    );

    const lenderBalanceBefore = await lenderWallet.getBalance(
      lenderWallet.address as string,
      lppDenom,
    );

    await sendInitExecuteFeeTokens(user1Wallet, lenderWallet.address as string);

    await lppInstance.lenderDeposit(
      lppContractAddress,
      lenderWallet,
      customFees.exec,
      [{ denom: lppDenom, amount: (+downpayment * 2).toString() }],
    );

    const lppLiquidityAfter = await lenderWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    const lppBalanceResponse = await lppInstance.getLppBalance(
      lppContractAddress,
    );

    const lenderBalanceAfter = await lenderWallet.getBalance(
      lenderWallet.address as string,
      lppDenom,
    );

    const lenderDepositAfter = await lppInstance.getLenderDeposit(
      lppContractAddress,
      lenderWallet.address as string,
    );

    expect(+lppLiquidityAfter.amount).toBe(
      +lppLiquidityBefore.amount + +downpayment * 2,
    );

    expect(+lppLiquidityAfter.amount).toBe(+lppBalanceResponse.balance.amount);

    expect(+lenderBalanceAfter.amount).toBe(
      +lenderBalanceBefore.amount - +downpayment * 2,
    );

    console.log(
      lenderDepositBefore.balance,
      downpayment,
      price.amount.amount,
      price.amount_quote.amount,
      price,
    );

    expect(+lenderDepositAfter.balance).toBe(
      +lenderDepositBefore.balance +
        Math.trunc(
          +downpayment *
            2 *
            (+price.amount.amount / +price.amount_quote.amount),
        ),
    );

    const result = await leaserInstance.openLease(
      leaserContractAddress,
      user1Wallet,
      lppDenom,
      customFees.exec,
      [{ denom: lppDenom, amount: downpayment }],
    );

    const leaseAddr = result.logs[0].events[7].attributes[3].value;
    expect(leaseAddr).not.toBe('');

    // wait for interest
    const secsToWait = 10;
    await sleep(secsToWait);

    const currentLeaseState = await leaseInstance.getLeaseStatus(leaseAddr);

    await user1Wallet.transferAmount(
      lenderWallet.address as string,
      [{ denom: lppDenom, amount: deposit }],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(user1Wallet, lenderWallet.address as string);

    const lppBalanceAfterLeaseOpen = await lppInstance.getLppBalance(
      lppContractAddress,
    );

    const priceImediatAfterLeaseOpening = await lppInstance.getPrice(
      lppContractAddress,
    );

    // a/b === c/d if a*d == b*c
    expect(
      +priceImediatAfterLeaseOpening.amount_quote.amount *
        +lppBalanceAfterLeaseOpen.balance_nlpn.amount,
    ).toBe(
      (+lppBalanceAfterLeaseOpen.balance.amount +
        +lppBalanceAfterLeaseOpen.total_principal_due.amount +
        +lppBalanceAfterLeaseOpen.total_interest_due.amount) *
        +priceImediatAfterLeaseOpening.amount.amount,
    );

    await lppInstance.lenderDeposit(
      lppContractAddress,
      lenderWallet,
      customFees.exec,
      [{ denom: lppDenom, amount: deposit }],
    );

    const priceAfterLeaseOpening = await lppInstance.getPrice(
      lppContractAddress,
    );

    const lppLiquidityAfterLeaseOpening = await lenderWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    const lenderDepositAfterLeaseOpening = await lppInstance.getLenderDeposit(
      lppContractAddress,
      lenderWallet.address as string,
    );

    const borrowAmount = currentLeaseState.opened?.amount.amount;

    if (!borrowAmount) {
      undefinedHandler();
      return;
    }

    expect(+lppLiquidityAfterLeaseOpening.amount).toBe(
      +lppLiquidityAfter.amount - +borrowAmount + +downpayment + +deposit,
    );
    expect(+lenderDepositAfterLeaseOpening.balance).toBe(
      +lenderDepositAfter.balance +
        Math.trunc(
          +deposit *
            (+priceAfterLeaseOpening.amount.amount /
              +priceAfterLeaseOpening.amount_quote.amount),
        ),
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
      lppInstance.lenderDeposit(
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
      lppInstance.lenderDeposit(
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
      lppInstance.lenderDeposit(
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

  test('the lender tries not to send funds when calling "deposit" - should produce an error', async () => {
    const lppLiquidityBefore = await lenderWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    await sendInitExecuteFeeTokens(user1Wallet, lenderWallet.address as string);

    const depositResult = () =>
      lppInstance.lenderDeposit(
        lppContractAddress,
        lenderWallet,
        customFees.exec,
      );
    await expect(depositResult).rejects.toThrow(
      /^.* Expecting funds of uusdc but found none.*/,
    );

    const lppLiquidityAfter = await lenderWallet.getBalance(
      lppContractAddress,
      lppDenom,
    );

    expect(+lppLiquidityAfter.amount).toBe(+lppLiquidityBefore.amount);
  });
});
