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
  getLeaseAddressFromOpenLeaseResponse,
  LPNS_To_NLPNS,
} from '../util/smart-contracts';
import { LppBalance, Price } from '@nolus/nolusjs/build/contracts/types';
import { runOrSkip } from '../util/testingRules';

runOrSkip(process.env.TEST_LENDER as string)(
  'Lender tests - Make deposit',
  () => {
    let feederWallet: NolusWallet;
    let lenderWallet: NolusWallet;
    let lppDenom: string;
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
        lppDenom,
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
          symbol: symbol,
        },
        amount_quote: {
          amount: totalLPNinLPP.toString(),
          symbol: lppDenom,
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
      lppDenom = lppConfig.lpn_symbol;
    });

    test('the successful provide liquidity scenario - should work as expected', async () => {
      const lppLiquidityBefore = await cosm.getBalance(
        lppContractAddress,
        lppDenom,
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
        [{ denom: lppDenom, amount: deposit.toString() }],
        customFees.transfer,
      );

      const lenderBalanceBefore = await lenderWallet.getBalance(
        lenderWallet.address as string,
        lppDenom,
      );

      await sendInitExecuteFeeTokens(
        feederWallet,
        lenderWallet.address as string,
      );

      const lppBalanceImmediatlyBeforeDeposit =
        await lppInstance.getLppBalance();
      const priceImmediatlyBeforeDeposit = await lppInstance.getPrice();

      await lppInstance.deposit(lenderWallet, customFees.exec, [
        { denom: lppDenom, amount: deposit.toString() },
      ]);

      const lppBalanceImmediatlyAfterDeposit =
        await lppInstance.getLppBalance();

      // define a price where only the total LPN value changes
      const customPriceAfterDeposit = getCustomPrice(
        lppBalanceImmediatlyBeforeDeposit,
        lppBalanceImmediatlyAfterDeposit,
        priceImmediatlyBeforeDeposit.amount.symbol,
      );

      const lppLiquidityAfterDeposit = await cosm.getBalance(
        lppContractAddress,
        lppDenom,
      );

      const lppBalanceResponse = await lppInstance.getLppBalance();

      const lenderBalanceAfter = await lenderWallet.getBalance(
        lenderWallet.address as string,
        lppDenom,
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
      const result = await leaserInstance.openLease(
        feederWallet,
        lppDenom,
        customFees.exec,
        [{ denom: lppDenom, amount: downpayment }],
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
        [{ denom: lppDenom, amount: deposit.toString() }],
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
        { denom: lppDenom, amount: deposit.toString() },
      ]);

      const lppBalanceImmediatlyAfterSecondDeposit =
        await lppInstance.getLppBalance();

      const customPriceAfterSecondDeposit = getCustomPrice(
        lppBalanceImmediatlyBeforeSecondDeposit,
        lppBalanceImmediatlyAfterSecondDeposit,
        priceImmediatlyBeforeDeposit.amount.symbol,
      );

      const lppLiquidityAfterLeaseOpening = await cosm.getBalance(
        lppContractAddress,
        lppDenom,
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

    test('the lender tries to deposit unsuported lpp currency - should produce an error', async () => {
      const lppLiquidityBefore = await cosm.getBalance(
        lppContractAddress,
        lppDenom,
      );
      const invalidLppDenom = NATIVE_MINIMAL_DENOM;

      await feederWallet.transferAmount(
        lenderWallet.address as string,
        [{ denom: invalidLppDenom, amount: deposit }],
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
        `Found currency '${invalidLppDenom}' expecting '${lppDenom}'`,
      );

      await verifyLppBalance(lppLiquidityBefore.amount);
    });

    test('the lender tries to deposit more amount than he owns - should produce an error', async () => {
      const lppLiquidityBefore = await cosm.getBalance(
        lppContractAddress,
        lppDenom,
      );

      await feederWallet.transferAmount(
        lenderWallet.address as string,
        [{ denom: lppDenom, amount: deposit }],
        customFees.transfer,
      );

      await sendInitExecuteFeeTokens(
        feederWallet,
        lenderWallet.address as string,
      );

      const lenderBalanceBefore = await lenderWallet.getBalance(
        lenderWallet.address as string,
        lppDenom,
      );

      const depositResult = () =>
        lppInstance.deposit(lenderWallet, customFees.exec, [
          {
            denom: lppDenom,
            amount: (BigInt(lenderBalanceBefore.amount) + BigInt(1)).toString(),
          },
        ]);
      await expect(depositResult).rejects.toThrow(/^.*insufficient funds.*/);

      const lenderBalanceAfter = await lenderWallet.getBalance(
        lenderWallet.address as string,
        lppDenom,
      );

      expect(lenderBalanceBefore.amount).toBe(lenderBalanceAfter.amount);

      await verifyLppBalance(lppLiquidityBefore.amount);
    });

    test('the lender tries to deposit 0 amount - should produce an error', async () => {
      const lppLiquidityBefore = await cosm.getBalance(
        lppContractAddress,
        lppDenom,
      );

      await sendInitExecuteFeeTokens(
        feederWallet,
        lenderWallet.address as string,
      );

      const depositResult = () =>
        lppInstance.deposit(lenderWallet, customFees.exec, [
          { denom: lppDenom, amount: '0' },
        ]);
      await expect(depositResult).rejects.toThrow(/^.*invalid coins.*/);

      await verifyLppBalance(lppLiquidityBefore.amount);
    });

    test('the lender tries not to send funds when calling "deposit" - should produce an error', async () => {
      const lppLiquidityBefore = await cosm.getBalance(
        lppContractAddress,
        lppDenom,
      );

      await sendInitExecuteFeeTokens(
        feederWallet,
        lenderWallet.address as string,
      );

      const depositResult = () =>
        lppInstance.deposit(lenderWallet, customFees.exec);
      await expect(depositResult).rejects.toThrow(
        `Expecting funds of ${lppDenom} but found none`,
      );

      await verifyLppBalance(lppLiquidityBefore.amount);
    });
  },
);
