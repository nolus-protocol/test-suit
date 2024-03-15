import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import { Asset } from '@nolus/nolusjs/build/contracts';
import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import {
  customFees,
  defaultTip,
  noProvidedPriceFor,
  undefinedHandler,
} from '../util/utils';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import {
  getLeaseGroupCurrencies,
  getLeaseObligations,
} from '../util/smart-contracts/getters';
import { runOrSkip, runTestIfLocal } from '../util/testingRules';
import {
  calcMinAllowablePaymentAmount,
  openLease,
  returnAmountToTheMainAccount,
  waitLeaseInProgressToBeNull,
  waitLeaseOpeningProcess,
} from '../util/smart-contracts/actions/borrower';
import {
  currencyPriceObjToNumbers,
  currencyTicker_To_IBC,
} from '../util/smart-contracts/calculations';

runOrSkip(process.env.TEST_BORROWER as string)(
  'Borrower tests - Market Close',
  () => {
    let userWithBalanceWallet: NolusWallet;
    let borrowerWallet: NolusWallet;
    let lppCurrency: string;
    let lppCurrencyToIBC: string;
    let leaseCurrency: string;
    let leaseCurrencyToIBC: string;
    let downpaymentCurrency: string;
    let oracleInstance: NolusContracts.Oracle;
    let lppInstance: NolusContracts.Lpp;
    let leaserInstance: NolusContracts.Leaser;
    let leaseInstance: NolusContracts.Lease;
    let leaseAddress: string;
    let cosm: CosmWasmClient;
    let minSellAsset: number;
    let minAsset: number;

    const leaserContractAddress = process.env.LEASER_ADDRESS as string;
    const oracleContractAddress = process.env.ORACLE_ADDRESS as string;
    const lppContractAddress = process.env.LPP_ADDRESS as string;

    const downpayment = '100000';

    async function testMarketCloseInvalidCases(
      wallet: NolusWallet,
      errorMessage: string,
      leaseAmountBeforeMarketClose: Asset,
      amount?: Asset,
    ) {
      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        wallet.address as string,
      );

      const result = () =>
        leaseInstance.closePositionLease(wallet, customFees.exec, amount);

      await expect(result).rejects.toThrow(errorMessage);

      const leaseAmountAfterMarketClose = (await leaseInstance.getLeaseStatus())
        .opened?.amount;

      expect(leaseAmountAfterMarketClose?.amount).toBe(
        leaseAmountBeforeMarketClose.amount,
      );
    }

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      cosm = await NolusClient.getInstance().getCosmWasmClient();

      userWithBalanceWallet = await getUser1Wallet();
      borrowerWallet = await createWallet();

      oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);
      leaserInstance = new NolusContracts.Leaser(cosm, leaserContractAddress);
      lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);

      const lppConfig = await lppInstance.getLppConfig();
      lppCurrency = lppConfig.lpn_ticker;
      lppCurrencyToIBC = currencyTicker_To_IBC(lppCurrency);
      leaseCurrency = getLeaseGroupCurrencies()[0];
      leaseCurrencyToIBC = currencyTicker_To_IBC(leaseCurrency);
      downpaymentCurrency = lppCurrency;

      minSellAsset = +(await leaserInstance.getLeaserConfig()).config
        .lease_position_spec.min_transaction.amount;
      minAsset = +(await leaserInstance.getLeaserConfig()).config
        .lease_position_spec.min_asset.amount;

      leaseAddress = await openLease(
        leaserInstance,
        lppInstance,
        downpayment,
        downpaymentCurrency,
        leaseCurrency,
        borrowerWallet,
      );
      leaseInstance = new NolusContracts.Lease(cosm, leaseAddress);

      expect(await waitLeaseOpeningProcess(leaseInstance)).toBe(undefined);
    });

    test('an unauthorized user tries to close the position - should produce an error', async () => {
      const leaseAmountBeforeMarketClose = (
        await leaseInstance.getLeaseStatus()
      ).opened?.amount;

      if (!leaseAmountBeforeMarketClose) {
        undefinedHandler();
        return;
      }

      await testMarketCloseInvalidCases(
        userWithBalanceWallet,
        'Unauthorized access!',
        leaseAmountBeforeMarketClose,
        undefined,
      );
    });

    test('the borrower tries to close partially "0" amount from the position - should produce an error', async () => {
      const leaseAmountBeforePartialClose = (
        await leaseInstance.getLeaseStatus()
      ).opened?.amount;

      if (!leaseAmountBeforePartialClose) {
        undefinedHandler();
        return;
      }
      const amount = {
        amount: '0',
        ticker: leaseAmountBeforePartialClose.ticker,
      };

      await testMarketCloseInvalidCases(
        borrowerWallet,
        `The position close amount should worth at least ${minSellAsset} ${lppCurrency}`,
        leaseAmountBeforePartialClose,
        amount,
      );
    });

    test('the borrower tries to close partially the full amount from the position - should produce an error', async () => {
      const leaseAmountBeforePartialClose = (
        await leaseInstance.getLeaseStatus()
      ).opened?.amount;

      if (!leaseAmountBeforePartialClose) {
        undefinedHandler();
        return;
      }

      await testMarketCloseInvalidCases(
        borrowerWallet,
        `The position past this close should worth at least ${minAsset} ${lppCurrency}`,
        leaseAmountBeforePartialClose,
        leaseAmountBeforePartialClose,
      );
    });

    test('the borrower tries to close partially an amount greater than the position - should produce an error', async () => {
      const leaseAmountBeforePartialClose = (
        await leaseInstance.getLeaseStatus()
      ).opened?.amount;

      if (!leaseAmountBeforePartialClose) {
        undefinedHandler();
        return;
      }
      const amount = {
        amount: (+leaseAmountBeforePartialClose.amount + 1).toString(),
        ticker: leaseAmountBeforePartialClose.ticker,
      };

      await testMarketCloseInvalidCases(
        borrowerWallet,
        `The position past this close should worth at least ${minAsset} ${lppCurrency}`,
        leaseAmountBeforePartialClose,
        amount,
      );
    });

    test('the borrower tries to close partially by sending amount ticker != lease currency ticker - should produce an error', async () => {
      const leaseAmountBeforePartialClose = (
        await leaseInstance.getLeaseStatus()
      ).opened?.amount;

      if (!leaseAmountBeforePartialClose) {
        undefinedHandler();
        return;
      }

      const invalidLeaseTicker = lppCurrency;

      const amount = { amount: '1', ticker: invalidLeaseTicker };

      await testMarketCloseInvalidCases(
        borrowerWallet,
        `Found a symbol '${invalidLeaseTicker}' pretending to be ticker of a currency pertaining to the lease group`,
        leaseAmountBeforePartialClose,
        amount,
      );
    });

    runTestIfLocal(
      'the borrower tries to close partially by sending amount ticker = unsupported currency ticker - should produce an error',
      async () => {
        const leaseAmountBeforePartialClose = (
          await leaseInstance.getLeaseStatus()
        ).opened?.amount;

        if (!leaseAmountBeforePartialClose) {
          undefinedHandler();
          return;
        }
        const unsupportedCurrency = noProvidedPriceFor;

        const amount = { amount: '1', ticker: unsupportedCurrency };

        await testMarketCloseInvalidCases(
          borrowerWallet,
          `Found ticker '${unsupportedCurrency}' expecting '${leaseAmountBeforePartialClose.ticker}'`,
          leaseAmountBeforePartialClose,
          amount,
        );
      },
    );

    test('the borrower tries to close partially by sending amount < "min_sell_asset" - should produce an error', async () => {
      const leaseAmountBeforePartialClose = (
        await leaseInstance.getLeaseStatus()
      ).opened?.amount;

      if (!leaseAmountBeforePartialClose) {
        undefinedHandler();
        return;
      }

      const leaseCurrencyPriceObj =
        await oracleInstance.getPriceFor(leaseCurrency);
      const [
        minToleranceCurrencyPrice_LC,
        exactCurrencyPrice_LC,
        maxToleranceCurrencyPrice_LC,
      ] = currencyPriceObjToNumbers(leaseCurrencyPriceObj, 1);

      const amountToCloseValue = Math.trunc(
        (minSellAsset - 1) * minToleranceCurrencyPrice_LC,
      );

      const amount = {
        amount: amountToCloseValue.toString(),
        ticker: leaseCurrency,
      };

      await testMarketCloseInvalidCases(
        borrowerWallet,
        `The position close amount should worth at least ${minSellAsset} ${lppCurrency}`,
        leaseAmountBeforePartialClose,
        amount,
      );
    });

    test('the borrower tries to close partially after which the lease amount is below "min_asset"" - should produce an error', async () => {
      const leaseStateBeforePartialClose = (
        await leaseInstance.getLeaseStatus()
      ).opened;

      if (!leaseStateBeforePartialClose) {
        undefinedHandler();
        return;
      }

      const leaseAmountBeforeClose = leaseStateBeforePartialClose.amount;

      const leaseCurrencyPriceObj =
        await oracleInstance.getPriceFor(leaseCurrency);
      const [
        minToleranceCurrencyPrice_LC,
        exactCurrencyPrice_LC,
        maxToleranceCurrencyPrice_LC,
      ] = currencyPriceObjToNumbers(leaseCurrencyPriceObj, 1);

      const minLeaseAmountLC = minAsset * maxToleranceCurrencyPrice_LC;
      const amountToCloseValue = Math.trunc(
        +leaseAmountBeforeClose.amount - minLeaseAmountLC / 2,
      );

      const amount = {
        amount: amountToCloseValue.toString(),
        ticker: leaseCurrency,
      };

      await testMarketCloseInvalidCases(
        borrowerWallet,
        `The position past this close should worth at least ${minAsset} ${lppCurrency}`,
        leaseAmountBeforeClose,
        amount,
      );
    });

    test('the borrower tries to close partially - should work as expected', async () => {
      const leaseStateBeforePartialClose = (
        await leaseInstance.getLeaseStatus()
      ).opened;

      if (!leaseStateBeforePartialClose) {
        undefinedHandler();
        return;
      }

      const leaseObligationsBeforePartialClose = getLeaseObligations(
        leaseStateBeforePartialClose,
        true,
      );

      if (!leaseObligationsBeforePartialClose) {
        undefinedHandler();
        return;
      }

      const borrowerBalanceBeforeLPN = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        lppCurrencyToIBC,
      );

      const borrowerBalanceBeforeLC = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        leaseCurrencyToIBC,
      );

      await userWithBalanceWallet.transferAmount(
        borrowerWallet.address as string,
        [defaultTip],
        customFees.transfer,
      );
      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );

      const leaseCurrencyPriceObj =
        await oracleInstance.getPriceFor(leaseCurrency);
      const [
        minToleranceCurrencyPrice_LC,
        exactCurrencyPrice_LC,
        maxToleranceCurrencyPrice_LC,
      ] = currencyPriceObjToNumbers(leaseCurrencyPriceObj, 1);

      const amountToCloseValue = await calcMinAllowablePaymentAmount(
        leaserInstance,
        oracleInstance,
        leaseCurrency,
        '10000',
      );

      const closedAmountToLPN_min = Math.trunc(
        +amountToCloseValue / minToleranceCurrencyPrice_LC,
      );
      const closedAmountToLPN_max = Math.trunc(
        +amountToCloseValue / maxToleranceCurrencyPrice_LC,
      );

      const amountToClose = {
        amount: amountToCloseValue.toString(),
        ticker: leaseCurrency,
      };

      await leaseInstance.closePositionLease(
        borrowerWallet,
        customFees.exec,
        amountToClose,
        [defaultTip],
      );
      expect(await waitLeaseInProgressToBeNull(leaseInstance)).toBe(undefined);

      const leaseStateAfterPartialClose = (await leaseInstance.getLeaseStatus())
        .opened;

      if (!leaseStateAfterPartialClose) {
        undefinedHandler();
        return;
      }

      expect(leaseStateAfterPartialClose).toBeDefined();

      const leaseObligationsAfterPartialClose = getLeaseObligations(
        leaseStateAfterPartialClose,
        true,
      );

      if (!leaseObligationsAfterPartialClose) {
        undefinedHandler();
        return;
      }

      expect(+leaseStateAfterPartialClose.amount.amount).toBe(
        +leaseStateBeforePartialClose.amount.amount - +amountToCloseValue,
      );

      expect(BigInt(leaseObligationsAfterPartialClose)).toBeGreaterThanOrEqual(
        BigInt(leaseObligationsBeforePartialClose) -
          BigInt(closedAmountToLPN_min),
      );

      expect(BigInt(leaseObligationsAfterPartialClose)).toBeLessThanOrEqual(
        BigInt(leaseObligationsBeforePartialClose) -
          BigInt(closedAmountToLPN_max),
      );

      const borrowerBalanceAfterLPN = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        lppCurrencyToIBC,
      );
      expect(borrowerBalanceAfterLPN.amount).toBe(
        borrowerBalanceBeforeLPN.amount,
      );

      const borrowerBalanceAfterLC = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        leaseCurrencyToIBC,
      );
      expect(borrowerBalanceAfterLC.amount).toBe(
        borrowerBalanceBeforeLC.amount,
      );

      await returnAmountToTheMainAccount(borrowerWallet, leaseCurrencyToIBC);
      await returnAmountToTheMainAccount(borrowerWallet, lppCurrencyToIBC);
    });

    test('the borrower tries to close partially by sending an amount which covers the obligations - should work as expected', async () => {
      const leaseStateBeforePartialClose = (
        await leaseInstance.getLeaseStatus()
      ).opened;

      if (!leaseStateBeforePartialClose) {
        undefinedHandler();
        return;
      }

      const leaseAmountBeforePartialClose = leaseStateBeforePartialClose.amount;

      const leaseObligationsBeforePartialClose = getLeaseObligations(
        leaseStateBeforePartialClose,
        true,
      );

      if (!leaseObligationsBeforePartialClose) {
        undefinedHandler();
        return;
      }

      const borrowerBalanceBeforeLPN = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        lppCurrencyToIBC,
      );

      const borrowerBalanceBeforeLC = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        leaseCurrencyToIBC,
      );

      await userWithBalanceWallet.transferAmount(
        borrowerWallet.address as string,
        [defaultTip],
        customFees.transfer,
      );
      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );

      const leaseCurrencyPriceObj =
        await oracleInstance.getPriceFor(leaseCurrency);

      const [
        minToleranceCurrencyPrice_LC,
        exactCurrencyPrice_LC,
        maxToleranceCurrencyPrice_LC,
      ] = currencyPriceObjToNumbers(leaseCurrencyPriceObj, 1);

      const amountToCloseValue = Math.max(
        minSellAsset,
        Math.floor(
          leaseObligationsBeforePartialClose * maxToleranceCurrencyPrice_LC,
        ),
      );

      const closedAmountToLPN_min = Math.trunc(
        +amountToCloseValue / minToleranceCurrencyPrice_LC,
      );

      const closedAmountToLPN_max = Math.trunc(
        +amountToCloseValue / maxToleranceCurrencyPrice_LC,
      );

      const amountToClose = {
        amount: amountToCloseValue.toString(),
        ticker: leaseAmountBeforePartialClose.ticker,
      };

      await leaseInstance.closePositionLease(
        borrowerWallet,
        customFees.exec,
        amountToClose,
        [defaultTip],
      );
      expect(await waitLeaseInProgressToBeNull(leaseInstance)).toBe(undefined);

      const leaseStateAfterPartialClose = await leaseInstance.getLeaseStatus();

      expect(leaseStateAfterPartialClose.paid).toBeDefined();

      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );

      await userWithBalanceWallet.transferAmount(
        borrowerWallet.address as string,
        [defaultTip],
        customFees.transfer,
      );

      await leaseInstance.closeLease(borrowerWallet, customFees.exec, [
        defaultTip,
      ]);
      expect(await waitLeaseInProgressToBeNull(leaseInstance)).toBe(undefined);

      const borrowerBalanceAfterLC = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        leaseCurrencyToIBC,
      );

      expect(+borrowerBalanceAfterLC.amount).toBe(
        +borrowerBalanceBeforeLC.amount +
          (+leaseAmountBeforePartialClose.amount - amountToCloseValue),
      );

      const borrowerBalanceAfterLPN = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        lppCurrencyToIBC,
      );

      expect(BigInt(borrowerBalanceAfterLPN.amount)).toBeLessThanOrEqual(
        BigInt(borrowerBalanceBeforeLPN.amount) +
          BigInt(
            Math.trunc(
              closedAmountToLPN_min - leaseObligationsBeforePartialClose,
            ),
          ),
      );

      expect(BigInt(borrowerBalanceAfterLPN.amount)).toBeGreaterThanOrEqual(
        BigInt(borrowerBalanceBeforeLPN.amount) +
          BigInt(
            Math.trunc(
              closedAmountToLPN_max - leaseObligationsBeforePartialClose,
            ),
          ),
      );

      await returnAmountToTheMainAccount(borrowerWallet, leaseCurrencyToIBC);
      await returnAmountToTheMainAccount(borrowerWallet, lppCurrencyToIBC);
    });

    test('the borrower tries to fully close the position - should work as expected', async () => {
      const leaseAddress = await openLease(
        leaserInstance,
        lppInstance,
        downpayment,
        downpaymentCurrency,
        leaseCurrency,
        borrowerWallet,
      );
      const leaseInstance = new NolusContracts.Lease(cosm, leaseAddress);

      expect(await waitLeaseOpeningProcess(leaseInstance)).toBe(undefined);

      const leasesBefore = (
        await leaserInstance.getCurrentOpenLeasesByOwner(
          borrowerWallet.address as string,
        )
      ).length;

      const leaseStateBeforeFullClose = (await leaseInstance.getLeaseStatus())
        .opened;

      if (!leaseStateBeforeFullClose) {
        undefinedHandler();
        return;
      }

      const leaseAmountBeforeClose = leaseStateBeforeFullClose.amount;

      const leaseObligations = getLeaseObligations(
        leaseStateBeforeFullClose,
        true,
      );

      if (!leaseObligations) {
        undefinedHandler();
        return;
      }

      const borrowerBalanceBeforeLPN = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        lppCurrencyToIBC,
      );

      await userWithBalanceWallet.transferAmount(
        borrowerWallet.address as string,
        [defaultTip],
        customFees.transfer,
      );
      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );

      const leaseCurrencyPriceObj =
        await oracleInstance.getPriceFor(leaseCurrency);
      const [
        minToleranceCurrencyPrice_LC,
        exactCurrencyPrice_LC,
        maxToleranceCurrencyPrice_LC,
      ] = currencyPriceObjToNumbers(leaseCurrencyPriceObj, 1);

      const leaseAmountToLPN_min =
        +leaseAmountBeforeClose.amount / minToleranceCurrencyPrice_LC;
      const leaseAmountToLPN_max =
        +leaseAmountBeforeClose.amount / maxToleranceCurrencyPrice_LC;

      await leaseInstance.closePositionLease(
        borrowerWallet,
        customFees.exec,
        undefined,
        [defaultTip],
      );
      expect(await waitLeaseInProgressToBeNull(leaseInstance)).toBe(undefined);

      const leaseStateAfterFullClose = await leaseInstance.getLeaseStatus();
      expect(leaseStateAfterFullClose.closed).toBeDefined();

      const borrowerBalanceAfterLPN = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        lppCurrencyToIBC,
      );

      expect(BigInt(borrowerBalanceAfterLPN.amount)).toBeLessThanOrEqual(
        BigInt(borrowerBalanceBeforeLPN.amount) +
          BigInt(Math.trunc(leaseAmountToLPN_min - leaseObligations)),
      );

      expect(BigInt(borrowerBalanceAfterLPN.amount)).toBeGreaterThanOrEqual(
        BigInt(borrowerBalanceBeforeLPN.amount) +
          BigInt(Math.trunc(leaseAmountToLPN_max - leaseObligations)),
      );

      const leasesAfter = (
        await leaserInstance.getCurrentOpenLeasesByOwner(
          borrowerWallet.address as string,
        )
      ).length;

      expect(leasesAfter).toBe(leasesBefore - 1);

      await returnAmountToTheMainAccount(borrowerWallet, leaseCurrencyToIBC);
      await returnAmountToTheMainAccount(borrowerWallet, lppCurrencyToIBC);
    });
  },
);
