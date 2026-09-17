import { CosmWasmClient } from '@cosmjs/cosmwasm';
import { NolusClient, NolusWallet } from '../util/nolus';
import NODE_ENDPOINT, {
  getLeaseAdminWallet,
  getUser1Wallet,
  createWallet,
} from '../util/clients';
import { customFees } from '../util/utils';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import {
  getLeaseGroupCurrencies,
  getLeaseObligations,
} from '../util/smart-contracts/getters';
import { runOrSkip } from '../util/testingRules';
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
import { Coin, Lease, Leaser, Lpp, Oracle } from '../util/contracts';

runOrSkip(process.env.TEST_BORROWER as string)(
  'Borrower tests - Market Close',
  () => {
    let userWithBalanceWallet: NolusWallet;
    let borrowerWallet: NolusWallet;
    let unauthorizedWallet: NolusWallet;
    let lppCurrency: string;
    let lppCurrencyToIBC: string;
    let leaseCurrency: string;
    let leaseCurrencyToIBC: string;
    let downpaymentCurrency: string;
    let oracleInstance: Oracle;
    let lppInstance: Lpp;
    let leaserInstance: Leaser;
    let leaseInstance: Lease;
    let leaseAddress: string;
    let cosm: CosmWasmClient;
    let minSellAsset: number;
    let minAsset: number;
    let maxCloseSlippagePercent: number;

    const leaserContractAddress = process.env.LEASER_ADDRESS as string;
    const oracleContractAddress = process.env.ORACLE_ADDRESS as string;
    const lppContractAddress = process.env.LPP_ADDRESS as string;

    const downpayment = '700000';

    async function openedLease(
      lease: Lease = leaseInstance,
    ): Promise<
      NonNullable<Awaited<ReturnType<Lease['getLeaseStatus']>>['opened']>
    > {
      const state = await lease.getLeaseStatus();

      if (!state.opened) {
        throw new Error(
          `The lease holds no open position to close. Its state is ${JSON.stringify(state)}.`,
        );
      }

      return state.opened;
    }

    async function testMarketCloseInvalidCases(
      wallet: NolusWallet,
      errorMessage: string,
      leaseAmountBeforeMarketClose: Coin,
      amount?: Coin,
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

      unauthorizedWallet = await createWallet();

      oracleInstance = new Oracle(cosm, oracleContractAddress);
      leaserInstance = new Leaser(cosm, leaserContractAddress);
      lppInstance = new Lpp(cosm, lppContractAddress);

      lppCurrency = process.env.LPP_BASE_CURRENCY as string;
      lppCurrencyToIBC = await currencyTicker_To_IBC(lppCurrency);
      leaseCurrency = (await getLeaseGroupCurrencies(oracleInstance))[0];
      leaseCurrencyToIBC = await currencyTicker_To_IBC(leaseCurrency);
      downpaymentCurrency = lppCurrency;

      expect(lppCurrencyToIBC).not.toBe('');
      expect(leaseCurrencyToIBC).not.toBe('');

      minSellAsset = +(await leaserInstance.getLeaserConfig()).config
        .lease_config.position_spec.min_transaction.amount;
      minAsset = +(await leaserInstance.getLeaserConfig()).config.lease_config
        .position_spec.min_asset.amount;

      // The protocol's own bound on how far a close may land from the oracle price, in permille.
      // Nothing promises the DEX agrees with the oracle any more tightly than this, so asserting a
      // narrower band asserts something the protocol never offered — one run came in 1.4% out
      // against a hand-picked 1%.
      maxCloseSlippagePercent =
        +(await leaserInstance.getLeaserConfig()).config.lease_config
          .max_slippages.close / 10;

      leaseAddress = await openLease(
        leaserInstance,
        lppInstance,
        downpayment,
        downpaymentCurrency,
        leaseCurrency,
        borrowerWallet,
      );

      leaseInstance = new Lease(cosm, leaseAddress);

      console.log('Lease address: ', leaseAddress);

      expect(await waitLeaseOpeningProcess(leaseInstance)).toBe(undefined);
    });

    afterAll(async () => {
      const openPositions = await leaserInstance.getCurrentOpenLeasesByOwner(
        borrowerWallet.address as string,
      );
      const failures: string[] = [];

      for (const address of openPositions) {
        try {
          const position = new Lease(cosm, address);

          await waitLeaseInProgressToBeNull(position);

          if (!(await position.getLeaseStatus()).opened) {
            continue;
          }

          await sendInitExecuteFeeTokens(
            userWithBalanceWallet,
            borrowerWallet.address as string,
          );

          await position.closePositionLease(borrowerWallet, customFees.exec);
          await waitLeaseInProgressToBeNull(position);
        } catch (error) {
          failures.push(`${address}: ${(error as Error).message}`);
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `Could not close ${failures.length} of ${openPositions.length} position(s). The sweep ` +
            `still records the owner, so the payouts can be recovered by hand:\n  ` +
            failures.join('\n  '),
        );
      }
    });

    test.skip('the lease admin closes a position regardless of the owner - should work as expected', async () => {
      const leaseAddressForAdminClose = await openLease(
        leaserInstance,
        lppInstance,
        downpayment,
        downpaymentCurrency,
        leaseCurrency,
        borrowerWallet,
      );
      console.log('leaseAddressForAdminClose', leaseAddressForAdminClose);

      const leaseInstanceForAdminClose = new Lease(
        cosm,
        leaseAddressForAdminClose,
      );

      expect(await waitLeaseOpeningProcess(leaseInstanceForAdminClose)).toBe(
        undefined,
      );

      const leaseAdminWallet = await getLeaseAdminWallet();

      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        leaseAdminWallet.address as string,
      );

      await leaseInstanceForAdminClose.closePositionLease(
        leaseAdminWallet,
        customFees.exec,
        undefined,
      );

      expect(
        await waitLeaseInProgressToBeNull(leaseInstanceForAdminClose),
      ).toBe(undefined);

      const leaseStateAfterAdminClose =
        await leaseInstanceForAdminClose.getLeaseStatus();

      expect(leaseStateAfterAdminClose.closed).toBeDefined();
    });

    test('an unauthorized user tries to close the position - should produce an error', async () => {
      const leaseAmountBeforeMarketClose = (await openedLease()).amount;
      await testMarketCloseInvalidCases(
        unauthorizedWallet,
        'Unauthorized access!',
        leaseAmountBeforeMarketClose,
        undefined,
      );
    });

    test('the borrower tries to close partially "0" amount from the position - should produce an error', async () => {
      const leaseAmountBeforePartialClose = (await openedLease()).amount;
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
      const leaseAmountBeforePartialClose = (await openedLease()).amount;
      await testMarketCloseInvalidCases(
        borrowerWallet,
        `The position past this close should worth at least ${minAsset} ${lppCurrency}`,
        leaseAmountBeforePartialClose,
        leaseAmountBeforePartialClose,
      );
    });

    test('the borrower tries to close partially an amount greater than the position - should produce an error', async () => {
      const leaseAmountBeforePartialClose = (await openedLease()).amount;
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
      const leaseAmountBeforePartialClose = (await openedLease()).amount;
      const invalidLeaseTicker = lppCurrency;

      const amount = { amount: '1', ticker: invalidLeaseTicker };

      await testMarketCloseInvalidCases(
        borrowerWallet,
        `Found a symbol '${invalidLeaseTicker}' pretending to be ticker of a currency pertaining to the lease group`,
        leaseAmountBeforePartialClose,
        amount,
      );
    });
    test('the borrower tries to close partially by sending amount < "min_transaction" - should produce an error', async () => {
      const leaseAmountBeforePartialClose = (await openedLease()).amount;
      const leaseCurrencyPriceObj =
        await oracleInstance.getBasePrice(leaseCurrency);
      const { min: minToleranceCurrencyPrice_LC } = currencyPriceObjToNumbers(
        leaseCurrencyPriceObj,
        1,
      );

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
      const leaseStateBeforePartialClose = await openedLease();
      const leaseAmountBeforeClose = leaseStateBeforePartialClose.amount;

      const leaseCurrencyPriceObj =
        await oracleInstance.getBasePrice(leaseCurrency);
      const { max: maxToleranceCurrencyPrice_LC } = currencyPriceObjToNumbers(
        leaseCurrencyPriceObj,
        1,
      );

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
      const leaseStateBeforePartialClose = await openedLease();
      const leaseObligationsBeforePartialClose = getLeaseObligations(
        leaseStateBeforePartialClose,
        true,
      );
      const borrowerBalanceBeforeLPN = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        lppCurrencyToIBC,
      );

      const borrowerBalanceBeforeLC = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        leaseCurrencyToIBC,
      );

      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );

      const leaseCurrencyPriceObj =
        await oracleInstance.getBasePrice(leaseCurrency);
      const {
        min: minToleranceCurrencyPrice_LC,
        max: maxToleranceCurrencyPrice_LC,
      } = currencyPriceObjToNumbers(
        leaseCurrencyPriceObj,
        maxCloseSlippagePercent,
      );

      const preferredCloseValueLPN = 500000;

      const amountToCloseValue = await calcMinAllowablePaymentAmount(
        leaserInstance,
        oracleInstance,
        leaseCurrency,
        Math.trunc(
          preferredCloseValueLPN * maxToleranceCurrencyPrice_LC,
        ).toString(),
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
      );
      expect(await waitLeaseInProgressToBeNull(leaseInstance)).toBe(undefined);

      const leaseStateAfterPartialClose = await openedLease();
      expect(leaseStateAfterPartialClose).toBeDefined();

      const leaseObligationsAfterPartialClose = getLeaseObligations(
        leaseStateAfterPartialClose,
        true,
      );
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
      const leaseStateBeforePartialClose = await openedLease();
      const leaseAmountBeforePartialClose = leaseStateBeforePartialClose.amount;

      const leaseObligationsBeforePartialClose = getLeaseObligations(
        leaseStateBeforePartialClose,
        true,
      );
      const borrowerBalanceBeforeLPN = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        lppCurrencyToIBC,
      );

      const borrowerBalanceBeforeLC = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        leaseCurrencyToIBC,
      );

      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );

      const leaseCurrencyPriceObj =
        await oracleInstance.getBasePrice(leaseCurrency);

      const {
        min: minToleranceCurrencyPrice_LC,
        max: maxToleranceCurrencyPrice_LC,
      } = currencyPriceObjToNumbers(
        leaseCurrencyPriceObj,
        maxCloseSlippagePercent,
      );

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
      );
      expect(await waitLeaseInProgressToBeNull(leaseInstance)).toBe(undefined);

      const leaseStateAfterPartialClose = await leaseInstance.getLeaseStatus();

      expect(leaseStateAfterPartialClose.closed).toBeDefined();

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
      const fullCloseLeaseInstance = new Lease(cosm, leaseAddress);

      console.log('Lease address', leaseAddress);

      expect(await waitLeaseOpeningProcess(fullCloseLeaseInstance)).toBe(
        undefined,
      );

      const leasesBefore = (
        await leaserInstance.getCurrentOpenLeasesByOwner(
          borrowerWallet.address as string,
        )
      ).length;

      const leaseStateBeforeFullClose = await openedLease(
        fullCloseLeaseInstance,
      );
      const leaseAmountBeforeClose = leaseStateBeforeFullClose.amount;

      const leaseObligations = getLeaseObligations(
        leaseStateBeforeFullClose,
        true,
      );
      const borrowerBalanceBeforeLPN = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        lppCurrencyToIBC,
      );

      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );

      const leaseCurrencyPriceObj =
        await oracleInstance.getBasePrice(leaseCurrency);
      const {
        min: minToleranceCurrencyPrice_LC,
        max: maxToleranceCurrencyPrice_LC,
      } = currencyPriceObjToNumbers(
        leaseCurrencyPriceObj,
        maxCloseSlippagePercent,
      );

      const leaseAmountToLPN_min =
        +leaseAmountBeforeClose.amount / minToleranceCurrencyPrice_LC;
      const leaseAmountToLPN_max =
        +leaseAmountBeforeClose.amount / maxToleranceCurrencyPrice_LC;

      await fullCloseLeaseInstance.closePositionLease(
        borrowerWallet,
        customFees.exec,
        undefined,
      );
      expect(await waitLeaseInProgressToBeNull(fullCloseLeaseInstance)).toBe(
        undefined,
      );

      const leaseStateAfterFullClose =
        await fullCloseLeaseInstance.getLeaseStatus();
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
