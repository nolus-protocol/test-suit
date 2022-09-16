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
  let lppInstance: NolusContracts.Lpp;
  let leaserInstance: NolusContracts.Leaser;
  let mainLeaseAddress: string;
  let cosm: any;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;

  const downpayment = '100';

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    cosm = await NolusClient.getInstance().getCosmWasmClient();

    feederWallet = await getUser1Wallet();
    borrowerWallet = await createWallet();

    lppInstance = new NolusContracts.Lpp(cosm, lppContractAddress);
    leaserInstance = new NolusContracts.Leaser(cosm, leaserContractAddress);

    const lppConfig = await lppInstance.getLppConfig();
    lppDenom = lppConfig.lpn_symbol;

    const initDeposit = '1000';
    await lppInstance.deposit(feederWallet, customFees.exec, [
      { denom: lppDenom, amount: initDeposit },
    ]);

    // get the liquidity
    lppLiquidity = await cosm.getBalance(lppContractAddress, lppDenom);
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

    const leaseInstance = new NolusContracts.Lease(cosm, mainLeaseAddress);
    const result = () =>
      leaseInstance.closeLease(borrowerWallet, customFees.exec);

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

    await leaseInstance.repayLease(borrowerWallet, customFees.exec, [payment]);

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

  test('unauthorized user tries to close unpaid lease - should produce an error', async () => {
    const newUserWallet = await createWallet();

    const leaseInstance = new NolusContracts.Lease(cosm, mainLeaseAddress);
    const leaseState = await leaseInstance.getLeaseStatus();

    expect(leaseState.opened).toBeDefined();

    await sendInitExecuteFeeTokens(
      feederWallet,
      newUserWallet.address as string,
    );
    const result = () =>
      leaseInstance.closeLease(newUserWallet, customFees.exec);

    await expect(result).rejects.toThrow(/^.*Unauthorized.*/);
  });

  test('the successful scenario for lease closing - should work as expected', async () => {
    const borrowerBalanceBefore = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    const leaseInstance = new NolusContracts.Lease(cosm, mainLeaseAddress);
    const leaseStateBeforeRepay = (await leaseInstance.getLeaseStatus()).opened;

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
      borrowerWallet,
      customFees.exec,
      [repayAll],
    );

    const principalPaid = getPrincipalPaidFromRepayResponse(repayTxReponse);

    const exactExcess =
      BigInt(principalPaid) - BigInt(leasePrincipalBeforeRepay);

    const leaseStateAfterRepay = await leaseInstance.getLeaseStatus();
    expect(leaseStateAfterRepay.paid).toBeDefined();

    const leasesAfterRepay = await leaserInstance.getCurrentOpenLeasesByOwner(
      borrowerWallet.address as string,
    );

    // unauthorized user tries to close paid lease

    const newUserWallet = await createWallet();

    await sendInitExecuteFeeTokens(
      feederWallet,
      newUserWallet.address as string,
    );
    const result = () =>
      leaseInstance.closeLease(newUserWallet, customFees.exec);

    await expect(result).rejects.toThrow(/^.*Unauthorized.*/);

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
    const leaseInstance = new NolusContracts.Lease(cosm, mainLeaseAddress);
    const result = () =>
      leaseInstance.closeLease(borrowerWallet, customFees.exec);

    await expect(result).rejects.toThrow(/^.*The underlying loan is closed.*/);
  });
});
