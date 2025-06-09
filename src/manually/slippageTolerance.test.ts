import { CosmWasmClient, ExecuteResult } from '@cosmjs/cosmwasm-stargate';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import NODE_ENDPOINT, {
  createWallet,
  getFeederWallet,
  getUser1Wallet,
  getWallet,
} from '../util/clients';
import { customFees, sleep, TONANOSEC, undefinedHandler } from '../util/utils';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import { getLeaseObligations } from '../util/smart-contracts/getters';
import {
  dispatchAlarms,
  openLease,
  waitLeaseInProgressToBeNull,
  waitLeaseOpeningProcess,
} from '../util/smart-contracts/actions/borrower';
import {
  calcLTV,
  currencyTicker_To_IBC,
} from '../util/smart-contracts/calculations';
import { Lease } from '@nolus/nolusjs/build/contracts';
import { fromHex } from '@cosmjs/encoding';

// These tests require the network to be specifically configured
// That`s why, they only work locally and in isolation, and only if this requirement is met!
// Suitable values are (Osmosis protocol):
// - for the Leaser - {..., "lease_max_slippage":{"liquidation":10}, "lease_interest_rate_margin":1000000,"lease_position_spec":{"liability":{"initial":650,"healthy":700,"first_liq_warn":720,"second_liq_warn":750,"third_liq_warn":780,"max":900,"recalc_time":7200000000000},"min_asset":{"amount":"15000","ticker":"<lpn>"},"min_transaction":{"amount":"1000","ticker":"<lpn>"}},...,"lease_due_period":300000000000}
// - for the Oracle  config - {"config":{....,"price_config":{"min_feeders":500,"sample_period_secs":230,"samples_number":1,"discount_factor":750}},....}
// - for the LPP - {...,"min_utilization":0}
// - non-working dispatcher bot
// - non-working feeder

// Before running -> update:
// - check and fill "leaseCurrency" and "validPriceLCtoLPN" (LC = "leaseCurrency")
// - "periodSecs" = configured "sample_period_secs" /take from the Oracle smart contract config/

describe.skip('Lease - Slippage tolerance tests', () => {
  let cosm: CosmWasmClient;
  let borrowerWallet: NolusWallet;
  let userWithBalanceWallet: NolusWallet;
  let leaserInstance: NolusContracts.Leaser;
  let oracleInstance: NolusContracts.Oracle;
  let lppInstance: NolusContracts.Lpp;
  let feederWallet: NolusWallet;
  let adminWallet: NolusWallet;
  let leaserConfig: NolusContracts.LeaserConfig;
  let lpnCurrency: string;
  let downpaymentCurrency: string;
  let leaseAddress: string;
  let lease2Address: string;
  let leaseInstance: Lease;
  let lease2Instance: Lease;
  let duePeriod: number;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;
  const oracleContractAddress = process.env.ORACLE_ADDRESS as string;
  const timealarmsContractAddress = process.env.TIMEALARMS_ADDRESS as string;
  const reserveContractAddress = process.env.RESERVE_ADDRESS as string;

  const alarmDispatcherPeriod = 120; // DispatcherBot:poll_period_seconds + 5
  const leaseCurrency = 'NTRN';
  const validPriceLCtoLPN = 0.284;
  const downpayment = '500000';

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    cosm = await NolusClient.getInstance().getCosmWasmClient();

    leaserInstance = new NolusContracts.Leaser(cosm, leaserContractAddress);
    lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);
    oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);

    borrowerWallet = await createWallet();
    userWithBalanceWallet = await getUser1Wallet();
    feederWallet = await getFeederWallet();
    adminWallet = await getWallet(
      fromHex(process.env.LEASE_ADMIN_PRIV_KEY as string),
    );
    console.log('Admin: ', adminWallet.address);

    leaserConfig = await leaserInstance.getLeaserConfig();
    duePeriod = +leaserConfig.config.lease_due_period.toString() / TONANOSEC;

    lpnCurrency = process.env.LPP_BASE_CURRENCY as string;
    downpaymentCurrency = lpnCurrency;

    await pushPrice(validPriceLCtoLPN);

    console.log(
      'Price before open: ',
      (await oracleInstance.getPrices()).prices,
    );

    leaseAddress = await openLease(
      leaserInstance,
      lppInstance,
      downpayment,
      downpaymentCurrency,
      leaseCurrency,
      borrowerWallet,
    );

    lease2Address = await openLease(
      leaserInstance,
      lppInstance,
      downpayment,
      downpaymentCurrency,
      leaseCurrency,
      borrowerWallet,
    );

    console.log('Lease address: ', leaseAddress);
    console.log('Lease address 2: ', lease2Address);

    leaseInstance = new NolusContracts.Lease(cosm, leaseAddress);
    lease2Instance = new NolusContracts.Lease(cosm, lease2Address);

    expect(await waitLeaseOpeningProcess(leaseInstance)).toBe(undefined);
    expect(await waitLeaseOpeningProcess(lease2Instance)).toBe(undefined);

    await userWithBalanceWallet.transferAmount(
      reserveContractAddress,
      [{ denom: await currencyTicker_To_IBC(lpnCurrency), amount: '1000000' }],
      customFees.transfer,
    );
  });

  async function pushPrice(price: number) {
    let amount = 2;

    const length = price.toString().split('.')[1].length;
    const amountQuote = Math.trunc(price * Math.pow(10, length) * amount);
    amount = amount * Math.pow(10, length);

    const priceObj = {
      prices: [
        {
          amount: { amount: amount.toString(), ticker: leaseCurrency },
          amount_quote: {
            amount: amountQuote.toString(),
            ticker: lpnCurrency,
          },
        },
      ],
    };

    await userWithBalanceWallet.transferAmount(
      feederWallet.address as string,
      customFees.exec.amount,
      customFees.transfer,
    );

    await oracleInstance.feedPrices(feederWallet, priceObj, customFees.exec);
  }

  async function changeConfig(percentPermille: number) {
    const leaserConfigMsg = await leaserInstance.getLeaserConfig();
    leaserConfigMsg.config.lease_max_slippages.liquidation = percentPermille;
    leaserConfigMsg.config.lease_code = undefined;
    leaserConfigMsg.config.dex = undefined;
    leaserConfigMsg.config.lpp = undefined;
    leaserConfigMsg.config.market_price_oracle = undefined;
    leaserConfigMsg.config.profit = undefined;
    leaserConfigMsg.config.time_alarms = undefined;
    leaserConfigMsg.config.reserve = undefined;
    leaserConfigMsg.config.protocols_registry = undefined;
    leaserConfigMsg.config.lease_admin = undefined;

    const updateConfigMsg = {
      config_leases: leaserConfigMsg.config,
    };

    await userWithBalanceWallet.transferAmount(
      adminWallet.address as string,
      customFees.configs.amount,
      customFees.transfer,
    );

    await adminWallet.executeContract(
      leaserContractAddress,
      updateConfigMsg,
      customFees.configs,
    );

    const leaserConfigAfter = await leaserInstance.getLeaserConfig();
    expect(leaserConfigAfter.config.lease_max_slippages.liquidation).toBe(
      percentPermille,
    );
  }

  async function timeLiquidationCheck(leaseInstance: Lease) {
    console.log('Waiting for the due_period to expire...');
    await sleep(duePeriod);

    const stateAfterDuePeriod = (await leaseInstance.getLeaseStatus()).opened;
    if (!stateAfterDuePeriod) {
      undefinedHandler();
      return;
    }

    console.log(stateAfterDuePeriod);
    expect(stateAfterDuePeriod.overdue_margin.amount).not.toBe('0');
  }

  async function unblockLease(
    leaseAddr: string,
    wallet: NolusWallet,
  ): Promise<ExecuteResult> {
    await sendInitExecuteFeeTokens(
      userWithBalanceWallet,
      wallet.address as string,
    );

    const unblockTx = await wallet.executeContract(
      leaseAddr,
      { heal: [] },
      customFees.exec,
    );

    return unblockTx;
  }

  test('activation of slippage protection - should work as expected', async () => {
    await changeConfig(0);

    await sendInitExecuteFeeTokens(
      userWithBalanceWallet,
      borrowerWallet.address as string,
    );

    // const protectionActivationPrice =
    //   (validPriceLCtoLPN + 2) / (1 - slippagePercent / 1000); // +2 more slippage

    const stateBeforeLiquidation = await leaseInstance.getLeaseStatus();
    expect(stateBeforeLiquidation.opened?.status).toBe('idle');

    await timeLiquidationCheck(leaseInstance);

    console.log('Waiting for the slippage protection...');

    await pushPrice(validPriceLCtoLPN + 0.1);

    await dispatchAlarms(timealarmsContractAddress);

    await waitLeaseInProgressToBeNull(leaseInstance);

    const stateAfterLiquidation = (await leaseInstance.getLeaseStatus()).opened;
    if (!stateAfterLiquidation) {
      undefinedHandler();
      return;
    }

    expect(stateAfterLiquidation.status).toBe('slippage_protection_activated');
  });

  test('execute heal but slippage protection was reactivated - should work as expected', async () => {
    await pushPrice(validPriceLCtoLPN);
    await dispatchAlarms(timealarmsContractAddress);

    await unblockLease(leaseAddress, adminWallet);

    await dispatchAlarms(timealarmsContractAddress);
    await waitLeaseInProgressToBeNull(leaseInstance);

    const state = (await leaseInstance.getLeaseStatus()).opened;
    if (!state) {
      undefinedHandler();
      return;
    }

    expect(state.status).toBe('slippage_protection_activated');
  });

  test('an unauthorized user tries to execute heal - should produce an error', async () => {
    const newAccount = await createWallet();

    await sendInitExecuteFeeTokens(
      userWithBalanceWallet,
      newAccount.address as string,
    );

    const unblockResult = () => unblockLease(leaseAddress, newAccount);
    await expect(unblockResult).rejects.toThrow(/^.*Unauthorized access!.*/);
  });

  test('lease recovery - slippage percentage update - should work as expected', async () => {
    await pushPrice(validPriceLCtoLPN + 0.1);
    await dispatchAlarms(timealarmsContractAddress);

    const stateBefore = (await lease2Instance.getLeaseStatus()).opened;
    if (!stateBefore) {
      undefinedHandler();
      return;
    }

    expect(stateBefore.status).toBe('slippage_protection_activated');

    await changeConfig(900);

    await dispatchAlarms(timealarmsContractAddress);

    await unblockLease(lease2Address, adminWallet);

    await waitLeaseInProgressToBeNull(lease2Instance, true);

    const stateAfter = await lease2Instance.getLeaseStatus();
    if (!stateAfter.opened) {
      undefinedHandler();
      expect(stateAfter.liquidated).toBeDefined();
    } else {
      expect(stateAfter.opened.status).toBe('idle');
      expect(+stateAfter.opened.amount.amount).toBeLessThan(
        +stateBefore.amount.amount,
      );
    }

    const unblockResult = () => unblockLease(lease2Address, adminWallet);
    await expect(unblockResult).rejects.toThrow(
      /^.*Inconsistency not detected.*/,
    );
  });

  test('lease recovery - submitting the real price - should work as expected', async () => {
    await changeConfig(50);

    await pushPrice(validPriceLCtoLPN);
    await dispatchAlarms(timealarmsContractAddress);

    const stateBefore = (await leaseInstance.getLeaseStatus()).opened;
    if (!stateBefore) {
      undefinedHandler();
      return;
    }

    expect(stateBefore.status).toBe('slippage_protection_activated');

    await unblockLease(leaseAddress, adminWallet);

    await dispatchAlarms(timealarmsContractAddress);

    await waitLeaseInProgressToBeNull(leaseInstance, true);

    const stateAfter = await leaseInstance.getLeaseStatus();
    if (!stateAfter.opened) {
      undefinedHandler();
      expect(stateAfter.liquidated).toBeDefined();
    } else {
      expect(stateAfter.opened.status).toBe('idle');
      expect(+stateAfter.opened.amount.amount).toBeLessThan(
        +stateBefore.amount.amount,
      );
    }
  });

  test('lease recovery and LTV=SL - should work as expected', async () => {
    const leaserConfigMsg = await leaserInstance.getLeaserConfig();
    leaserConfigMsg.config.lease_max_slippages.liquidation = 900;
    leaserConfigMsg.config.lease_code = undefined;
    leaserConfigMsg.config.dex = undefined;
    leaserConfigMsg.config.lpp = undefined;
    leaserConfigMsg.config.market_price_oracle = undefined;
    leaserConfigMsg.config.profit = undefined;
    leaserConfigMsg.config.time_alarms = undefined;
    leaserConfigMsg.config.reserve = undefined;
    leaserConfigMsg.config.protocols_registry = undefined;
    leaserConfigMsg.config.lease_admin = undefined;

    duePeriod = +leaserConfig.config.lease_due_period.toString() / TONANOSEC;

    const updateConfigMsg = {
      config_leases: leaserConfigMsg.config,
    };

    await userWithBalanceWallet.transferAmount(
      adminWallet.address as string,
      customFees.configs.amount,
      customFees.transfer,
    );

    await adminWallet.executeContract(
      leaserContractAddress,
      updateConfigMsg,
      customFees.configs,
    );

    await pushPrice(validPriceLCtoLPN);
    await dispatchAlarms(timealarmsContractAddress);

    const leaseAddress = await openLease(
      leaserInstance,
      lppInstance,
      downpayment,
      downpaymentCurrency,
      leaseCurrency,
      borrowerWallet,
    );

    const leaseInstance = new NolusContracts.Lease(cosm, leaseAddress);
    console.log(leaseAddress);

    expect(await waitLeaseOpeningProcess(leaseInstance)).toBe(undefined);

    ///////////////////

    const stateBeforeBlocking = (await leaseInstance.getLeaseStatus(duePeriod))
      .opened;
    if (!stateBeforeBlocking) {
      undefinedHandler();
      return;
    }

    const leaseAmount = +stateBeforeBlocking.amount.amount;
    const leaseDue = getLeaseObligations(stateBeforeBlocking, true);

    const currentLTV = await calcLTV(leaseInstance, oracleInstance);
    if (!currentLTV || !leaseDue) {
      undefinedHandler();
      return;
    }
    const SL = currentLTV + 50; // +5%

    const slPrice = (leaseDue * 1000) / (leaseAmount * SL);

    await userWithBalanceWallet.transferAmount(
      borrowerWallet.address as string,
      customFees.exec.amount,
      customFees.transfer,
    );
    await leaseInstance.changeClosePolicy(
      borrowerWallet,
      customFees.exec,
      SL,
      null,
    );
    const policy = (await leaseInstance.getLeaseStatus()).opened?.close_policy;
    expect(policy?.stop_loss).toBe(SL);

    /////////////////////////////////

    await changeConfig(0);

    await timeLiquidationCheck(leaseInstance);

    await pushPrice(validPriceLCtoLPN + 0.1); // 0.1 should be less than 90% of the validPrice
    await dispatchAlarms(timealarmsContractAddress);

    await waitLeaseInProgressToBeNull(leaseInstance);

    const stateAfterBlocking = (await leaseInstance.getLeaseStatus()).opened;
    if (!stateAfterBlocking) {
      undefinedHandler();
      return;
    }
    expect(stateAfterBlocking.status).toBe('slippage_protection_activated');

    //////////////////////////////////////////

    await changeConfig(900);

    await pushPrice(slPrice);
    await sleep(alarmDispatcherPeriod);

    await unblockLease(leaseAddress, adminWallet);

    await dispatchAlarms(timealarmsContractAddress);

    await waitLeaseInProgressToBeNull(leaseInstance, true);

    const stateAfter = await leaseInstance.getLeaseStatus();
    expect(stateAfter.closed).toBeDefined();
  });
});
