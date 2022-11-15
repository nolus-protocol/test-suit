import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import { customFees, NATIVE_TICKER, undefinedHandler } from '../util/utils';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import {
  getChangeFromRepayResponse,
  getLeaseAddressFromOpenLeaseResponse,
  getLeaseGroupCurrencies,
} from '../util/smart-contracts/getters';
import { runOrSkip } from '../util/testingRules';
import {
  checkLeaseBalance,
  provideEnoughLiquidity,
  waitLeaseOpeningProcess,
} from '../util/smart-contracts/actions';
import { currencyTicker_To_IBC } from '../util/smart-contracts/calculations';

runOrSkip(process.env.TEST_BORROWER as string)(
  'Borrower tests - Close lease',
  () => {
    let feederWallet: NolusWallet;
    let borrowerWallet: NolusWallet;
    let lppCurrency: string;
    let leaseCurrency: string;
    let leaseCurrencyToIBC: string;
    let downpaymentCurrency: string;
    let downpaymentCurrencyToIBC: string;
    let lppInstance: NolusContracts.Lpp;
    let leaserInstance: NolusContracts.Leaser;
    let oracleInstance: NolusContracts.Oracle;
    let mainLeaseAddress: string;
    let cosm: any;
    let leaseInstance: NolusContracts.Lease;

    const leaserContractAddress = process.env.LEASER_ADDRESS as string;
    const lppContractAddress = process.env.LPP_ADDRESS as string;
    const oracleContractAddress = process.env.ORACLE_ADDRESS as string;

    const downpayment = '100';

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      cosm = await NolusClient.getInstance().getCosmWasmClient();

      feederWallet = await getUser1Wallet();
      borrowerWallet = await createWallet();

      lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);
      leaserInstance = new NolusContracts.Leaser(cosm, leaserContractAddress);
      oracleInstance = new NolusContracts.Oracle(cosm, oracleContractAddress);

      const lppConfig = await lppInstance.getLppConfig();
      lppCurrency = lppConfig.lpn_ticker;
      leaseCurrency = getLeaseGroupCurrencies()[0];
      leaseCurrencyToIBC = currencyTicker_To_IBC(leaseCurrency);
      downpaymentCurrency = lppCurrency;
      downpaymentCurrencyToIBC = currencyTicker_To_IBC(downpaymentCurrency);

      await provideEnoughLiquidity(
        leaserInstance,
        lppInstance,
        downpayment,
        downpaymentCurrency,
        leaseCurrency,
      );

      // preparе one open lease
      await feederWallet.transferAmount(
        borrowerWallet.address as string,
        [{ denom: downpaymentCurrencyToIBC, amount: downpayment }],
        customFees.transfer,
      );
      await sendInitExecuteFeeTokens(
        feederWallet,
        borrowerWallet.address as string,
      );

      const result = await leaserInstance.openLease(
        borrowerWallet,
        lppCurrency,
        customFees.exec,
        [{ denom: downpaymentCurrencyToIBC, amount: downpayment }],
      );

      mainLeaseAddress = getLeaseAddressFromOpenLeaseResponse(result);
      leaseInstance = new NolusContracts.Lease(cosm, mainLeaseAddress);

      expect(await waitLeaseOpeningProcess(leaseInstance)).toBe(undefined);

      // check lease address balance - there shouldn't be any
      const leaseBalances = await checkLeaseBalance(mainLeaseAddress, [
        NATIVE_TICKER,
        leaseCurrency,
        downpaymentCurrency,
      ]);
      expect(leaseBalances).toBe(false);
    });

    test('the borrower tries to close a lease before it is paid - should produce an error', async () => {
      await sendInitExecuteFeeTokens(
        feederWallet,
        borrowerWallet.address as string,
      );

      const result = () =>
        leaseInstance.closeLease(borrowerWallet, customFees.exec);

      await expect(result).rejects.toThrow(
        /^.*The underlying loan is not fully repaid.*/,
      );

      // make payment and try again
      const payment = {
        denom: downpaymentCurrencyToIBC,
        amount: '1', // any amount
      };

      await feederWallet.transferAmount(
        borrowerWallet.address as string,
        [payment],
        customFees.transfer,
      );
      await sendInitExecuteFeeTokens(
        feederWallet,
        borrowerWallet.address as string,
      );

      await leaseInstance.repayLease(borrowerWallet, customFees.exec, [
        payment,
      ]);

      const leaseBalances = await checkLeaseBalance(mainLeaseAddress, [
        NATIVE_TICKER,
        leaseCurrency,
        downpaymentCurrency,
      ]);
      expect(leaseBalances).toBe(false);

      await sendInitExecuteFeeTokens(
        feederWallet,
        borrowerWallet.address as string,
      );

      const result2 = () =>
        leaseInstance.closeLease(borrowerWallet, customFees.exec);

      await expect(result2).rejects.toThrow(
        /^.*The underlying loan is not fully repaid.*/,
      );
    });

    test('an unauthorized user tries to close lease - should produce an error', async () => {
      const unauthorizedUserWallet = await createWallet();

      // const leaseInstance = new NolusContracts.Lease(cosm, mainLeaseAddress);
      const leaseState = await leaseInstance.getLeaseStatus();

      expect(leaseState.opened).toBeDefined();

      await sendInitExecuteFeeTokens(
        feederWallet,
        unauthorizedUserWallet.address as string,
      );
      const result = () =>
        leaseInstance.closeLease(unauthorizedUserWallet, customFees.exec);

      await expect(result).rejects.toThrow(/^.*Unauthorized.*/);
    });

    test('the successful scenario for lease closing - should work as expected', async () => {
      const borrowerBalanceBefore = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        leaseCurrencyToIBC,
      );

      // const leaseInstance = new NolusContracts.Lease(cosm, mainLeaseAddress);
      const leaseStateBeforeRepay = (await leaseInstance.getLeaseStatus())
        .opened;

      if (!leaseStateBeforeRepay) {
        undefinedHandler();
        return;
      }

      const currentPID = leaseStateBeforeRepay.previous_interest_due.amount;
      const currentPMD = leaseStateBeforeRepay.previous_margin_due.amount;
      const currentCID = leaseStateBeforeRepay.current_interest_due.amount;
      const currentCMD = leaseStateBeforeRepay.current_margin_due.amount;

      const loanAmount = BigInt(leaseStateBeforeRepay.amount.amount);
      const leaseInterestBeforeRepay =
        BigInt(currentPID) +
        BigInt(currentPMD) +
        BigInt(currentCID) +
        BigInt(currentCMD);
      const leasePrincipalBeforeRepay = BigInt(
        leaseStateBeforeRepay.principal_due.amount,
      );

      const excess = leasePrincipalBeforeRepay; // +excess - make sure the lease principal will be paid

      const repayAll = {
        denom: downpaymentCurrencyToIBC,
        amount: (
          leaseInterestBeforeRepay +
          leasePrincipalBeforeRepay +
          excess
        ).toString(),
      };

      await feederWallet.transferAmount(
        borrowerWallet.address as string,
        [repayAll],
        customFees.transfer,
      );
      await sendInitExecuteFeeTokens(
        feederWallet,
        borrowerWallet.address as string,
      );

      // OR get price
      // TO DO: get the exact price from the repay tx events
      const leaseCurrencyPriceObj = await oracleInstance.getPriceFor(
        leaseCurrency,
      );

      const repayTxReponse = await leaseInstance.repayLease(
        borrowerWallet,
        customFees.exec,
        [repayAll],
      );

      const exactExcessToLeaseCurrency =
        (getChangeFromRepayResponse(repayTxReponse) *
          BigInt(+leaseCurrencyPriceObj.amount.amount)) /
        BigInt(+leaseCurrencyPriceObj.amount_quote.amount);

      const leaseStateAfterRepay = await leaseInstance.getLeaseStatus();
      expect(leaseStateAfterRepay.paid).toBeDefined();

      const leasesAfterRepay = await leaserInstance.getCurrentOpenLeasesByOwner(
        borrowerWallet.address as string,
      );

      // close
      await sendInitExecuteFeeTokens(
        feederWallet,
        borrowerWallet.address as string,
      );
      await leaseInstance.closeLease(borrowerWallet, customFees.exec);

      const leasesAfterClose = await leaserInstance.getCurrentOpenLeasesByOwner(
        borrowerWallet.address as string,
      );

      expect(leasesAfterClose.length).toEqual(leasesAfterRepay.length);

      const leaseStateAfterClose = await leaseInstance.getLeaseStatus();
      expect(leaseStateAfterClose.closed).toBeDefined();

      const borrowerBalanceAfter = await borrowerWallet.getBalance(
        borrowerWallet.address as string,
        leaseCurrencyToIBC,
      );

      expect(BigInt(borrowerBalanceAfter.amount)).toBe(
        BigInt(borrowerBalanceBefore.amount) +
          loanAmount +
          exactExcessToLeaseCurrency,
      );

      // check lease address balance - there shouldn't be any
      const leaseBalances = await checkLeaseBalance(mainLeaseAddress, [
        NATIVE_TICKER,
        leaseCurrency,
        downpaymentCurrency,
      ]);
      expect(leaseBalances).toBe(false);
    });

    test('the borrower tries to close an already closed lease - should produce an error', async () => {
      await sendInitExecuteFeeTokens(
        feederWallet,
        borrowerWallet.address as string,
      );

      // mainLease is now closed due to the previous test

      // const leaseInstance = new NolusContracts.Lease(cosm, mainLeaseAddress);
      const result = () =>
        leaseInstance.closeLease(borrowerWallet, customFees.exec);

      await expect(result).rejects.toThrow(
        /^.*The underlying loan is closed.*/,
      );
    });
  },
);
