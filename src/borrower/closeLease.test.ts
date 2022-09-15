import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import { Coin } from '@cosmjs/amino';
import { customFees, undefinedHandler } from '../util/utils';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import { sendInitExecuteFeeTokens } from '../util/transfer';
import {
  getLeaseAddressFromOpenLeaseResponse,
  getPrincipalPaidFromRepayResponse,
} from '../util/smart-contracts';

describe('Leaser contract tests - Close lease', () => {
  let feederWallet: NolusWallet;
  let borrowerWallet: NolusWallet;
  let lppLiquidity: Coin;
  let lppDenom: string;
  let leaseInstance: NolusContracts.Lease;
  let lppInstance: NolusContracts.Lpp;
  let leaserInstance: NolusContracts.Leaser;
  let mainLeaseAddress: string;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;

  const downpayment = '100';

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    const cosm = await NolusClient.getInstance().getCosmWasmClient();

    feederWallet = await getUser1Wallet();
    borrowerWallet = await createWallet();

    leaseInstance = new NolusContracts.Lease(cosm);
    lppInstance = new NolusContracts.Lpp(cosm);
    leaserInstance = new NolusContracts.Leaser(cosm);

    const lppConfig = await lppInstance.getLppConfig(lppContractAddress);
    lppDenom = lppConfig.lpn_symbol;

    const initDeposit = '1000';
    await lppInstance.lenderDeposit(
      lppContractAddress,
      feederWallet,
      customFees.exec,
      [{ denom: lppDenom, amount: initDeposit }],
    );

    // get the liquidity
    lppLiquidity = await feederWallet.getBalance(lppContractAddress, lppDenom);
    expect(lppLiquidity.amount).not.toBe('0');

    // preparе one open lease
    await feederWallet.transferAmount(
      borrowerWallet.address as string,
      [{ denom: lppDenom, amount: downpayment }],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      feederWallet,
      borrowerWallet.address as string,
    );

    const result = await leaserInstance.openLease(
      leaserContractAddress,
      borrowerWallet,
      lppDenom,
      customFees.exec,
      [{ denom: lppDenom, amount: downpayment }],
    );

    mainLeaseAddress = getLeaseAddressFromOpenLeaseResponse(result);
  });

  test('the borrower tries to close a lease before it is paid - should produce an error', async () => {
    await sendInitExecuteFeeTokens(
      feederWallet,
      borrowerWallet.address as string,
    );

    const result = () =>
      leaseInstance.closeLease(
        mainLeaseAddress,
        borrowerWallet,
        customFees.exec,
      );

    await expect(result).rejects.toThrow(
      /^.*The underlying loan is not fully repaid.*/,
    );

    // make small payment and try again

    const payment = {
      denom: lppDenom,
      amount: '1', // any amount
    };

    // send some tokens to the borrower
    // for the payment and fees
    await feederWallet.transferAmount(
      borrowerWallet.address as string,
      [payment],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      feederWallet,
      borrowerWallet.address as string,
    );

    await leaseInstance.repayLease(
      mainLeaseAddress,
      borrowerWallet,
      customFees.exec,
      [payment],
    );

    await sendInitExecuteFeeTokens(
      feederWallet,
      borrowerWallet.address as string,
    );

    const result2 = () =>
      leaseInstance.closeLease(
        mainLeaseAddress,
        borrowerWallet,
        customFees.exec,
      );

    await expect(result2).rejects.toThrow(
      /^.*The underlying loan is not fully repaid.*/,
    );
  });

  test('unauthorized user tries to close unpaid lease - should produce an error', async () => {
    const newUserWallet = await createWallet();

    const leaseState = await leaseInstance.getLeaseStatus(mainLeaseAddress);

    expect(leaseState.opened).toBeDefined();

    await sendInitExecuteFeeTokens(
      feederWallet,
      newUserWallet.address as string,
    );
    const result = () =>
      leaseInstance.closeLease(
        mainLeaseAddress,
        newUserWallet,
        customFees.exec,
      );

    await expect(result).rejects.toThrow(/^.*Unauthorized.*/);
  });

  test('the successful scenario for lease closing - should work as expected', async () => {
    const borrowerBalanceBefore = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    const leaseStateBeforeRepay = (
      await leaseInstance.getLeaseStatus(mainLeaseAddress)
    ).opened;

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
      denom: lppDenom,
      amount: (
        leaseInterestBeforeRepay +
        leasePrincipalBeforeRepay +
        excess
      ).toString(),
    };

    // send some tokens to the borrower
    // for the payment and fees
    await feederWallet.transferAmount(
      borrowerWallet.address as string,
      [repayAll],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      feederWallet,
      borrowerWallet.address as string,
    );

    const repayTxReponse = await leaseInstance.repayLease(
      mainLeaseAddress,
      borrowerWallet,
      customFees.exec,
      [repayAll],
    );

    const principalPaid = getPrincipalPaidFromRepayResponse(repayTxReponse);

    const exactExcess =
      BigInt(principalPaid) - BigInt(leasePrincipalBeforeRepay);

    const leaseStateAfterRepay = await leaseInstance.getLeaseStatus(
      mainLeaseAddress,
    );
    expect(leaseStateAfterRepay.paid).toBeDefined();

    const leasesAfterRepay = await leaserInstance.getCurrentOpenLeases(
      leaserContractAddress,
      borrowerWallet.address as string,
    );

    // unauthorized user tries to close paid lease

    const newUserWallet = await createWallet();

    await sendInitExecuteFeeTokens(
      feederWallet,
      newUserWallet.address as string,
    );
    const result = () =>
      leaseInstance.closeLease(
        mainLeaseAddress,
        newUserWallet,
        customFees.exec,
      );

    await expect(result).rejects.toThrow(/^.*Unauthorized.*/);

    // close
    await sendInitExecuteFeeTokens(
      feederWallet,
      borrowerWallet.address as string,
    );
    await leaseInstance.closeLease(
      mainLeaseAddress,
      borrowerWallet,
      customFees.exec,
    );

    const leasesAfterClose = await leaserInstance.getCurrentOpenLeases(
      leaserContractAddress,
      borrowerWallet.address as string,
    );

    expect(leasesAfterClose.length).toEqual(leasesAfterRepay.length);

    const leaseStateAfterClose = await leaseInstance.getLeaseStatus(
      mainLeaseAddress,
    );
    expect(leaseStateAfterClose.closed).toBeDefined();

    const borrowerBalanceAfter = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    expect(BigInt(borrowerBalanceAfter.amount)).toBe(
      BigInt(borrowerBalanceBefore.amount) + loanAmount + exactExcess,
    );
  });

  test('the borrower tries to close an already closed lease - should produce an error', async () => {
    await sendInitExecuteFeeTokens(
      feederWallet,
      borrowerWallet.address as string,
    );

    // mainLease is now closed due to the previous test
    const result = () =>
      leaseInstance.closeLease(
        mainLeaseAddress,
        borrowerWallet,
        customFees.exec,
      );

    await expect(result).rejects.toThrow(/^.*The underlying loan is closed.*/);
  });
});
