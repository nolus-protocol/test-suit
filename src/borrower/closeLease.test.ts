import NODE_ENDPOINT, { getUser1Wallet, createWallet } from '../util/clients';
import { Coin } from '@cosmjs/amino';
import { customFees, undefinedHandler } from '../util/utils';
import { NolusClient, NolusWallet, NolusContracts } from '@nolus/nolusjs';
import { sendInitExecuteFeeTokens } from '../util/transfer';

describe('Leaser contract tests - Close lease', () => {
  let user1Wallet: NolusWallet;
  let borrowerWallet: NolusWallet;
  let lppLiquidity: Coin;
  let lppDenom: string;
  let leaseInstance: NolusContracts.Lease;
  let mainLeaseAddress: string;
  let secondLeaseAddress: string;

  const leaserContractAddress = process.env.LEASER_ADDRESS as string;
  const lppContractAddress = process.env.LPP_ADDRESS as string;

  const downpayment = '100';

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);
    user1Wallet = await getUser1Wallet();
    borrowerWallet = await createWallet();

    const cosm = await NolusClient.getInstance().getCosmWasmClient();
    leaseInstance = new NolusContracts.Lease(cosm);

    const lppConfig = await leaseInstance.getLppConfig(lppContractAddress);
    lppDenom = lppConfig.lpn_symbol;

    // send init tokens to lpp address to provide liquidity
    await user1Wallet.transferAmount(
      lppContractAddress,
      [{ denom: lppDenom, amount: '1000' }],
      customFees.transfer,
    );

    // get the liquidity
    lppLiquidity = await user1Wallet.getBalance(lppContractAddress, lppDenom);
    expect(lppLiquidity.amount).not.toBe('0');

    await user1Wallet.transferAmount(
      borrowerWallet.address as string,
      [{ denom: lppDenom, amount: downpayment }],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      user1Wallet,
      borrowerWallet.address as string,
    );

    const result = await leaseInstance.openLease(
      leaserContractAddress,
      borrowerWallet,
      lppDenom,
      customFees.exec,
      [{ denom: lppDenom, amount: downpayment }],
    );

    mainLeaseAddress = result.logs[0].events[7].attributes[3].value;
  });

  test('the borrower tries to close a lease before it is paid - should produce an error', async () => {
    const leasesBefore = await leaseInstance.getCurrentOpenLeases(
      leaserContractAddress,
      borrowerWallet.address as string,
    );

    await sendInitExecuteFeeTokens(
      user1Wallet,
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

    const leasesAfter = await leaseInstance.getCurrentOpenLeases(
      leaserContractAddress,
      borrowerWallet.address as string,
    );

    expect(leasesBefore.length).toEqual(leasesAfter.length);
  });

  test('the successful scenario for lease closing - should work as expected', async () => {
    const borrowerBalanceBefore = await borrowerWallet.getBalance(
      borrowerWallet.address as string,
      lppDenom,
    );

    const leaseStateBeforeRepay = await leaseInstance.getLeaseStatus(
      mainLeaseAddress,
    );

    const loanAmount = leaseStateBeforeRepay.opened?.amount.amount;
    const cInterest = leaseStateBeforeRepay.opened?.interest_due.amount;
    const cPrincipal = leaseStateBeforeRepay.opened?.principal_due.amount;

    if (!cInterest || !cPrincipal || !loanAmount) {
      undefinedHandler();
      return;
    }

    // send some tokens to the borrower
    // for the payment and fees
    const repayAll = {
      denom: lppDenom,
      amount: Math.floor(+cInterest + +cPrincipal).toString(),
    };

    await user1Wallet.transferAmount(
      borrowerWallet.address as string,
      [repayAll],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      user1Wallet,
      borrowerWallet.address as string,
    );

    await leaseInstance.repayLease(
      mainLeaseAddress,
      borrowerWallet,
      customFees.exec,
      [repayAll],
    );

    const leaseStateAfterRepay = await leaseInstance.getLeaseStatus(
      mainLeaseAddress,
    );

    expect(leaseStateAfterRepay.paid).toBeDefined();

    const leasesAfterRepay = await leaseInstance.getCurrentOpenLeases(
      leaserContractAddress,
      borrowerWallet.address as string,
    );

    await sendInitExecuteFeeTokens(
      user1Wallet,
      borrowerWallet.address as string,
    );
    // close
    await leaseInstance.closeLease(
      mainLeaseAddress,
      borrowerWallet,
      customFees.exec,
    );

    const leasesAfterClose = await leaseInstance.getCurrentOpenLeases(
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

    expect(+borrowerBalanceAfter.amount).toBe(
      +borrowerBalanceBefore.amount + +loanAmount,
    );
  });

  test('the borrower tries to close an already closed lease - should produce an error', async () => {
    await sendInitExecuteFeeTokens(
      user1Wallet,
      borrowerWallet.address as string,
    );

    const result = () =>
      leaseInstance.closeLease(
        mainLeaseAddress,
        borrowerWallet,
        customFees.exec,
      );

    await expect(result).rejects.toThrow(/^.*The underlying loan is closed.*/);
  });

  test('the borrower tries to close a brand new lease - should produce an error', async () => {
    // send some tokens to the borrower
    // for the downpayment and fees
    await user1Wallet.transferAmount(
      borrowerWallet.address as string,
      [{ denom: lppDenom, amount: downpayment }],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(
      user1Wallet,
      borrowerWallet.address as string,
    );

    const result = await leaseInstance.openLease(
      leaserContractAddress,
      borrowerWallet,
      lppDenom,
      customFees.exec,
      [{ denom: lppDenom, amount: downpayment }],
    );

    secondLeaseAddress = result.logs[0].events[7].attributes[3].value;

    expect(secondLeaseAddress).not.toBe('');

    await sendInitExecuteFeeTokens(
      user1Wallet,
      borrowerWallet.address as string,
    );

    const closeResult = () =>
      leaseInstance.closeLease(
        secondLeaseAddress,
        borrowerWallet,
        customFees.exec,
      );

    await expect(closeResult).rejects.toThrow(
      /^.*The underlying loan is not fully repaid.*/,
    );
  });

  test('unauthorized user tries to close the lease - should produce an error', async () => {
    const userWallet = await createWallet();

    const leaseStateBeforeRepay = await leaseInstance.getLeaseStatus(
      secondLeaseAddress,
    );

    const cInterest = leaseStateBeforeRepay.opened?.interest_due.amount;
    const cPrincipal = leaseStateBeforeRepay.opened?.principal_due.amount;

    if (!cInterest || !cPrincipal) {
      undefinedHandler();
      return;
    }

    const repayAll = {
      denom: lppDenom,
      amount: Math.floor(+cInterest + +cPrincipal).toString(),
    };

    // send some tokens to the borrower
    // for the payment and fees
    await user1Wallet.transferAmount(
      userWallet.address as string,
      [repayAll],
      customFees.transfer,
    );
    await sendInitExecuteFeeTokens(user1Wallet, userWallet.address as string);

    await leaseInstance.repayLease(
      secondLeaseAddress,
      userWallet,
      customFees.exec,
      [repayAll],
    );

    const leaseStateAfterRepay = await leaseInstance.getLeaseStatus(
      secondLeaseAddress,
    );

    expect(leaseStateAfterRepay.paid).toBeDefined(); // TO DO: maybe this will return 'Closed'

    await sendInitExecuteFeeTokens(user1Wallet, userWallet.address as string);
    const result = () =>
      leaseInstance.closeLease(secondLeaseAddress, userWallet, customFees.exec);

    await expect(result).rejects.toThrow(/^.*Unauthorized.*/);
  });
});
