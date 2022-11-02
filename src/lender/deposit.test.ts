import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import {
  customFees,
  NATIVE_MINIMAL_DENOM,
  sleep,
  undefinedHandler,
} from '../util/utils';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import {
  currencyTicker_To_IBC,
  LPNS_To_NLPNS,
} from '../util/smart-contracts/calculations';
import { LppBalance, Price } from '@nolus/nolusjs/build/contracts/types';
import { runOrSkip } from '../util/testingRules';
import { getLeaseAddressFromOpenLeaseResponse } from '../util/smart-contracts/getters';

runOrSkip(process.env.TEST_LENDER as string)(
  'Lender tests - Make deposit',
  () => {
    let feederWallet: NolusWallet;
    let lenderWallet: NolusWallet;
    let lppCurrency: string;
    let lppCurrencyToIBC: string;
    let lppInstance: NolusContracts.Lpp;
    let leaserInstance: NolusContracts.Leaser;
    const lppContractAddress = process.env.LPP_ADDRESS as string;
    const leaserContractAddress = process.env.LEASER_ADDRESS as string;
    let cosm: any;

    const deposit = '100000';
    const downpayment = '1000000000';

    async function verifyLppBalance(lppLiquidityBefore: string) {
      const lppLiquidityAfter = await cosm.getBalance(
        lppContractAddress,
        lppCurrency,
      );

      expect(lppLiquidityAfter.amount).toBe(lppLiquidityBefore);
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

      feederWallet = await getUser1Wallet();
      lenderWallet = await createWallet();

      lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);
      leaserInstance = new NolusContracts.Leaser(cosm, leaserContractAddress);

      const lppConfig = await lppInstance.getLppConfig();
      lppCurrency = lppConfig.lpn_ticker;
      lppCurrencyToIBC = currencyTicker_To_IBC(lppCurrency);
    });

    test('the successful provide liquidity scenario - should work as expected', async () => {
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

      const deposit = +downpayment * 2;

      await feederWallet.transferAmount(
        lenderWallet.address as string,
        [{ denom: lppCurrencyToIBC, amount: deposit.toString() }],
        customFees.transfer,
      );

      const lenderBalanceBefore = await lenderWallet.getBalance(
        lenderWallet.address as string,
        lppCurrencyToIBC,
      );

      await sendInitExecuteFeeTokens(
        feederWallet,
        lenderWallet.address as string,
      );

      const lppBalanceImmediatlyBeforeDeposit =
        await lppInstance.getLppBalance();
      const priceImmediatlyBeforeDeposit = await lppInstance.getPrice();

      await lppInstance.deposit(lenderWallet, customFees.exec, [
        { denom: lppCurrencyToIBC, amount: deposit.toString() },
      ]);

      const lppBalanceImmediatlyAfterDeposit =
        await lppInstance.getLppBalance();

      // define a price where only the total LPN value changes
      const customPriceAfterDeposit = getCustomPrice(
        lppBalanceImmediatlyBeforeDeposit,
        lppBalanceImmediatlyAfterDeposit,
        priceImmediatlyBeforeDeposit.amount.ticker,
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
        deposit,
        BigInt(lenderDepositBefore.balance),
        priceImmediatlyBeforeDeposit,
        customPriceAfterDeposit,
      );

      // try again if there is open leases and respectively interest
      // TO DO: multicurrency- choose from getLeaseCurrencies()
      const leaseCurrency = lppCurrency;
      const result = await leaserInstance.openLease(
        feederWallet,
        leaseCurrency,
        customFees.exec,
        [{ denom: lppCurrencyToIBC, amount: downpayment }],
      );

      const leaseAddr = getLeaseAddressFromOpenLeaseResponse(result);
      expect(leaseAddr).not.toBe('');

      // wait for interest
      const secsToWait = 10;
      await sleep(secsToWait);

      const leaseInstance = new NolusContracts.Lease(cosm, leaseAddr);
      const currentLeaseState = await leaseInstance.getLeaseStatus();

      await feederWallet.transferAmount(
        lenderWallet.address as string,
        [{ denom: lppCurrencyToIBC, amount: deposit.toString() }],
        customFees.transfer,
      );

      await sendInitExecuteFeeTokens(
        feederWallet,
        lenderWallet.address as string,
      );

      const lppBalanceImmediatlyBeforeSecondDeposit =
        await lppInstance.getLppBalance();
      const priceImmediatlyBeforeSecondDeposit = await lppInstance.getPrice();

      await lppInstance.deposit(lenderWallet, customFees.exec, [
        { denom: lppCurrencyToIBC, amount: deposit.toString() },
      ]);

      const lppBalanceImmediatlyAfterSecondDeposit =
        await lppInstance.getLppBalance();

      const customPriceAfterSecondDeposit = getCustomPrice(
        lppBalanceImmediatlyBeforeSecondDeposit,
        lppBalanceImmediatlyAfterSecondDeposit,
        priceImmediatlyBeforeDeposit.amount.ticker,
      );

      const lppLiquidityAfterLeaseOpening = await cosm.getBalance(
        lppContractAddress,
        lppCurrencyToIBC,
      );

      const borrowAmount = currentLeaseState.opened?.amount.amount;

      if (!borrowAmount) {
        undefinedHandler();
        return;
      }

      const lenderDepositAfterSecondDeposit =
        await lppInstance.getLenderDeposit(lenderWallet.address as string);

      expect(BigInt(lppLiquidityAfterLeaseOpening.amount)).toBe(
        BigInt(lppLiquidityAfterDeposit.amount) -
          BigInt(borrowAmount) +
          BigInt(downpayment) +
          BigInt(deposit),
      );

      verifyLenderNLPNBalance(
        BigInt(lenderDepositAfterSecondDeposit.balance),
        deposit,
        BigInt(lenderDepositAfter.balance),
        priceImmediatlyBeforeSecondDeposit,
        customPriceAfterSecondDeposit,
      );
    });

    test('the lender tries to deposit unsupported lpp currency - should produce an error', async () => {
      const lppLiquidityBefore = await cosm.getBalance(
        lppContractAddress,
        lppCurrency,
      );
      const invalidlppCurrency = NATIVE_MINIMAL_DENOM;

      await feederWallet.transferAmount(
        lenderWallet.address as string,
        [{ denom: invalidlppCurrency, amount: deposit }],
        customFees.transfer,
      );

      await sendInitExecuteFeeTokens(
        feederWallet,
        lenderWallet.address as string,
      );

      const depositResult = () =>
        lppInstance.deposit(lenderWallet, customFees.exec, [
          { denom: NATIVE_MINIMAL_DENOM, amount: deposit },
        ]);

      await expect(depositResult).rejects.toThrow(
        `Found bank symbol '${invalidlppCurrency}' expecting '${lppCurrencyToIBC}'`,
      );

      await verifyLppBalance(lppLiquidityBefore.amount);
    });

    test('the lender tries to deposit more amount than he owns - should produce an error', async () => {
      const lppLiquidityBefore = await cosm.getBalance(
        lppContractAddress,
        lppCurrency,
      );

      await feederWallet.transferAmount(
        lenderWallet.address as string,
        [{ denom: lppCurrency, amount: deposit }],
        customFees.transfer,
      );

      await sendInitExecuteFeeTokens(
        feederWallet,
        lenderWallet.address as string,
      );

      const lenderBalanceBefore = await lenderWallet.getBalance(
        lenderWallet.address as string,
        lppCurrency,
      );

      const depositResult = () =>
        lppInstance.deposit(lenderWallet, customFees.exec, [
          {
            denom: lppCurrency,
            amount: (BigInt(lenderBalanceBefore.amount) + BigInt(1)).toString(),
          },
        ]);
      await expect(depositResult).rejects.toThrow(/^.*insufficient funds.*/);

      const lenderBalanceAfter = await lenderWallet.getBalance(
        lenderWallet.address as string,
        lppCurrency,
      );

      expect(lenderBalanceBefore.amount).toBe(lenderBalanceAfter.amount);

      await verifyLppBalance(lppLiquidityBefore.amount);
    });

    test('the lender tries to deposit 0 amount - should produce an error', async () => {
      const lppLiquidityBefore = await cosm.getBalance(
        lppContractAddress,
        lppCurrency,
      );

      await sendInitExecuteFeeTokens(
        feederWallet,
        lenderWallet.address as string,
      );

      const depositResult = () =>
        lppInstance.deposit(lenderWallet, customFees.exec, [
          { denom: lppCurrency, amount: '0' },
        ]);
      await expect(depositResult).rejects.toThrow(/^.*invalid coins.*/);

      await verifyLppBalance(lppLiquidityBefore.amount);
    });

    test('the lender tries not to send funds when calling "deposit" msg - should produce an error', async () => {
      const lppLiquidityBefore = await cosm.getBalance(
        lppContractAddress,
        lppCurrency,
      );

      await sendInitExecuteFeeTokens(
        feederWallet,
        lenderWallet.address as string,
      );

      const depositResult = () =>
        lppInstance.deposit(lenderWallet, customFees.exec);
      await expect(depositResult).rejects.toThrow(
        `Expecting funds of ${lppCurrency} but found none`,
      );

      await verifyLppBalance(lppLiquidityBefore.amount);
    });
  },
);
