import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { sleep, undefinedHandler, TONANOSEC, customFees } from '../util/utils';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import { fromHex } from '@cosmjs/encoding';
import { Lease, LeaseStatus } from '@nolus/nolusjs/build/contracts';
import { currencyPriceObjToNumbers } from '../util/smart-contracts/calculations';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import NODE_ENDPOINT, {
  createWallet,
  getUser1Wallet,
  getWallet,
} from '../util/clients';
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
import { applyLeaserConfig } from '../util/manualTestHelpers';

// These tests require the network to be specifically configured
// That`s why, they are only executed locally and in isolation, and only if this requirement is met:
// - non-working dispatcher
// - working feeder

describe.skip('Lease - Time Liquidation tests', () => {
  let cosm: CosmWasmClient;
  let borrowerWallet: NolusWallet;
  let userWithBalanceWallet: NolusWallet;
  let adminWallet: NolusWallet;
  let leaserInstance: NolusContracts.Leaser;
  let oracleInstance: NolusContracts.Oracle;
  let lppInstance: NolusContracts.Lpp;
  let leaserConfig: NolusContracts.LeaserConfigInfo;
  let originalLeaserConfig: NolusContracts.LeaserConfigInfo;
  let leaseCurrency: string;
  let downpaymentCurrency: string;
  let duePeriod: number;
  let minAssetLPN: number;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;
  const oracleContractAddress = process.env.ORACLE_ADDRESS as string;
  const timealarmsContractAddress = process.env.TIMEALARMS_ADDRESS as string;

  async function updateLeaserConfigForTest() {
    const leaserCfgMsg = await leaserInstance.getLeaserConfig();

    leaserCfgMsg.config.lease_max_slippages.liquidation = 900;
    leaserCfgMsg.config.lease_interest_rate_margin = 10000000;
    leaserCfgMsg.config.lease_position_spec.liability.initial = 650;
    leaserCfgMsg.config.lease_position_spec.liability.healthy = 700;
    leaserCfgMsg.config.lease_position_spec.liability.first_liq_warn = 720;
    leaserCfgMsg.config.lease_position_spec.liability.second_liq_warn = 750;
    leaserCfgMsg.config.lease_position_spec.liability.third_liq_warn = 780;
    leaserCfgMsg.config.lease_position_spec.liability.max = 800;
    leaserCfgMsg.config.lease_position_spec.liability.recalc_time = 7200000000000;
    leaserCfgMsg.config.lease_due_period = Number(240000000000);

    await applyLeaserConfig(
      leaserInstance,
      leaserContractAddress,
      userWithBalanceWallet,
      adminWallet,
      leaserCfgMsg.config,
    );
  }

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
    adminWallet = await getWallet(
      fromHex(process.env.LEASE_ADMIN_PRIV_KEY as string),
    );

    originalLeaserConfig = (await leaserInstance.getLeaserConfig()).config;
    await updateLeaserConfigForTest();

    leaserConfig = (await leaserInstance.getLeaserConfig()).config;
    duePeriod = +leaserConfig.lease_due_period.toString() / TONANOSEC;
    minAssetLPN = +leaserConfig.lease_position_spec.min_asset.amount;
    downpaymentCurrency = process.env.LPP_BASE_CURRENCY as string;
    leaseCurrency = (await getLeaseGroupCurrencies(oracleInstance))[0];
  });

  afterAll(async () => {
    await applyLeaserConfig(
      leaserInstance,
      leaserContractAddress,
      userWithBalanceWallet,
      adminWallet,
      originalLeaserConfig,
    );
  });

  test('partial liquidation due to expiry of due_period - should work as expected', async () => {
    const downpayment = '100000';

    const leaseAddress = await openLease(
      leaserInstance,
      lppInstance,
      downpayment,
      downpaymentCurrency,
      leaseCurrency,
      borrowerWallet,
    );

    console.log('Lease address: ', leaseAddress);

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
