import NODE_ENDPOINT, { createWallet, getUser1Wallet } from '../util/clients';
import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import {
  customFees,
  sleep,
  undefinedHandler,
  TONANOSEC,
  defaultTip,
} from '../util/utils';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import { Lease, LeaseStatus } from '@nolus/nolusjs/build/contracts';
import {
  currencyPriceObjToNumbers,
  currencyTicker_To_IBC,
} from '../util/smart-contracts/calculations';
import {
  getLeaseAddressFromOpenLeaseResponse,
  getLeaseGroupCurrencies,
} from '../util/smart-contracts/getters';
import { provideEnoughLiquidity } from '../util/smart-contracts/actions/lender';
import {
  waitLeaseInProgressToBeNull,
  waitLeaseOpeningProcess,
} from '../util/smart-contracts/actions/borrower';

// These tests require the network to be configured with Leaser specific config
// That`s why, they are only executed locally and in isolation, and only if this requirement is met!
// Suitable values are :
// - for the Leaser - {...,"lease_interest_rate_margin":10000000,"liability":{"initial":650,"healthy":700,"first_liq_warn":720,"second_liq_warn":750,"third_liq_warn":780,"max":800,"recalc_time":7200000000000},......,"lease_interest_payment":{"due_period":60000000000,"grace_period":30000000000}}
// TO DO: minLeaseValueLPN and allowablePeviousInterestLPN in the Leaser config
// - working dispatcher
// - working feeder

// Before running -> update:
// - "alarmDispatcherPeriod" = configured "poll_period_seconds" + 5 /take from the alarms-dispatcher bot config/
describe.skip('Lease - Time Liquidation tests', () => {
  let cosm: CosmWasmClient;
  let borrowerWallet: NolusWallet;
  let userWithBalanceWallet: NolusWallet;
  let leaserInstance: NolusContracts.Leaser;
  let oracleInstance: NolusContracts.Oracle;
  let lppInstance: NolusContracts.Lpp;
  let leaserConfig: NolusContracts.LeaserConfig;
  let leaseCurrency: string;
  let leaseCurrencyToIBC: string;
  let downpaymentCurrency: string;
  let downpaymentCurrencyToIBC: string;
  let mainPeriod: number;
  let gracePeriod: number;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;
  const oracleContractAddress = process.env.ORACLE_ADDRESS as string;

  const alarmDispatcherPeriod = 15; // poll_period_seconds + 5
  const minLeaseValueLPN = 15000000; // should be more; to do when possible to configurate it
  const allowablePeviousInterestLPN = 100000; // should be less; to do when possible to configurate it

  async function timeLiquidationCheck(
    leaseInstance: Lease,
    stateBefore: LeaseStatus,
  ) {
    const leasesBefore = await leaserInstance.getCurrentOpenLeasesByOwner(
      borrowerWallet.address as string,
    );

    await sleep(mainPeriod);

    const stateAfterMainPeriod = (await leaseInstance.getLeaseStatus()).opened;
    if (!stateAfterMainPeriod) {
      undefinedHandler();
      return;
    }

    const PMD_afterMainPeriod = stateAfterMainPeriod.previous_margin_due.amount;

    expect(PMD_afterMainPeriod).not.toBe('0');

    expect(stateBefore.opened?.amount.amount).toBe(
      stateAfterMainPeriod.amount.amount,
    );

    await sleep(gracePeriod);

    const stateRightAfterGracePeriod = (await leaseInstance.getLeaseStatus())
      .opened;
    if (!stateRightAfterGracePeriod) {
      undefinedHandler();
      return;
    }

    const PID_afterGracePeriod =
      stateRightAfterGracePeriod.previous_interest_due.amount;
    const PMD_afterGracePeriod =
      stateRightAfterGracePeriod.previous_margin_due.amount;
    const previousInterestLPN = +PID_afterGracePeriod + +PMD_afterGracePeriod;

    await sleep(alarmDispatcherPeriod);

    await waitLeaseInProgressToBeNull(leaseInstance);

    const leaseCurrencyPriceObj = await oracleInstance.getPriceFor(
      leaseCurrency,
    );
    const [
      minToleranceCurrencyPrice_LC,
      exactCurrencyPrice_LC,
      maxToleranceCurrencyPrice_LC,
    ] = currencyPriceObjToNumbers(leaseCurrencyPriceObj, 1);

    const stateAfterGracePeriod = await leaseInstance.getLeaseStatus();
    if (!stateAfterGracePeriod) {
      undefinedHandler();
      return;
    }

    const previousInterestToLeaseCurrency = Math.trunc(
      previousInterestLPN * exactCurrencyPrice_LC,
    );

    if (
      +stateAfterMainPeriod.amount.amount / exactCurrencyPrice_LC <
      minLeaseValueLPN
    ) {
      expect(stateAfterGracePeriod.liquidated).toBeDefined();

      const leasesAfter = await leaserInstance.getCurrentOpenLeasesByOwner(
        borrowerWallet.address as string,
      );
      expect(leasesAfter.length).toEqual(leasesBefore.length - 1);
    } else {
      if (!stateAfterGracePeriod.opened) {
        undefinedHandler();
        return;
      }
      expect(+stateAfterGracePeriod.opened?.amount.amount).toBeLessThanOrEqual(
        +stateAfterMainPeriod.amount.amount - previousInterestToLeaseCurrency,
      );
    }
  }

  async function openLease(downpayment: number): Promise<NolusContracts.Lease> {
    await provideEnoughLiquidity(
      leaserInstance,
      lppInstance,
      downpayment.toString(),
      downpaymentCurrency,
      leaseCurrency,
    );

    await userWithBalanceWallet.transferAmount(
      borrowerWallet.address as string,
      [
        { denom: downpaymentCurrencyToIBC, amount: downpayment.toString() },
        defaultTip,
      ],
      customFees.transfer,
    );

    await sendInitExecuteFeeTokens(
      userWithBalanceWallet,
      borrowerWallet.address as string,
    );

    const response = await leaserInstance.openLease(
      borrowerWallet,
      leaseCurrency,
      customFees.exec,
      undefined,
      [
        {
          denom: downpaymentCurrencyToIBC,
          amount: downpayment.toString(),
        },
        defaultTip,
      ],
    );

    const leaseAddress = getLeaseAddressFromOpenLeaseResponse(response);
    console.log('Lease address: ', leaseAddress);

    const leaseInstance = new NolusContracts.Lease(cosm, leaseAddress);
    expect(await waitLeaseOpeningProcess(leaseInstance)).toBe(undefined);

    return leaseInstance;
  }

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    cosm = await NolusClient.getInstance().getCosmWasmClient();

    leaserInstance = new NolusContracts.Leaser(cosm, leaserContractAddress);
    lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);
    oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);

    borrowerWallet = await createWallet();
    userWithBalanceWallet = await getUser1Wallet();

    leaserConfig = await leaserInstance.getLeaserConfig();
    mainPeriod =
      leaserConfig.config.lease_interest_payment.due_period / TONANOSEC;
    gracePeriod =
      leaserConfig.config.lease_interest_payment.grace_period / TONANOSEC;

    const lppConfig = await lppInstance.getLppConfig();
    downpaymentCurrency = lppConfig.lpn_ticker;
    downpaymentCurrencyToIBC = currencyTicker_To_IBC(downpaymentCurrency);
    leaseCurrency = getLeaseGroupCurrencies()[0];
    leaseCurrencyToIBC = currencyTicker_To_IBC(leaseCurrency);
  });

  test('partial liquidation due to expiry of the grace period - should work as expected', async () => {
    const downpayment = 10000000;
    const leaseInstance = await openLease(downpayment);

    await sendInitExecuteFeeTokens(
      userWithBalanceWallet,
      borrowerWallet.address as string,
    );

    const stateBeforeFirstLiquidation = await leaseInstance.getLeaseStatus();
    await timeLiquidationCheck(leaseInstance, stateBeforeFirstLiquidation);
  });

  test.skip('full liquidation due to expiry of the grace period - should work as expected', async () => {
    const downpayment = 10000;
    const leaseInstance = await openLease(downpayment);
    await sendInitExecuteFeeTokens(
      userWithBalanceWallet,
      borrowerWallet.address as string,
    );
    const stateBeforeFirstLiquidation = await leaseInstance.getLeaseStatus();
    await timeLiquidationCheck(leaseInstance, stateBeforeFirstLiquidation);
  });
});
