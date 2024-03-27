import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import {
  customFees,
  defaultTip,
  NATIVE_TICKER,
  undefinedHandler,
} from '../util/utils';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import { getLeaseGroupCurrencies } from '../util/smart-contracts/getters';
import { runOrSkip } from '../util/testingRules';
import {
  checkLeaseBalance,
  openLease,
  returnAmountToTheMainAccount,
  waitLeaseInProgressToBeNull,
  waitLeaseOpeningProcess,
} from '../util/smart-contracts/actions/borrower';
import { currencyTicker_To_IBC } from '../util/smart-contracts/calculations';

runOrSkip(process.env.TEST_BORROWER as string)(
  'Borrower tests - Close lease',
  () => {
    let userWithBalanceWallet: NolusWallet;
    let borrowerWallet: NolusWallet;
    let lppCurrency: string;
    let leaseCurrency: string;
    let leaseCurrencyToIBC: string;
    let downpaymentCurrency: string;
    let downpaymentCurrencyToIBC: string;
    let lppInstance: NolusContracts.Lpp;
    let leaserInstance: NolusContracts.Leaser;
    let leaseAddress: string;
    let cosm: CosmWasmClient;
    let leaseInstance: NolusContracts.Lease;

    const leaserContractAddress = process.env.LEASER_ADDRESS as string;
    const lppContractAddress = process.env.LPP_ADDRESS as string;

    const downpayment = '100000';

    async function testCloseInvalidCases(wallet: NolusWallet, message: string) {
      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        wallet.address as string,
      );

      const result = () => leaseInstance.closeLease(wallet, customFees.exec);

      await expect(result).rejects.toThrow(message);
    }

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      cosm = await NolusClient.getInstance().getCosmWasmClient();

      userWithBalanceWallet = await getUser1Wallet();
      borrowerWallet = await createWallet();

      lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);
      leaserInstance = new NolusContracts.Leaser(cosm, leaserContractAddress);

      lppCurrency = process.env.LPP_BASE_CURRENCY as string;
      leaseCurrency = getLeaseGroupCurrencies()[0];
      leaseCurrencyToIBC = currencyTicker_To_IBC(leaseCurrency);
      downpaymentCurrency = lppCurrency;
      downpaymentCurrencyToIBC = currencyTicker_To_IBC(downpaymentCurrency);

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

    test('the borrower tries to close the lease before it is paid - should produce an error', async () => {
      await testCloseInvalidCases(
        borrowerWallet,
        `The operation 'close' is not supported in the current state`,
      );

      const payment = {
        denom: downpaymentCurrencyToIBC,
        amount: downpayment, // amount < principal
      };

      await userWithBalanceWallet.transferAmount(
        borrowerWallet.address as string,
        [payment, defaultTip],
        customFees.transfer,
      );
      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );

      await leaseInstance.repayLease(borrowerWallet, customFees.exec, [
        payment,
        defaultTip,
      ]);

      expect(await waitLeaseInProgressToBeNull(leaseInstance)).toBe(undefined);

      const leaseBalances = await checkLeaseBalance(leaseAddress, [
        leaseCurrency,
        downpaymentCurrency,
      ]);
      expect(leaseBalances).toBe(false);

      await testCloseInvalidCases(
        borrowerWallet,
        `The operation 'close' is not supported in the current state`,
      );
    });

    test('the successful scenario for lease closing - should work as expected', async () => {
      const borrowerBalanceBefore = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        leaseCurrencyToIBC,
      );

      const leaseStateBeforeRepay = (await leaseInstance.getLeaseStatus())
        .opened;

      if (!leaseStateBeforeRepay) {
        undefinedHandler();
        return;
      }

      const loanAmount = BigInt(leaseStateBeforeRepay.amount.amount);

      const leasePrincipalBeforeRepay =
        leaseStateBeforeRepay.principal_due.amount;

      const repayAll = {
        denom: downpaymentCurrencyToIBC,
        amount: leasePrincipalBeforeRepay,
      };

      await userWithBalanceWallet.transferAmount(
        borrowerWallet.address as string,
        [repayAll, defaultTip],
        customFees.transfer,
      );
      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );

      await leaseInstance.repayLease(borrowerWallet, customFees.exec, [
        repayAll,
        defaultTip,
      ]);

      expect(await waitLeaseInProgressToBeNull(leaseInstance)).toBe(undefined);

      const leaseStateAfterRepay = await leaseInstance.getLeaseStatus();
      expect(leaseStateAfterRepay.paid).toBeDefined();

      // an unauthorized user tries to close the lease
      const unauthorizedUserWallet = await createWallet();

      await testCloseInvalidCases(unauthorizedUserWallet, 'Unauthorized');

      const leasesAfterRepay = await leaserInstance.getCurrentOpenLeasesByOwner(
        borrowerWallet.address as string,
      );

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

      const leasesAfterClose = await leaserInstance.getCurrentOpenLeasesByOwner(
        borrowerWallet.address as string,
      );

      expect(leasesAfterClose.length).toEqual(leasesAfterRepay.length - 1);

      const leaseStateAfterClose = await leaseInstance.getLeaseStatus();
      expect(leaseStateAfterClose.closed).toBeDefined();

      const borrowerBalanceAfter = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        leaseCurrencyToIBC,
      );

      expect(BigInt(borrowerBalanceAfter.amount)).toBe(
        BigInt(borrowerBalanceBefore.amount) + loanAmount,
      );

      const leaseBalances = await checkLeaseBalance(leaseAddress, [
        NATIVE_TICKER,
        leaseCurrency,
        downpaymentCurrency,
      ]);
      expect(leaseBalances).toBe(false);

      await returnAmountToTheMainAccount(borrowerWallet, leaseCurrencyToIBC);
    });

    test('the borrower tries to close the already closed lease - should produce an error', async () => {
      await testCloseInvalidCases(
        borrowerWallet,
        `The operation 'close' is not supported in the current state`,
      );
    });
  },
);
