import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { LppBalance, Price } from '@nolus/nolusjs/build/contracts/types';
import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import {
  customFees,
  NATIVE_MINIMAL_DENOM,
  undefinedHandler,
} from '../util/utils';
import {
  calcFeeProfit,
  returnRestToMainAccount,
  sendInitExecuteFeeTokens,
} from '../util/transfer';
import {
  calcDepositCapacity,
  currencyTicker_To_IBC,
  LPNS_To_NLPNS,
} from '../util/smart-contracts/calculations';
import { ifLocal, runIfLenderDepositRestriction } from '../util/testingRules';

const maybe =
  (process.env.TEST_LENDER as string).toLowerCase() !== 'false' &&
  +(process.env.LENDER_DEPOSIT_CAPACITY as string) !== 0
    ? describe
    : describe.skip;

maybe('Lender tests - Make a deposit', () => {
  let cosm: CosmWasmClient;
  let userWithBalance: NolusWallet;
  let lenderWallet: NolusWallet;
  let lppInstance: NolusContracts.Lpp;
  let lppCurrency: string;
  let lppCurrencyToIBC: string;
  let deposit: string;

  const lppContractAddress = process.env.LPP_ADDRESS as string;

  async function testDepositInvalidCases(
    depositCurrency: string,
    depositAmount: string,
    errorMsg: string,
  ) {
    const deposit = { denom: depositCurrency, amount: depositAmount };

    const lppLiquidityBefore = await cosm.getBalance(
      lppContractAddress,
      lppCurrencyToIBC,
    );

    const lenderBalanceBefore = await lenderWallet.getBalance(
      lenderWallet.address as string,
      lppCurrencyToIBC,
    );

    const depositCapacity = await lppInstance.getDepositCapacity();

    if (!depositCapacity) {
      undefinedHandler();
      return;
    }

    if (
      +depositAmount > 0 &&
      (+depositAmount <= +lenderBalanceBefore.amount ||
        depositCurrency === NATIVE_MINIMAL_DENOM ||
        +depositAmount > depositCapacity?.amount)
    ) {
      await userWithBalance.transferAmount(
        lenderWallet.address as string,
        [deposit],
        customFees.transfer,
      );
    }

    await sendInitExecuteFeeTokens(
      userWithBalance,
      lenderWallet.address as string,
    );

    const depositResult = () =>
      lppInstance.deposit(lenderWallet, customFees.exec, [deposit]);

    await expect(depositResult).rejects.toThrow(errorMsg);

    const lenderBalanceAfter = await lenderWallet.getBalance(
      lenderWallet.address as string,
      lppCurrencyToIBC,
    );

    if (+depositAmount <= depositCapacity?.amount) {
      expect(lenderBalanceBefore.amount).toBe(lenderBalanceAfter.amount);
    }

    await verifyLppBalance(lppLiquidityBefore.amount);

    await returnRestToMainAccount(lenderWallet, lppCurrencyToIBC);
  }

  async function verifyLppBalance(lppLiquidityBefore: string) {
    const lppLiquidityAfter = await cosm.getBalance(
      lppContractAddress,
      lppCurrencyToIBC,
    );

    expect(lppLiquidityAfter.amount).toBe(lppLiquidityBefore);
  }

  async function burnDeposit() {
    const lenderDepositAfter = await lppInstance.getLenderDeposit(
      lenderWallet.address as string,
    );

    await sendInitExecuteFeeTokens(
      userWithBalance,
      lenderWallet.address as string,
    );

    await lppInstance.burnDeposit(
      lenderWallet,
      lenderDepositAfter.balance,
      customFees.exec,
    );

    await returnRestToMainAccount(lenderWallet, lppCurrencyToIBC);
  }

  function verifyPrice(price: Price, lppBalance: LppBalance): void {
    // a/b === c/d if a*d == b*c
    expect(
      BigInt(price.amount_quote.amount) *
        BigInt(lppBalance.balance_nlpn.amount),
    ).toBe(
      (BigInt(lppBalance.balance.amount) +
        BigInt(lppBalance.total_principal_due.amount) +
        BigInt(lppBalance.total_interest_due.amount)) *
        BigInt(price.amount.amount),
    );
  }

  function verifyLenderNLPNBalance(
    lppLenderDepositResponse: bigint,
    deposit: number,
    lenderDepositBefore: bigint,
    priceBeforeDeposit: Price,
    priceAfterDeposit: Price,
  ): void {
    expect(lppLenderDepositResponse).toBeLessThanOrEqual(
      lenderDepositBefore + LPNS_To_NLPNS(deposit, priceBeforeDeposit),
    );

    expect(lppLenderDepositResponse).toBeGreaterThanOrEqual(
      lenderDepositBefore + LPNS_To_NLPNS(deposit, priceAfterDeposit),
    );
  }

  function getCustomPrice(
    lppBalanceBeforeDeposit: LppBalance,
    lppBalanceAfterDeposit: LppBalance,
    symbol: string,
  ): Price {
    const totalLPNinLPP =
      BigInt(lppBalanceAfterDeposit.balance.amount) +
      BigInt(lppBalanceAfterDeposit.total_principal_due.amount) +
      BigInt(lppBalanceAfterDeposit.total_interest_due.amount);

    const customPriceAfterDeposit: Price = {
      amount: {
        amount: lppBalanceBeforeDeposit.balance_nlpn.amount,
        ticker: symbol,
      },
      amount_quote: {
        amount: totalLPNinLPP.toString(),
        ticker: lppCurrency,
      },
    };

    return customPriceAfterDeposit;
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
  });

  test('the successful liquidity provision scenario - should work as expected', async () => {
    const lppLiquidityBefore = await cosm.getBalance(
      lppContractAddress,
      lppCurrencyToIBC,
    );

    const lppBalanceBeginning = await lppInstance.getLppBalance();

    const price = await lppInstance.getPrice();

    if (BigInt(lppLiquidityBefore.amount) === BigInt(0)) {
      expect(price.amount.amount).toBe('1');
      expect(price.amount_quote.amount).toBe('1');
    } else {
      verifyPrice(price, lppBalanceBeginning);
    }

    const lenderDepositBefore = await lppInstance.getLenderDeposit(
      lenderWallet.address as string,
    );

    await userWithBalance.transferAmount(
      lenderWallet.address as string,
      [{ denom: lppCurrencyToIBC, amount: deposit }],
      customFees.transfer,
    );

    const lenderBalanceBefore = await lenderWallet.getBalance(
      lenderWallet.address as string,
      lppCurrencyToIBC,
    );

    await sendInitExecuteFeeTokens(
      userWithBalance,
      lenderWallet.address as string,
    );

    const lppBalanceImmediatlyBeforeDeposit = await lppInstance.getLppBalance();
    const priceImmediatlyBeforeDeposit = await lppInstance.getPrice();

    await lppInstance.deposit(lenderWallet, customFees.exec, [
      { denom: lppCurrencyToIBC, amount: deposit },
    ]);

    const lppBalanceImmediatlyAfterDeposit = await lppInstance.getLppBalance();

    const customPriceAfterDeposit = getCustomPrice(
      lppBalanceImmediatlyBeforeDeposit,
      lppBalanceImmediatlyAfterDeposit,
      lppCurrency,
    );

    const lppLiquidityAfterDeposit = await cosm.getBalance(
      lppContractAddress,
      lppCurrencyToIBC,
    );

    const lppBalanceResponse = await lppInstance.getLppBalance();

    const lenderBalanceAfter = await lenderWallet.getBalance(
      lenderWallet.address as string,
      lppCurrencyToIBC,
    );

    const lenderDepositAfter = await lppInstance.getLenderDeposit(
      lenderWallet.address as string,
    );

    expect(BigInt(lppLiquidityAfterDeposit.amount)).toBe(
      BigInt(lppLiquidityBefore.amount) + BigInt(deposit),
    );

    expect(BigInt(lppLiquidityAfterDeposit.amount)).toBe(
      BigInt(lppBalanceResponse.balance.amount),
    );

    expect(BigInt(lenderBalanceAfter.amount)).toBe(
      BigInt(lenderBalanceBefore.amount) - BigInt(deposit),
    );

    verifyLenderNLPNBalance(
      BigInt(lenderDepositAfter.balance),
      +deposit,
      BigInt(lenderDepositBefore.balance),
      priceImmediatlyBeforeDeposit,
      customPriceAfterDeposit,
    );

    await burnDeposit();
  });

  test('a lender tries to make a deposit in an unsupported lpp currency - should produce an error', async () => {
    const invalidlppCurrency = NATIVE_MINIMAL_DENOM;

    await testDepositInvalidCases(
      invalidlppCurrency,
      deposit,
      `Found a symbol '${invalidlppCurrency}' pretending to be the bank symbol of the currency with ticker '${lppCurrency}'`,
    );
  });

  test('a lender tries to deposit more amount than he owns - should produce an error', async () => {
    const lenderBalanceBefore = await lenderWallet.getBalance(
      lenderWallet.address as string,
      lppCurrencyToIBC,
    );

    await testDepositInvalidCases(
      lppCurrencyToIBC,
      (BigInt(lenderBalanceBefore.amount) + BigInt(1)).toString(),
      'insufficient funds',
    );
  });

  test('a lender tries to deposit 0 amount - should produce an error', async () => {
    await testDepositInvalidCases(lppCurrencyToIBC, '0', 'invalid coins');
  });

  test('a lender tries not to send funds when calling "deposit" msg - should produce an error', async () => {
    const lppLiquidityBefore = await cosm.getBalance(
      lppContractAddress,
      lppCurrencyToIBC,
    );

    await sendInitExecuteFeeTokens(
      userWithBalance,
      lenderWallet.address as string,
    );

    const depositResult = () =>
      lppInstance.deposit(lenderWallet, customFees.exec);
    await expect(depositResult).rejects.toThrow(
      `Expecting funds of ${lppCurrency} but found none`,
    );

    await verifyLppBalance(lppLiquidityBefore.amount);
  });

  runIfLenderDepositRestriction(
    'check that the deposit capacity is calculated correctly',
    async () => {
      const depositCapacity = await lppInstance.getDepositCapacity();
      const minUtilization = (await lppInstance.getLppConfig()).min_utilization;
      const lppBalance = await lppInstance.getLppBalance();

      if (!depositCapacity) {
        undefinedHandler();
        return;
      }

      expect(+depositCapacity.amount).toBe(
        calcDepositCapacity(minUtilization, lppBalance),
      );
    },
  );

  runIfLenderDepositRestriction(
    'a lender tries to deposit more than the capacity restriction value - should produce an error',
    async () => {
      const depositCapacity = await lppInstance.getDepositCapacity();

      if (!depositCapacity) {
        undefinedHandler();
        return;
      }

      const depositAmount = +depositCapacity.amount + 100;

      await testDepositInvalidCases(
        lppCurrencyToIBC,
        depositAmount.toString(),
        'Utilization is below the set minimal rate',
      );
    },
  );

  runIfLenderDepositRestriction(
    'a lender tries to deposit an amount equal to the value of the capacity restriction - should work as expected',
    async () => {
      const lppLiquidityBefore = await cosm.getBalance(
        lppContractAddress,
        lppCurrencyToIBC,
      );

      const depositCapacity = await lppInstance.getDepositCapacity();

      const userWitBalanceBalanceBefore = await userWithBalance.getBalance(
        userWithBalance.address as string,
        lppCurrencyToIBC,
      );

      if (!depositCapacity) {
        undefinedHandler();
        return;
      }

      const deposit = +depositCapacity.amount;

      expect(+userWitBalanceBalanceBefore.amount).toBeGreaterThan(deposit);

      await userWithBalance.transferAmount(
        lenderWallet.address as string,
        [{ denom: lppCurrencyToIBC, amount: deposit.toString() }],
        customFees.transfer,
      );

      await sendInitExecuteFeeTokens(
        userWithBalance,
        lenderWallet.address as string,
      );

      const treasuryAddress = process.env.TREASURY_ADDRESS as string;

      const treasuryBalanceBefore = await lenderWallet.getBalance(
        treasuryAddress,
        NATIVE_MINIMAL_DENOM,
      );

      await lppInstance.deposit(lenderWallet, customFees.exec, [
        { denom: lppCurrencyToIBC, amount: deposit.toString() },
      ]);

      const lppLiquidityAfter = await cosm.getBalance(
        lppContractAddress,
        lppCurrencyToIBC,
      );

      const treasuryBalanceAfter = await lenderWallet.getBalance(
        treasuryAddress,
        NATIVE_MINIMAL_DENOM,
      );

      if (ifLocal()) {
        expect(BigInt(treasuryBalanceAfter.amount)).toBe(
          BigInt(treasuryBalanceBefore.amount) +
            BigInt(calcFeeProfit(customFees.exec)),
        );
      }

      expect(BigInt(lppLiquidityAfter.amount)).toBe(
        BigInt(lppLiquidityBefore.amount) + BigInt(deposit),
      );

      const depositCapacityAfter = await lppInstance.getDepositCapacity();

      if (!depositCapacityAfter) {
        undefinedHandler();
        return;
      }

      expect(+depositCapacityAfter.amount).toBe(0);

      await sendInitExecuteFeeTokens(
        userWithBalance,
        lenderWallet.address as string,
      );

      await burnDeposit();

      const depositCapacityAfterDepositBurn =
        await lppInstance.getDepositCapacity();

      if (!depositCapacityAfterDepositBurn) {
        undefinedHandler();
        return;
      }

      expect(+depositCapacityAfterDepositBurn.amount).toBeGreaterThan(0);
    },
  );
});
