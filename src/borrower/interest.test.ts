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
    let duePeriod: number;

    const lppContractAddress = process.env.LPP_ADDRESS as string;
    const leaseAddress = process.env.ACTIVE_LEASE_ADDRESS as string;
    const leaserAddress = process.env.LEASER_ADDRESS as string;

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

      leaseInstance = new NolusContracts.Lease(cosm, leaseAddress);

      lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);
      const lppConfig = await lppInstance.getLppConfig();
      lppCurrency = lppConfig.lpn_ticker;
      lppCurrencyToIBC = currencyTicker_To_IBC(lppCurrency);

      const leaserInstance = new NolusContracts.Leaser(cosm, leaserAddress);
      duePeriod = +(
        await leaserInstance.getLeaserConfig()
      ).config.lease_due_period.toString();

      userWithBalanceWallet = await getUser1Wallet();
      borrowerWallet = await createWallet();
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
      const leaseID = leaseState.due_interest.amount;
      const leaseMD = leaseState.due_margin.amount;
      const leaseIOD = leaseState.overdue_interest.amount;
      const leaseMOD = leaseState.overdue_margin.amount;

      const loan = await lppInstance.getLoanInformation(leaseAddress);

      const startPeriodLoanDue = Math.max(
        +loan.interest_paid,
        +leaseState.validity - duePeriod,
      );

      // verify loan interest due calc
      verifyInterestCalc(
        BigInt(leasePrincipal),
        BigInt(leaseAnnualInterest),
        BigInt(startPeriodLoanDue),
        BigInt(leaseState.validity),
        BigInt(leaseID),
      );

      const endPeriodOverdue = +leaseState.validity - duePeriod;

      // verify loan interest overdue calc
      verifyInterestCalc(
        BigInt(leasePrincipal),
        BigInt(leaseAnnualInterest),
        BigInt(loan.interest_paid),
        BigInt(endPeriodOverdue),
        BigInt(leaseIOD),
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

      const startPeriodMarginDue = Math.max(
        +marginInterestPaidTo.toString(),
        +leaseState.validity - duePeriod,
      );

      // verify margin interest due calc
      verifyInterestCalc(
        BigInt(leasePrincipal),
        BigInt(interestRateMargin),
        BigInt(startPeriodMarginDue),
        BigInt(leaseState.validity),
        BigInt(leaseMD),
      );

      // verify margin interest overdue calc
      verifyInterestCalc(
        BigInt(leasePrincipal),
        BigInt(interestRateMargin),
        marginInterestPaidTo,
        BigInt(endPeriodOverdue),
        BigInt(leaseMOD),
      );
    });

    test('repayment of debts must be in proper sequence', async () => {
      const leaseStateBefore = (await leaseInstance.getLeaseStatus()).opened;

      if (!leaseStateBefore) {
        undefinedHandler();
        return;
      }

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

      const leaseStateAfterFirstRepay = (await leaseInstance.getLeaseStatus())
        .opened;

      if (!leaseStateAfterFirstRepay) {
        undefinedHandler();
        return;
      }

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

      const leaseStateFinish = (await leaseInstance.getLeaseStatus()).opened;

      if (!leaseStateFinish) {
        undefinedHandler();
        return;
      }

      expect(leaseStateFinish.due_interest.amount).toBe('0');
      expect(leaseStateFinish.due_margin.amount).toBe('0');
      expect(BigInt(leaseStateFinish.principal_due.amount)).toBe(
        principalAfterFirstRepay - payPrincipalAmount,
      );
    });
  },
);
