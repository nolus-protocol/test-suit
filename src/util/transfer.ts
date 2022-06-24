import { DeliverTxResponse } from '@cosmjs/stargate';
import { NolusWallet } from '@nolus/nolusjs';
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
