import { CosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { NolusClient, NolusContracts, NolusWallet } from '@nolus/nolusjs';
import { toUtf8 } from '@cosmjs/encoding';
import { Coin } from '@cosmjs/proto-signing';
import {
  calcInterestRate,
  currencyTicker_To_IBC,
} from '../util/smart-contracts/calculations';
import NODE_ENDPOINT, {
  createWallet,
  getUser1Wallet,
  txSearchByEvents,
} from '../util/clients';
import { runOrSkip } from '../util/testingRules';
import { customFees, defaultTip, undefinedHandler } from '../util/utils';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import {
  getLoanInterestPaidFromRepayTx,
  getMarginInterestPaidFromRepayTx,
  getMarginPaidTimeFromRawState,
  getPrincipalPaidFromRepayTx,
} from '../util/smart-contracts/getters';
import { waitLeaseInProgressToBeNull } from '../util/smart-contracts/actions/borrower';

// TO DO : if previous interest
runOrSkip(process.env.TEST_BORROWER_INTEREST as string)(
  'Borrower tests - Interest testing',
  () => {
    let userWithBalanceWallet: NolusWallet;
    let borrowerWallet: NolusWallet;
    let lppCurrency: string;
    let lppCurrencyToIBC: string;
    let cosm: CosmWasmClient;
    let lppInstance: NolusContracts.Lpp;
    let leaseInstance: NolusContracts.Lease;
    let leaseAddress: string;

    const lppContractAddress = process.env.LPP_ADDRESS as string;

    function verifyInterestDueCalc(
      principalDue: bigint,
      interestRate: bigint,
      interestPaidByNanoSec: bigint, // from
      outstandingByNanoSec: bigint, // to
      expectedResult: bigint,
    ): bigint {
      const calcInterest = calcInterestRate(
        principalDue,
        interestRate,
        interestPaidByNanoSec,
        outstandingByNanoSec,
      );

      expect(calcInterest).toBeGreaterThanOrEqual(BigInt(0));
      expect(calcInterest).toBe(expectedResult);

      return calcInterest;
    }

    async function repay(payment: Coin) {
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

      await waitLeaseInProgressToBeNull(leaseInstance);

      const txsCount = (
        await txSearchByEvents(
          `wasm-ls-repay._contract_address='${leaseAddress}'`,
          undefined,
          undefined,
        )
      ).totalCount;

      const repayTxResponse = (
        await txSearchByEvents(
          `wasm-ls-repay._contract_address='${leaseAddress}'`,
          txsCount,
          1,
        )
      ).txs;

      const marginInterestPaid = getMarginInterestPaidFromRepayTx(
        repayTxResponse[0],
      );
      const loanInterestPaid = getLoanInterestPaidFromRepayTx(
        repayTxResponse[0],
      );
      const principalPaid = getPrincipalPaidFromRepayTx(repayTxResponse[0]);

      return [marginInterestPaid, loanInterestPaid, principalPaid];
    }

    beforeAll(async () => {
      NolusClient.setInstance(NODE_ENDPOINT);
      cosm = await NolusClient.getInstance().getCosmWasmClient();

      leaseAddress = process.env.ACTIVE_LEASE_ADDRESS as string;
      leaseInstance = new NolusContracts.Lease(cosm, leaseAddress);

      userWithBalanceWallet = await getUser1Wallet();
      borrowerWallet = await createWallet();

      lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);

      const lppConfig = await lppInstance.getLppConfig();
      lppCurrency = lppConfig.lpn_ticker;
      lppCurrencyToIBC = currencyTicker_To_IBC(lppCurrency);
    });

    test('the existing lease should have a properly calculated interest', async () => {
      const leaseState = (await leaseInstance.getLeaseStatus()).opened;

      if (!leaseState) {
        undefinedHandler();
        return;
      }

      const leaseAnnualInterest = leaseState.loan_interest_rate;
      const interestRateMargin = leaseState.margin_interest_rate;
      const leasePrincipal = leaseState.principal_due.amount;
      const leaseCID = leaseState.current_interest_due.amount;
      const leaseCMD = leaseState.current_margin_due.amount;

      const loan = await lppInstance.getLoanInformation(leaseAddress);

      const leaseStateAfterRepay = (await leaseInstance.getLeaseStatus())
        .opened;

      if (!leaseStateAfterRepay) {
        undefinedHandler();
        return;
      }

      // verify loan interest due calc
      verifyInterestDueCalc(
        BigInt(leasePrincipal),
        BigInt(leaseAnnualInterest),
        BigInt(loan.interest_paid),
        BigInt(leaseState.validity),
        BigInt(leaseCID),
      );

      const leaseRawState = await cosm.queryContractRaw(
        leaseAddress,
        toUtf8('state'),
      );

      if (!leaseRawState) {
        undefinedHandler();
        return;
      }

      const marginInterestPaidTo = getMarginPaidTimeFromRawState(leaseRawState);

      // verify margin interest due calc
      verifyInterestDueCalc(
        BigInt(leasePrincipal),
        BigInt(interestRateMargin),
        marginInterestPaidTo,
        BigInt(leaseState.validity),
        BigInt(leaseCMD),
      );
    });

    test('repayment of debts must be in proper sequence', async () => {
      const leaseStateBefore = (await leaseInstance.getLeaseStatus()).opened;

      if (!leaseStateBefore) {
        undefinedHandler();
        return;
      }

      const CMD_before = BigInt(leaseStateBefore.current_margin_due.amount);
      const CID_before = BigInt(leaseStateBefore.current_interest_due.amount);
      const principalBefore = BigInt(leaseStateBefore.principal_due.amount);

      const payLoanInterestAmount = CID_before / BigInt(2);
      const marginAndLoanInteresPayment = {
        denom: lppCurrencyToIBC,
        amount: (CMD_before + payLoanInterestAmount).toString(),
      };

      let [marginInterestPaid, loanInterestPaid, principalPaid] = await repay(
        marginAndLoanInteresPayment,
      );

      expect(marginInterestPaid).toBe(CMD_before);
      expect(loanInterestPaid).toBe(payLoanInterestAmount);
      expect(principalPaid).toBe(BigInt(0));

      const leaseStateAfterFirstRepay = (await leaseInstance.getLeaseStatus())
        .opened;

      if (!leaseStateAfterFirstRepay) {
        undefinedHandler();
        return;
      }

      const CMD_afterFirstRepay = BigInt(
        leaseStateAfterFirstRepay.current_margin_due.amount,
      );
      const CID_afterFirstRepay = BigInt(
        leaseStateAfterFirstRepay.current_interest_due.amount,
      );
      const principalAfterFirstRepay = BigInt(
        leaseStateAfterFirstRepay.principal_due.amount,
      );

      expect(principalAfterFirstRepay).toBe(principalBefore);
      expect(CMD_afterFirstRepay).toBe(BigInt(0));
      expect(CID_afterFirstRepay).toBe(CID_before - payLoanInterestAmount);

      const payPrincipalAmount = principalAfterFirstRepay / BigInt(2);
      const paymentPrincipal = {
        denom: lppCurrencyToIBC,
        amount: (
          CMD_afterFirstRepay +
          CID_afterFirstRepay +
          payPrincipalAmount
        ).toString(),
      };

      [marginInterestPaid, loanInterestPaid, principalPaid] =
        await repay(paymentPrincipal);

      expect(marginInterestPaid).toBe(CMD_afterFirstRepay);
      expect(loanInterestPaid).toBe(CID_afterFirstRepay);
      expect(principalPaid).toBe(payPrincipalAmount);

      const leaseStateFinish = (await leaseInstance.getLeaseStatus()).opened;

      if (!leaseStateFinish) {
        undefinedHandler();
        return;
      }

      expect(leaseStateFinish.current_interest_due.amount).toBe('0');
      expect(leaseStateFinish.current_margin_due.amount).toBe('0');
      expect(BigInt(leaseStateFinish.principal_due.amount)).toBe(
        principalAfterFirstRepay - payPrincipalAmount,
      );
    });
  },
);
