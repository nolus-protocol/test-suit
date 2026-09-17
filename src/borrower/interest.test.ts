import { CosmWasmClient } from '@cosmjs/cosmwasm';
import { NolusClient, NolusWallet } from '../util/nolus';
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
import { customFees } from '../util/utils';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import {
  getLoanInterestPaidFromRepayTx,
  getMarginInterestPaidFromRepayTx,
  getMarginPaidTimeFromRawState,
  getPrincipalPaidFromRepayTx,
} from '../util/smart-contracts/getters';
import { waitLeaseInProgressToBeNull } from '../util/smart-contracts/actions/borrower';
import { Lease, Leaser, Lpp } from '../util/contracts';

runOrSkip(process.env.TEST_BORROWER_INTEREST as string)(
  'Borrower tests - Interest testing',
  () => {
    let userWithBalanceWallet: NolusWallet;
    let borrowerWallet: NolusWallet;
    let lppCurrency: string;
    let lppCurrencyToIBC: string;
    let cosm: CosmWasmClient;
    let lppInstance: Lpp;
    let leaseInstance: Lease;
    let duePeriod: bigint;

    const lppContractAddress = process.env.LPP_ADDRESS as string;
    const leaseAddress = process.env.ACTIVE_LEASE_ADDRESS as string;
    const leaserAddress = process.env.LEASER_ADDRESS as string;

    async function openedLease(): Promise<
      NonNullable<Awaited<ReturnType<Lease['getLeaseStatus']>>['opened']>
    > {
      const state = await leaseInstance.getLeaseStatus();

      if (!state.opened) {
        throw new Error(
          `ACTIVE_LEASE_ADDRESS (${leaseAddress}) holds no open position; its state is ` +
            `${JSON.stringify(state)}.`,
        );
      }

      return state.opened;
    }

    function verifyInterestCalc(
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

      expect(calcInterest).toBe(expectedResult);

      return calcInterest;
    }

    async function repay(payment: Coin) {
      await userWithBalanceWallet.transferAmount(
        borrowerWallet.address as string,
        [payment],
        customFees.transfer,
      );

      await sendInitExecuteFeeTokens(
        userWithBalanceWallet,
        borrowerWallet.address as string,
      );

      await leaseInstance.repayLease(borrowerWallet, customFees.exec, [
        payment,
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

      leaseInstance = new Lease(cosm, leaseAddress);
      lppInstance = new Lpp(cosm, lppContractAddress);

      lppCurrency = process.env.LPP_BASE_CURRENCY as string;
      lppCurrencyToIBC = await currencyTicker_To_IBC(lppCurrency);

      const leaserInstance = new Leaser(cosm, leaserAddress);
      duePeriod = BigInt(
        (await leaserInstance.getLeaserConfig()).config.lease_config.due_period,
      );

      userWithBalanceWallet = await getUser1Wallet();
      borrowerWallet = await createWallet();
    });

    test('the existing lease should have a properly calculated interest', async () => {
      const leaseState = await openedLease();
      const leaseAnnualInterest = leaseState.loan_interest_rate;
      const interestRateMargin = leaseState.margin_interest_rate;
      const leasePrincipal = leaseState.principal_due.amount;
      const leaseID = leaseState.due_interest.amount;
      const leaseMD = leaseState.due_margin.amount;
      const leaseIOD = leaseState.overdue_interest.amount;
      const leaseMOD = leaseState.overdue_margin.amount;

      const loan = await lppInstance.getLoanInformation(leaseAddress);

      if (loan === null) {
        throw new Error(
          `the LPP holds no loan for ${leaseAddress}, so the interest assertions cannot run`,
        );
      }

      const endPeriodOverdue = BigInt(leaseState.validity) - duePeriod;
      const interestPaid = BigInt(loan.interest_paid);
      const startPeriodLoanDue =
        interestPaid > endPeriodOverdue ? interestPaid : endPeriodOverdue;

      // verify loan interest due calc
      verifyInterestCalc(
        BigInt(leasePrincipal),
        BigInt(leaseAnnualInterest),
        startPeriodLoanDue,
        BigInt(leaseState.validity),
        BigInt(leaseID),
      );

      // verify loan interest overdue calc
      verifyInterestCalc(
        BigInt(leasePrincipal),
        BigInt(leaseAnnualInterest),
        interestPaid,
        endPeriodOverdue,
        BigInt(leaseIOD),
      );

      const leaseRawState = await cosm.queryContractRaw(
        leaseAddress,
        toUtf8('state'),
      );

      if (!leaseRawState) {
        throw new Error(
          `the raw state of ${leaseAddress} came back empty, so the margin-paid timestamp the ` +
            'margin assertions need cannot be read',
        );
      }

      const marginInterestPaidTo = getMarginPaidTimeFromRawState(leaseRawState);

      const startPeriodMarginDue =
        marginInterestPaidTo > endPeriodOverdue
          ? marginInterestPaidTo
          : endPeriodOverdue;

      // verify margin interest due calc
      verifyInterestCalc(
        BigInt(leasePrincipal),
        BigInt(interestRateMargin),
        startPeriodMarginDue,
        BigInt(leaseState.validity),
        BigInt(leaseMD),
      );

      // verify margin interest overdue calc
      verifyInterestCalc(
        BigInt(leasePrincipal),
        BigInt(interestRateMargin),
        marginInterestPaidTo,
        endPeriodOverdue,
        BigInt(leaseMOD),
      );
    });

    test('repayment of debts must be in proper sequence', async () => {
      const leaseStateBefore = await openedLease();
      const MOD_before = BigInt(leaseStateBefore.overdue_margin.amount);
      const IOD_before = BigInt(leaseStateBefore.overdue_interest.amount);
      const MD_before = BigInt(leaseStateBefore.due_margin.amount);
      const ID_before = BigInt(leaseStateBefore.due_interest.amount);
      const principalBefore = BigInt(leaseStateBefore.principal_due.amount);

      const payMarginInterestAmount = MD_before / BigInt(2);
      const marginAndLoanInteresPayment = {
        denom: lppCurrencyToIBC,
        amount: (
          IOD_before +
          MOD_before +
          ID_before +
          payMarginInterestAmount
        ).toString(),
      };

      let [marginInterestPaid, loanInterestPaid, principalPaid] = await repay(
        marginAndLoanInteresPayment,
      );

      const leaseStateAfterFirstRepay = await openedLease();
      const CMD_afterFirstRepay = BigInt(
        leaseStateAfterFirstRepay.due_margin.amount,
      );
      const CID_afterFirstRepay = BigInt(
        leaseStateAfterFirstRepay.due_interest.amount,
      );
      const principalAfterFirstRepay = BigInt(
        leaseStateAfterFirstRepay.principal_due.amount,
      );

      expect(marginInterestPaid).toBe(payMarginInterestAmount);
      expect(loanInterestPaid).toBe(ID_before);
      expect(principalPaid).toBe(BigInt(0));

      expect(principalAfterFirstRepay).toBe(principalBefore);
      expect(CID_afterFirstRepay).toBe(BigInt(0));
      expect(CMD_afterFirstRepay).toBe(MD_before - payMarginInterestAmount);

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

      const leaseStateFinish = await openedLease();
      expect(leaseStateFinish.due_interest.amount).toBe('0');
      expect(leaseStateFinish.due_margin.amount).toBe('0');
      expect(BigInt(leaseStateFinish.principal_due.amount)).toBe(
        principalAfterFirstRepay - payPrincipalAmount,
      );
    });
  },
);
