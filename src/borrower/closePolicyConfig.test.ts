import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import { runOrSkip } from '../util/testingRules';
import NODE_ENDPOINT, { createWallet, getUser1Wallet } from '../util/clients';
import {
  customFees,
  PERMILLE_TO_PERCENT,
  undefinedHandler,
} from '../util/utils';
import {
  openLease,
  waitLeaseInProgressToBeNull,
  waitLeaseOpeningProcess,
} from '../util/smart-contracts/actions/borrower';
import { getLeaseGroupCurrencies } from '../util/smart-contracts/getters';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import { calcLTV } from '../util/smart-contracts/calculations';

runOrSkip(process.env.TEST_BORROWER as string)(
  'Borrower tests - Close policy Configuration',
  () => {
    let userWithBalanceWallet: NolusWallet;
    let borrowerWallet: NolusWallet;
    let cosm: CosmWasmClient;
    let leaserInstance: NolusContracts.Leaser;
    let oracleInstance: NolusContracts.Oracle;
    let lppInstance: NolusContracts.Lpp;
    let leaseInstance: NolusContracts.Lease;

    const leaserContractAddress = process.env.LEASER_ADDRESS as string;
    const lppContractAddress = process.env.LPP_ADDRESS as string;
    const oracleContractAddress = process.env.ORACLE_ADDRESS as string;

    const downpayment = '10000';

    async function changeClosePolicyInvalidCases(
      wallet: NolusWallet,
      errorMessage: string,
      SL?: number | null,
      TP?: number | null,
    ) {
      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        wallet.address as string,
      );

      const broadcastTx = () =>
        leaseInstance.changeClosePolicy(wallet, customFees.exec, SL, TP);

      await expect(broadcastTx).rejects.toThrow(errorMessage);
    }

    async function changeClosePolicy(
      wallet: NolusWallet,
      SL?: number | null,
      TP?: number | null,
    ) {
      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        wallet.address as string,
      );

      await leaseInstance.changeClosePolicy(wallet, customFees.exec, SL, TP);

      const policy = (await leaseInstance.getLeaseStatus()).opened
        ?.close_policy;

      expect(policy?.take_profit).toBe(TP);
      expect(policy?.stop_loss).toBe(SL);
    }

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      cosm = await NolusClient.getInstance().getCosmWasmClient();

      leaserInstance = new NolusContracts.Leaser(cosm, leaserContractAddress);
      lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);
      oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);

      userWithBalanceWallet = await getUser1Wallet();
      borrowerWallet = await createWallet();
    });

    test('try changing the closePolicy when the lease is not fully opened - should produce an error', async () => {
      const downpaymentCurrency = process.env.LPP_BASE_CURRENCY as string;
      const leaseCurrency = (await getLeaseGroupCurrencies(oracleInstance))[0];

      const leaseAddress = await openLease(
        leaserInstance,
        lppInstance,
        downpayment,
        downpaymentCurrency,
        leaseCurrency,
        borrowerWallet,
      );

      leaseInstance = new NolusContracts.Lease(cosm, leaseAddress);

      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );

      await changeClosePolicyInvalidCases(
        userWithBalanceWallet,
        `The operation 'change close policy' is not supported in the current state`,
        1110, // any values
        1110,
      );

      await waitLeaseOpeningProcess(leaseInstance);

      const policy = (await leaseInstance.getLeaseStatus()).opened
        ?.close_policy;

      expect(policy?.take_profit).toBe(null);
      expect(policy?.stop_loss).toBe(null);
    });

    test('an unauthorized account tries to change closePolicy - should produce an error', async () => {
      await changeClosePolicyInvalidCases(
        userWithBalanceWallet,
        'Unauthorized access',
        1110, // any values
        1110,
      );
    });

    test('try to set SL <= currentLTV - should produce an error', async () => {
      const currentLTV = await calcLTV(leaseInstance, oracleInstance);
      if (!currentLTV) {
        undefinedHandler();
        return;
      }
      let SL = currentLTV;

      await changeClosePolicyInvalidCases(
        borrowerWallet,
        `The current lease LTV '${currentLTV / PERMILLE_TO_PERCENT}%' would trigger 'stop loss above or equal to ${SL / PERMILLE_TO_PERCENT}%'!`,
        SL,
        null,
      );

      SL = currentLTV - 200; // - 20%
      await changeClosePolicyInvalidCases(
        borrowerWallet,
        `The current lease LTV '${currentLTV / PERMILLE_TO_PERCENT}%' would trigger 'stop loss above or equal to ${SL / PERMILLE_TO_PERCENT}%'!`,
        SL,
        null,
      );
    });

    test('try to set SL >= maxLTV - should produce an error', async () => {
      const maxLTV = (await leaserInstance.getLeaserConfig()).config
        .lease_position_spec.liability.max;
      let SL = maxLTV;

      await changeClosePolicyInvalidCases(
        borrowerWallet,
        `The new strategy 'stop loss above or equal to ${SL / PERMILLE_TO_PERCENT}%' is not less than the max lease liability LTV '${maxLTV / PERMILLE_TO_PERCENT}%'!`,
        SL,
        null,
      );

      SL = maxLTV + 10; // +1%
      await changeClosePolicyInvalidCases(
        borrowerWallet,
        `The new strategy 'stop loss above or equal to ${SL / PERMILLE_TO_PERCENT}%' is not less than the max lease liability LTV '${maxLTV / PERMILLE_TO_PERCENT}%'!`,
        SL,
        null,
      );
    });

    test('try to set TP > currentLTV - should produce an error', async () => {
      const currentLTV = await calcLTV(leaseInstance, oracleInstance);
      if (!currentLTV) {
        undefinedHandler();
        return;
      }

      let TP = currentLTV + 100; // + 10%
      await changeClosePolicyInvalidCases(
        borrowerWallet,
        `The current lease LTV '${currentLTV / PERMILLE_TO_PERCENT}%' would trigger 'take profit below ${TP / PERMILLE_TO_PERCENT}%'!`,
        null,
        TP,
      );
    });

    test('try to set TP = 0 - should produce an error', async () => {
      let TP = 0;
      await changeClosePolicyInvalidCases(
        borrowerWallet,
        `The close policy 'take profit' should not be zero!`,
        null,
        TP,
      );
    });

    test('try to set valid SL and TP - should work as expected', async () => {
      const currentLTV = await calcLTV(leaseInstance, oracleInstance);
      if (!currentLTV) {
        undefinedHandler();
        return;
      }

      const validTP = currentLTV - 100; // - 20%
      const validSL = currentLTV + 100; // + 20%

      await changeClosePolicy(borrowerWallet, validSL, validTP);

      await changeClosePolicy(borrowerWallet, null, null);
    });

    test('try changing the closePolicy when the lease is closed - should produce an error', async () => {
      await leaseInstance.closePositionLease(borrowerWallet, customFees.exec);

      await waitLeaseInProgressToBeNull(leaseInstance);

      await changeClosePolicyInvalidCases(
        borrowerWallet,
        `The operation 'change close policy' is not supported in the current state`,
        111, // any values
        111,
      );
    });
  },
);
