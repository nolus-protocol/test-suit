import {
  assertIsDeliverTxSuccess,
  Coin,
  DeliverTxResponse,
} from '@cosmjs/stargate';
import { NolusClient, NolusWallet } from '@nolus/nolusjs';
import NODE_ENDPOINT, { getUser1Wallet, getUser2Wallet } from '../util/clients';
import {
  customFees,
  fee_divisor,
  GASPRICE,
  NATIVE_MINIMAL_DENOM,
  VALIDATOR_PART,
} from '../util/utils';

describe('Fee tests', () => {
  let user1Wallet: NolusWallet;
  let user2Wallet: NolusWallet;
  let fee: any;
  let transferAmount: Coin;

  const acceptedDenoms = JSON.parse(process.env.ACCEPTED_DENOMS || '[]');

  async function tryBankTransfer(errorMsg: RegExp) {
    const broadcastTx = () =>
      user1Wallet.transferAmount(
        user2Wallet.address as string,
        [transferAmount],
        fee,
      );

    await expect(broadcastTx).rejects.toThrow(errorMsg);
  }

  beforeAll(async () => {
    NolusClient.setInstance(NODE_ENDPOINT);

    user1Wallet = await getUser1Wallet();
    user2Wallet = await getUser2Wallet();

    transferAmount = {
      denom: NATIVE_MINIMAL_DENOM,
      amount: '100',
    };

    fee = {
      gas: '200000',
      amount: [
        {
          amount: Math.floor((200000 * GASPRICE) / fee_divisor).toString(),
          denom: '',
        },
      ],
    };
  });

  test('user should be able to pay the fee in any of the supported currencies - should work as expected', async () => {
    const feeParams = acceptedDenoms[0];
    const feeDenom = feeParams.denom;
    const feeDenomPrice = feeParams.minPrice;
    const transferGas = customFees.transfer.gas;

    fee.amount[0].denom = feeDenom;
    const feeAmount = Math.trunc(+transferGas * +feeDenomPrice);

    const profitAddress = feeParams.profit;
    const profitBalanceBefore = await user1Wallet.getBalance(
      profitAddress,
      feeDenom,
    );

    const balanceTransferDenomBefore = await user1Wallet.getBalance(
      user1Wallet.address as string,
      transferAmount.denom,
    );

    const balanceFeeDenomBefore = await user1Wallet.getBalance(
      user1Wallet.address as string,
      feeDenom,
    );

    fee.amount[0].amount = feeAmount.toString();

    const broadcastTx: DeliverTxResponse = await user1Wallet.transferAmount(
      user2Wallet.address as string,
      [transferAmount],
      fee,
    );

    assertIsDeliverTxSuccess(broadcastTx);

    const profitBalanceAfter = await user1Wallet.getBalance(
      profitAddress,
      feeDenom,
    );

    const profitPercent = 1 - VALIDATOR_PART;
    expect(BigInt(profitBalanceAfter.amount)).toBe(
      BigInt(profitBalanceBefore.amount) + BigInt(feeAmount * profitPercent),
    );

    const balanceTransferDenomAfter = await user1Wallet.getBalance(
      user1Wallet.address as string,
      transferAmount.denom,
    );

    const balanceFeeDenomAfter = await user1Wallet.getBalance(
      user1Wallet.address as string,
      feeDenom,
    );

    expect(BigInt(balanceFeeDenomAfter.amount)).toBe(
      BigInt(balanceFeeDenomBefore.amount) - BigInt(feeAmount),
    );

    expect(BigInt(balanceTransferDenomAfter.amount)).toBe(
      BigInt(balanceTransferDenomBefore.amount) - BigInt(transferAmount.amount),
    );
  });

  test('user tries to pay an insufficient fee - should produce an error', async () => {
    const feeParams = acceptedDenoms[0];
    const feeDenom = feeParams.denom;
    const feeDenomPrice = feeParams.minPrice;
    const transferGas = customFees.transfer.gas;

    fee.amount[0].denom = feeDenom;

    const feeAmount = Math.trunc(+transferGas * +feeDenomPrice);
    fee.amount[0].amount = (feeAmount - 1).toString();

    await tryBankTransfer(/^.*insufficient fee.*/);
  });

  test('user tries to pay the fee with amount = "0" - should produce an error', async () => {
    fee.amount[0].denom = acceptedDenoms[0].denom;
    fee.amount[0].amount = '0';

    await tryBankTransfer(/^.*insufficient fee.*/);
  });

  test('user tries to pay the fee with more amount than he owns - should produce an error', async () => {
    const feeDenom = acceptedDenoms[0].denom;
    fee.amount[0].denom = feeDenom;

    const senderBalanceFeeDenomBefore = await user1Wallet.getBalance(
      user1Wallet.address as string,
      feeDenom,
    );

    fee.amount[0].amount = (
      +senderBalanceFeeDenomBefore.amount + 100
    ).toString();

    await tryBankTransfer(/^.*insufficient funds.*/);
  });
});
