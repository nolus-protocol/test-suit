import { DeliverTxResponse } from '@cosmjs/stargate';
import { NolusWallet } from '@nolus/nolusjs';
import { getUser1Wallet } from './clients';
import { customFees } from './utils';

export async function sendInitTransferFeeTokens(
  client: NolusWallet,
  receiverAdr: string,
): Promise<DeliverTxResponse> {
  return await client.transferAmount(
    receiverAdr,
    customFees.transfer.amount,
    customFees.transfer,
    '',
  );
}

export async function sendInitExecuteFeeTokens(
  client: NolusWallet,
  receiverAdr: string,
): Promise<DeliverTxResponse> {
  return await client.transferAmount(
    receiverAdr,
    customFees.exec.amount,
    customFees.transfer,
    '',
  );
}
export async function returnRestToMainAccount(
  sender: NolusWallet,
  denom: string,
): Promise<void> {
  const mainAccount = await getUser1Wallet();
  const senderBalance = await sender.getBalance(
    sender.address as string,
    denom,
  );
  const amount = {
    amount: (
      BigInt(senderBalance.amount) -
      BigInt(customFees.transfer.amount[0].amount)
    ).toString(),
    denom: denom,
  };
  await sender.transferAmount(mainAccount.address as string, [amount], 1.3);
}
