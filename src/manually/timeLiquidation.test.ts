import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { sleep, undefinedHandler, TONANOSEC } from '../util/utils';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import { Lease, LeaseStatus } from '@nolus/nolusjs/build/contracts';
import { currencyPriceObjToNumbers } from '../util/smart-contracts/calculations';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import NODE_ENDPOINT, { createWallet, getUser1Wallet } from '../util/clients';
import {
  getLeaseGroupCurrencies,
  getLeaseObligations,
} from '../util/smart-contracts/getters';
import {
  dispatchAlarms,
  openLease,
  waitLeaseInProgressToBeNull,
  waitLeaseOpeningProcess,
} from '../util/smart-contracts/actions/borrower';

// These tests require the network to be configured with Leaser specific config
// That`s why, they are only executed locally and in isolation, and only if this requirement is met!
// Suitable values are :
// - for the Leaser - {...,"lease_max_slippage":{"liquidation":900}, "lease_interest_rate_margin":10000000,"lease_position_spec":{"liability":{"initial":650,"healthy":700,"first_liq_warn":720,"second_liq_warn":750,"third_liq_warn":780,"max":800,"recalc_time":7200000000000},"min_asset":{"amount":"15000","ticker":"<lpn>"},"min_transaction":{"amount":"1000","ticker":"<lpn>"}},...,"lease_due_period":240000000000}
// - for the LPP - {...,"min_utilization": 0}
// - non-working dispatcher
// - working feeder

describe.skip('Lease - Time Liquidation tests', () => {
  let cosm: CosmWasmClient;
  let borrowerWallet: NolusWallet;
  let userWithBalanceWallet: NolusWallet;
  let leaserInstance: NolusContracts.Leaser;
  let oracleInstance: NolusContracts.Oracle;
  let lppInstance: NolusContracts.Lpp;
  let leaserConfig: NolusContracts.LeaserConfigInfo;
  let leaseCurrency: string;
  let downpaymentCurrency: string;
  let duePeriod: number;
  let minAssetLPN: number;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;
  const oracleContractAddress = process.env.ORACLE_ADDRESS as string;
  const timealarmsContractAddress = process.env.TIMEALARMS_ADDRESS as string;

  async function timeLiquidationCheck(
    leaseInstance: Lease,
    stateBefore: LeaseStatus,
  ) {
    const leasesBefore = await leaserInstance.getCurrentOpenLeasesByOwner(
      borrowerWallet.address as string,
    );
    console.log('Waiting for the due_period to expire...');
    await sleep(duePeriod);

    const stateAfterDuePeriod = (await leaseInstance.getLeaseStatus()).opened;
    if (!stateAfterDuePeriod) {
      undefinedHandler();
      return;
    }

    const interestLPN = getLeaseObligations(stateAfterDuePeriod, false);

    if (!interestLPN) {
      undefinedHandler();
      return;
    }

    expect(stateAfterDuePeriod.overdue_margin.amount).not.toBe('0');

    expect(stateBefore.opened?.amount.amount).toBe(
      stateAfterDuePeriod.amount.amount,
    );

    await dispatchAlarms(timealarmsContractAddress);

    await waitLeaseInProgressToBeNull(leaseInstance, true);

    const leaseCurrencyPriceObj =
      await oracleInstance.getBasePrice(leaseCurrency);
    const [
      minToleranceCurrencyPrice_LC,
      exactCurrencyPrice_LC,
      maxToleranceCurrencyPrice_LC,
    ] = currencyPriceObjToNumbers(leaseCurrencyPriceObj, 1);

    const stateAfterLiquidation = await leaseInstance.getLeaseStatus();

    const interestToLeaseCurrency = Math.trunc(
      interestLPN * exactCurrencyPrice_LC,
    );

    if (
      +stateAfterDuePeriod.amount.amount / exactCurrencyPrice_LC <
      minAssetLPN
    ) {
      expect(stateAfterLiquidation.liquidated).toBeDefined();

      const leasesAfter = await leaserInstance.getCurrentOpenLeasesByOwner(
        borrowerWallet.address as string,
      );
      expect(leasesAfter.length).toEqual(leasesBefore.length - 1);
    } else {
      if (!stateAfterLiquidation.opened) {
        undefinedHandler();
        return;
      }

      expect(+stateAfterLiquidation.opened?.amount.amount).toBeLessThanOrEqual(
        +stateAfterDuePeriod.amount.amount - interestToLeaseCurrency,
      );
    }
  }

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    cosm = await NolusClient.getInstance().getCosmWasmClient();

    leaserInstance = new NolusContracts.Leaser(cosm, leaserContractAddress);
    lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);
    oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);

    borrowerWallet = await createWallet();
    userWithBalanceWallet = await getUser1Wallet();

    leaserConfig = (await leaserInstance.getLeaserConfig()).config;
    duePeriod = +leaserConfig.lease_due_period.toString() / TONANOSEC;
    minAssetLPN = +leaserConfig.lease_position_spec.min_asset.amount;
    downpaymentCurrency = process.env.LPP_BASE_CURRENCY as string;
    leaseCurrency = (await getLeaseGroupCurrencies(oracleInstance))[0];
  });

  test('partial liquidation due to expiry of due_period - should work as expected', async () => {
    const downpayment = '1000000';

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

    await sendInitExecuteFeeTokens(
      userWithBalanceWallet,
      borrowerWallet.address as string,
    );

    const stateBeforeFirstLiquidation = await leaseInstance.getLeaseStatus();
    await timeLiquidationCheck(leaseInstance, stateBeforeFirstLiquidation);
  });
});
